import assert from 'node:assert/strict';
import test from 'node:test';
import type { OfferMeasurementInterval, OfferMeasurementSeries, OfferMeasurementSource } from './offer-measurements';
import {
  completeOfferMeasurementGaps,
  type OfferMeasurementGapCandidate,
  type OfferMeasurementGapInput,
  type OfferMeasurementGapCalendarInterval,
} from './offer-measurement-gap-model';

const hourMs = 60 * 60 * 1000;

function calendarForHours(count: number, start = '2026-01-01T00:00:00.000Z'): OfferMeasurementGapCalendarInterval[] {
  const first = Date.parse(start);
  return Array.from({ length: count }, (_, index) => {
    const startUtc = new Date(first + index * hourMs).toISOString();
    const endUtc = new Date(first + (index + 1) * hourMs).toISOString();
    return { startUtc, endUtc, localStart: startUtc, localEnd: endUtc, occurrence: 1 };
  });
}

function reading(valueKwh: number, source: OfferMeasurementSource['source'] = 'measured'): OfferMeasurementSource {
  return { valueKwh, source, fileIds: ['meter-file'] };
}

function interval(
  calendar: OfferMeasurementGapCalendarInterval,
  imported: OfferMeasurementSource | null = null,
  exported: OfferMeasurementSource | null = null,
): OfferMeasurementInterval {
  return { ...calendar, import: imported, export: exported };
}

function seriesFor(
  calendar: OfferMeasurementGapCalendarInterval[],
  intervals: OfferMeasurementInterval[] = [],
): OfferMeasurementSeries {
  const periods = [...new Set(calendar.map(({ localStart }) => localStart.slice(0, 7)))].sort();
  return {
    ppeNumber: '590000000000000001',
    projectId: 'project-1',
    periods: periods.map((period) => ({ period, hasImport: false, hasExport: false, missingDirections: ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'] })),
    missingMonths: periods,
    missingDirections: periods.flatMap((period) => [
      { period, kind: 'ACTIVE_IMPORT' as const },
      { period, kind: 'ACTIVE_EXPORT' as const },
    ]),
    intervals,
    files: [],
  };
}

function candidate(loadShape: number[], key = 'reference-seasonal', name = 'Profil sezonowy'): OfferMeasurementGapCandidate {
  return { key, name, contentHash: `sha256-${key}`, loadShape };
}

function inputFor(
  calendar: OfferMeasurementGapCalendarInterval[],
  intervals: OfferMeasurementInterval[],
  loadShape: number[],
  pvKwh = calendar.map(() => 0),
): OfferMeasurementGapInput {
  return { series: seriesFor(calendar, intervals), calendar, pvKwh, candidates: [candidate(loadShape)], invoices: [] };
}

test('measured values including zero stay unchanged and the best seasonal shape fills gaps', () => {
  const calendar = calendarForHours(24);
  const existing = [
    interval(calendar[0], reading(1), reading(0)),
    interval(calendar[1], reading(4), reading(0)),
    interval(calendar[2], reading(0), reading(0)),
  ];
  const seasonalShape = [1, 4, 0, 3, ...Array.from({ length: 20 }, (_, index) => 1 + (index % 4))];
  const flatShape = calendar.map(() => 1);
  const input = inputFor(calendar, existing, seasonalShape);
  input.candidates = [candidate(flatShape, 'flat', 'Profil płaski'), candidate(seasonalShape, 'seasonal', 'Profil sezonowy')];

  const result = completeOfferMeasurementGaps(input);

  assert.equal(result.provenance.profileKey, 'seasonal');
  assert.equal(result.provenance.calibrationHours, 3);
  assert.equal(result.provenance.confidence, 'low');
  assert.deepEqual(result.series.intervals.slice(0, 3), existing);
  assert.equal(result.series.intervals[3].import?.valueKwh, 3);
  assert.equal(result.series.intervals[3].export?.valueKwh, 0);
  assert.equal(result.series.intervals[3].import?.source, 'modelled');
  assert.deepEqual(result.series.intervals[3].import?.fileIds, []);
  assert.deepEqual(result.series.missingDirections, []);
});

test('one physical-import invoice calibrates missing hours to its exact residual', () => {
  const calendar = calendarForHours(24);
  const knownImport = interval(calendar[0], reading(2, 'modelled'), null);
  const input = inputFor(calendar, [knownImport], calendar.map(() => 1));
  input.invoices = [{ id: 'invoice-jan', fromDate: '2026-01-01', toDate: '2026-01-01', importKwh: 50 }];

  const result = completeOfferMeasurementGaps(input);

  const totalImport = result.series.intervals.reduce((sum, row) => sum + row.import!.valueKwh, 0);
  assert.ok(Math.abs(totalImport - 50) < 1e-8);
  assert.equal(result.series.intervals[0].import, knownImport.import);
  assert.equal(result.series.intervals[0].export?.source, 'modelled');
  assert.equal(result.provenance.calibrationHours, 0);
  assert.equal(result.provenance.confidence, 'low');
  assert.equal(result.provenance.invoiceIds[0], 'invoice-jan');
  assert.equal(result.provenance.modelledHours, 24);
});

test('confirmed no-PV import-only readings calibrate load and model zero export', () => {
  const calendar = calendarForHours(24);
  const input = inputFor(calendar, [interval(calendar[0], reading(2), null)], calendar.map(() => 1));

  const result = completeOfferMeasurementGaps(input);

  assert.equal(result.provenance.calibrationHours, 1);
  assert.equal(result.series.intervals[1].import?.valueKwh, 2);
  assert.equal(result.series.intervals[1].export?.valueKwh, 0);
  assert.equal(result.series.intervals[1].export?.source, 'modelled');
});

test('reused modelled readings with source-period provenance can calibrate at low confidence', () => {
  const calendar = calendarForHours(24);
  const shape = calendar.map((_, index) => 1 + (index % 4));
  const oldImportFileId = 'reused-import';
  const oldExportFileId = 'reused-export';
  const existing = calendar.slice(0, 12).map((hour, index) => interval(
    hour,
    { valueKwh: shape[index], source: 'modelled', fileIds: [oldImportFileId] },
    { valueKwh: 0, source: 'modelled', fileIds: [oldExportFileId] },
  ));
  const input = inputFor(calendar, existing, shape);
  input.series.files = [
    { id: oldImportFileId, period: '2026-01', kind: 'ACTIVE_IMPORT', ppeNumber: input.series.ppeNumber, totalKwh: 30, rowsCount: 12, sourcePeriod: '2025-01' },
    { id: oldExportFileId, period: '2026-01', kind: 'ACTIVE_EXPORT', ppeNumber: input.series.ppeNumber, totalKwh: 0, rowsCount: 12, sourcePeriod: '2025-01' },
  ];

  const result = completeOfferMeasurementGaps(input);

  assert.equal(result.provenance.calibrationHours, 12);
  assert.equal(result.provenance.confidence, 'low');
  assert.equal(result.provenance.profileKey, 'reference-seasonal');
  assert.equal(result.series.intervals[12].import?.valueKwh, shape[12]);
});

test('estimated-only anchors keep confidence low', () => {
  const calendar = calendarForHours(24);
  const existing = calendar.slice(0, 12).map((hour) => interval(hour, reading(1, 'estimated'), reading(0, 'estimated')));
  const input = inputFor(calendar, existing, calendar.map(() => 1));

  const result = completeOfferMeasurementGaps(input);

  assert.equal(result.provenance.estimatedCalibrationHours, 12);
  assert.equal(result.provenance.measuredCalibrationHours, 0);
  assert.equal(result.provenance.confidence, 'low');
});

test('profile ranking retains hourly seasonal shape after scalar calibration', () => {
  const calendar = calendarForHours(24);
  const shape = [1, 4, ...Array.from({ length: 22 }, (_, index) => 1 + (index % 3))];
  const existing = [interval(calendar[0], reading(1), reading(0)), interval(calendar[1], reading(4), reading(0))];
  const input = inputFor(calendar, existing, shape);
  input.candidates = [candidate(calendar.map(() => 1), 'flat', 'Profil płaski'), candidate(shape, 'seasonal', 'Profil sezonowy')];

  const result = completeOfferMeasurementGaps(input);

  assert.equal(result.provenance.profileKey, 'seasonal');
  assert.equal(result.series.intervals[2].import?.valueKwh, shape[2]);
  assert.equal(result.series.intervals[3].import?.valueKwh, shape[3]);
});

test('measured calibration conserves total observed energy instead of least-squares fitting', () => {
  const calendar = calendarForHours(24);
  const shape = [1, 3, 7, ...Array.from({ length: 21 }, (_, index) => 1 + (index % 2))];
  const existing = [
    interval(calendar[0], reading(2), reading(0)),
    interval(calendar[1], reading(2), reading(0)),
  ];
  const input = inputFor(calendar, existing, shape);

  const result = completeOfferMeasurementGaps(input);

  const observedImport = result.series.intervals.slice(0, 2).reduce((sum, row) => sum + row.import!.valueKwh, 0);
  const reconstructedLoad = result.series.intervals[2].import!.valueKwh;
  assert.equal(observedImport, 4);
  assert.equal(result.series.intervals[2].import?.valueKwh, 7);
  assert.ok(result.provenance.fitError > 0, 'The test distinguishes sum-conserving scale from a least-squares fit');
  assert.ok(reconstructedLoad > 6.99 && reconstructedLoad < 7.01);
});

test('medium confidence requires measured coverage in two calendar months and positive load', () => {
  const calendar = calendarForHours(48, '2026-01-31T00:00:00.000Z');
  const existing = [
    ...calendar.slice(0, 12).map((hour) => interval(hour, reading(1), reading(0))),
    ...calendar.slice(24, 36).map((hour) => interval(hour, reading(1), reading(0))),
  ];
  const input = inputFor(calendar, existing, calendar.map(() => 1));

  const result = completeOfferMeasurementGaps(input);

  assert.equal(result.provenance.calibrationHours, 24);
  assert.equal(result.provenance.measuredCalibrationHours, 24);
  assert.equal(result.provenance.confidence, 'medium');
});

test('completion rejects a gap with no measured pair and no invoice anchor', () => {
  const calendar = calendarForHours(24);
  const input = inputFor(calendar, [], calendar.map(() => 1));

  assert.throws(() => completeOfferMeasurementGaps(input), /kotw|skalibrować/i);
});

test('overlapping invoice ranges are rejected before energy is allocated twice', () => {
  const calendar = calendarForHours(72);
  const input = inputFor(calendar, [], calendar.map(() => 1));
  input.invoices = [
    { id: 'invoice-a', fromDate: '2026-01-01', toDate: '2026-01-02', importKwh: 48 },
    { id: 'invoice-b', fromDate: '2026-01-02', toDate: '2026-01-03', importKwh: 48 },
  ];

  assert.throws(() => completeOfferMeasurementGaps(input), /nachodzą na siebie/);
});

test('negative and non-finite inputs are rejected', () => {
  const calendar = calendarForHours(24);
  const negativePv = inputFor(calendar, [], calendar.map(() => 1), calendar.map((_, index) => index === 0 ? -0.1 : 0));
  assert.throws(() => completeOfferMeasurementGaps(negativePv), /nieujemną/);

  const infiniteShape = inputFor(calendar, [], calendar.map((_, index) => index === 0 ? Number.POSITIVE_INFINITY : 1));
  assert.throws(() => completeOfferMeasurementGaps(infiniteShape), /skończoną/);
});

test('a complete input is an identity no-op even without reference profiles', () => {
  const calendar = calendarForHours(24);
  const original = calendar.map((hour, index) => interval(hour, reading(index === 0 ? 0 : 1), reading(0)));
  const input = inputFor(calendar, original, calendar.map(() => 1));
  input.candidates = [];

  const result = completeOfferMeasurementGaps(input);

  assert.strictEqual(result.series, input.series);
  assert.equal(result.provenance.profileKey, null);
  assert.equal(result.provenance.modelledHours, 0);
  assert.equal(result.provenance.fitError, 0);
});

test('an export invoice mismatch is surfaced while preserving load-versus-PV model output', () => {
  const calendar = calendarForHours(24);
  const input = inputFor(calendar, [], calendar.map(() => 1), calendar.map(() => 0.5));
  input.invoices = [{ id: 'invoice-export-conflict', fromDate: '2026-01-01', toDate: '2026-01-01', importKwh: 12, exportKwh: 10 }];

  const result = completeOfferMeasurementGaps(input);

  assert.ok(result.provenance.notes.some((note) => note.includes('faktura invoice-export-conflict')));
  assert.equal(result.series.intervals[0].export?.valueKwh, 0);
  assert.equal(result.series.intervals[0].export?.source, 'modelled');
});

test('a zero-import-only invoice cannot establish zero annual consumption for missing hours', () => {
  const calendar = calendarForHours(24);
  const input = inputFor(calendar, [], calendar.map(() => 1));
  input.invoices = [{ id: 'zero-import', fromDate: '2026-01-01', toDate: '2026-01-01', importKwh: 0 }];

  assert.throws(() => completeOfferMeasurementGaps(input), /zerowym importem nie pozwalają wyznaczyć rocznego obciążenia/);
});
