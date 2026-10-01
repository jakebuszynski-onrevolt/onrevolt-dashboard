import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { calculateEnergyScenario, defaultHourlyLoadProfile, polishPvHourlyProfiles, polishPvMonthlyDistribution } from './energy-scenario';

const baseInput = {
  monthlyConsumptionKwh: Array.from({ length: 12 }, () => 500),
  hourlyLoadProfile: defaultHourlyLoadProfile,
  pvPowerKw: 6,
  pvSpecificYieldKwhPerKw: 950,
  pvMonthlyDistribution: polishPvMonthlyDistribution,
  pvHourlyProfiles: polishPvHourlyProfiles,
  batteryCapacityKwh: 0,
  batteryMaxChargeKw: 0,
  batteryMaxDischargeKw: 0,
  batteryRoundTripEfficiency: 0.9,
  initialBatterySocPercent: 0,
  energyBuyGrossPerKwh: 0.62,
  distributionGrossPerKwh: 0.48,
  exportGrossPerKwh: 0.45,
  fixedMonthlyGross: 30,
  depositPayoutRate: 0.2,
};

test('CRM and RE price the same dated load identically while proposed tariff stays unchanged', () => {
  const engine = createRequire(import.meta.url)('../../../public/shared/re-tariff-engine.js');
  const g11 = { zone_model: 'all', variable: [{ label: 'Energia czynna', window_code: 'all', price: 0.6 },
    { label: 'Dystrybucja', window_code: 'all', price: 0.3 }], fixed: [{ component_key: 'fixed', amount: 31 }] };
  const g13 = { ...g11, zone_model: 'highmidlow', use_monthly: true, cheap_saturday: true, cheap_sunday: true,
    monthly: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, Array.from({ length: 24 }, (_, hour) => hour < 8 ? 3 : 1)])),
    variable: [{ label: 'Energia czynna', window_code: 'high', price: 1.2 }, { label: 'Energia czynna', window_code: 'low', price: 0.2 },
      { label: 'Dystrybucja', window_code: 'all', price: 0.3 }], fixed: [{ component_key: 'fixed', amount: 62 }] };
  const byDate: Record<string, any> = {}, records = [];
  for (let d = new Date('2026-01-01T12:00:00Z'); d.getUTCFullYear() === 2026; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10), days = new Date(Date.UTC(2026, d.getUTCMonth() + 1, 0)).getUTCDate();
    byDate[date] = date < '2026-01-16' ? g11 : g13;
    records.push({ date, slots: Array.from({ length: 96 }, (_, index) => ({ hour: Math.floor(index / 4), kwh: 500 / days / 96 })) });
  }
  const history = { strict: true as const, revision: 1, byDate, issues: [] };
  const options = { billingCycleMonths: 1, connectionPowerKw: 10, annualUsageKwh: 6000 };
  const input = { ...baseInput, pvPowerKw: 0, hourlyLoadProfile: Array(24).fill(1), scenarioYear: 2026, ...options };
  const result = calculateEnergyScenario({ ...input, currentTariffHistory: history });
  const unchangedTarget = calculateEnergyScenario(input);
  assert.equal(result.scenarioAnnualCostGross, unchangedTarget.scenarioAnnualCostGross);
  for (let month = 1; month <= 12; month++) {
    const from = `2026-${String(month).padStart(2, '0')}-01`;
    const until = new Date(Date.UTC(2026, month, 1)).toISOString().slice(0, 10);
    const expected = engine.cost(history, records, from, until, options);
    assert.ok(Math.abs(result.months[month - 1].baselineCostGross - expected.total) < 0.006);
  }
  delete byDate['2026-04-01'];
  assert.throws(() => calculateEnergyScenario({ ...input, currentTariffHistory: history }), /brak cen taryfy/);
});

test('silnik zachowuje roczny bilans zużycia i produkcji', () => {
  const result = calculateEnergyScenario(baseInput);
  assert.equal(result.annualConsumptionKwh, 6000);
  assert.equal(result.annualPvGenerationKwh, 5700);
  assert.equal(result.months.length, 12);
  assert.ok(result.annualGridImportKwh >= 0);
  assert.ok(result.annualExportKwh >= 0);
});

test('magazyn zmniejsza import z sieci i nie tworzy energii', () => {
  const withoutBattery = calculateEnergyScenario(baseInput);
  const withBattery = calculateEnergyScenario({
    ...baseInput,
    batteryCapacityKwh: 15,
    batteryMaxChargeKw: 5,
    batteryMaxDischargeKw: 5,
    initialBatterySocPercent: 0.2,
  });
  assert.ok(withBattery.annualGridImportKwh < withoutBattery.annualGridImportKwh);
  assert.ok(withBattery.annualBatteryDischargeKwh <= withBattery.annualPvGenerationKwh + 15);
  assert.ok(withBattery.equivalentBatteryCycles > 0);
});

test('depozyt nie pokrywa kosztu dystrybucji', () => {
  const result = calculateEnergyScenario({ ...baseInput, exportGrossPerKwh: 10 });
  const minimumDistribution = result.annualGridImportKwh * baseInput.distributionGrossPerKwh;
  assert.ok(result.scenarioAnnualCostGross >= minimumDistribution - result.depositPayoutGross);
});

test('liczy taryfę przed i po według właściwej strefy godzinowej', () => {
  const allHours = Array.from({ length: 12 }, () => Array.from({ length: 24 }, () => 'all'));
  const targetHours = Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, hour) => hour === 12 ? 'high' : 'low'));
  const tariffBase = {
    source: 'WINDYONE_RE' as const,
    sourceUrl: 'https://windyone.pl/re/setup.php',
    fetchedAt: '2026-08-11T00:00:00.000Z',
    operator: 'ENEA',
    name: 'G11',
    zoneModel: 'all',
    fixedCosts: [],
    billingCycleMonths: 1,
  };
  const result = calculateEnergyScenario({
    ...baseInput,
    monthlyConsumptionKwh: Array.from({ length: 12 }, () => 100),
    hourlyLoadProfile: Array.from({ length: 24 }, (_, hour) => hour === 12 ? 1 : 0),
    pvPowerKw: 0,
    currentTariff: {
      ...tariffBase,
      code: 'G11',
      monthlyZoneCodes: allHours,
      zoneRates: [{ code: 'all', label: 'Cała doba', energyGrossPerKwh: 0.6, distributionGrossPerKwh: 0.3, totalGrossPerKwh: 0.9 }],
      fixedMonthlyGross: 20,
    },
    targetTariff: {
      ...tariffBase,
      code: 'G13active',
      name: 'G13active',
      zoneModel: 'highmidlow',
      monthlyZoneCodes: targetHours,
      zoneRates: [
        { code: 'high', label: 'Wysoka', energyGrossPerKwh: 0.8, distributionGrossPerKwh: 0.4, totalGrossPerKwh: 1.2 },
        { code: 'low', label: 'Niska', energyGrossPerKwh: 0.3, distributionGrossPerKwh: 0.1, totalGrossPerKwh: 0.4 },
      ],
      fixedMonthlyGross: 30,
    },
  });

  assert.equal(result.baselineAnnualEnergyCostGross, 720);
  assert.equal(result.baselineAnnualDistributionCostGross, 360);
  assert.equal(result.baselineAnnualFixedCostGross, 240);
  assert.equal(result.scenarioAnnualEnergyDueGross, 960);
  assert.equal(result.scenarioAnnualDistributionCostGross, 480);
  assert.equal(result.scenarioAnnualFixedCostGross, 360);
});

test('dla firmy nalicza zmienną opłatę mocową tylko w godzinach kwalifikowanych i z grupą K', () => {
  const allHours = Array.from({ length: 12 }, () => Array.from({ length: 24 }, () => 'all'));
  const baseTariff = {
    source: 'WINDYONE_RE' as const,
    sourceUrl: 'https://windyone.pl/re/setup.php',
    fetchedAt: '2026-09-30T00:00:00.000Z',
    operator: 'ENEA',
    code: 'C13active',
    name: 'C13active',
    zoneModel: 'all',
    monthlyZoneCodes: allHours,
    zoneRates: [{ code: 'all', label: 'Cała doba', energyGrossPerKwh: 0.5, distributionGrossPerKwh: 0.2, totalGrossPerKwh: 0.7 }],
    fixedMonthlyGross: 0,
    fixedCosts: [],
    billingCycleMonths: 1,
  };
  const capacityCharge = {
    model: 'pl_capacity_charge' as const,
    mode: 'variable' as const,
    effectiveFrom: '2026-01-01',
    effectiveUntil: '2027-01-01',
    variableRateGrossPerKwh: 0.269862,
    qualifyingHourFrom: 7,
    qualifyingHourUntil: 22,
    excludeWeekends: true,
    excludePublicHolidays: true,
    profileFactors: [
      { differenceMaxPercent: 5, factor: 0.17, group: 'K1' },
      { differenceMaxPercent: 10, factor: 0.5, group: 'K2' },
      { differenceMaxPercent: 15, factor: 0.83, group: 'K3' },
      { differenceMaxPercent: null, factor: 1, group: 'K4' },
    ],
  };
  const withoutCapacity = calculateEnergyScenario({
    ...baseInput,
    scenarioYear: 2026,
    pvPowerKw: 0,
    hourlyLoadProfile: Array(24).fill(1),
    targetTariff: baseTariff,
  });
  const withCapacity = calculateEnergyScenario({
    ...baseInput,
    scenarioYear: 2026,
    pvPowerKw: 0,
    hourlyLoadProfile: Array(24).fill(1),
    targetTariff: { ...baseTariff, capacityCharge },
  });
  const extra = withCapacity.scenarioAnnualDistributionCostGross - withoutCapacity.scenarioAnnualDistributionCostGross;

  assert.ok(extra > 0);
  assert.ok(extra < withCapacity.annualGridImportKwh * capacityCharge.variableRateGrossPerKwh * 0.2);
});
