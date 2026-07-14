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
