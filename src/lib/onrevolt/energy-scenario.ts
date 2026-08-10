export const energyScenarioEngineVersion = 'ONREVOLT_RE_SIM_1.0.0';

export type EnergyScenarioInput = {
  monthlyConsumptionKwh: number[];
  hourlyLoadProfile: number[];
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
  scenarioCashCostGross: number;
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
  scenarioAnnualCostGross: number;
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

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function calculateEnergyScenario(input: EnergyScenarioInput): EnergyScenarioResult {
  assertArray(input.monthlyConsumptionKwh, 12, 'monthlyConsumptionKwh');
  assertArray(input.hourlyLoadProfile, 24, 'hourlyLoadProfile');
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
  assertFinite(input.depositPayoutRate, 'depositPayoutRate');
  if (input.depositPayoutRate > 1) throw new Error('Wypłata depozytu musi być ułamkiem 0-1');

  const loadProfile = normalized(input.hourlyLoadProfile, 'hourlyLoadProfile');
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
    };

    for (let day = 0; day < days; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const load = monthConsumption * loadProfile[hour] / days;
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
      }
    }

    annualBatteryCharge += monthTotals.charge;
    annualBatteryDischarge += monthTotals.discharge;
    deposit += monthTotals.export * input.exportGrossPerKwh;
    const energyDue = monthTotals.grid * input.energyBuyGrossPerKwh;
    const paidFromDeposit = Math.min(deposit, energyDue);
    deposit -= paidFromDeposit;
    const scenarioCashCost = energyDue - paidFromDeposit
      + monthTotals.grid * input.distributionGrossPerKwh
      + input.fixedMonthlyGross;
    const baselineCost = monthConsumption * (input.energyBuyGrossPerKwh + input.distributionGrossPerKwh)
      + input.fixedMonthlyGross;

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
      scenarioCashCostGross: round(scenarioCashCost, 2),
      depositEndGross: round(deposit, 2),
    });
  }

  const annualConsumptionKwh = months.reduce((sum, month) => sum + month.consumptionKwh, 0);
  const annualGridImportKwh = months.reduce((sum, month) => sum + month.gridImportKwh, 0);
  const annualExportKwh = months.reduce((sum, month) => sum + month.exportKwh, 0);
  const annualDirectPvKwh = months.reduce((sum, month) => sum + month.directPvKwh, 0);
  const baselineAnnualCostGross = months.reduce((sum, month) => sum + month.baselineCostGross, 0);
  const cashBeforePayout = months.reduce((sum, month) => sum + month.scenarioCashCostGross, 0);
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
    scenarioAnnualCostGross: round(scenarioAnnualCostGross, 2),
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
