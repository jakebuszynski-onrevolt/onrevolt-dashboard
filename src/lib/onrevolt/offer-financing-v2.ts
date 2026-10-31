export const OFFER_FINANCING_RULE_VERSION = '2026_10_PME2';

export const OFFER_FINANCING_SOURCES = {
  pme2: 'https://przydomowemagazyny.gov.pl/wp-content/uploads/2026/10/Program_-PME_FM.pdf',
  thermomodernizationRelief: 'https://podatki.gov.pl/ulgi-i-odliczenia/ulga-termomodernizacyjna-pit-kto-i-ile-moze-odliczyc',
} as const;

export const PME2_RULES = {
  applicationFrom: '2026-10-20',
  applicationUntil: '2027-10-01',
  costFrom: '2025-11-01',
  costUntil: '2029-12-31',
  minimumBatteryCapacityKwh: 10,
  minimumBatteryToPvRatio: 2,
  maximumStorageCostPerKwhGross: 3000,
  grantRate: 0.3,
  grantPerKwhGross: 800,
  maximumNetBillingGrantGross: 16000,
  maximumNetMeteringGrantGross: 8000,
} as const;

export const THERMOMODERNIZATION_DEDUCTION_LIMIT_GROSS = 53000;

export type EligibilityStatus = 'unknown' | 'confirmed' | 'ineligible';
export type EvidenceStatus = 'unknown' | 'yes' | 'no';
export type BillingModel = 'net-billing' | 'net-metering';
export type BudgetAvailabilityStatus = 'unknown' | 'available' | 'unavailable';

export interface BudgetAvailabilityEvidence {
  status: BudgetAvailabilityStatus;
  checkedOn: string | null;
  evidenceReference: string | null;
}

export interface Pme2EligibilityReview {
  status: EligibilityStatus;
  reasons: string[];
}

export interface Pme2EligibilityEvidence {
  individualApplicant: EvidenceStatus;
  residentialBuilding: EvidenceStatus;
  gridConnectedProsumer: EvidenceStatus;
  energyContractNotForBusiness: EvidenceStatus;
  newCertifiedBattery: EvidenceStatus;
  backupCapabilityDocumented: EvidenceStatus;
  compliantEmsDocumented: EvidenceStatus;
  noOtherSubsidyForSameScope: EvidenceStatus;
  within50KwMicroinstallationLimit: EvidenceStatus;
  allOtherProgramConditionsReviewed: EvidenceStatus;
}

export interface Pme2OfferInput {
  applicationDate: string;
  projectCostDates: string[];
  installationDate: string | null;
  osdConfirmationDate: string | null;
  batteryCapacityKwh: number;
  pvPowerKwp: number;
  storageCostExcludingEmsAndInverterGross: number;
  billingModel: BillingModel;
  requestEuManufacturingBonus: boolean;
  budgetAvailabilityEvidence: BudgetAvailabilityEvidence;
  eligibilityReview: Pme2EligibilityReview;
  evidence: Pme2EligibilityEvidence;
}

export interface Pme2OfferResult {
  ruleVersion: typeof OFFER_FINANCING_RULE_VERSION;
  eligibilityStatus: EligibilityStatus;
  eligibilityReasons: string[];
  formulaMaximumGross: number;
  potentialGross: number;
  budgetAvailabilityStatus: BudgetAvailabilityStatus;
  budgetAvailabilityEvidence: BudgetAvailabilityEvidence;
  budgetConditionedPotentialGross: number | null;
  confirmedEligibleGross: number | null;
  awardGuaranteed: false;
  euBonusStatus: 'not-requested' | 'requires-confirmation';
  thermalStorageIncluded: false;
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} musi być skończoną liczbą nieujemną.`);
  }
}

function assertIsoDate(value: string, name: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${name} musi mieć format RRRR-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${name} nie jest poprawną datą.`);
  }
}

export function calculatePme2Offer(input: Pme2OfferInput): Pme2OfferResult {
  if (input.billingModel !== 'net-billing' && input.billingModel !== 'net-metering') {
    throw new TypeError('Model rozliczeń musi być jawnie wskazany jako net-billing albo net-metering.');
  }
  if (typeof input.requestEuManufacturingBonus !== 'boolean') {
    throw new TypeError('Informacja o wnioskowaniu o premię UE musi być jawna.');
  }
  const budgetEvidence = input.budgetAvailabilityEvidence;
  if (!['unknown', 'available', 'unavailable'].includes(budgetEvidence.status)) {
    throw new TypeError('Dostępność budżetu musi mieć jawny status.');
  }
  if (budgetEvidence.status === 'unknown') {
    if (budgetEvidence.checkedOn !== null || budgetEvidence.evidenceReference !== null) {
      throw new TypeError('Nieznana dostępność budżetu nie może zawierać pozornego potwierdzenia.');
    }
  } else {
    if (budgetEvidence.checkedOn === null || !budgetEvidence.evidenceReference?.trim()) {
      throw new TypeError('Potwierdzony status budżetu wymaga daty sprawdzenia i źródła dowodu.');
    }
    assertIsoDate(budgetEvidence.checkedOn, 'Data sprawdzenia budżetu');
  }
  if (!['unknown', 'confirmed', 'ineligible'].includes(input.eligibilityReview.status)
    || !Array.isArray(input.eligibilityReview.reasons)
    || input.eligibilityReview.reasons.some((reason) => typeof reason !== 'string')) {
    throw new TypeError('Przegląd kwalifikowalności musi zawierać jawny status i listę powodów.');
  }
  assertIsoDate(input.applicationDate, 'Data złożenia wniosku');
  assertFiniteNonNegative(input.batteryCapacityKwh, 'Pojemność magazynu');
  assertFiniteNonNegative(input.pvPowerKwp, 'Moc PV');
  assertFiniteNonNegative(input.storageCostExcludingEmsAndInverterGross, 'Koszt magazynu');

  const reasons = [...input.eligibilityReview.reasons];
  const disqualifiers: string[] = [];
  const unknowns: string[] = [];

  if (input.applicationDate < PME2_RULES.applicationFrom || input.applicationDate > PME2_RULES.applicationUntil) {
    disqualifiers.push('Data wniosku jest poza okresem naboru PME2.');
  }
  if (input.projectCostDates.length === 0) {
    unknowns.push('Brak dat kosztów przedsięwzięcia do sprawdzenia.');
  }
  for (const date of input.projectCostDates) {
    assertIsoDate(date, 'Data kosztu przedsięwzięcia');
    if (date < PME2_RULES.costFrom || date > PME2_RULES.costUntil) {
      disqualifiers.push(`Koszt z dnia ${date} jest poza okresem kwalifikowalności.`);
    }
  }
  for (const [label, date] of [
    ['montażu', input.installationDate],
    ['potwierdzenia OSD', input.osdConfirmationDate],
  ] as const) {
    if (date === null) {
      unknowns.push(`Brak daty ${label} do sprawdzenia.`);
      continue;
    }
    assertIsoDate(date, `Data ${label}`);
    if (date < PME2_RULES.costFrom || date > PME2_RULES.costUntil) {
      disqualifiers.push(`Data ${label} (${date}) jest poza okresem kwalifikowalności.`);
    }
  }
  if (input.batteryCapacityKwh < PME2_RULES.minimumBatteryCapacityKwh) {
    disqualifiers.push('Pojemność magazynu jest mniejsza niż 10 kWh.');
  }
  if (input.pvPowerKwp <= 0 || input.batteryCapacityKwh < PME2_RULES.minimumBatteryToPvRatio * input.pvPowerKwp) {
    disqualifiers.push('Pojemność magazynu musi wynosić co najmniej dwukrotność mocy PV w kWp.');
  }
  if (input.batteryCapacityKwh > 0
    && input.storageCostExcludingEmsAndInverterGross / input.batteryCapacityKwh > PME2_RULES.maximumStorageCostPerKwhGross) {
    disqualifiers.push('Koszt magazynu bez EMS i falownika przekracza 3000 zł/kWh.');
  }

  const evidenceLabels: Record<keyof Pme2EligibilityEvidence, string> = {
    individualApplicant: 'status osoby fizycznej składającej wniosek',
    residentialBuilding: 'budynek mieszkalny',
    gridConnectedProsumer: 'prosument z mikroinstalacją przyłączoną do sieci',
    energyContractNotForBusiness: 'umowa energetyczna niezawarta dla działalności gospodarczej',
    newCertifiedBattery: 'nowy, certyfikowany magazyn energii',
    backupCapabilityDocumented: 'udokumentowana możliwość zasilania awaryjnego',
    compliantEmsDocumented: 'udokumentowany EMS spełniający wymagania programu',
    noOtherSubsidyForSameScope: 'brak innej dotacji na ten sam zakres',
    within50KwMicroinstallationLimit: 'spełnienie limitu 50 kW dla mikroinstalacji, potwierdzone odrębnym dowodem',
    allOtherProgramConditionsReviewed: 'przegląd pozostałych warunków programu',
  };
  for (const key of Object.keys(evidenceLabels) as (keyof Pme2EligibilityEvidence)[]) {
    const status = input.evidence[key];
    if (!['unknown', 'yes', 'no'].includes(status)) {
      throw new TypeError(`Dowód warunku „${evidenceLabels[key]}” musi mieć jawny status.`);
    }
    if (status === 'no') {
      disqualifiers.push(`Niepotwierdzony warunek programu: ${evidenceLabels[key]}.`);
    } else if (status === 'unknown') {
      unknowns.push(`Do weryfikacji: ${evidenceLabels[key]}.`);
    }
  }

  let eligibilityStatus: EligibilityStatus;
  if (disqualifiers.length > 0 || input.eligibilityReview.status === 'ineligible') {
    eligibilityStatus = 'ineligible';
  } else if (input.eligibilityReview.status === 'unknown' || unknowns.length > 0) {
    eligibilityStatus = 'unknown';
  } else {
    eligibilityStatus = 'confirmed';
  }

  if (input.eligibilityReview.status === 'ineligible' && reasons.length === 0) {
    reasons.push('Kwalifikowalność oznaczono jako niepotwierdzoną pozytywnie podczas przeglądu.');
  }
  reasons.push(...disqualifiers, ...unknowns);
  if (eligibilityStatus === 'unknown' && reasons.length === 0) {
    reasons.push('Kwalifikowalność wymaga potwierdzenia na podstawie dokumentów i regulaminu naboru.');
  }

  const billingCap = input.billingModel === 'net-billing'
    ? PME2_RULES.maximumNetBillingGrantGross
    : PME2_RULES.maximumNetMeteringGrantGross;
  const formulaMaximumGross = Math.min(
    input.storageCostExcludingEmsAndInverterGross * PME2_RULES.grantRate,
    input.batteryCapacityKwh * PME2_RULES.grantPerKwhGross,
    billingCap,
  );
  const potentialGross = eligibilityStatus === 'ineligible' ? 0 : formulaMaximumGross;

  return {
    ruleVersion: OFFER_FINANCING_RULE_VERSION,
    eligibilityStatus,
    eligibilityReasons: reasons,
    formulaMaximumGross,
    potentialGross,
    budgetAvailabilityStatus: budgetEvidence.status,
    budgetAvailabilityEvidence: { ...budgetEvidence },
    budgetConditionedPotentialGross: budgetEvidence.status === 'unknown'
      ? null
      : budgetEvidence.status === 'available'
        ? potentialGross
        : 0,
    confirmedEligibleGross: eligibilityStatus === 'confirmed' ? formulaMaximumGross : null,
    awardGuaranteed: false,
    euBonusStatus: input.requestEuManufacturingBonus ? 'requires-confirmation' : 'not-requested',
    thermalStorageIncluded: false,
  };
}

export interface TaxBand {
  upperBoundGross: number | null;
  marginalRate: number;
}

export type TaxRegime = 'progressive' | 'flat' | 'lump-sum';

export interface ThermomodernizationReliefInput {
  ownerOrCoOwnerOfExistingSingleFamilyHome: EvidenceStatus;
  eligibleExpenditureConfirmed: EvidenceStatus;
  eligibleInvoiceCostsGross: number;
  deductibleVatGross: number;
  grantReimbursementGross: number;
  otherReimbursementsGross: number;
  previouslyUsedDeductionGross: number;
  taxableBaseBeforeDeductionGross: number;
  taxRegime: TaxRegime;
  taxBands: TaxBand[];
  firstExpenseDate: string;
  completionDate: string | null;
  asOfDate: string;
}

export interface ThermomodernizationReliefResult {
  eligibilityStatus: EligibilityStatus;
  eligibilityReasons: string[];
  completionDeadline: string;
  eligibleCostAfterVatAndReimbursementsGross: number;
  theoreticalDeductionGross: number;
  theoreticalDeductionThisYearGross: number;
  conditionalDeductionThisYearGross: number;
  confirmedDeductionThisYearGross: number | null;
  taxBeforeDeductionGross: number;
  theoreticalTaxAfterDeductionGross: number;
  taxAfterDeductionGross: number;
  theoreticalTaxSavingGross: number;
  conditionalTaxSavingGross: number;
  confirmedTaxSavingGross: number | null;
  theoreticalUnusedDeductionGross: number;
  unusedPotentialCarryForwardGross: number;
  carryForwardCountedAsGuaranteedBenefit: false;
}

function validateTaxBands(regime: TaxRegime, bands: TaxBand[]): void {
  if (bands.length === 0) throw new RangeError('Należy podać jawne progi i stawki podatkowe.');
  let previousUpperBound = 0;
  let hasUnlimitedBand = false;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    assertFiniteNonNegative(band.marginalRate, 'Stawka podatkowa');
    if (band.marginalRate > 1) throw new RangeError('Stawka podatkowa nie może przekraczać 100%.');
    if (band.upperBoundGross === null) {
      if (index !== bands.length - 1) throw new RangeError('Próg bez górnego limitu musi być ostatni.');
      hasUnlimitedBand = true;
    } else {
      assertFiniteNonNegative(band.upperBoundGross, 'Górny próg podatkowy');
      if (band.upperBoundGross <= previousUpperBound) throw new RangeError('Progi podatkowe muszą rosnąć.');
      previousUpperBound = band.upperBoundGross;
    }
  }
  if (!hasUnlimitedBand) throw new RangeError('Ostatni próg podatkowy musi obejmować pozostałą podstawę.');
  if (regime !== 'progressive' && bands.length !== 1) {
    throw new RangeError('Podatek liniowy i ryczałt wymagają jednej jawnej stawki dla podanej podstawy.');
  }
}

function taxForBase(base: number, bands: TaxBand[]): number {
  let tax = 0;
  let lowerBound = 0;
  for (const band of bands) {
    const upperBound = band.upperBoundGross ?? base;
    const taxableInBand = Math.max(0, Math.min(base, upperBound) - lowerBound);
    tax += taxableInBand * band.marginalRate;
    if (base <= upperBound) break;
    lowerBound = upperBound;
  }
  return tax;
}

function dateAfterYearsAtYearEnd(date: string, years: number): string {
  const year = Number(date.slice(0, 4)) + years;
  return `${String(year).padStart(4, '0')}-12-31`;
}

export function calculateThermomodernizationRelief(
  input: ThermomodernizationReliefInput,
): ThermomodernizationReliefResult {
  if (!['progressive', 'flat', 'lump-sum'].includes(input.taxRegime)) {
    throw new TypeError('Forma opodatkowania musi być jawnie wskazana.');
  }
  if (!['unknown', 'yes', 'no'].includes(input.ownerOrCoOwnerOfExistingSingleFamilyHome)
    || !['unknown', 'yes', 'no'].includes(input.eligibleExpenditureConfirmed)) {
    throw new TypeError('Status własności i kwalifikowalności wydatku musi być jawny.');
  }
  for (const [name, value] of [
    ['Koszty z faktur', input.eligibleInvoiceCostsGross],
    ['Odliczony VAT', input.deductibleVatGross],
    ['Otrzymana dotacja', input.grantReimbursementGross],
    ['Inne zwroty kosztów', input.otherReimbursementsGross],
    ['Wykorzystany wcześniej limit', input.previouslyUsedDeductionGross],
    ['Podstawa opodatkowania przed ulgą', input.taxableBaseBeforeDeductionGross],
  ] as const) assertFiniteNonNegative(value, name);

  assertIsoDate(input.firstExpenseDate, 'Data pierwszego wydatku');
  assertIsoDate(input.asOfDate, 'Data wyceny');
  if (input.completionDate !== null) {
    assertIsoDate(input.completionDate, 'Data zakończenia przedsięwzięcia');
    if (input.completionDate < input.firstExpenseDate || input.completionDate > input.asOfDate) {
      throw new RangeError('Data zakończenia musi przypadać między pierwszym wydatkiem a datą wyceny.');
    }
  }
  if (input.deductibleVatGross > input.eligibleInvoiceCostsGross) {
    throw new RangeError('Odliczony VAT nie może przekraczać kosztów z faktur.');
  }
  if (input.previouslyUsedDeductionGross > THERMOMODERNIZATION_DEDUCTION_LIMIT_GROSS) {
    throw new RangeError('Wykorzystany limit ulgi przekracza 53 000 zł na osobę.');
  }
  const reimbursementTotal = input.grantReimbursementGross + input.otherReimbursementsGross;
  if (input.deductibleVatGross + reimbursementTotal > input.eligibleInvoiceCostsGross) {
    throw new RangeError('VAT i zwroty kosztów łącznie nie mogą przekroczyć kosztu z faktur.');
  }
  validateTaxBands(input.taxRegime, input.taxBands);

  const completionDeadline = dateAfterYearsAtYearEnd(input.firstExpenseDate, 3);
  const reasons: string[] = [];
  const failures: string[] = [];
  const unknowns: string[] = [];
  if (input.ownerOrCoOwnerOfExistingSingleFamilyHome === 'no') {
    failures.push('Wnioskodawca nie jest właścicielem ani współwłaścicielem istniejącego domu jednorodzinnego.');
  } else if (input.ownerOrCoOwnerOfExistingSingleFamilyHome === 'unknown') {
    unknowns.push('Niepotwierdzone prawo własności lub współwłasności domu jednorodzinnego.');
  }
  if (input.eligibleExpenditureConfirmed === 'no') {
    failures.push('Rodzaj wydatku nie został potwierdzony jako kwalifikowany do ulgi.');
  } else if (input.eligibleExpenditureConfirmed === 'unknown') {
    unknowns.push('Rodzaj wydatku wymaga potwierdzenia w wykazie kosztów kwalifikowanych.');
  }
  if (input.completionDate !== null && input.completionDate > completionDeadline) {
    failures.push('Przedsięwzięcie zakończono po terminie trzech lat.');
  } else if (input.completionDate === null && input.asOfDate > completionDeadline) {
    failures.push('Nie zakończono przedsięwzięcia w terminie trzech lat.');
  } else if (input.completionDate === null) {
    unknowns.push('Termin zakończenia jeszcze nie upłynął; zachowanie ulgi zależy od terminowego ukończenia.');
  }

  const eligibilityStatus: EligibilityStatus = failures.length > 0
    ? 'ineligible'
    : unknowns.length > 0
      ? 'unknown'
      : 'confirmed';
  reasons.push(...failures, ...unknowns);

  const eligibleCostAfterVatAndReimbursementsGross = input.eligibleInvoiceCostsGross
    - input.deductibleVatGross
    - reimbursementTotal;
  const remainingDeductionLimit = THERMOMODERNIZATION_DEDUCTION_LIMIT_GROSS - input.previouslyUsedDeductionGross;
  const theoreticalDeductionGross = Math.min(eligibleCostAfterVatAndReimbursementsGross, remainingDeductionLimit);
  const theoreticalDeductionThisYearGross = Math.min(theoreticalDeductionGross, input.taxableBaseBeforeDeductionGross);
  const conditionalDeductionThisYearGross = eligibilityStatus === 'ineligible'
    ? 0
    : theoreticalDeductionThisYearGross;
  const theoreticalTaxableBaseAfterDeduction = input.taxableBaseBeforeDeductionGross - theoreticalDeductionThisYearGross;
  const applicableTaxableBase = input.taxableBaseBeforeDeductionGross - conditionalDeductionThisYearGross;
  const taxBeforeDeductionGross = taxForBase(input.taxableBaseBeforeDeductionGross, input.taxBands);
  const theoreticalTaxAfterDeductionGross = taxForBase(theoreticalTaxableBaseAfterDeduction, input.taxBands);
  const taxAfterDeductionGross = taxForBase(applicableTaxableBase, input.taxBands);
  const theoreticalTaxSavingGross = taxBeforeDeductionGross - theoreticalTaxAfterDeductionGross;
  const conditionalTaxSavingGross = taxBeforeDeductionGross - taxAfterDeductionGross;
  const theoreticalUnusedDeductionGross = theoreticalDeductionGross - theoreticalDeductionThisYearGross;

  return {
    eligibilityStatus,
    eligibilityReasons: reasons,
    completionDeadline,
    eligibleCostAfterVatAndReimbursementsGross,
    theoreticalDeductionGross,
    theoreticalDeductionThisYearGross,
    conditionalDeductionThisYearGross,
    confirmedDeductionThisYearGross: eligibilityStatus === 'confirmed' ? conditionalDeductionThisYearGross : null,
    taxBeforeDeductionGross,
    theoreticalTaxAfterDeductionGross,
    taxAfterDeductionGross,
    theoreticalTaxSavingGross,
    conditionalTaxSavingGross,
    confirmedTaxSavingGross: eligibilityStatus === 'confirmed' ? conditionalTaxSavingGross : null,
    theoreticalUnusedDeductionGross,
    unusedPotentialCarryForwardGross: eligibilityStatus === 'ineligible' ? 0 : theoreticalUnusedDeductionGross,
    carryForwardCountedAsGuaranteedBenefit: false,
  };
}

export interface TimedAmount {
  year: number;
  timing: 'start-of-year' | 'end-of-year';
  amountGross: number;
}

export interface OfferProjectionInput {
  investmentGross: number;
  annualSavingsGross: number[];
  subsidyReceipts: TimedAmount[];
  taxSavingReceipts: TimedAmount[];
  annualSavingsTiming: 'uniform-through-year';
  annualDiscountRate: number;
}

export interface OfferProjectionYear {
  year: number;
  savingsGross: number;
  subsidyGross: number;
  taxSavingGross: number;
  investmentGross: number;
  netCashFlowGross: number;
  discountedCashFlowGross: number;
  cumulativeCashFlowGross: number;
  discountedCumulativeCashFlowGross: number;
}

export interface OfferProjectionResult {
  investmentGross: number;
  totalSubsidyGross: number;
  totalTaxSavingsGross: number;
  netCostGross: number;
  netPresentValueGross: number;
  paybackYears: number | null;
  discountedPaybackYears: number | null;
  paybackAchieved: boolean;
  discountedPaybackAchieved: boolean;
  years: OfferProjectionYear[];
}

function validateTimedAmounts(amounts: TimedAmount[], horizon: number, name: string): void {
  for (const item of amounts) {
    if (!Number.isInteger(item.year) || item.year < 0 || item.year > horizon) {
      throw new RangeError(`${name}: rok przepływu musi mieścić się w zakresie 0-${horizon}.`);
    }
    if (item.timing !== 'start-of-year' && item.timing !== 'end-of-year') {
      throw new TypeError(`${name}: moment wpływu musi być jawny.`);
    }
    assertFiniteNonNegative(item.amountGross, `${name}: kwota`);
  }
}

function receiptTime(item: TimedAmount): number {
  if (item.year === 0) return 0;
  return item.timing === 'start-of-year' ? item.year - 1 : item.year;
}

function sumAtTime(amounts: TimedAmount[], time: number, discountRate?: number): number {
  return amounts.reduce((sum, item) => {
    if (receiptTime(item) !== time) return sum;
    return sum + (discountRate === undefined
      ? item.amountGross
      : item.amountGross / ((1 + discountRate) ** time));
  }, 0);
}

function discountedUniformAnnualSavings(amount: number, year: number, annualRate: number): number {
  if (annualRate === 0) return amount;
  const logGrowth = Math.log1p(annualRate);
  const startDiscount = Math.exp(-logGrowth * (year - 1));
  const endDiscount = Math.exp(-logGrowth * year);
  return amount * (startDiscount - endDiscount) / logGrowth;
}

function findInterpolatedPayback(input: OfferProjectionInput, discounted: boolean): number | null {
  const receiptTotalAt = (time: number) => {
    if (!discounted) {
      return sumAtTime(input.subsidyReceipts, time) + sumAtTime(input.taxSavingReceipts, time);
    }
    return sumAtTime(input.subsidyReceipts, time, input.annualDiscountRate)
      + sumAtTime(input.taxSavingReceipts, time, input.annualDiscountRate);
  };

  let cumulative = -input.investmentGross + receiptTotalAt(0);
  if (cumulative >= 0) return 0;
  for (let year = 1; year <= input.annualSavingsGross.length; year += 1) {
    const annualSavings = discounted
      ? discountedUniformAnnualSavings(input.annualSavingsGross[year - 1], year, input.annualDiscountRate)
      : input.annualSavingsGross[year - 1];
    if (cumulative < 0 && annualSavings > 0 && cumulative + annualSavings >= 0) {
      return year - 1 + (-cumulative / annualSavings);
    }
    cumulative += annualSavings;

    const beforeReceipt = cumulative;
    cumulative += receiptTotalAt(year);
    if (beforeReceipt < 0 && cumulative >= 0) return year;
  }
  return null;
}

export function calculateOfferProjection(input: OfferProjectionInput): OfferProjectionResult {
  assertFiniteNonNegative(input.investmentGross, 'Nakład inwestycyjny');
  assertFiniteNonNegative(input.annualDiscountRate, 'Roczna stopa dyskontowa');
  if (input.annualSavingsTiming !== 'uniform-through-year') {
    throw new TypeError('Moment oszczędności rocznych musi być jawnie określony jako równomierny w ciągu roku.');
  }
  for (const [index, saving] of input.annualSavingsGross.entries()) {
    if (!Number.isFinite(saving)) throw new RangeError(`Oszczędność w roku ${index + 1} musi być skończona.`);
  }
  const horizon = input.annualSavingsGross.length;
  validateTimedAmounts(input.subsidyReceipts, horizon, 'Dotacja');
  validateTimedAmounts(input.taxSavingReceipts, horizon, 'Oszczędność podatkowa');

  const totalSubsidyGross = input.subsidyReceipts.reduce((sum, item) => sum + item.amountGross, 0);
  const totalTaxSavingsGross = input.taxSavingReceipts.reduce((sum, item) => sum + item.amountGross, 0);
  const years: OfferProjectionYear[] = [];
  let cumulativeCashFlowGross = 0;
  let discountedCumulativeCashFlowGross = 0;
  for (let year = 0; year <= horizon; year += 1) {
    const investmentGross = year === 0 ? input.investmentGross : 0;
    const savingsGross = year === 0 ? 0 : input.annualSavingsGross[year - 1];
    const subsidyGross = sumAtTime(input.subsidyReceipts, year);
    const taxSavingGross = sumAtTime(input.taxSavingReceipts, year);
    const netCashFlowGross = -investmentGross + savingsGross + subsidyGross + taxSavingGross;
    const discountedSavingsGross = year === 0
      ? 0
      : discountedUniformAnnualSavings(savingsGross, year, input.annualDiscountRate);
    const discountedCashFlowGross = -investmentGross
      + discountedSavingsGross
      + sumAtTime(input.subsidyReceipts, year, input.annualDiscountRate)
      + sumAtTime(input.taxSavingReceipts, year, input.annualDiscountRate);
    cumulativeCashFlowGross += netCashFlowGross;
    discountedCumulativeCashFlowGross += discountedCashFlowGross;
    years.push({
      year,
      savingsGross,
      subsidyGross,
      taxSavingGross,
      investmentGross,
      netCashFlowGross,
      discountedCashFlowGross,
      cumulativeCashFlowGross,
      discountedCumulativeCashFlowGross,
    });
  }

  const paybackYears = findInterpolatedPayback(input, false);
  const discountedPaybackYears = findInterpolatedPayback(input, true);
  return {
    investmentGross: input.investmentGross,
    totalSubsidyGross,
    totalTaxSavingsGross,
    netCostGross: input.investmentGross - totalSubsidyGross - totalTaxSavingsGross,
    netPresentValueGross: discountedCumulativeCashFlowGross,
    paybackYears,
    discountedPaybackYears,
    paybackAchieved: paybackYears !== null,
    discountedPaybackAchieved: discountedPaybackYears !== null,
    years,
  };
}

export interface OfferProjectionForRanking {
  id: string;
  projection: OfferProjectionResult;
}

export interface RankedOfferProjection {
  id: string;
  rank: number;
  paybackYears: number | null;
  netCostGross: number;
}

export function rankOfferProjections(
  offers: OfferProjectionForRanking[],
): RankedOfferProjection[] {
  return offers
    .map((offer, index) => ({ offer, index }))
    .sort((left, right) => {
      const leftPayback = left.offer.projection.paybackYears;
      const rightPayback = right.offer.projection.paybackYears;
      if (leftPayback === null && rightPayback !== null) return 1;
      if (leftPayback !== null && rightPayback === null) return -1;
      if (leftPayback !== null && rightPayback !== null && leftPayback !== rightPayback) {
        return leftPayback - rightPayback;
      }
      const netCostDifference = left.offer.projection.netCostGross - right.offer.projection.netCostGross;
      return netCostDifference || left.index - right.index;
    })
    .map(({ offer }, index) => ({
      id: offer.id,
      rank: index + 1,
      paybackYears: offer.projection.paybackYears,
      netCostGross: offer.projection.netCostGross,
    }));
}
