import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { ClientTariffHistory, ClientTariffPayload } from './client-tariffs';
import type { OfferMeasurementInterval } from './offer-measurements';
import { OFFER_TARIFF_ENGINE_SHA256 } from './offer-tariff-engine';
import {
  calculateOfferWorkspaceValuation,
  type CalculateOfferWorkspaceValuationInput,
} from './offer-workspace-valuation';

const vatRate = 0.23;

function tariff(energy = 0.5, distribution = 0.25): ClientTariffPayload {
  const rows = [
    { component_key: 'energy', label: 'Energia czynna', net: energy, gross: energy * (1 + vatRate), vatRate, window_code: 'all' },
    { component_key: 'distribution', label: 'Składnik zmienny stawki sieciowej', net: distribution, gross: distribution * (1 + vatRate), vatRate, window_code: 'all' },
  ];
  return {
    osd_id: 1, tariff_id: 1, code: 'G11', name: 'Test', segment: 'B2C',
    zone_model: 'all', use_monthly: true, fixed: [{ amount: 50, amount_mode: 'per_kw_month', billing_cycle_months: 6 }],
    variable: rows.map(row => ({ ...row, price: row.net })),
    pricing: { tariffStorage: { priceBasis: 'net', vatRate, validFrom: '2025-01-01', fixed: [], variable: rows } },
  };
}

function rdnTariff(): ClientTariffPayload {
  const distribution = { component_key: 'distribution', label: 'Składnik zmienny stawki sieciowej', net: 0.25, gross: 0.3075, vatRate, window_code: 'all' };
  return {
    ...tariff(0, 0.25), sell_method: 'rdn', osd_add_rdn: 0, osd_add_akcyza: 0,
    variable: [{ ...distribution, price: distribution.net }],
    pricing: { tariffStorage: {
      priceBasis: 'net', vatRate, validFrom: '2025-01-01', fixed: [], variable: [distribution],
      market: {
        margin: { net: 0, gross: 0, vatRate },
        excise: { net: 0, gross: 0, vatRate },
      },
    } } as ClientTariffPayload['pricing'],
  } as ClientTariffPayload;
}

function interval(startUtc: string, localStart: string, importKwh: number, exportKwh = 0, durationMs = 3_600_000): OfferMeasurementInterval {
  const start = Date.parse(startUtc);
  const localMatch = /([+-]\d{2}:\d{2}|Z)$/.exec(localStart);
  const offset = localMatch?.[1] || 'Z';
  const localInstant = new Date(Date.parse(localStart.slice(0, 19) + 'Z') + durationMs);
  const localEnd = `${localInstant.toISOString().slice(0, 19)}${offset}`;
  return {
    startUtc: new Date(start).toISOString(),
    endUtc: new Date(start + durationMs).toISOString(),
    localStart,
    localEnd,
    occurrence: 1,
    import: { valueKwh: importKwh, source: 'measured', fileIds: ['import'] },
    export: { valueKwh: exportKwh, source: 'measured', fileIds: ['export'] },
  };
}

function baseInput(intervals: OfferMeasurementInterval[], months: CalculateOfferWorkspaceValuationInput['measurements']['months'], options: Partial<CalculateOfferWorkspaceValuationInput> = {}): CalculateOfferWorkspaceValuationInput {
  const selectedTariff = tariff();
  const history: ClientTariffHistory = {
    strict: true,
    revision: 1,
    byDate: Object.fromEntries(Array.from(new Set(intervals.map(row => row.localStart.slice(0, 10))), date => [date, 'tariff'])),
    tariffs: { tariff: selectedTariff },
    issues: [],
  };
  const scenario = { settlement: 'NET_METERING' as const, source: 'PROJECT_HISTORY' as const, tariffHistory: history };
  return {
    measurements: { months }, intervals, vatBasis: 'GROSS', connectionPowerKw: null,
    current: scenario,
    target: { settlement: 'NET_METERING', source: 'CURRENT_CATALOG', tariff: selectedTariff },
    ...options,
  };
}

test('15-minute measured import is billed in full and day-hour totals sum the four intervals', () => {
  const intervals: OfferMeasurementInterval[] = [];
  const dayStart = Date.parse('2025-01-09T23:00:00.000Z');
  for (let index = 0; index < 96; index += 1) {
    const utc = new Date(dayStart + index * 900_000);
    const local = new Date(utc.getTime() + 3_600_000);
    intervals.push(interval(utc.toISOString(), `${local.toISOString().slice(0, 19)}+01:00`, 0.25));
  }
  const dayHours = Array.from({ length: 24 }, (_, hour) => ({ hour, importKwh: 1, exportKwh: 0 }));
  const input = baseInput(intervals, [{ period: '2025-01', importKwh: 24, exportKwh: 0 }], {
    measurements: { months: [{ period: '2025-01', importKwh: 24, exportKwh: 0 }], dayProfiles: [{ date: '2025-01-10', period: '2025-01', dayType: 'workday', hours: dayHours }] },
  });
  const result = calculateOfferWorkspaceValuation(input);
  assert.equal(result.current.months[0].importValuePln, 22.14);
  assert.equal(result.target.months[0].importValuePln, 22.14);
  assert.equal(result.current.days[0].hours[10].importValuePln, 0.9225);
  assert.equal(result.current.days[0].totals.importValuePln, 22.14);
});

test('local month boundary keeps each measured hour in its own monthly aggregate', () => {
  const intervals = [
    interval('2025-01-31T22:00:00.000Z', '2025-01-31T23:00:00+01:00', 1),
    interval('2025-01-31T23:00:00.000Z', '2025-02-01T00:00:00+01:00', 1),
  ];
  const result = calculateOfferWorkspaceValuation(baseInput(intervals, [
    { period: '2025-01', importKwh: 1, exportKwh: 0 },
    { period: '2025-02', importKwh: 1, exportKwh: 0 },
  ], { vatBasis: 'NET' }));
  assert.deepEqual(result.current.months.map(row => row.importValuePln), [0.75, 0.75]);
  assert.equal(result.current.totals.importValuePln, 1.5);
});

test('repeated autumn DST hour uses each distinct UTC RDN price and counts both imports', () => {
  const intervals = [
    interval('2025-10-26T00:00:00.000Z', '2025-10-26T02:00:00+02:00', 1),
    interval('2025-10-26T01:00:00.000Z', '2025-10-26T02:00:00+01:00', 1),
  ];
  const dynamic = rdnTariff();
  const history: ClientTariffHistory = {
    strict: true, revision: 1,
    byDate: { '2025-10-26': 'rdn' }, tariffs: { rdn: dynamic }, issues: [],
  };
  const scenario = { settlement: 'NET_METERING' as const, source: 'PROJECT_HISTORY' as const, tariffHistory: history };
  const result = calculateOfferWorkspaceValuation({
    measurements: { months: [{ period: '2025-10', importKwh: 2, exportKwh: 0 }] }, intervals,
    vatBasis: 'NET', connectionPowerKw: null, current: scenario,
    target: { settlement: 'NET_METERING', source: 'CURRENT_CATALOG', tariff: dynamic },
    rdnPricesNetPlnPerKwh: new Map([
      ['2025-10-26T00:00:00.000Z', 0.5],
      ['2025-10-26T01:00:00.000Z', 1.5],
    ]),
  });
  assert.equal(result.current.months[0].importValuePln, 2.5);
  assert.equal(result.current.totals.importKwh, 2);
});

test('missing strict historical tariff nulls only its affected valuation; target is not a fallback', () => {
  const intervals = [interval('2025-03-01T10:00:00.000Z', '2025-03-01T10:00:00Z', 1)];
  const input = baseInput(intervals, [{ period: '2025-03', importKwh: 1, exportKwh: 0 }]);
  input.current.tariffHistory = { strict: true, revision: 2, byDate: { '2025-03-01': null }, tariffs: {}, issues: [] };
  const result = calculateOfferWorkspaceValuation(input);
  assert.equal(result.current.months[0].importValuePln, null);
  assert.equal(result.target.months[0].importValuePln, 0.9225);
  assert.ok(result.current.issues.some(issue => issue.includes('brak cen taryfy')));
});

test('staging G13active catalogue rows without runtime component_key match gross prices to keyed net metadata', () => {
  const storedRows = [
    { component_key: 'energy-low', label: 'Energia czynna', window_code: 'low', net: 0.28, gross: 0.3444, vatRate },
    { component_key: 'energy-mid', label: 'Energia czynna', window_code: 'mid', net: 0.5, gross: 0.615, vatRate },
    { component_key: 'energy-high', label: 'Energia czynna', window_code: 'high', net: 0.65, gross: 0.7995, vatRate },
    { component_key: 'network-low', label: 'Opłata sieciowa', window_code: 'low', net: 0.073, gross: 0.08979, vatRate },
    { component_key: 'network-mid', label: 'Opłata sieciowa', window_code: 'mid', net: 0.2456, gross: 0.302088, vatRate },
    { component_key: 'network-high', label: 'Opłata sieciowa', window_code: 'high', net: 0.3032, gross: 0.372936, vatRate },
    { component_key: 'quality', label: 'Opłata jakościowa', window_code: 'all', net: 0.0332, gross: 0.040836, vatRate },
    { component_key: 'oze', label: 'Opłata OZE', window_code: 'all', net: 0.0073, gross: 0.008979, vatRate },
    { component_key: 'cogeneration', label: 'Opłata kogeneracyjna', window_code: 'all', net: 0.003, gross: 0.00369, vatRate },
  ];
  const month10 = [2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 3, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 2];
  const catalog = {
    osd_id: 1, tariff_id: 27, code: 'G13active', name: 'G13active', segment: 'household',
    zone_model: 'highmidlow' as const, use_monthly: true,
    monthly: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [String(index + 1), month10])),
    fixed: [],
    variable: storedRows.map(({ label, window_code, gross }) => ({ label, window_code, price: gross })),
    pricing: { tariffStorage: { priceBasis: 'net' as const, vatRate, validFrom: '2025-01-01', fixed: [], variable: storedRows } },
  } as ClientTariffPayload;
  const intervals = [interval('2025-10-01T08:00:00.000Z', '2025-10-01T10:00:00+02:00', 1)];
  const input = baseInput(intervals, [{ period: '2025-10', importKwh: 1, exportKwh: 0 }]);
  input.current.tariffHistory = {
    strict: true, revision: 1, byDate: { '2025-10-01': 'catalog' }, tariffs: { catalog }, issues: [],
  };
  input.target.tariff = catalog;

  const result = calculateOfferWorkspaceValuation(input);
  assert.equal(result.current.months[0].importValuePln, 0.487695);
  assert.equal(result.target.months[0].importValuePln, 0.487695);
  assert.ok(!result.target.issues.some(issue => issue.includes('NET/GROSS')));
});

test('offer tariff engine snapshot matches its pinned SHA-256', () => {
  const pinnedPath = path.resolve(__dirname, '../../../integrations/re/offer-runtime/tariff-engine.js');
  const hash = createHash('sha256').update(readFileSync(pinnedPath)).digest('hex').toUpperCase();
  assert.equal(hash, OFFER_TARIFF_ENGINE_SHA256);
});

test('pinned engine prices energy_schedule independently from the distribution zone', () => {
  const scheduled = tariff(0.2, 0.3) as ClientTariffPayload & {
    energy_schedule?: { model: 'monthly_codes'; monthly: Record<string, string[]> };
  };
  scheduled.zone_model = 'daynight';
  scheduled.monthly = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [String(index + 1), Array(24).fill(2)]));
  const rows = [
    { component_key: 'energy-cheap', label: 'Energia czynna', net: 0.2, gross: 0.246, vatRate, window_code: 'cheap' },
    { component_key: 'energy-other', label: 'Energia czynna', net: 0.8, gross: 0.984, vatRate, window_code: 'other' },
    { component_key: 'distribution-day', label: 'Składnik zmienny stawki sieciowej', net: 0.3, gross: 0.369, vatRate, window_code: 'day' },
  ];
  scheduled.variable = rows.map(row => ({ ...row, price: row.net }));
  scheduled.pricing.tariffStorage.variable = rows;
  scheduled.energy_schedule = {
    model: 'monthly_codes',
    monthly: { '1': Array.from({ length: 24 }, (_, hour) => hour === 5 ? 'cheap' : 'other') },
  };
  const intervals = [interval('2025-01-10T05:00:00.000Z', '2025-01-10T05:00:00Z', 1)];
  const input = baseInput(intervals, [{ period: '2025-01', importKwh: 1, exportKwh: 0 }], { vatBasis: 'NET' });
  input.current.tariffHistory = {
    strict: true, revision: 1, byDate: { '2025-01-10': 'scheduled' }, tariffs: { scheduled }, issues: [],
  };
  input.target.tariff = scheduled;

  const result = calculateOfferWorkspaceValuation(input);
  assert.equal(result.current.months[0].importValuePln, 0.5);
  assert.equal(result.target.months[0].importValuePln, 0.5);
});

test('NET_METERING has no monetary export value; NET_BILLING values exports only with supplied RCE', () => {
  const intervals = [interval('2025-04-01T10:00:00.000Z', '2025-04-01T10:00:00Z', 0.5, 0.5)];
  const measurements = { months: [{ period: '2025-04', importKwh: 0.5, exportKwh: 0.5 }] };
  const netMetering = calculateOfferWorkspaceValuation(baseInput(intervals, measurements.months));
  assert.equal(netMetering.current.months[0].exportValuePln, null);
  const input = baseInput(intervals, measurements.months, { vatBasis: 'GROSS' });
  input.current.settlement = 'NET_BILLING';
  input.target.settlement = 'NET_BILLING';
  input.rcePricesNetPlnPerKwh = new Map([['2025-04-01T10:00:00.000Z', 0.2]]);
  const netBilling = calculateOfferWorkspaceValuation(input);
  assert.equal(netBilling.current.months[0].exportValuePln, 0.123);
  assert.ok(netBilling.current.issues.some(issue => issue.includes('nie kwotą rozliczenia')));
});

test('missing import tariff does not suppress available NET_BILLING export value; zero denominator average is null', () => {
  const intervals = [interval('2025-05-01T10:00:00.000Z', '2025-05-01T10:00:00Z', 1, 1)];
  const input = baseInput(intervals, [{ period: '2025-05', importKwh: 1, exportKwh: 1 }], { vatBasis: 'NET' });
  input.current.settlement = 'NET_BILLING';
  input.current.tariffHistory = { strict: true, revision: 2, byDate: { '2025-05-01': null }, tariffs: {}, issues: [] };
  input.rcePricesNetPlnPerKwh = new Map([['2025-05-01T10:00:00.000Z', 0.2]]);
  const partial = calculateOfferWorkspaceValuation(input);
  assert.equal(partial.current.months[0].importValuePln, null);
  assert.equal(partial.current.months[0].exportValuePln, 0.2);

  const zero = calculateOfferWorkspaceValuation(baseInput(
    [interval('2025-05-01T10:00:00.000Z', '2025-05-01T10:00:00Z', 0, 0)],
    [{ period: '2025-05', importKwh: 0, exportKwh: 0 }],
    { vatBasis: 'NET' },
  ));
  assert.equal(zero.current.months[0].averageBuyPlnPerKwh, null);
});

test('8,760 measured hourly intervals aggregate without repeated tariff-history scans', () => {
  const intervals: OfferMeasurementInterval[] = [];
  const importsByMonth = new Map<string, number>();
  const start = Date.parse('2025-01-01T00:00:00.000Z');
  for (let index = 0; index < 8760; index += 1) {
    const instant = new Date(start + index * 3_600_000);
    const period = instant.toISOString().slice(0, 7);
    intervals.push(interval(instant.toISOString(), instant.toISOString().replace('.000Z', 'Z'), 0.1));
    importsByMonth.set(period, (importsByMonth.get(period) || 0) + 0.1);
  }
  const months = Array.from(importsByMonth, ([period, importKwh]) => ({ period, importKwh, exportKwh: 0 }));
  const result = calculateOfferWorkspaceValuation(baseInput(intervals, months, { vatBasis: 'NET' }));
  assert.equal(result.current.totals.importKwh, 876);
  assert.equal(result.current.totals.importValuePln, 657);
});
