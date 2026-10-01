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

const businessCapacityTariff = {
  code: 'C13active',
  name: 'C13active',
  zone_model: 'all',
  fixed: [],
  variable: [
    { label: 'Energia czynna', window_code: 'all', price: 0.5 },
    { label: 'Opłata sieciowa', window_code: 'all', price: 0.2 },
    { label: 'Opłata mocowa', window_code: 'all', price: 0.269862 },
  ],
  capacity_charge: {
    model: 'pl_capacity_charge',
    effective_from: '2026-01-01',
    effective_until: '2027-01-01',
    flat_eligible: true,
    flat_max_power_kw: 16,
    flat_monthly: [
      { annual_usage_min_kwh: null, annual_usage_max_kwh: 500, amount: 5.2767 },
      { annual_usage_min_kwh: 500, annual_usage_max_kwh: 1200, amount: 12.6813 },
      { annual_usage_min_kwh: 1200, annual_usage_max_kwh: 2800, amount: 21.1314 },
      { annual_usage_min_kwh: 2800, annual_usage_max_kwh: null, amount: 29.5815 },
    ],
    variable_rate: 0.269862,
    qualifying_hour_from: 7,
    qualifying_hour_until: 22,
    exclude_weekends: true,
    exclude_public_holidays: true,
    profile_factors: [
      { difference_max_percent: 5, factor: 0.17, group: 'K1' },
      { difference_max_percent: 10, factor: 0.5, group: 'K2' },
      { difference_max_percent: 15, factor: 0.83, group: 'K3' },
      { difference_max_percent: null, factor: 1, group: 'K4' },
    ],
  },
};

test('C1 do 16 kW dostaje miesięczną opłatę mocową zamiast stawki na każdą kWh', () => {
  const snapshot = buildEnergyTariffCostSnapshot({
    tariff: businessCapacityTariff,
    operator: 'ENEA',
    annualUsageKwh: 1500,
    connectionPowerKw: 10,
  });

  assert.equal(snapshot.capacityCharge?.mode, 'flat');
  assert.equal(snapshot.fixedMonthlyGross, 21.1314);
  assert.equal(snapshot.zoneRates[0].totalGrossPerKwh, 0.7);
});

test('C1 powyżej 16 kW zachowuje zmienną opłatę mocową poza zwykłą dystrybucją', () => {
  const snapshot = buildEnergyTariffCostSnapshot({
    tariff: businessCapacityTariff,
    operator: 'ENEA',
    annualUsageKwh: 6000,
    connectionPowerKw: 20,
  });

  assert.equal(snapshot.capacityCharge?.mode, 'variable');
  assert.equal(snapshot.fixedMonthlyGross, 0);
  assert.equal(snapshot.zoneRates[0].distributionGrossPerKwh, 0.2);
  assert.equal(snapshot.capacityCharge?.variableRateGrossPerKwh, 0.269862);
});
