import type { OfferCandidateItemSnapshot, OfferCandidateSnapshot } from './offer-candidates';

export type OfferEconomicsBaselineId = 'ZERO_INVESTMENT' | 'TARIFF_ONLY';
export type OfferEconomicsVerificationStatus = 'verified' | 'unverified' | 'failed';

export interface EconomicsProvenance {
  source: string;
  reference: string;
  verifiedAt: string;
}

export interface TariffOnlyBaselineInput {
  upfrontCostGross: number;
  /** Annual net operating savings versus ZERO_INVESTMENT, not absolute energy-bill payments. */
  annualNetOperatingCashflowsGross: number[];
  provenance: EconomicsProvenance;
}

export interface ConfirmedFinancingReduction {
  id: string;
  kind: 'GRANT_AWARD' | 'TAX_SAVING';
  confirmationStatus: 'confirmed';
  amountGross: number;
  year: number;
  timing: 'start-of-year' | 'end-of-year';
  provenance: EconomicsProvenance;
}

export interface OfferEconomicsVerification {
  physical: OfferEconomicsVerificationStatus;
  tariff: OfferEconomicsVerificationStatus;
  pv: OfferEconomicsVerificationStatus;
  compatibility: OfferEconomicsVerificationStatus;
}

export interface OfferEconomicsVerificationEvidence {
  physical: EconomicsProvenance;
  tariff: EconomicsProvenance;
  pv: EconomicsProvenance;
  compatibility: EconomicsProvenance;
}

export interface OfferEconomicsCandidateInput {
  candidate: OfferCandidateSnapshot;
  investmentGross: number;
  investmentProvenance: EconomicsProvenance;
  /** Annual net operating savings versus ZERO_INVESTMENT, not absolute energy-bill payments. */
  annualNetOperatingCashflowsGross: number[];
  cashflowProvenance: EconomicsProvenance;
  verification: OfferEconomicsVerification;
  verificationEvidence: OfferEconomicsVerificationEvidence;
  verificationReasons: Record<keyof OfferEconomicsVerification, string[]>;
  confirmedFinancingReductions: ConfirmedFinancingReduction[];
}

export interface OfferEconomicsInput {
  horizonYears: number;
  annualDiscountRate: number;
  /** Operating savings are treated as uniform within each year for discounting and interpolated payback. */
  annualCashflowTiming: 'uniform-through-year';
  rankingBaselineId: OfferEconomicsBaselineId;
  tariffOnlyBaseline: TariffOnlyBaselineInput;
  candidates: OfferEconomicsCandidateInput[];
}

export interface OfferEconomicsBaselineSnapshot {
  id: OfferEconomicsBaselineId;
  upfrontCostGross: number;
  /** Annual net operating savings versus ZERO_INVESTMENT, not absolute energy-bill payments. */
  annualNetOperatingCashflowsGross: number[];
  provenance: EconomicsProvenance | null;
}

export interface OfferEconomicsComparison {
  baselineId: OfferEconomicsBaselineId;
  upfrontInvestmentDeltaGross: number;
  annualIncrementalCashflowsGross: number[];
  confirmedFinancingReductionsGross: number;
  longTermNetBenefitGross: number;
  netPresentValueGross: number;
  paybackYearsPrecise: number | null;
  paybackYearsDisplayFloor: number | null;
  netCostAfterConfirmedFinancingGross: number;
}

export interface OfferEconomicsCandidateAssessment {
  id: string;
  templateIds: string[];
  templateVersions: number[];
  eligibilityStatus: 'eligible' | 'not-eligible';
  exclusionReasons: string[];
  comparisons: Record<OfferEconomicsBaselineId, OfferEconomicsComparison> | null;
}

export interface RankedOfferEconomicsCandidate {
  id: string;
  rank: number;
  paybackYearsPrecise: number | null;
  paybackYearsDisplayFloor: number | null;
  longTermNetBenefitGross: number;
  netPresentValueGross: number;
  netCostAfterConfirmedFinancingGross: number;
}

export interface OfferEconomicsResult {
  horizonYears: number;
  annualDiscountRate: number;
  rankingBaselineId: OfferEconomicsBaselineId;
  baselines: Record<OfferEconomicsBaselineId, OfferEconomicsBaselineSnapshot>;
  candidateAssessments: OfferEconomicsCandidateAssessment[];
  rankedCandidates: RankedOfferEconomicsCandidate[];
  recommendedCandidateId: string | null;
  recommendationReason: string;
}

const verificationKeys = ['physical', 'tariff', 'pv', 'compatibility'] as const;
const explicitlyNonPricedSupplyModes = new Set(['CLIENT_OWNED_USED', 'CLIENT_SUPPLIED_NEW', 'NOT_INCLUDED']);

function isZeroCalculationLine(calculation: NonNullable<OfferCandidateItemSnapshot['calculation']>): boolean {
  return Object.values(calculation).every((value) => Number.isFinite(value) && value === 0);
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} musi być skończoną liczbą nieujemną.`);
  }
}

function assertFiniteCashflows(values: number[], expectedLength: number, name: string): void {
  if (!Array.isArray(values) || values.length !== expectedLength) {
    throw new RangeError(`${name} musi zawierać dokładnie ${expectedLength} rocznych przepływów.`);
  }
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) throw new RangeError(`${name}, rok ${index + 1}: przepływ musi być skończony.`);
  });
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (!Number.isFinite(parsed.getTime())) return false;
  if (value.length === 10) return parsed.toISOString().slice(0, 10) === value;
  return true;
}

function provenanceIssues(provenance: EconomicsProvenance, label: string): string[] {
  const reasons: string[] = [];
  if (!provenance.source.trim()) reasons.push(`${label}: brak wskazania źródła.`);
  if (!provenance.reference.trim()) reasons.push(`${label}: brak referencji do dowodu.`);
  if (!isValidDate(provenance.verifiedAt)) reasons.push(`${label}: data weryfikacji nie jest poprawną datą ISO.`);
  return reasons;
}

function receiptTime(reduction: ConfirmedFinancingReduction): number {
  return reduction.timing === 'start-of-year' ? reduction.year - 1 : reduction.year;
}

function sumReceiptsAtTime(
  reductions: ConfirmedFinancingReduction[],
  time: number,
  annualDiscountRate?: number,
): number {
  return reductions.reduce((sum, reduction) => {
    if (receiptTime(reduction) !== time) return sum;
    return sum + (annualDiscountRate === undefined
      ? reduction.amountGross
      : reduction.amountGross / ((1 + annualDiscountRate) ** time));
  }, 0);
}

function presentValueOfUniformAnnualCashflow(amount: number, year: number, annualRate: number): number {
  if (annualRate === 0) return amount;
  const logGrowth = Math.log1p(annualRate);
  const startDiscount = Math.exp(-logGrowth * (year - 1));
  const endDiscount = Math.exp(-logGrowth * year);
  return amount * (startDiscount - endDiscount) / logGrowth;
}

function validateReductionInputs(
  reductions: ConfirmedFinancingReduction[],
  horizonYears: number,
  candidateId: string,
): void {
  const seenIds = new Set<string>();
  for (const reduction of reductions) {
    if (reduction.confirmationStatus !== 'confirmed') {
      throw new TypeError(`${candidateId}: niepotwierdzone finansowanie nie może obniżać kosztu.`);
    }
    if (!reduction.id.trim() || seenIds.has(reduction.id)) {
      throw new TypeError(`${candidateId}: identyfikatory potwierdzonych redukcji muszą być jawne i unikalne.`);
    }
    seenIds.add(reduction.id);
    if (reduction.kind !== 'GRANT_AWARD' && reduction.kind !== 'TAX_SAVING') {
      throw new TypeError(`${candidateId}: nieznany rodzaj potwierdzonej redukcji.`);
    }
    assertFiniteNonNegative(reduction.amountGross, `${candidateId}: kwota finansowania`);
    if (!Number.isInteger(reduction.year) || reduction.year < 1 || reduction.year > horizonYears) {
      throw new RangeError(`${candidateId}: rok wpływu finansowania musi mieścić się w zakresie 1-${horizonYears}.`);
    }
    if (reduction.timing !== 'start-of-year' && reduction.timing !== 'end-of-year') {
      throw new TypeError(`${candidateId}: moment wpływu finansowania musi być jawny.`);
    }
    const issues = provenanceIssues(reduction.provenance, `${candidateId}: redukcja ${reduction.id}`);
    if (issues.length > 0) throw new TypeError(issues.join(' '));
  }
}

function assessCandidate(
  input: OfferEconomicsCandidateInput,
  horizonYears: number,
): OfferEconomicsCandidateAssessment {
  const candidate = input.candidate;
  const reasons = new Set<string>();
  assertFiniteNonNegative(input.investmentGross, `${candidate.id}: nakład`);
  assertFiniteCashflows(input.annualNetOperatingCashflowsGross, horizonYears, `${candidate.id}: przepływy kandydata`);
  validateReductionInputs(input.confirmedFinancingReductions, horizonYears, candidate.id);

  for (const reason of provenanceIssues(input.investmentProvenance, `${candidate.id}: koszt inwestycji`)) reasons.add(reason);
  for (const reason of provenanceIssues(input.cashflowProvenance, `${candidate.id}: przepływy`)) reasons.add(reason);
  for (const key of verificationKeys) {
    const status = input.verification[key];
    if (!['verified', 'unverified', 'failed'].includes(status)) {
      throw new TypeError(`${candidate.id}: status weryfikacji „${key}” jest niepoprawny.`);
    }
    for (const reason of provenanceIssues(input.verificationEvidence[key], `${candidate.id}: weryfikacja ${key}`)) reasons.add(reason);
    if (status !== 'verified') {
      const details = input.verificationReasons[key];
      if (!Array.isArray(details) || details.length === 0) reasons.add(`Warunek ${key} nie ma statusu zweryfikowanego.`);
      else details.forEach((detail) => reasons.add(detail));
    }
  }

  const snapshot = candidate;
  if (!snapshot.id.trim()) reasons.add('Kandydat nie ma stabilnego identyfikatora.');
  if (snapshot.templateIds.length === 0 || snapshot.templateIds.length !== snapshot.templateVersions.length
    || new Set(snapshot.templateIds).size !== snapshot.templateIds.length
    || snapshot.templateIds.some((id) => !id.trim())
    || snapshot.templateVersions.some((version) => !Number.isInteger(version) || version <= 0)) {
    reasons.add('Snapshot kandydata nie ma kompletu ID i wersji rzeczywistych szablonów.');
  }
  if (snapshot.items.length === 0 || snapshot.totals === null || snapshot.totals.lines.length !== snapshot.items.length) {
    reasons.add('Kandydat nie ma kompletnego, wycenionego BOM.');
  }
  if (snapshot.totals && snapshot.totals.saleGross !== input.investmentGross) {
    reasons.add('Jawny nakład nie zgadza się z sumą sprzedaży snapshotu konfiguracji.');
  }
  if (snapshot.requiresReview) {
    if (snapshot.reviewReasons.length === 0) reasons.add('Snapshot kandydata wymaga przeglądu.');
    else snapshot.reviewReasons.forEach((reason) => reasons.add(reason));
  }
  if (snapshot.missingPrices.length > 0) {
    snapshot.missingPrices.forEach((missing) => reasons.add(`Brak wymaganej ceny: ${missing}`));
  }
  if (snapshot.pvGeometryReviewRequired) reasons.add('Geometria PV wymaga przeglądu.');
  if (!Number.isFinite(snapshot.batteryCapacityKwh) || snapshot.batteryCapacityKwh <= 0) {
    reasons.add('Kandydat nie pochodzi z dodatniego, dyskretnego wariantu magazynu.');
  }
  if (!Number.isFinite(snapshot.batteryPowerKw) || snapshot.batteryPowerKw <= 0
    || !Number.isFinite(snapshot.totalPvKw) || snapshot.totalPvKw <= 0) {
    reasons.add('Kandydat nie ma dodatniej mocy magazynu i PV z szablonów.');
  }
  for (const item of snapshot.items) {
    if (!snapshot.templateIds.includes(item.templateId)
      || snapshot.templateVersions[snapshot.templateIds.indexOf(item.templateId)] !== item.templateVersion
      || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      reasons.add('Pozycja BOM nie odpowiada wersji szablonu albo ma niepoprawną ilość.');
    }
    const explicitlyNonPriced = explicitlyNonPricedSupplyModes.has(item.supplyMode);
    const zeroNonPricedLine = item.calculation !== null && isZeroCalculationLine(item.calculation);
    if (item.calculation === null || item.missingPriceReason !== null
      || (item.resolvedCosts === null && (!explicitlyNonPriced || !zeroNonPricedLine))
      || (explicitlyNonPriced && (item.resolvedCosts !== null || !zeroNonPricedLine))) {
      reasons.add('Pozycja BOM wymaga pełnej wyceny albo jawnego niekosztowego trybu dostawy z zerową kalkulacją.');
    }
  }

  return {
    id: snapshot.id,
    templateIds: [...snapshot.templateIds],
    templateVersions: [...snapshot.templateVersions],
    eligibilityStatus: reasons.size === 0 ? 'eligible' : 'not-eligible',
    exclusionReasons: Array.from(reasons),
    comparisons: null,
  };
}

function compareToBaseline(
  candidate: OfferEconomicsCandidateInput,
  baselineId: OfferEconomicsBaselineId,
  baselineUpfrontCostGross: number,
  baselineCashflows: number[],
  annualDiscountRate: number,
): OfferEconomicsComparison {
  const upfrontInvestmentDeltaGross = candidate.investmentGross - baselineUpfrontCostGross;
  const annualIncrementalCashflowsGross = candidate.annualNetOperatingCashflowsGross
    .map((cashflow, index) => cashflow - baselineCashflows[index]);
  const reductions = candidate.confirmedFinancingReductions;
  const confirmedFinancingReductionsGross = reductions.reduce((sum, item) => sum + item.amountGross, 0);
  const longTermNetBenefitGross = -upfrontInvestmentDeltaGross
    + annualIncrementalCashflowsGross.reduce((sum, value) => sum + value, 0)
    + confirmedFinancingReductionsGross;

  let netPresentValueGross = -upfrontInvestmentDeltaGross;
  for (let year = 1; year <= annualIncrementalCashflowsGross.length; year += 1) {
    netPresentValueGross += presentValueOfUniformAnnualCashflow(
      annualIncrementalCashflowsGross[year - 1],
      year,
      annualDiscountRate,
    );
  }
  netPresentValueGross += sumReceiptsAtTime(reductions, 0, annualDiscountRate);
  for (let year = 1; year <= annualIncrementalCashflowsGross.length; year += 1) {
    netPresentValueGross += sumReceiptsAtTime(reductions, year, annualDiscountRate);
  }

  let cumulative = -upfrontInvestmentDeltaGross + sumReceiptsAtTime(reductions, 0);
  let paybackYearsPrecise: number | null = cumulative >= 0 ? 0 : null;
  for (let year = 1; paybackYearsPrecise === null && year <= annualIncrementalCashflowsGross.length; year += 1) {
    const annualCashflow = annualIncrementalCashflowsGross[year - 1];
    if (annualCashflow > 0 && cumulative < 0 && cumulative + annualCashflow >= 0) {
      paybackYearsPrecise = year - 1 + (-cumulative / annualCashflow);
      break;
    }
    cumulative += annualCashflow;
    const beforeReceipt = cumulative;
    cumulative += sumReceiptsAtTime(reductions, year);
    if (beforeReceipt < 0 && cumulative >= 0) paybackYearsPrecise = year;
  }

  return {
    baselineId,
    upfrontInvestmentDeltaGross,
    annualIncrementalCashflowsGross,
    confirmedFinancingReductionsGross,
    longTermNetBenefitGross,
    netPresentValueGross,
    paybackYearsPrecise,
    paybackYearsDisplayFloor: paybackYearsPrecise === null ? null : Math.floor(paybackYearsPrecise),
    netCostAfterConfirmedFinancingGross: candidate.investmentGross - confirmedFinancingReductionsGross,
  };
}

function rankCandidates(
  assessments: OfferEconomicsCandidateAssessment[],
  baselineId: OfferEconomicsBaselineId,
): RankedOfferEconomicsCandidate[] {
  return assessments
    .filter((assessment) => assessment.eligibilityStatus === 'eligible' && assessment.comparisons !== null)
    .map((assessment) => {
      const comparison = assessment.comparisons![baselineId];
      return {
        id: assessment.id,
        rank: 0,
        paybackYearsPrecise: comparison.paybackYearsPrecise,
        paybackYearsDisplayFloor: comparison.paybackYearsDisplayFloor,
        longTermNetBenefitGross: comparison.longTermNetBenefitGross,
        netPresentValueGross: comparison.netPresentValueGross,
        netCostAfterConfirmedFinancingGross: comparison.netCostAfterConfirmedFinancingGross,
      };
    })
    .sort((left, right) => {
      if (left.paybackYearsPrecise === null && right.paybackYearsPrecise !== null) return 1;
      if (left.paybackYearsPrecise !== null && right.paybackYearsPrecise === null) return -1;
      if (left.paybackYearsPrecise !== null && right.paybackYearsPrecise !== null
        && left.paybackYearsPrecise !== right.paybackYearsPrecise) {
        return left.paybackYearsPrecise - right.paybackYearsPrecise;
      }
      if (left.netPresentValueGross !== right.netPresentValueGross) {
        return right.netPresentValueGross - left.netPresentValueGross;
      }
      if (left.longTermNetBenefitGross !== right.longTermNetBenefitGross) {
        return right.longTermNetBenefitGross - left.longTermNetBenefitGross;
      }
      if (left.netCostAfterConfirmedFinancingGross !== right.netCostAfterConfirmedFinancingGross) {
        return left.netCostAfterConfirmedFinancingGross - right.netCostAfterConfirmedFinancingGross;
      }
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    })
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

export function calculateOfferEconomics(input: OfferEconomicsInput): OfferEconomicsResult {
  if (!Number.isInteger(input.horizonYears) || input.horizonYears <= 0) {
    throw new RangeError('Horyzont analizy musi być dodatnią liczbą całych lat.');
  }
  assertFiniteNonNegative(input.annualDiscountRate, 'Stopa dyskontowa');
  if (input.annualCashflowTiming !== 'uniform-through-year') {
    throw new TypeError('Rozkład rocznych przepływów musi być jawny.');
  }
  if (input.rankingBaselineId !== 'ZERO_INVESTMENT' && input.rankingBaselineId !== 'TARIFF_ONLY') {
    throw new TypeError('Baseline rankingu musi być jawnie wybrany.');
  }
  assertFiniteNonNegative(input.tariffOnlyBaseline.upfrontCostGross, 'Nakład baseline taryfowego');
  assertFiniteCashflows(
    input.tariffOnlyBaseline.annualNetOperatingCashflowsGross,
    input.horizonYears,
    'Przepływy baseline taryfowego',
  );
  const baselineProvenanceProblems = provenanceIssues(input.tariffOnlyBaseline.provenance, 'Baseline taryfowy');
  if (baselineProvenanceProblems.length > 0) throw new TypeError(baselineProvenanceProblems.join(' '));

  const baselines: Record<OfferEconomicsBaselineId, OfferEconomicsBaselineSnapshot> = {
    ZERO_INVESTMENT: {
      id: 'ZERO_INVESTMENT',
      upfrontCostGross: 0,
      annualNetOperatingCashflowsGross: Array(input.horizonYears).fill(0),
      provenance: null,
    },
    TARIFF_ONLY: {
      id: 'TARIFF_ONLY',
      upfrontCostGross: input.tariffOnlyBaseline.upfrontCostGross,
      annualNetOperatingCashflowsGross: [...input.tariffOnlyBaseline.annualNetOperatingCashflowsGross],
      provenance: { ...input.tariffOnlyBaseline.provenance },
    },
  };

  const candidateAssessments = input.candidates.map((candidate) => assessCandidate(candidate, input.horizonYears));
  const duplicateIds = new Set<string>();
  for (const assessment of candidateAssessments) {
    if (duplicateIds.has(assessment.id)) throw new TypeError(`Powtórzony identyfikator kandydata: ${assessment.id}`);
    duplicateIds.add(assessment.id);
  }

  for (let index = 0; index < input.candidates.length; index += 1) {
    const candidate = input.candidates[index];
    const assessment = candidateAssessments[index];
    if (assessment.eligibilityStatus !== 'eligible') continue;
    assessment.comparisons = {
      ZERO_INVESTMENT: compareToBaseline(
        candidate,
        'ZERO_INVESTMENT',
        baselines.ZERO_INVESTMENT.upfrontCostGross,
        baselines.ZERO_INVESTMENT.annualNetOperatingCashflowsGross,
        input.annualDiscountRate,
      ),
      TARIFF_ONLY: compareToBaseline(
        candidate,
        'TARIFF_ONLY',
        baselines.TARIFF_ONLY.upfrontCostGross,
        baselines.TARIFF_ONLY.annualNetOperatingCashflowsGross,
        input.annualDiscountRate,
      ),
    };
  }

  const rankedCandidates = rankCandidates(candidateAssessments, input.rankingBaselineId);
  const firstPaybackCandidate = rankedCandidates.find((candidate) => candidate.paybackYearsPrecise !== null);
  return {
    horizonYears: input.horizonYears,
    annualDiscountRate: input.annualDiscountRate,
    rankingBaselineId: input.rankingBaselineId,
    baselines,
    candidateAssessments,
    rankedCandidates,
    recommendedCandidateId: firstPaybackCandidate?.id ?? null,
    recommendationReason: firstPaybackCandidate
      ? `Najszybszy niezaokrąglony zwrot względem baseline ${input.rankingBaselineId}.`
      : 'Brak zweryfikowanego kandydata z odzyskaniem nakładu w zadanym horyzoncie.',
  };
}
