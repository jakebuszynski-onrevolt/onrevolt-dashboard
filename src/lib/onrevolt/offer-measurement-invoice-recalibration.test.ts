import assert from 'node:assert/strict';
import test from 'node:test';
import type { OfferMeasurementInterval, OfferMeasurementSeries } from './offer-measurements';
import {
  OfferMeasurementInvoiceRecalibrationError,
  recalibrateOfferMeasurementInvoices,
  type OfferMeasurementInvoiceTarget,
} from './offer-measurement-invoice-recalibration';

function interval(
  hour: number,
  importKwh: number | null,
  importSource: 'measured' | 'estimated' | 'modelled' | null,
  exportKwh: number | null,
  exportSource: 'measured' | 'estimated' | 'modelled' | null,
  day = '2026-01-01',
): OfferMeasurementInterval {
  const localHour = String(hour).padStart(2, '0');
  const [year, month, dayNumber] = day.split('-').map(Number);
  const startUtc = new Date(Date.UTC(year, month - 1, dayNumber, hour - 1)).toISOString();
  const endUtc = new Date(Date.UTC(year, month - 1, dayNumber, hour)).toISOString();
  const endDay = hour === 23 ? new Date(Date.UTC(year, month - 1, dayNumber + 1)).toISOString().slice(0, 10) : day;
  return {
    localStart: `${day}T${localHour}:00:00`,
    localEnd: `${endDay}T${String((hour + 1) % 24).padStart(2, '0')}:00:00`,
    startUtc,
    endUtc,
    occurrence: 1,
    import: importKwh === null ? null : { valueKwh: importKwh, source: importSource!, fileIds: [] },
    export: exportKwh === null ? null : { valueKwh: exportKwh, source: exportSource!, fileIds: [] },
  };
}

function series(intervals: OfferMeasurementInterval[]): OfferMeasurementSeries {
  const byStart = new Map(intervals.map((row) => [row.localStart.slice(0, 13), row]));
  const days = [...new Set(intervals.map((row) => row.localStart.slice(0, 10)))];
  const fullIntervals = days.flatMap((day) => Array.from({ length: 24 }, (_, hour) => {
    const localStart = `${day}T${String(hour).padStart(2, '0')}`;
    return byStart.get(localStart) ?? interval(hour, 0, 'modelled', 0, 'modelled', day);
  }));
  return {
    ppeNumber: '590310600001382633',
    periods: [{ period: '2026-01', hasImport: true, hasExport: true, missingDirections: [] }],
    missingMonths: [],
    missingDirections: [],
    intervals: fullIntervals,
    files: [],
  };
}

function invoice(importKwh: number, exportKwh: number, dates = ['2026-01-01', '2026-01-01']): OfferMeasurementInvoiceTarget {
  return { id: 'invoice-1', fromDate: dates[0], toDate: dates[1], importKwh, exportKwh };
}

function assertError(fn: () => unknown, code: OfferMeasurementInvoiceRecalibrationError['code']) {
  assert.throws(fn, (error: unknown) => error instanceof OfferMeasurementInvoiceRecalibrationError
    && error.code === code);
}

test('fits invoice sums to mutable customer-shaped weights and is idempotent', () => {
  const original = series([
    interval(0, 4, 'modelled', 2, 'modelled'),
    interval(1, 1, 'modelled', 5, 'modelled'),
  ]);
  const snapshot = structuredClone(original);
  const target = invoice(18, 12);
  const weights = [
    { startUtc: original.intervals[0].startUtc, importKwh: 6, exportKwh: 1 },
    { startUtc: original.intervals[1].startUtc, importKwh: 4, exportKwh: 6 },
  ];

  const result = recalibrateOfferMeasurementInvoices({ series: original, invoices: [target], weights });
  assert.deepEqual(original, snapshot);
  assert.ok(Math.abs(result.provenance.invoiceResults[0].afterImportKwh - 18) < 1e-9);
  assert.ok(Math.abs(result.provenance.invoiceResults[0].afterExportKwh - 12) < 1e-9);
  assert.equal(result.provenance.invoiceResults[0].changedIntervals, 2);
  for (const row of result.series.intervals) {
    assert.equal(row.import?.source, 'modelled');
    assert.equal(row.export?.source, 'modelled');
    assert.ok(!(row.import!.valueKwh > 1e-9 && row.export!.valueKwh > 1e-9));
  }

  const repeated = recalibrateOfferMeasurementInvoices({ series: result.series, invoices: [target] });
  assert.deepEqual(repeated.series.intervals, result.series.intervals);
  assert.equal(repeated.provenance.invoiceResults[0].changedIntervals, 0);
});

test('preserves real and OSD-estimated readings and adjusts only modelled directions', () => {
  const input = series([
    interval(0, 2, 'measured', 0, 'measured'),
    interval(1, 1, 'estimated', 0, 'estimated'),
    interval(2, null, null, 2, 'modelled'),
    interval(3, 4, 'modelled', null, null),
  ]);
  const fixedMeasured = structuredClone(input.intervals[0]);
  const fixedEstimate = structuredClone(input.intervals[1]);
  const result = recalibrateOfferMeasurementInvoices({
    series: input,
    invoices: [invoice(8, 4)],
  });
  assert.deepEqual(result.series.intervals[0], fixedMeasured);
  assert.deepEqual(result.series.intervals[1], fixedEstimate);
  assert.equal(result.series.intervals[2].export?.valueKwh, 4);
  assert.equal(result.series.intervals[3].import?.valueKwh, 5);
  assert.equal(result.series.intervals[2].import?.source, 'modelled');
  assert.equal(result.series.intervals[3].export?.source, 'modelled');
  assert.equal(result.provenance.invoiceResults[0].preservedMeasuredIntervals, 1);
  assert.equal(result.provenance.invoiceResults[0].preservedEstimatedIntervals, 1);
});

test('nets overlapping mutable hourly weights before scaling so the anchored sums cannot be netted twice', () => {
  const input = series([
    interval(0, 4, 'modelled', 2, 'modelled'),
    interval(1, 1, 'modelled', 3, 'modelled'),
  ]);
  const result = recalibrateOfferMeasurementInvoices({ series: input, invoices: [invoice(8, 4)] });
  assert.equal(result.series.intervals[0].import?.valueKwh, 8);
  assert.equal(result.series.intervals[0].export?.valueKwh, 0);
  assert.equal(result.series.intervals[1].import?.valueKwh, 0);
  assert.equal(result.series.intervals[1].export?.valueKwh, 4);
  assert.equal(result.provenance.invoiceResults[0].afterImportKwh, 8);
  assert.equal(result.provenance.invoiceResults[0].afterExportKwh, 4);
});

test('fails rather than changing fixed readings when invoice totals are below them', () => {
  const input = series([interval(0, 4, 'measured', 0, 'measured'), interval(1, 1, 'modelled', 0, 'modelled')]);
  assertError(() => recalibrateOfferMeasurementInvoices({ series: input, invoices: [invoice(3, 0)] }), 'TARGET_BELOW_FIXED_READINGS');
});

test('leaves hours outside the invoice period byte-for-byte unchanged', () => {
  const input = series([
    interval(0, 4, 'modelled', 2, 'modelled', '2026-01-01'),
    interval(0, 9, 'modelled', 8, 'modelled', '2026-01-02'),
  ]);
  const outside = structuredClone(input.intervals[1]);
  const result = recalibrateOfferMeasurementInvoices({ series: input, invoices: [invoice(6, 0)] });
  assert.deepEqual(result.series.intervals[1], outside);
  assert.equal(result.provenance.invoiceResults[0].afterImportKwh, 6);
  assert.equal(result.provenance.invoiceResults[0].afterExportKwh, 0);
});

test('rejects overlapping invoice targets', () => {
  const input = series([interval(0, 1, 'modelled', 1, 'modelled')]);
  const first = invoice(1, 1, ['2026-01-01', '2026-01-01']);
  const second = { ...first, id: 'invoice-2' };
  assertError(() => recalibrateOfferMeasurementInvoices({ series: input, invoices: [first, second] }), 'OVERLAPPING_INVOICES');
});

test('fails explicitly when invoice requires positive residual but no mutable customer-shaped hours support it', () => {
  const input = series([
    interval(0, 2, 'measured', 0, 'measured'),
    interval(1, 1, 'modelled', 1, 'modelled'),
  ]);
  assertError(() => recalibrateOfferMeasurementInvoices({ series: input, invoices: [invoice(3, 3)] }), 'NO_ELIGIBLE_WEIGHTS');
});

test('does not let a mutable model overlap a fixed opposite-direction reading', () => {
  const input = series([
    interval(0, 2, 'measured', 0, 'measured'),
    interval(1, 5, 'measured', 0, 'measured'),
    interval(2, 0, 'modelled', null, null),
  ]);
  const result = recalibrateOfferMeasurementInvoices({
    series: input,
    invoices: [invoice(7, 2)],
    weights: [{ startUtc: input.intervals[2].startUtc, importKwh: 0, exportKwh: 2 }],
  });
  assert.equal(result.series.intervals[2].export?.valueKwh, 2);
  assert.equal(result.series.intervals[2].import?.valueKwh, 0);
});

test('rejects invoices that exceed the available hour series', () => {
  const input = series([interval(0, 1, 'modelled', 1, 'modelled')]);
  assertError(() => recalibrateOfferMeasurementInvoices({
    series: input,
    invoices: [invoice(1, 1, ['2025-12-31', '2026-01-01'])],
  }), 'INVALID_INPUT');
});

test('rejects sparse hours inside an otherwise covered invoice period', () => {
  const input = series([interval(0, 1, 'modelled', 1, 'modelled')]);
  input.intervals = input.intervals.filter((row) => row.localStart.slice(11, 13) !== '12');
  assertError(() => recalibrateOfferMeasurementInvoices({ series: input, invoices: [invoice(1, 1)] }), 'INVALID_INPUT');
});
