import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEnergyTariffCostSnapshot } from './energy-tariff-pricing';

test('odwzorowuje trzy strefy G13active i dobiera opłaty stałe do klienta', () => {
  const monthly = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
    String(index + 1),
    Array.from({ length: 24 }, (_, hour) => hour < 6 ? 3 : hour < 15 ? 2 : 1),
  ]));
  const snapshot = buildEnergyTariffCostSnapshot({
    tariff: {
      code: 'G13active',
      name: 'G13active',
      zone_model: 'highmidlow',
      use_monthly: true,
      monthly,
      fixed: [
        { label: 'Opłata sieciowa', amount: 17.9088, annual_usage_min_kwh: null, annual_usage_max_kwh: null },
        { label: 'Opłata abonamentowa', amount: 4.7232, billing_cycle_months: 1 },
        { label: 'Opłata abonamentowa', amount: 2.3616, billing_cycle_months: 2 },
        { label: 'Opłata mocowa', amount: 21.13, annual_usage_min_kwh: 1200, annual_usage_max_kwh: 2800 },
        { label: 'Opłata mocowa', amount: 29.58, annual_usage_min_kwh: 2800 },
        { label: 'Opłata handlowa eFaktura', amount: 13.49 },
      ],
      variable: [
        { label: 'Energia czynna', window_code: 'low', price: 0.341 },
        { label: 'Energia czynna', window_code: 'mid', price: 0.6089 },
        { label: 'Energia czynna', window_code: 'high', price: 0.7915 },
        { label: 'Opłata sieciowa', window_code: 'low', price: 0.08979 },
        { label: 'Opłata sieciowa', window_code: 'mid', price: 0.302088 },
        { label: 'Opłata sieciowa', window_code: 'high', price: 0.372936 },
        { label: 'Opłata jakościowa', window_code: 'all', price: 0.040836 },
        { label: 'Opłata OZE', window_code: 'all', price: 0.008979 },
        { label: 'Opłata kogeneracyjna', window_code: 'all', price: 0.00369 },
      ],
    },
    operator: 'ENEA',
    annualUsageKwh: 5220,
    billingCycleMonths: 1,
    fetchedAt: new Date('2026-08-11T00:00:00.000Z'),
  });

  assert.equal(snapshot.monthlyZoneCodes[0][0], 'low');
  assert.equal(snapshot.monthlyZoneCodes[0][7], 'mid');
  assert.equal(snapshot.monthlyZoneCodes[0][18], 'high');
  assert.equal(snapshot.fixedMonthlyGross, 65.702);
  assert.deepEqual(snapshot.zoneRates.map((rate) => [rate.code, Number(rate.totalGrossPerKwh.toFixed(6))]), [
    ['high', 1.217941],
    ['mid', 0.964493],
    ['low', 0.484295],
  ]);
});
