export const energyScenarioEngineVersion = 'ONREVOLT_RE_SIM_1.1.0';

export type EnergyTariffZoneRate = {
  code: string;
  label: string;
  energyGrossPerKwh: number;
  distributionGrossPerKwh: number;
  totalGrossPerKwh: number;
};

export type EnergyTariffCostSnapshot = {
  source: 'WINDYONE_RE';
  sourceUrl: string;
  fetchedAt: string;
  operator: string;
  code: string;
  name: string;
  zoneModel: string;
  monthlyZoneCodes: string[][];
  zoneRates: EnergyTariffZoneRate[];
  variableCosts?: Array<{
    label: string;
    zoneCode: string;
    amountGrossPerKwh: number;
  }>;
  fixedMonthlyGross: number;
  fixedCosts: Array<{ label: string; amountGross: number }>;
  billingCycleMonths: number;
};

export type EnergyScenarioInput = {
  monthlyConsumptionKwh: number[];
  hourlyLoadProfile: number[];
  monthlyHourlyLoadProfiles?: number[][];
  pvPowerKw: number;
  pvSpecificYieldKwhPerKw: number;
  pvMonthlyDistribution: number[];
  pvHourlyProfiles: number[][];
  batteryCapacityKwh: number;
  batteryMaxChargeKw: number;
  batteryMaxDischargeKw: number;
  batteryRoundTripEfficiency: number;
  initialBatterySocPercent: number;
  energyBuyGrossPerKwh: number;
  distributionGrossPerKwh: number;
  exportGrossPerKwh: number;
  fixedMonthlyGross: number;
  currentTariff?: EnergyTariffCostSnapshot;
  targetTariff?: EnergyTariffCostSnapshot;
  depositPayoutRate: number;
  investmentGross?: number;
};

export type EnergyScenarioMonth = {
  month: number;
  consumptionKwh: number;
  pvGenerationKwh: number;
  directPvKwh: number;
  batteryChargeInputKwh: number;
  batteryDischargeToLoadKwh: number;
  gridImportKwh: number;
  exportKwh: number;
  baselineCostGross: number;
  baselineEnergyCostGross: number;
  baselineDistributionCostGross: number;
  baselineFixedCostGross: number;
  scenarioCashCostGross: number;
  scenarioEnergyDueGross: number;
  scenarioEnergyCashGross: number;
  scenarioDistributionCostGross: number;
  scenarioFixedCostGross: number;
  depositEndGross: number;
};

export type EnergyScenarioResult = {
  engineVersion: string;
  months: EnergyScenarioMonth[];
  annualConsumptionKwh: number;
  annualPvGenerationKwh: number;
  annualGridImportKwh: number;
  annualExportKwh: number;
  annualDirectPvKwh: number;
  annualBatteryDischargeKwh: number;
  baselineAnnualCostGross: number;
  baselineAnnualEnergyCostGross: number;
  baselineAnnualDistributionCostGross: number;
  baselineAnnualFixedCostGross: number;
  scenarioAnnualCostGross: number;
  scenarioAnnualEnergyDueGross: number;
  scenarioAnnualEnergyCashGross: number;
  scenarioAnnualDistributionCostGross: number;
  scenarioAnnualFixedCostGross: number;
  annualSavingsGross: number;
  savingsPercent: number;
  selfConsumptionPercent: number;
  energyAutonomyPercent: number;
  equivalentBatteryCycles: number;
  finalDepositGross: number;
  depositPayoutGross: number;
  finalBatterySocKwh: number;
  simplePaybackYears: number | null;
};

const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function assertFinite(value: number, name: string, min = 0) {
  if (!Number.isFinite(value) || value < min) throw new Error(`Nieprawidłowa wartość ${name}`);
}

function assertArray(values: number[], length: number, name: string) {
  if (!Array.isArray(values) || values.length !== length) throw new Error(`${name} musi mieć ${length} pozycji`);
  values.forEach((value, index) => assertFinite(value, `${name}[${index}]`));
}

function normalized(values: number[], name: string) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) throw new Error(`${name} nie może mieć sumy 0`);
  return values.map((value) => value / total);
}

function validateTariff(tariff: EnergyTariffCostSnapshot | undefined, name: string) {
  if (!tariff) return;
  if (!Array.isArray(tariff.monthlyZoneCodes) || tariff.monthlyZoneCodes.length !== 12) {
    throw new Error(`${name}.monthlyZoneCodes musi mieć 12 pozycji`);
  }
  tariff.monthlyZoneCodes.forEach((row, month) => {
    if (!Array.isArray(row) || row.length !== 24) {
      throw new Error(`${name}.monthlyZoneCodes[${month}] musi mieć 24 pozycje`);
    }
  });
  if (!Array.isArray(tariff.zoneRates) || !tariff.zoneRates.length) {
    throw new Error(`${name}.zoneRates nie może być puste`);
  }
  tariff.zoneRates.forEach((rate, index) => {
    assertFinite(rate.energyGrossPerKwh, `${name}.zoneRates[${index}].energyGrossPerKwh`);
    assertFinite(rate.distributionGrossPerKwh, `${name}.zoneRates[${index}].distributionGrossPerKwh`);
  });
  assertFinite(tariff.fixedMonthlyGross, `${name}.fixedMonthlyGross`);
}

function tariffRateAt(
  tariff: EnergyTariffCostSnapshot | undefined,
  monthIndex: number,
  hour: number,
  fallbackEnergy: number,
  fallbackDistribution: number,
) {
  if (!tariff) return { energy: fallbackEnergy, distribution: fallbackDistribution };
  const code = tariff.monthlyZoneCodes[monthIndex]?.[hour] || tariff.zoneRates[0]?.code;
  const rate = tariff.zoneRates.find((item) => item.code === code) || tariff.zoneRates[0];
  return {
    energy: rate.energyGrossPerKwh,
    distribution: rate.distributionGrossPerKwh,
  };
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function calculateEnergyScenario(input: EnergyScenarioInput): EnergyScenarioResult {
  assertArray(input.monthlyConsumptionKwh, 12, 'monthlyConsumptionKwh');
  assertArray(input.hourlyLoadProfile, 24, 'hourlyLoadProfile');
  if (input.monthlyHourlyLoadProfiles) {
    if (!Array.isArray(input.monthlyHourlyLoadProfiles) || input.monthlyHourlyLoadProfiles.length !== 12) {
      throw new Error('monthlyHourlyLoadProfiles musi mieć 12 profili');
    }
    input.monthlyHourlyLoadProfiles.forEach((profile, month) => assertArray(profile, 24, `monthlyHourlyLoadProfiles[${month}]`));
  }
  assertArray(input.pvMonthlyDistribution, 12, 'pvMonthlyDistribution');
  if (!Array.isArray(input.pvHourlyProfiles) || input.pvHourlyProfiles.length !== 12) {
    throw new Error('pvHourlyProfiles musi mieć 12 profili');
  }
  input.pvHourlyProfiles.forEach((profile, month) => assertArray(profile, 24, `pvHourlyProfiles[${month}]`));
  assertFinite(input.pvPowerKw, 'pvPowerKw');
  assertFinite(input.pvSpecificYieldKwhPerKw, 'pvSpecificYieldKwhPerKw');
  assertFinite(input.batteryCapacityKwh, 'batteryCapacityKwh');
  assertFinite(input.batteryMaxChargeKw, 'batteryMaxChargeKw');
  assertFinite(input.batteryMaxDischargeKw, 'batteryMaxDischargeKw');
  assertFinite(input.batteryRoundTripEfficiency, 'batteryRoundTripEfficiency', 0.01);
  if (input.batteryRoundTripEfficiency > 1) throw new Error('Sprawność magazynu nie może przekraczać 100%');
  assertFinite(input.initialBatterySocPercent, 'initialBatterySocPercent');
  if (input.initialBatterySocPercent > 1) throw new Error('Początkowy SOC musi być ułamkiem 0-1');
  assertFinite(input.energyBuyGrossPerKwh, 'energyBuyGrossPerKwh');
  assertFinite(input.distributionGrossPerKwh, 'distributionGrossPerKwh');
  assertFinite(input.exportGrossPerKwh, 'exportGrossPerKwh');
  assertFinite(input.fixedMonthlyGross, 'fixedMonthlyGross');
  validateTariff(input.currentTariff, 'currentTariff');
  validateTariff(input.targetTariff, 'targetTariff');
  assertFinite(input.depositPayoutRate, 'depositPayoutRate');
  if (input.depositPayoutRate > 1) throw new Error('Wypłata depozytu musi być ułamkiem 0-1');

  const loadProfile = normalized(input.hourlyLoadProfile, 'hourlyLoadProfile');
  const monthlyLoadProfiles = input.monthlyHourlyLoadProfiles?.map((profile, month) => (
    normalized(profile, `monthlyHourlyLoadProfiles[${month}]`)
  ));
  const pvMonthProfile = normalized(input.pvMonthlyDistribution, 'pvMonthlyDistribution');
  const pvHourProfiles = input.pvHourlyProfiles.map((profile, month) => normalized(profile, `pvHourlyProfiles[${month}]`));
  const annualPvGenerationKwh = input.pvPowerKw * input.pvSpecificYieldKwhPerKw;
  const chargeEfficiency = Math.sqrt(input.batteryRoundTripEfficiency);
  const dischargeEfficiency = chargeEfficiency;
  let batterySoc = input.batteryCapacityKwh * input.initialBatterySocPercent;
  let deposit = 0;
  let annualBatteryCharge = 0;
  let annualBatteryDischarge = 0;
  const months: EnergyScenarioMonth[] = [];

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const days = daysInMonth[monthIndex];
    const monthConsumption = input.monthlyConsumptionKwh[monthIndex];
    const monthPv = annualPvGenerationKwh * pvMonthProfile[monthIndex];
    const monthTotals = {
      direct: 0,
      charge: 0,
      discharge: 0,
      grid: 0,
      export: 0,
      baselineEnergy: 0,
      baselineDistribution: 0,
      scenarioEnergy: 0,
      scenarioDistribution: 0,
    };

    for (let day = 0; day < days; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const load = monthConsumption * (monthlyLoadProfiles?.[monthIndex] || loadProfile)[hour] / days;
        const pv = monthPv * pvHourProfiles[monthIndex][hour] / days;
        const direct = Math.min(load, pv);
        let surplus = pv - direct;
        let deficit = load - direct;
        const chargeInput = input.batteryCapacityKwh > 0
          ? Math.min(surplus, input.batteryMaxChargeKw, (input.batteryCapacityKwh - batterySoc) / chargeEfficiency)
          : 0;
        batterySoc += chargeInput * chargeEfficiency;
        surplus -= chargeInput;
        const dischargeToLoad = input.batteryCapacityKwh > 0
          ? Math.min(deficit, input.batteryMaxDischargeKw, batterySoc * dischargeEfficiency)
          : 0;
        batterySoc -= dischargeToLoad / dischargeEfficiency;
        deficit -= dischargeToLoad;

        monthTotals.direct += direct;
        monthTotals.charge += chargeInput;
        monthTotals.discharge += dischargeToLoad;
        monthTotals.grid += deficit;
        monthTotals.export += surplus;
        const currentRate = tariffRateAt(
          input.currentTariff,
          monthIndex,
          hour,
          input.energyBuyGrossPerKwh,
          input.distributionGrossPerKwh,
        );
        const targetRate = tariffRateAt(
          input.targetTariff,
          monthIndex,
          hour,
          input.energyBuyGrossPerKwh,
          input.distributionGrossPerKwh,
        );
        monthTotals.baselineEnergy += load * currentRate.energy;
        monthTotals.baselineDistribution += load * currentRate.distribution;
        monthTotals.scenarioEnergy += deficit * targetRate.energy;
        monthTotals.scenarioDistribution += deficit * targetRate.distribution;
      }
    }

    annualBatteryCharge += monthTotals.charge;
    annualBatteryDischarge += monthTotals.discharge;
    deposit += monthTotals.export * input.exportGrossPerKwh;
    const energyDue = monthTotals.scenarioEnergy;
    const paidFromDeposit = Math.min(deposit, energyDue);
    deposit -= paidFromDeposit;
    const currentFixedMonthly = input.currentTariff?.fixedMonthlyGross ?? input.fixedMonthlyGross;
    const targetFixedMonthly = input.targetTariff?.fixedMonthlyGross ?? input.fixedMonthlyGross;
    const scenarioCashCost = energyDue - paidFromDeposit
      + monthTotals.scenarioDistribution
      + targetFixedMonthly;
    const baselineCost = monthTotals.baselineEnergy + monthTotals.baselineDistribution + currentFixedMonthly;

    months.push({
      month: monthIndex + 1,
      consumptionKwh: round(monthConsumption),
      pvGenerationKwh: round(monthPv),
      directPvKwh: round(monthTotals.direct),
      batteryChargeInputKwh: round(monthTotals.charge),
      batteryDischargeToLoadKwh: round(monthTotals.discharge),
      gridImportKwh: round(monthTotals.grid),
      exportKwh: round(monthTotals.export),
      baselineCostGross: round(baselineCost, 2),
      baselineEnergyCostGross: round(monthTotals.baselineEnergy, 2),
      baselineDistributionCostGross: round(monthTotals.baselineDistribution, 2),
      baselineFixedCostGross: round(currentFixedMonthly, 2),
      scenarioCashCostGross: round(scenarioCashCost, 2),
      scenarioEnergyDueGross: round(energyDue, 2),
      scenarioEnergyCashGross: round(energyDue - paidFromDeposit, 2),
      scenarioDistributionCostGross: round(monthTotals.scenarioDistribution, 2),
      scenarioFixedCostGross: round(targetFixedMonthly, 2),
      depositEndGross: round(deposit, 2),
    });
  }

  const annualConsumptionKwh = months.reduce((sum, month) => sum + month.consumptionKwh, 0);
  const annualGridImportKwh = months.reduce((sum, month) => sum + month.gridImportKwh, 0);
  const annualExportKwh = months.reduce((sum, month) => sum + month.exportKwh, 0);
  const annualDirectPvKwh = months.reduce((sum, month) => sum + month.directPvKwh, 0);
  const baselineAnnualCostGross = months.reduce((sum, month) => sum + month.baselineCostGross, 0);
  const baselineAnnualEnergyCostGross = months.reduce((sum, month) => sum + month.baselineEnergyCostGross, 0);
  const baselineAnnualDistributionCostGross = months.reduce((sum, month) => sum + month.baselineDistributionCostGross, 0);
  const baselineAnnualFixedCostGross = months.reduce((sum, month) => sum + month.baselineFixedCostGross, 0);
  const cashBeforePayout = months.reduce((sum, month) => sum + month.scenarioCashCostGross, 0);
  const scenarioAnnualEnergyDueGross = months.reduce((sum, month) => sum + month.scenarioEnergyDueGross, 0);
  const scenarioAnnualEnergyCashGross = months.reduce((sum, month) => sum + month.scenarioEnergyCashGross, 0);
  const scenarioAnnualDistributionCostGross = months.reduce((sum, month) => sum + month.scenarioDistributionCostGross, 0);
  const scenarioAnnualFixedCostGross = months.reduce((sum, month) => sum + month.scenarioFixedCostGross, 0);
  const depositPayoutGross = deposit * input.depositPayoutRate;
  const scenarioAnnualCostGross = Math.max(0, cashBeforePayout - depositPayoutGross);
  const annualSavingsGross = Math.max(0, baselineAnnualCostGross - scenarioAnnualCostGross);
  const investmentGross = input.investmentGross || 0;

  return {
    engineVersion: energyScenarioEngineVersion,
    months,
    annualConsumptionKwh: round(annualConsumptionKwh),
    annualPvGenerationKwh: round(annualPvGenerationKwh),
    annualGridImportKwh: round(annualGridImportKwh),
    annualExportKwh: round(annualExportKwh),
    annualDirectPvKwh: round(annualDirectPvKwh),
    annualBatteryDischargeKwh: round(annualBatteryDischarge),
    baselineAnnualCostGross: round(baselineAnnualCostGross, 2),
    baselineAnnualEnergyCostGross: round(baselineAnnualEnergyCostGross, 2),
    baselineAnnualDistributionCostGross: round(baselineAnnualDistributionCostGross, 2),
    baselineAnnualFixedCostGross: round(baselineAnnualFixedCostGross, 2),
    scenarioAnnualCostGross: round(scenarioAnnualCostGross, 2),
    scenarioAnnualEnergyDueGross: round(scenarioAnnualEnergyDueGross, 2),
    scenarioAnnualEnergyCashGross: round(scenarioAnnualEnergyCashGross, 2),
    scenarioAnnualDistributionCostGross: round(scenarioAnnualDistributionCostGross, 2),
    scenarioAnnualFixedCostGross: round(scenarioAnnualFixedCostGross, 2),
    annualSavingsGross: round(annualSavingsGross, 2),
    savingsPercent: baselineAnnualCostGross > 0 ? round(annualSavingsGross / baselineAnnualCostGross * 100, 1) : 0,
    selfConsumptionPercent: annualPvGenerationKwh > 0 ? round((annualPvGenerationKwh - annualExportKwh) / annualPvGenerationKwh * 100, 1) : 0,
    energyAutonomyPercent: annualConsumptionKwh > 0 ? round((annualConsumptionKwh - annualGridImportKwh) / annualConsumptionKwh * 100, 1) : 0,
    equivalentBatteryCycles: input.batteryCapacityKwh > 0 ? round(annualBatteryDischarge / input.batteryCapacityKwh, 1) : 0,
    finalDepositGross: round(deposit, 2),
    depositPayoutGross: round(depositPayoutGross, 2),
    finalBatterySocKwh: round(batterySoc),
    simplePaybackYears: investmentGross > 0 && annualSavingsGross > 0 ? round(investmentGross / annualSavingsGross, 2) : null,
  };
}

export const defaultHourlyLoadProfile = [
  2.97, 2.89, 2.89, 2.89, 2.97, 3.4, 4.25, 5.1, 4.67, 4.25, 4.08, 3.82,
  3.82, 3.91, 3.99, 4.25, 6.63, 6.37, 5.78, 5.1, 4.67, 4.25, 3.82, 3.23,
];

export const annualConsumptionDistribution = [
  0.11, 0.1, 0.09, 0.08, 0.07, 0.065, 0.065, 0.065, 0.075, 0.085, 0.095, 0.105,
];

export function distributeAnnualConsumption(annualConsumptionKwh: number) {
  if (!Number.isFinite(annualConsumptionKwh) || annualConsumptionKwh <= 0) {
    throw new Error('Roczne zużycie energii musi być większe od 0');
  }
  const total = annualConsumptionDistribution.reduce((sum, share) => sum + share, 0);
  return annualConsumptionDistribution.map((share) => annualConsumptionKwh * share / total);
}

export const polishPvMonthlyDistribution = [0.025, 0.045, 0.085, 0.115, 0.135, 0.145, 0.14, 0.125, 0.09, 0.055, 0.025, 0.015];

export const polishPvHourlyProfiles = polishPvMonthlyDistribution.map((_, month) => {
  const winterDistance = Math.abs(5.5 - month) / 5.5;
  const sunrise = 5 + winterDistance * 2.5;
  const sunset = 20.5 - winterDistance * 3;
  return Array.from({ length: 24 }, (_, hour) => {
    if (hour < sunrise || hour > sunset) return 0;
    const position = (hour - sunrise) / (sunset - sunrise);
    return Math.max(0, Math.sin(Math.PI * position));
  });
});
