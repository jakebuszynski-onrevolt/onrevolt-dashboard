import assert from 'node:assert/strict';
import test from 'node:test';
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
