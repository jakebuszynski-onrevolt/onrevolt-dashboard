import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generalTariffSummary, projectGeneralTariff, tariffPeriodLabel, tariffSchedule } from './client-tariffs';
import { extractEneaTariffEvidence } from './enea-portal';
const engine = createRequire(import.meta.url)('../../../public/shared/re-tariff-engine.js');
const base = { zone_model: 'daynight', dn_night: [0, 1, 2, 3, 4, 5, 6, 22, 23], po_off: [],
  variable: [{ label: 'Energia czynna', window_code: 'day', price: 1 }, { label: 'Energia czynna', window_code: 'night', price: 0.3 }, { label: 'Dystrybucja', window_code: 'all', price: 0.2 }],
  fixed: [{ amount: 31, amount_mode: 'flat_month' }] };

test('general tariff summary shows the saved operator and tariff without inventing G11', () => {
  assert.equal(generalTariffSummary(projectGeneralTariff([{ operator: 'ENEA', tariff: 'C11' }])), 'ENEA · C11');
  assert.equal(generalTariffSummary(projectGeneralTariff([{ operator: 'PGE', tariff: 'G12w' }])), 'PGE · G12w');
  assert.equal(generalTariffSummary(projectGeneralTariff([])), 'Nie wybrano operatora ani taryfy');
  assert.equal(generalTariffSummary(projectGeneralTariff([{ operator: 'ENEA', tariff: null }])), 'ENEA · Nie wybrano taryfy');
  assert.equal(generalTariffSummary(projectGeneralTariff([{ operator: '', tariff: 'G11' }])), 'Nie wybrano operatora · G11');
});

test('general tariff selection matches the saved account shown in energy data', () => {
  assert.deepEqual(projectGeneralTariff([{ operator: 'PGE', tariff: 'G11' }, { operator: 'ENEA', tariff: 'C11' }]), { operator: 'ENEA', code: 'C11' });
  assert.deepEqual(projectGeneralTariff([{ operator: 'PGE', tariff: 'G12w' }, { operator: 'PGE', tariff: 'G11' }]), { operator: 'PGE', code: 'G12w' });
});
test('tariff intervals display an inclusive end without changing the exclusive contract', () => {
  assert.equal(tariffPeriodLabel({ validFrom: null, validUntil: '2026-03-01' }), 'Od początku danych – 2026-02-28');
});
test('strict history never substitutes a current tariff or zero for missing rates', () => {
  assert.throws(() => engine.resolve({ strict: true, byDate: {} }, '2026-01-01', base), /Wymaga uzupełnienia/);
  assert.equal(engine.resolve(null, '2026-01-01', base), base);
});

test('compact tariff history shares catalog payloads and preserves missing-price errors', () => {
  const compact = { strict: true, format: 'client-tariffs-v1', tariffs: { g11: base }, byDate: { '2026-01-01': 'g11', '2026-01-02': 'g11', '2026-01-03': null } };
  assert.equal(engine.resolve(compact, '2026-01-01', null), base);
  const expanded = engine.expand(compact);
  assert.equal(expanded.byDate['2026-01-01'], expanded.byDate['2026-01-02']);
  assert.equal(engine.expand(expanded), expanded);
  assert.throws(() => engine.resolve(compact, '2026-01-03', base), /brak cen/);
  assert.equal(compact.byDate['2026-01-01'], 'g11');
});
test('weekends and seasonal schedules are resolved in Polish wall-clock hours', () => {
  const schedule = tariffSchedule({ ...base, cheap_saturday: true } as any);
  assert.equal(engine.zone({ ...base, ...schedule }, '2026-09-26', 12), 'night');
  assert.equal(engine.zone({ ...base, ...schedule }, '2026-09-28', 12), 'day');
  schedule.monthly['9'][12] = 1;
  assert.equal(engine.zone({ ...base, ...schedule }, '2026-09-28', 12), 'night');
});
test('hourly and quarter-hour energy produce identical costs; DST repeat is counted twice', () => {
  const hourly = engine.rates(base, '2026-10-25', 2).total;
  assert.equal(hourly, 0.5);
  assert.equal(Array(4).fill(0.25).reduce((sum, kwh) => sum + kwh * hourly, 0), hourly);
  assert.equal(Array(8).fill(0.25).reduce((sum, kwh) => sum + kwh * hourly, 0), hourly * 2);
});
test('fixed costs use actual days of month and change without double billing', () => {
  const later = { ...base, fixed: [{ amount: 62, amount_mode: 'flat_month' }] };
  const total = 15 * engine.fixedDaily(base, '2026-01-01') + 16 * engine.fixedDaily(later, '2026-01-16');
  assert.equal(total, 47);
  assert.equal(engine.fixedDaily({ ...base, fixed: [{ amount: 29 }] }, '2028-02-29'), 1);
});
test('fixed cost conditions and connection power are retained', () => {
  const tariff = { ...base, fixed: [{ amount: 2, amount_mode: 'per_kw_month' }, { amount: 10, annual_usage_min_kwh: 5000 }, { amount: 20, billing_cycle_months: 2 }] };
  assert.equal(engine.fixedMonthly(tariff, { connectionPowerKw: 10, annualUsageKwh: 3000, billingCycleMonths: 1 }), 20);
});

test('ENEA evidence requires an unambiguous code and explicit coverage of the requested range', () => {
  const month = { year: 2026, month: 1, dateFrom: '2026-01-01', dateTo: '2026-01-31' } as any;
  const input = { tariffGroupNames: 'C11', values: [1], periodPartlyInAgreement: false };
  const result = extractEneaTariffEvidence(input, month);
  assert.equal(result.certain, true); assert.equal(result.validUntil, '2026-02-01');
  for (const patch of [{ tariffGroupNames: 'G11, G13active' }, { tariffGroupNames: '' }, { periodPartlyInAgreement: true }, { periodPartlyInAgreement: undefined }, { values: [] }]) {
    assert.equal(extractEneaTariffEvidence({ ...input, ...patch }, month).certain, false);
  }
  assert.equal(extractEneaTariffEvidence({ tariff: 'C11', obis: '1.8.0', values: [1] }, month).certain, false);
});

test('fixed costs cannot silently ignore required power or billing cycle', () => {
  assert.throws(() => engine.fixedMonthly({ fixed: [{ amount: 2, amount_mode: 'per_kw_month' }] }, { connectionPowerKw: 0 }), /Brak danych/);
  assert.throws(() => engine.fixedMonthly({ fixed: [{ amount: 2, billing_cycle_months: 2 }] }, {}), /Brak cyklu/);
});
