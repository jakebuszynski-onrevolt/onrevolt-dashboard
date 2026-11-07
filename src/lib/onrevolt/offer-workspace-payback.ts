import type {
  NetBillingPolicy,
  OfferBillingScenarioResult,
} from './offer-workspace-billing';

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YEAR_ONE_RECONCILIATION_TOLERANCE_PLN = 0.01;
const DEFAULT_ANNUAL_PRICE_GROWTH_RATE = 0.05;

type BillingMonth = OfferBillingScenarioResult['months'][number];
type PaybackInput = {
  tariffOnly: OfferBillingScenarioResult;
  proposed: OfferBillingScenarioResult;
  policy: NetBillingPolicy;
  costAfterFinancingPln: number;
  horizonYears?: number;
  annualPriceGrowthRate?: number;
};

export type OfferWorkspacePaybackEstimate = {
  annualSavingsPln: number[];
  annualTargetCostPln: number[];
  annualTariffOnlyCostPln: number[];
  monthlyTargetCostPln: number[];
  monthlyTariffOnlyCostPln: number[];
  annualPriceGrowthRate: number;
  annualExportPriceGrowthRate: 0;
  estimatedPaybackYears: number | null;
  horizonYears: number;
};

type ProfileMonth = Pick<
  BillingMonth,
  | 'month'
  | 'energyCostPln'
  | 'depositUsedPln'
  | 'distributionCostPln'
  | 'fixedCostPln'
  | 'depositEarnedPln'
  | 'cashDuePln'
>;

type DepositLot = {
  amountPln: number;
  creditedOrdinal: number;
  expiresOrdinal: number;
  order: number;
};

function finite(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${label}: oczekiwano skończonej liczby nie mniejszej niż ${minimum}.`);
  }
  return value;
}

function finiteSigned(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}: oczekiwano skończonej liczby.`);
  }
  return value;
}

function monthOrdinal(value: unknown, label: string): number {
  if (typeof value !== 'string') throw new Error(`${label}: wymagany miesiąc YYYY-MM.`);
  const match = MONTH_PATTERN.exec(value);
  if (!match) throw new Error(`${label}: wymagany prawidłowy miesiąc YYYY-MM.`);
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function monthAt(ordinal: number): string {
  const year = Math.floor(ordinal / 12);
  const month = ordinal % 12 + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function checkedSum(values: number[], label: string): number {
  const sum = values.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum)) throw new Error(`${label}: suma przekracza zakres skończonych liczb.`);
  return sum;
}

function validateProfile(scenario: OfferBillingScenarioResult, label: string): ProfileMonth[] {
  if (!scenario || !Array.isArray(scenario.months) || scenario.months.length !== 12) {
    throw new Error(`${label}: wymagany jest dokładnie pełny profil 12 kolejnych miesięcy.`);
  }

  const months = scenario.months.map((month, index): ProfileMonth => {
    if (!month || typeof month !== 'object') throw new Error(`${label}.months[${index}]: brak miesiąca.`);
    const currentOrdinal = monthOrdinal(month.month, `${label}.months[${index}].month`);
    if (index > 0) {
      const previousOrdinal = monthOrdinal(scenario.months[index - 1].month, `${label}.months[${index - 1}].month`);
      if (currentOrdinal !== previousOrdinal + 1) {
        throw new Error(`${label}: miesiące muszą być chronologiczne i kolejne.`);
      }
    }

    return {
      month: month.month,
      energyCostPln: finiteSigned(month.energyCostPln, `${label}.months[${index}].energyCostPln`),
      depositUsedPln: finite(month.depositUsedPln, `${label}.months[${index}].depositUsedPln`),
      distributionCostPln: finite(month.distributionCostPln, `${label}.months[${index}].distributionCostPln`),
      fixedCostPln: finite(month.fixedCostPln, `${label}.months[${index}].fixedCostPln`),
      depositEarnedPln: finite(month.depositEarnedPln, `${label}.months[${index}].depositEarnedPln`),
      cashDuePln: finiteSigned(month.cashDuePln, `${label}.months[${index}].cashDuePln`),
    };
  });

  return months;
}

function validatePolicy(policy: NetBillingPolicy): { delayMonths: number; expiryMonths: number; lots: DepositLot[] } {
  if (!policy || policy.mode !== 'NET_BILLING') throw new Error('policy: wymagany tryb NET_BILLING.');
  if (policy.expiredRefundRate !== 0) throw new Error('policy.expiredRefundRate musi wynosić 0.');
  if (policy.depositCoverage !== 'ENERGY_ONLY' || policy.fixedChargeTreatment !== 'ALWAYS_BILLED') {
    throw new Error('policy: depozyt musi pokrywać wyłącznie energię, a opłaty stałe muszą być zawsze naliczane.');
  }

  const delayMonths = finite(policy.creditingDelayMonths, 'policy.creditingDelayMonths', 1);
  const expiryMonths = finite(policy.depositExpiryMonths, 'policy.depositExpiryMonths', 1);
  if (!Number.isInteger(delayMonths) || !Number.isInteger(expiryMonths)) {
    throw new Error('policy.creditingDelayMonths i policy.depositExpiryMonths muszą być całkowite.');
  }
  if (!Array.isArray(policy.initialDeposit)) throw new Error('policy.initialDeposit musi być jawną listą transz.');

  const anyFifoOrder = policy.initialDeposit.some((lot) => lot.fifoOrder !== undefined);
  if (anyFifoOrder && policy.initialDeposit.some((lot) => lot.fifoOrder === undefined)) {
    throw new Error('policy.initialDeposit: fifoOrder musi być podany dla każdej transzy albo dla żadnej.');
  }

  const usedOrders = new Set<number>();
  const lots = policy.initialDeposit.map((lot, index): DepositLot => {
    if (!lot || typeof lot !== 'object') throw new Error(`policy.initialDeposit[${index}]: brak transzy.`);
    const amountPln = finite(lot.amountPln, `policy.initialDeposit[${index}].amountPln`);
    const creditedOrdinal = monthOrdinal(lot.creditedMonth, `policy.initialDeposit[${index}].creditedMonth`);
    const expiresOrdinal = monthOrdinal(lot.expiresMonth, `policy.initialDeposit[${index}].expiresMonth`);
    if (expiresOrdinal <= creditedOrdinal || expiresOrdinal - creditedOrdinal > expiryMonths) {
      throw new Error(`policy.initialDeposit[${index}]: nieprawidłowy termin wygaśnięcia.`);
    }

    const order = lot.fifoOrder === undefined
      ? index
      : finite(lot.fifoOrder, `policy.initialDeposit[${index}].fifoOrder`);
    if (!Number.isInteger(order) || usedOrders.has(order)) {
      throw new Error('policy.initialDeposit.fifoOrder musi być unikalnym całkowitym indeksem nieujemnym.');
    }
    usedOrders.add(order);
    return { amountPln, creditedOrdinal, expiresOrdinal, order };
  });

  return { delayMonths, expiryMonths, lots };
}

function replayProfile(
  profile: ProfileMonth[],
  openingLots: DepositLot[],
  delayMonths: number,
  expiryMonths: number,
  horizonYears: number,
  annualPriceGrowthRate: number,
): { monthlyCashDue: number[]; annualCashDue: number[] } {
  const lots = openingLots.map((lot) => ({ ...lot }));
  let nextOrder = lots.reduce((next, lot) => Math.max(next, lot.order + 1), 0);
  const monthlyCashDue: number[] = [];
  const annualCashDue: number[] = Array(horizonYears).fill(0);
  const firstMonthOrdinal = monthOrdinal(profile[0].month, 'profile.month');

  for (let monthIndex = 0; monthIndex < horizonYears * 12; monthIndex += 1) {
    const currentOrdinal = firstMonthOrdinal + monthIndex;
    const currentMonth = monthAt(currentOrdinal);
    const month = profile[monthIndex % 12];
    const purchaseCostGrowthFactor = (1 + annualPriceGrowthRate) ** Math.floor(monthIndex / 12);
    if (!Number.isFinite(purchaseCostGrowthFactor)) {
      throw new Error(`${currentMonth}: współczynnik wzrostu kosztów zakupu jest poza zakresem.`);
    }
    for (let lotIndex = lots.length - 1; lotIndex >= 0; lotIndex -= 1) {
      if (lots[lotIndex].expiresOrdinal <= currentOrdinal) lots.splice(lotIndex, 1);
    }

    const preDepositEnergy = (month.energyCostPln + month.depositUsedPln) * purchaseCostGrowthFactor;
    if (!Number.isFinite(preDepositEnergy)) throw new Error(`${currentMonth}: koszt energii przed depozytem jest poza zakresem.`);
    const activeLots = lots
      .filter((lot) => lot.creditedOrdinal <= currentOrdinal)
      .sort((left, right) => left.creditedOrdinal - right.creditedOrdinal || left.order - right.order);
    let remainingEnergy = preDepositEnergy;
    for (const lot of activeLots) {
      if (remainingEnergy <= 0) break;
      const used = Math.min(lot.amountPln, remainingEnergy);
      lot.amountPln -= used;
      remainingEnergy -= used;
    }
    for (let lotIndex = lots.length - 1; lotIndex >= 0; lotIndex -= 1) {
      if (lots[lotIndex].amountPln <= 0) lots.splice(lotIndex, 1);
    }

    const cashDue = remainingEnergy
      + month.distributionCostPln * purchaseCostGrowthFactor
      + month.fixedCostPln * purchaseCostGrowthFactor;
    if (!Number.isFinite(cashDue)) throw new Error(`${currentMonth}: odtworzony rachunek jest poza zakresem.`);
    monthlyCashDue.push(cashDue);
    annualCashDue[Math.floor(monthIndex / 12)] += cashDue;

    if (month.depositEarnedPln > 0) {
      const creditedOrdinal = currentOrdinal + delayMonths;
      lots.push({
        amountPln: month.depositEarnedPln,
        creditedOrdinal,
        expiresOrdinal: creditedOrdinal + expiryMonths,
        order: nextOrder++,
      });
    }
  }

  annualCashDue.forEach((amount, index) => {
    if (!Number.isFinite(amount)) throw new Error(`Rok ${index + 1}: suma rachunków jest poza zakresem.`);
  });
  return { monthlyCashDue, annualCashDue };
}

function assertYearOneParity(profile: ProfileMonth[], replayed: number[], label: string): void {
  const actual = checkedSum(profile.map((month) => month.cashDuePln), `${label}.cashDuePln`);
  if (Math.abs(replayed[0] - actual) > YEAR_ONE_RECONCILIATION_TOLERANCE_PLN + Number.EPSILON) {
    throw new Error(
      `${label}: odtworzony rachunek roku 1 (${replayed[0].toFixed(2)} PLN) `
      + `nie zgadza się z rzeczywistym (${actual.toFixed(2)} PLN) z tolerancją 0,01 PLN.`,
    );
  }
}

function unavailableEstimate(horizonYears: number, annualPriceGrowthRate: number): OfferWorkspacePaybackEstimate {
  return {
    annualSavingsPln: [],
    annualTargetCostPln: [],
    annualTariffOnlyCostPln: [],
    monthlyTargetCostPln: [],
    monthlyTariffOnlyCostPln: [],
    annualPriceGrowthRate,
    annualExportPriceGrowthRate: 0,
    estimatedPaybackYears: null,
    horizonYears,
  };
}

function hasNegativeEnergy(scenario: OfferBillingScenarioResult, profile: ProfileMonth[]): boolean {
  return profile.some(month => month.energyCostPln < 0)
    || (Array.isArray(scenario.intervals) && scenario.intervals.some(interval => interval.energyCostPln < 0));
}

/**
 * Estimates payback by repeating the supplied full 12-consecutive-month billed profile.
 * It does not rerun the billing engine or forecast future calendar prices, weather, degradation,
 * or actual consumption. Purchase, distribution, and fixed costs grow at the requested rate;
 * export prices and deposit lots remain nominal while dated lots advance on a synthetic timeline.
 * Negative monthly or interval energy costs make the multi-year monthly replay unavailable.
 */
export function estimateOfferWorkspacePayback(input: PaybackInput): OfferWorkspacePaybackEstimate {
  if (!input || typeof input !== 'object') throw new Error('input: wymagany obiekt wejściowy.');
  const horizonYears = input.horizonYears === undefined ? 20 : finite(input.horizonYears, 'horizonYears', 1);
  if (!Number.isInteger(horizonYears)) throw new Error('horizonYears musi być dodatnią liczbą całkowitą.');
  const costAfterFinancingPln = finite(input.costAfterFinancingPln, 'costAfterFinancingPln');
  const annualPriceGrowthRate = input.annualPriceGrowthRate === undefined
    ? DEFAULT_ANNUAL_PRICE_GROWTH_RATE
    : finite(input.annualPriceGrowthRate, 'annualPriceGrowthRate');
  const tariffOnlyProfile = validateProfile(input.tariffOnly, 'tariffOnly');
  const proposedProfile = validateProfile(input.proposed, 'proposed');
  if (tariffOnlyProfile.some((month, index) => month.month !== proposedProfile[index].month)) {
    throw new Error('tariffOnly i proposed muszą obejmować te same 12 miesięcy.');
  }
  const policy = validatePolicy(input.policy);
  if (hasNegativeEnergy(input.tariffOnly, tariffOnlyProfile) || hasNegativeEnergy(input.proposed, proposedProfile)) {
    return unavailableEstimate(horizonYears, annualPriceGrowthRate);
  }

  const tariffReplay = replayProfile(tariffOnlyProfile, policy.lots, policy.delayMonths, policy.expiryMonths, horizonYears, annualPriceGrowthRate);
  const proposedReplay = replayProfile(proposedProfile, policy.lots, policy.delayMonths, policy.expiryMonths, horizonYears, annualPriceGrowthRate);
  assertYearOneParity(tariffOnlyProfile, tariffReplay.annualCashDue, 'tariffOnly');
  assertYearOneParity(proposedProfile, proposedReplay.annualCashDue, 'proposed');

  const annualSavingsPln = tariffReplay.annualCashDue.map((cost, index) => cost - proposedReplay.annualCashDue[index]);
  const monthlySavings = tariffReplay.monthlyCashDue.map((cost, index) => cost - proposedReplay.monthlyCashDue[index]);
  let estimatedPaybackYears: number | null = null;
  if (costAfterFinancingPln === 0) {
    const totalHorizonSavings = checkedSum(annualSavingsPln, 'annualSavingsPln');
    if (annualSavingsPln[0] > 0 && totalHorizonSavings > 0) estimatedPaybackYears = 0;
  } else {
    let cumulativeSavings = 0;
    for (let index = 0; index < monthlySavings.length; index += 1) {
      const previousSavings = cumulativeSavings;
      cumulativeSavings += monthlySavings[index];
      if (!Number.isFinite(cumulativeSavings)) throw new Error('Skumulowane oszczędności są poza zakresem.');
      if (monthlySavings[index] > 0 && previousSavings < costAfterFinancingPln
        && cumulativeSavings >= costAfterFinancingPln) {
        estimatedPaybackYears = (index + (costAfterFinancingPln - previousSavings) / monthlySavings[index]) / 12;
        break;
      }
    }
  }

  return {
    annualSavingsPln,
    annualTargetCostPln: proposedReplay.annualCashDue,
    annualTariffOnlyCostPln: tariffReplay.annualCashDue,
    monthlyTargetCostPln: proposedReplay.monthlyCashDue,
    monthlyTariffOnlyCostPln: tariffReplay.monthlyCashDue,
    annualPriceGrowthRate,
    annualExportPriceGrowthRate: 0,
    estimatedPaybackYears,
    horizonYears,
  };
}
