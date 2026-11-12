import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClientEnergyPvSummary, resolveClientEnergyBatteryPresence } from './client-energy-pv-summary';
import type { OfferMeasurementInterval, OfferMeasurementSeries } from './offer-measurements';

const localDateTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function fixture(options: {
  months?: string[];
  fromUtc?: string;
  untilUtc?: string;
  exports?: (hour: number, period: string) => number;
  pv?: (hour: number, period: string) => number;
} = {}) {
  const periodKeys = options.months || ['2026-01'];
  const fromUtc = options.fromUtc || (periodKeys[0] === '2026-01' ? '2025-12-31T23:00:00.000Z' : '2026-01-31T23:00:00.000Z');
  const untilUtc = options.untilUtc || (periodKeys.length === 1
    ? '2026-01-31T23:00:00.000Z'
    : '2026-02-28T23:00:00.000Z');
  const start = Date.parse(fromUtc), until = Date.parse(untilUtc);
  const modelHours: Array<{ startUtc: string; pvKwh: number }> = [];
  const intervals: OfferMeasurementInterval[] = [];
  const monthHourIndexes = new Map<string, number>();
  for (let epoch = start; epoch < until; epoch += 3_600_000) {
    const startUtc = new Date(epoch).toISOString();
    const endUtc = new Date(epoch + 3_600_000).toISOString();
    const localStart = localDateTime.format(new Date(epoch));
    const localEnd = localDateTime.format(new Date(epoch + 3_600_000));
    const period = localStart.slice(0, 7);
    const index = monthHourIndexes.get(period) || 0;
    monthHourIndexes.set(period, index + 1);
    const pvKwh = options.pv?.(index, period) ?? 0;
    const exportKwh = options.exports?.(index, period) ?? 0;
    modelHours.push({ startUtc, pvKwh });
    intervals.push({
      localStart, localEnd, startUtc, endUtc, occurrence: 1,
      import: { valueKwh: 0, source: 'measured', fileIds: ['import'] },
      export: { valueKwh: exportKwh, source: 'measured', fileIds: ['export'] },
    });
  }
  const exportPeriods = new Set(intervals.map((interval) => interval.localStart.slice(0, 7)));
  const measurementSeries: OfferMeasurementSeries = {
    ppeNumber: '590310600030743962', projectId: 'project', missingMonths: [], missingDirections: [], files: [],
    periods: periodKeys.map((period) => ({ period, hasImport: true, hasExport: exportPeriods.has(period), missingDirections: [] })),
    intervals,
  };
  const months = periodKeys.map((period) => ({
    period,
    importKwh: 0,
    exportKwh: exportPeriods.has(period) ? 0 : null,
  }));
  return { periodKeys, fromUtc, untilUtc, modelHours, measurementSeries, months };
}

function summarize(data: ReturnType<typeof fixture>, existingBatteryPresent: boolean | null = false) {
  return buildClientEnergyPvSummary({
    ...data,
    modelError: null,
    modelUrl: '/api/projects/project/pv-profile',
    existingBatteryPresent,
  });
}

test('self-consumption sums hourly max(model PV - export, 0), not annual subtraction', () => {
  const data = fixture({ pv: (hour) => hour < 2 ? 1 : 0, exports: (hour) => hour === 0 ? 2 : 0 });
  const result = summarize(data);

  assert.equal(result.productionKwh, 2);
  assert.equal(result.selfConsumptionKwh, 1);
  assert.notEqual(result.selfConsumptionKwh, Math.max(result.productionKwh! - 2, 0));
  assert.equal(result.coveredMonths, 1);
  assert.equal(result.totalMonths, 1);
  assert.equal(result.coveredHours, 744);
  assert.equal(result.totalHours, 744);
});

test('partial analysis sums only complete export months without extrapolating', () => {
  const data = fixture({ months: ['2026-01', '2026-02'], pv: () => 1 });
  data.measurementSeries.periods[1] = {
    period: '2026-02', hasImport: false, hasExport: false, missingDirections: ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'],
  };
  data.measurementSeries.intervals = data.measurementSeries.intervals.filter((interval) => interval.localStart.startsWith('2026-01'));
  data.months[1].importKwh = null;

  const result = summarize(data);

  assert.equal(result.productionKwh, 1416);
  assert.equal(result.selfConsumptionKwh, 744);
  assert.equal(result.coveredMonths, 1);
  assert.equal(result.totalMonths, 2);
  assert.equal(result.coveredHours, 744);
  assert.equal(result.totalHours, 1416);
  assert.ok(result.issues.some((issue) => issue.includes('744/1416')));
});

test('invalid battery capacity and present battery keep self-consumption unknown with an explicit reason', () => {
  const data = fixture({ pv: () => 1 });
  const unknown = summarize(data, null);
  const present = summarize(data, true);

  assert.equal(unknown.productionKwh, 744);
  assert.equal(unknown.selfConsumptionKwh, null);
  assert.equal(unknown.coveredMonths, 1);
  assert.equal(unknown.coveredHours, 744);
  assert.ok(unknown.issues.some((issue) => issue.includes('Pojemność istniejącego magazynu energii jest nieprawidłowa')));
  assert.equal(present.selfConsumptionKwh, null);
  assert.equal(present.coveredMonths, 1);
  assert.ok(present.issues.some((issue) => issue.includes('przepływach magazynu')));
});

test('empty saved battery capacity means no existing battery in energy data', () => {
  for (const capacity of [null, undefined, '', '  ', 0, '0']) {
    assert.equal(resolveClientEnergyBatteryPresence(capacity), false);
  }
  assert.equal(resolveClientEnergyBatteryPresence(5), true);
  assert.equal(resolveClientEnergyBatteryPresence('8.5'), true);
  assert.equal(resolveClientEnergyBatteryPresence({ toNumber: () => 16 }), true);
  for (const capacity of [-1, 'invalid', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(resolveClientEnergyBatteryPresence(capacity), null);
  }
});

test('no entered battery enables self-consumption from measured exports and model PV', () => {
  const data = fixture({ pv: () => 1, exports: () => 0.25 });
  const result = summarize(data, resolveClientEnergyBatteryPresence(null));
  assert.equal(result.selfConsumptionKwh, 558);
  assert.equal(result.coveredHours, 744);
  assert.ok(!result.issues.some((issue) => /magazyn|nieznana/.test(issue)));
  assert.doesNotMatch(result.note, /potwierdzenia braku magazynu/);
});

test('model-only project still returns production without accounts or import/export data', () => {
  const data = fixture({ pv: () => 0.5 });
  const result = buildClientEnergyPvSummary({
    ...data, measurementSeries: null, months: [], existingBatteryPresent: null,
    modelUrl: '/api/projects/project/pv-profile',
  });

  assert.equal(result.productionKwh, 372);
  assert.equal(result.selfConsumptionKwh, null);
  assert.equal(result.coveredMonths, 0);
  assert.equal(result.coveredHours, 0);
  assert.equal(result.totalHours, 744);
  assert.equal(result.modelUrl, '/api/projects/project/pv-profile');
});

test('model production below measured export is explicit', () => {
  const data = fixture({ pv: (hour) => hour === 0 ? 1 : 0, exports: (hour) => hour === 0 ? 2 : 0 });
  const result = summarize(data);

  assert.equal(result.selfConsumptionKwh, 0);
  assert.ok(result.issues.some((issue) => issue.includes('przewyższa model PV')));
});

test('one missing ENEA export hour preserves the other 719 measured hours', () => {
  const data = fixture({
    months: ['2025-06'],
    fromUtc: '2025-05-31T22:00:00.000Z',
    untilUtc: '2025-06-30T22:00:00.000Z',
    pv: () => 1,
  });
  const missingHour = data.measurementSeries.intervals.find((interval) => interval.startUtc === '2025-06-26T19:00:00.000Z');
  assert.ok(missingHour, 'Fixture should contain the reported missing UTC hour.');
  missingHour.export = null;

  const result = summarize(data);

  assert.equal(result.productionKwh, 720);
  assert.equal(result.selfConsumptionKwh, 719);
  assert.equal(result.coveredMonths, 0);
  assert.equal(result.coveredHours, 719);
  assert.equal(result.totalHours, 720);
  assert.ok(result.issues.some((issue) => issue.includes('719/720 zmierzonych godzin')));
  assert.ok(!result.issues.some((issue) => issue.includes('brakujące miesiące')));
});

test('invalid or partial model coverage is reported instead of extrapolated', () => {
  const data = fixture({ pv: () => 1 });
  const result = buildClientEnergyPvSummary({
    ...data, modelHours: data.modelHours.slice(0, -1), existingBatteryPresent: false,
    modelError: 'Model PV zwrócił niepełny okres.',
  });

  assert.equal(result.productionKwh, null);
  assert.equal(result.selfConsumptionKwh, null);
  assert.equal(result.modelUrl, null);
  assert.ok(result.issues.includes('Model PV zwrócił niepełny okres.'));
});

test('roczne zużycie lokalne wymaga kompletnych godzin i braku istniejącego magazynu', () => {
  const data = fixture({ pv: () => 2, exports: () => 1 });
  for (const row of data.measurementSeries.intervals) row.import!.valueKwh = 3;
  assert.equal(summarize(data).loadKwh, data.modelHours.length * 4);
  assert.equal(summarize(data, true).loadKwh, null);
  data.measurementSeries.intervals[2].import = null;
  assert.equal(summarize(data).loadKwh, null);
});
