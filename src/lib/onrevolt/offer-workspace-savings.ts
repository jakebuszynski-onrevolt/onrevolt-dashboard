import type { OfferBillingScenarioResult } from './offer-workspace-billing';
import type { OfferWorkspaceCalculation, OfferForecastFlow } from './offer-workspace-calculation-types';
import type { OfferWorkspaceDayProfile } from './offer-workspace-chart-data';
import type { OfferWorkspaceValuationScenario, OfferWorkspaceValuationValues } from './offer-workspace-valuation';

type Settlement = OfferWorkspaceValuationScenario['settlement'];
type BillLine = Pick<OfferBillingScenarioResult['totals'],
  | 'importKwh' | 'exportKwh' | 'billedImportKwh' | 'billedExportKwh' | 'coveredKwh'
  | 'energyCostPln' | 'distributionCostPln' | 'fixedCostPln' | 'coveredEnergyPln'
  | 'coveredDistributionPln' | 'depositUsedPln' | 'depositEarnedPln' | 'cashDuePln'>;

export type OfferWorkspaceBillFinancialValues = {
  importKwh: number;
  exportKwh: number;
  billedImportKwh: number;
  billedExportKwh: number;
  coveredKwh: number;
  rateBasisImportKwh: number | null;
  energyCostPln: number;
  distributionCostPln: number;
  fixedCostPln: number;
  coveredEnergyPln: number;
  coveredDistributionPln: number;
  depositUsedPln: number;
  depositEarnedPln: number;
  grossPurchaseEnergyCostPln: number;
  grossPurchaseDistributionCostPln: number;
  paidEnergyCostPln: number;
  paidDistributionCostPln: number;
  paidFixedCostPln: number;
  cashDuePln: number;
  averageEnergyPurchasePlnPerKwh: number | null;
  averageDistributionPurchasePlnPerKwh: number | null;
};

export type OfferWorkspaceSavingsBillMonth = OfferWorkspaceBillFinancialValues & { period: string };

export type OfferWorkspaceSavingsBillSummary = {
  totals: OfferWorkspaceBillFinancialValues;
  months: OfferWorkspaceSavingsBillMonth[];
  representedMonths: number;
  averageMonthlyFixedCostPln: number | null;
};

export type OfferWorkspaceSavingsProjection = {
  horizonYears: number;
  annualPriceGrowthRate: number;
  annualExportPriceGrowthRate: number;
  annualTargetCostPln: number[];
  annualTariffOnlyCostPln: number[];
  annualSavingsPln: number[];
  cumulativeTargetCostPln: number[];
  cumulativeTariffOnlyCostPln: number[];
  totalTargetCostPln: number;
  totalTariffOnlyCostPln: number;
  totalSavingsPln: number;
  costAfterFinancingPln: number | null;
  netSavingsAfterCostPln: number | null;
  estimatedPaybackYears: number | null;
};

export type OfferWorkspaceSavingsPresentation = {
  annualBill: OfferWorkspaceSavingsBillSummary | null;
  projection: OfferWorkspaceSavingsProjection | null;
  projectionReason: string | null;
};

export type OfferSavingsBatteryTotals = {
  months: Record<string, number>;
  hours: Record<string, number>;
};

const warsawParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23',
});

function localKeys(value: string): { date: string; period: string; hour: number } {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error(`Nieprawidłowy czas UTC: ${value}.`);
  const parts = Object.fromEntries(warsawParts.formatToParts(instant).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, period: date.slice(0, 7), hour: Number(parts.hour) };
}

function finite(value: unknown, label: string, minimum = Number.NEGATIVE_INFINITY): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${label}: oczekiwano skończonej liczby.`);
  }
  return value;
}

function checkedSum(values: number[], label: string): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total)) throw new Error(`${label}: suma przekracza zakres skończonych liczb.`);
  return total;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function lineValues(row: BillLine, label: string, settlement: Settlement): OfferWorkspaceBillFinancialValues {
  const importKwh = finite(row.importKwh, `${label}.importKwh`, 0);
  const exportKwh = finite(row.exportKwh, `${label}.exportKwh`, 0);
  const billedImportKwh = finite(row.billedImportKwh, `${label}.billedImportKwh`, 0);
  const billedExportKwh = finite(row.billedExportKwh, `${label}.billedExportKwh`, 0);
  const coveredKwh = finite(row.coveredKwh, `${label}.coveredKwh`, 0);
  const energyCostPln = finite(row.energyCostPln, `${label}.energyCostPln`);
  const distributionCostPln = finite(row.distributionCostPln, `${label}.distributionCostPln`);
  const fixedCostPln = finite(row.fixedCostPln, `${label}.fixedCostPln`);
  const coveredEnergyPln = finite(row.coveredEnergyPln, `${label}.coveredEnergyPln`);
  const coveredDistributionPln = finite(row.coveredDistributionPln, `${label}.coveredDistributionPln`, 0);
  const depositUsedPln = finite(row.depositUsedPln, `${label}.depositUsedPln`, 0);
  const depositEarnedPln = finite(row.depositEarnedPln, `${label}.depositEarnedPln`, 0);
  const cashDuePln = finite(row.cashDuePln, `${label}.cashDuePln`);
  const rateBasisImportKwh = settlement === 'NET_METERING'
    ? billedImportKwh + coveredKwh : settlement === 'NET_BILLING' ? billedImportKwh : null;

  // energyCostPln is already net of coverage; coveredEnergyPln restores it once.
  const grossPurchaseEnergyCostPln = energyCostPln + coveredEnergyPln;
  const grossPurchaseDistributionCostPln = distributionCostPln + coveredDistributionPln;
  if (!Number.isFinite(grossPurchaseEnergyCostPln) || !Number.isFinite(grossPurchaseDistributionCostPln)
    || (rateBasisImportKwh !== null && !Number.isFinite(rateBasisImportKwh))) {
    throw new Error(`${label}: koszt zakupu lub mianownik stawki poza zakresem.`);
  }

  return {
    importKwh, exportKwh, billedImportKwh, billedExportKwh, coveredKwh, rateBasisImportKwh,
    energyCostPln, distributionCostPln, fixedCostPln, coveredEnergyPln, coveredDistributionPln,
    depositUsedPln, depositEarnedPln,
    grossPurchaseEnergyCostPln: round(grossPurchaseEnergyCostPln),
    grossPurchaseDistributionCostPln: round(grossPurchaseDistributionCostPln),
    paidEnergyCostPln: energyCostPln,
    paidDistributionCostPln: distributionCostPln,
    paidFixedCostPln: fixedCostPln,
    cashDuePln,
    averageEnergyPurchasePlnPerKwh: rateBasisImportKwh !== null && rateBasisImportKwh > 0
      ? round(grossPurchaseEnergyCostPln / rateBasisImportKwh) : null,
    averageDistributionPurchasePlnPerKwh: rateBasisImportKwh !== null && rateBasisImportKwh > 0
      ? round(grossPurchaseDistributionCostPln / rateBasisImportKwh) : null,
  };
}

function sumBillValues(rows: OfferWorkspaceBillFinancialValues[], label: string): OfferWorkspaceBillFinancialValues {
  const keys: Array<keyof Omit<OfferWorkspaceBillFinancialValues,
    'averageEnergyPurchasePlnPerKwh' | 'averageDistributionPurchasePlnPerKwh' | 'rateBasisImportKwh'>> = [
    'importKwh', 'exportKwh', 'billedImportKwh', 'billedExportKwh', 'coveredKwh',
    'energyCostPln', 'distributionCostPln', 'fixedCostPln', 'coveredEnergyPln',
    'coveredDistributionPln', 'depositUsedPln', 'depositEarnedPln', 'grossPurchaseEnergyCostPln',
    'grossPurchaseDistributionCostPln', 'paidEnergyCostPln', 'paidDistributionCostPln',
    'paidFixedCostPln', 'cashDuePln',
  ];
  const totals = Object.fromEntries(keys.map(key => [key,
    round(checkedSum(rows.map(row => row[key]), `${label}.${key}`))])) as unknown as
    Omit<OfferWorkspaceBillFinancialValues, 'averageEnergyPurchasePlnPerKwh' | 'averageDistributionPurchasePlnPerKwh' | 'rateBasisImportKwh'>;
  const rateBasisImportKwh = rows.some(row => row.rateBasisImportKwh === null)
    ? null : round(checkedSum(rows.map(row => row.rateBasisImportKwh!), `${label}.rateBasisImportKwh`));
  return {
    ...totals,
    rateBasisImportKwh,
    averageEnergyPurchasePlnPerKwh: rateBasisImportKwh !== null && rateBasisImportKwh > 0
      ? round(totals.grossPurchaseEnergyCostPln / rateBasisImportKwh) : null,
    averageDistributionPurchasePlnPerKwh: rateBasisImportKwh !== null && rateBasisImportKwh > 0
      ? round(totals.grossPurchaseDistributionCostPln / rateBasisImportKwh) : null,
  };
}

export function summarizeOfferSavingsBill(
  bill: OfferBillingScenarioResult,
  settlement: Settlement,
): OfferWorkspaceSavingsBillSummary {
  if (!bill || !Array.isArray(bill.months) || !bill.totals) throw new Error('bill: wymagany wynik rachunku.');
  const months = bill.months.map((month, index) => ({
    period: month.month,
    ...lineValues(month, `bill.months[${index}]`, settlement),
  }));
  const totals = months.length
    ? sumBillValues(months, 'bill.totals')
    : lineValues(bill.totals, 'bill.totals', settlement);
  return {
    totals,
    months,
    representedMonths: months.length,
    averageMonthlyFixedCostPln: months.length ? round(totals.paidFixedCostPln / months.length) : null,
  };
}

function valuationValues(values: OfferWorkspaceBillFinancialValues, settlement: Settlement): OfferWorkspaceValuationValues {
  const importValuePln = values.grossPurchaseEnergyCostPln + values.grossPurchaseDistributionCostPln;
  const exportValuePln = settlement === 'NET_BILLING' ? values.depositEarnedPln : null;
  return {
    importKwh: values.importKwh,
    exportKwh: values.exportKwh,
    importValuePln: round(importValuePln),
    exportValuePln,
    averageBuyPlnPerKwh: values.rateBasisImportKwh !== null && values.rateBasisImportKwh > 0
      ? round(importValuePln / values.rateBasisImportKwh) : null,
    averageSellPlnPerKwh: exportValuePln !== null && values.billedExportKwh > 0
      ? round(exportValuePln / values.billedExportKwh) : null,
  };
}

function emptyValuationValues(): OfferWorkspaceValuationValues {
  return {
    importKwh: null, exportKwh: null, importValuePln: null, exportValuePln: null,
    averageBuyPlnPerKwh: null, averageSellPlnPerKwh: null,
  };
}

export function adaptOfferWorkspaceProposedBillValuation(
  bill: OfferBillingScenarioResult,
  settlement: Settlement,
  dayProfiles: readonly OfferWorkspaceDayProfile[],
): OfferWorkspaceValuationScenario {
  if (!bill || !Array.isArray(bill.intervals) || !Array.isArray(bill.months)) {
    throw new Error('bill: wymagane są interwały i podsumowania miesięczne rachunku.');
  }
  const summary = summarizeOfferSavingsBill(bill, settlement);
  const selectedSlots = new Set(dayProfiles.flatMap(profile => profile.hours.map(({ hour }) => `${profile.date}/${hour}`)));
  const selectedHourValues = new Map<string, OfferWorkspaceBillFinancialValues[]>();
  const hasPhysicalVsBilledImport = settlement === 'NET_BILLING'
    && bill.intervals.some(row => Math.abs(row.importKwh - row.billedImportKwh) > 1e-6);

  bill.intervals.forEach((row, index) => {
    const local = localKeys(row.startUtc);
    if (row.month !== local.period) throw new Error(`bill.intervals[${index}].month nie zgadza się z datą Europe/Warsaw.`);
    const key = `${local.date}/${local.hour}`;
    if (!selectedSlots.has(key)) return;
    const values = selectedHourValues.get(key) || [];
    values.push(lineValues(row, `bill.intervals[${index}]`, settlement));
    selectedHourValues.set(key, values);
  });

  const days = dayProfiles.map(profile => {
    const hours = profile.hours.map(({ hour }) => {
      const key = `${profile.date}/${hour}`;
      const rows = selectedHourValues.get(key);
      return { hour, ...(rows?.length
        ? valuationValues(sumBillValues(rows, `bill.days[${key}]`), settlement)
        : emptyValuationValues()) };
    });
    const dayRows = profile.hours.flatMap(({ hour }) => selectedHourValues.get(`${profile.date}/${hour}`) || []);
    const totals = dayRows.length
      ? valuationValues(sumBillValues(dayRows, `bill.days[${profile.date}]`), settlement)
      : emptyValuationValues();
    return { date: profile.date, period: profile.period, dayType: profile.dayType, totals, hours };
  });

  const issues = [
    ...(settlement === 'NET_BILLING'
      ? ['NET_BILLING: exportValuePln to wartość przypisana depozytowi (może uwzględniać mnożnik), nie surowa wartość RCE ani gwarantowana wypłata; etykieta wykresu: „Wartość depozytu za eksport”.']
      : []),
    ...(hasPhysicalVsBilledImport
      ? ['NET_BILLING: importKwh pokazuje fizyczny import, a średnia zakupu jest liczona od billedImportKwh po godzinowym bilansowaniu.']
      : []),
    ...(settlement === null ? ['Brak jawnego systemu rozliczeń; średnie stawki zakupu i eksportu pominięto.'] : []),
  ];

  return {
    settlement,
    source: 'MISSING',
    totals: valuationValues(summary.totals, settlement),
    months: summary.months.map(month => ({ period: month.period, ...valuationValues(month, settlement) })),
    days,
    issues,
  };
}

function projectionFor(calculation: OfferWorkspaceCalculation): { projection: OfferWorkspaceSavingsProjection | null; reason: string | null } {
  const target: unknown = calculation.estimatedAnnualTargetCostPln;
  const tariffOnly: unknown = calculation.estimatedAnnualTariffOnlyCostPln;
  const savings: unknown = calculation.estimatedAnnualSavingsPln;
  if (target === undefined && tariffOnly === undefined && savings === undefined) {
    return { projection: null, reason: 'Brak wieloletniej projekcji w wyniku obliczeń.' };
  }
  if (!Array.isArray(target) || !Array.isArray(tariffOnly) || !Array.isArray(savings)) {
    return { projection: null, reason: 'Projekcja jest niekompletna; odśwież wynik, aby uzyskać tablice kosztu taryfowego i docelowego.' };
  }
  if (target.length !== tariffOnly.length || target.length !== savings.length) {
    return { projection: null, reason: 'Tablice projekcji mają różne długości.' };
  }
  if (!target.length) return { projection: null, reason: 'Projekcja wieloletnia jest niedostępna dla tego profilu cen.' };
  if (calculation.estimateHorizonYears !== undefined && calculation.estimateHorizonYears !== target.length) {
    return { projection: null, reason: 'Długość tablic projekcji nie zgadza się z horyzontem.' };
  }
  for (let index = 0; index < target.length; index += 1) {
    if (![target[index], tariffOnly[index], savings[index]].every(value => typeof value === 'number' && Number.isFinite(value))) {
      return { projection: null, reason: `Rok ${index + 1}: projekcja zawiera nieprawidłową wartość.` };
    }
    if (Math.abs((tariffOnly[index] as number) - (target[index] as number) - (savings[index] as number)) > 0.01) {
      return { projection: null, reason: `Rok ${index + 1}: oszczędność nie zgadza się z różnicą kosztów.` };
    }
  }

  const totalTargetCostPln = checkedSum(target as number[], 'estimatedAnnualTargetCostPln');
  const totalTariffOnlyCostPln = checkedSum(tariffOnly as number[], 'estimatedAnnualTariffOnlyCostPln');
  const totalSavingsPln = checkedSum(savings as number[], 'estimatedAnnualSavingsPln');
  const rawCost = calculation.costAfterFinancingPln;
  const costAfterFinancingPln = rawCost == null ? null
    : typeof rawCost === 'number' && Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : null;
  const rawPayback = calculation.estimatedPaybackYears;
  const estimatedPaybackYears = rawPayback == null ? null
    : typeof rawPayback === 'number' && Number.isFinite(rawPayback) && rawPayback >= 0 ? rawPayback : null;
  const monthlyTarget = calculation.estimatedMonthlyTargetCostPln;
  const monthlyTariffOnly = calculation.estimatedMonthlyTariffOnlyCostPln;
  const annualPriceGrowthRate = calculation.estimatedAnnualPriceGrowthRate;
  const annualExportPriceGrowthRate = calculation.estimatedAnnualExportPriceGrowthRate;
  if (!Array.isArray(monthlyTarget) || !Array.isArray(monthlyTariffOnly)
    || monthlyTarget.length !== target.length * 12 || monthlyTariffOnly.length !== monthlyTarget.length
    || costAfterFinancingPln === null
    || typeof annualPriceGrowthRate !== 'number' || !Number.isFinite(annualPriceGrowthRate) || annualPriceGrowthRate < 0
    || annualExportPriceGrowthRate !== 0) {
    return { projection: null, reason: 'Brak miesięcznej projekcji, kosztu inwestycji lub założeń wzrostu cen. Przelicz wariant ponownie.' };
  }
  if ([...monthlyTarget, ...monthlyTariffOnly].some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    return { projection: null, reason: 'Miesięczna projekcja zawiera nieprawidłową wartość.' };
  }
  for (let index = 0; index < target.length; index += 1) {
    const start = index * 12;
    if (Math.abs(checkedSum(monthlyTarget.slice(start, start + 12), 'monthlyTarget') - target[index]) > 0.01
      || Math.abs(checkedSum(monthlyTariffOnly.slice(start, start + 12), 'monthlyTariffOnly') - tariffOnly[index]) > 0.01) {
      return { projection: null, reason: `Rok ${index + 1}: projekcja miesięczna nie zgadza się z roczną.` };
    }
  }
  const cumulative = (values: number[], openingCost: number) => {
    const result = [openingCost];
    for (const value of values) result.push(checkedSum([result[result.length - 1], value], 'cumulativeCost'));
    return result;
  };

  return {
    projection: {
      horizonYears: target.length,
      annualPriceGrowthRate,
      annualExportPriceGrowthRate,
      annualTargetCostPln: [...target] as number[],
      annualTariffOnlyCostPln: [...tariffOnly] as number[],
      annualSavingsPln: [...savings] as number[],
      cumulativeTargetCostPln: cumulative(monthlyTarget, costAfterFinancingPln),
      cumulativeTariffOnlyCostPln: cumulative(monthlyTariffOnly, 0),
      totalTargetCostPln: round(totalTargetCostPln),
      totalTariffOnlyCostPln: round(totalTariffOnlyCostPln),
      totalSavingsPln: round(totalSavingsPln),
      costAfterFinancingPln,
      netSavingsAfterCostPln: costAfterFinancingPln === null
        ? null : round(totalSavingsPln - costAfterFinancingPln),
      estimatedPaybackYears,
    },
    reason: null,
  };
}

export function buildOfferWorkspaceSavingsPresentation(
  calculation: OfferWorkspaceCalculation,
  settlement: Settlement,
): OfferWorkspaceSavingsPresentation {
  if (!calculation || typeof calculation !== 'object') throw new Error('calculation: wymagany obiekt wyniku obliczeń.');
  const annualBill = calculation.proposedBill
    ? summarizeOfferSavingsBill(calculation.proposedBill, settlement) : null;
  const projection = projectionFor(calculation);
  return { annualBill, projection: projection.projection, projectionReason: projection.reason };
}

export function offerSavingsBatteryTotals(flows: readonly OfferForecastFlow[]): OfferSavingsBatteryTotals {
  if (!Array.isArray(flows)) throw new Error('forecastFlows: wymagana jest tablica przepływów.');
  const months: Record<string, number> = {};
  const hours: Record<string, number> = {};
  for (const [index, flow] of flows.entries()) {
    const { date, period, hour } = localKeys(flow.startUtc);
    const discharged = finite(flow.batteryToLoadKwh, `forecastFlows[${index}].batteryToLoadKwh`, 0);
    const hourKey = `${date}T${String(hour).padStart(2, '0')}`;
    months[period] = (months[period] || 0) + discharged;
    hours[hourKey] = (hours[hourKey] || 0) + discharged;
  }
  return {
    months: Object.fromEntries(Object.entries(months).map(([key, value]) => [key, round(value)])),
    hours: Object.fromEntries(Object.entries(hours).map(([key, value]) => [key, round(value)])),
  };
}
