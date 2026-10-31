import {
  calculatePme2Offer,
  calculateThermomodernizationRelief,
  OFFER_FINANCING_RULE_VERSION,
  PME2_RULES,
  type BillingModel,
  type BudgetAvailabilityEvidence,
  type BudgetAvailabilityStatus,
  type EligibilityStatus,
  type EvidenceStatus,
  type Pme2EligibilityEvidence,
  type TaxBand,
  type TaxRegime,
} from './offer-financing-v2';

export type OfferWorkspaceFinancingClientType = 'B2C' | 'B2B';

export interface OfferWorkspaceFinancingPricingLine {
  id: string;
  /** Exact product category; only MAGAZYN_ENERGII and BATTERY identify a storage line. */
  category: string | null;
  /** Selected line sale amount including VAT. */
  amountGross: number | null;
}

export interface OfferWorkspaceCustomerEligibilityAssumptions {
  reviewStatus?: EligibilityStatus;
  reviewReasons?: string[];
  evidence?: Partial<Pme2EligibilityEvidence>;
}

export interface OfferWorkspacePme2Assumptions {
  /** Explicit qualifying storage cost; when omitted, only identified battery lines are summed. */
  storageCostExcludingEmsAndInverterGross?: number;
  applicationDate?: string;
  projectCostDates?: string[];
  installationDate?: string | null;
  osdConfirmationDate?: string | null;
  requestEuManufacturingBonus?: boolean;
  budgetAvailabilityEvidence?: BudgetAvailabilityEvidence;
  customerEligibility?: OfferWorkspaceCustomerEligibilityAssumptions;
}

export type OfferWorkspaceTaxGrantScope = 'same-as-pme2' | 'separate' | 'none' | 'unknown';

export interface OfferWorkspaceThermomodernizationAssumptions {
  ownerOrCoOwnerOfExistingSingleFamilyHome?: EvidenceStatus;
  eligibleExpenditureConfirmed?: EvidenceStatus;
  eligibleInvoiceCostsGross?: number;
  deductibleVatGross?: number;
  /** Actual reimbursement for the relief scope; omitted same-scope amount uses PME2 potential conditionally. */
  grantReimbursementGross?: number;
  otherReimbursementsGross?: number;
  previouslyUsedDeductionGross?: number;
  taxableBaseBeforeDeductionGross?: number;
  taxRegime?: TaxRegime;
  taxBands?: TaxBand[];
  firstExpenseDate?: string;
  completionDate?: string | null;
  asOfDate?: string;
  grantScope?: OfferWorkspaceTaxGrantScope;
}

export interface OfferWorkspaceFinancingInput {
  clientType: OfferWorkspaceFinancingClientType;
  selectedPricingLines: OfferWorkspaceFinancingPricingLine[];
  batteryCapacityKwh: number | null;
  pvPowerKwp: number | null;
  billingModel: BillingModel | null;
  pme2?: OfferWorkspacePme2Assumptions;
  thermomodernization?: OfferWorkspaceThermomodernizationAssumptions;
}

export type OfferWorkspacePme2Status = EligibilityStatus | 'not-applicable';
export type OfferWorkspaceTaxStatus = EligibilityStatus | 'not-requested' | 'not-calculated';
export type OfferWorkspaceStorageCostSource = 'explicit' | 'battery-product-lines' | 'unavailable';
export type OfferWorkspaceTaxGrantSource = 'pme2-potential' | 'explicit' | 'none' | 'unavailable';

export interface OfferWorkspacePme2Estimate {
  status: OfferWorkspacePme2Status;
  formulaMaximumGross: number | null;
  conditionalGross: number | null;
  confirmedEligibleGross: number | null;
  budgetAvailabilityStatus: BudgetAvailabilityStatus | 'not-assessed';
  budgetConditionedPotentialGross: number | null;
  awardGuaranteed: false;
  euBonusStatus: 'not-requested' | 'requires-confirmation' | 'not-assessed';
  storageCostExcludingEmsAndInverterGross: number | null;
  storageCostSource: OfferWorkspaceStorageCostSource;
  reasons: string[];
  missingInputs: string[];
}

export interface OfferWorkspaceTaxEstimate {
  status: OfferWorkspaceTaxStatus;
  eligibleCostAfterVatAndReimbursementsGross: number | null;
  conditionalDeductionThisYearGross: number | null;
  theoreticalTaxSavingGross: number | null;
  conditionalTaxSavingGross: number | null;
  confirmedTaxSavingGross: number | null;
  grantReimbursementGrossUsed: number | null;
  grantReimbursementSource: OfferWorkspaceTaxGrantSource;
  reasons: string[];
  missingInputs: string[];
}

export interface OfferWorkspaceFinancingResult {
  ruleVersion: typeof OFFER_FINANCING_RULE_VERSION;
  clientType: OfferWorkspaceFinancingClientType;
  pme2: OfferWorkspacePme2Estimate;
  thermomodernization: OfferWorkspaceTaxEstimate;
  conditionalCombinedGross: number | null;
  confirmedCombinedGross: number | null;
  awardGuaranteed: false;
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
  within50KwMicroinstallationLimit: 'spełnienie limitu 50 kW dla mikroinstalacji',
  allOtherProgramConditionsReviewed: 'przegląd pozostałych warunków programu',
};

const unknownPme2Evidence: Pme2EligibilityEvidence = {
  individualApplicant: 'unknown',
  residentialBuilding: 'unknown',
  gridConnectedProsumer: 'unknown',
  energyContractNotForBusiness: 'unknown',
  newCertifiedBattery: 'unknown',
  backupCapabilityDocumented: 'unknown',
  compliantEmsDocumented: 'unknown',
  noOtherSubsidyForSameScope: 'unknown',
  within50KwMicroinstallationLimit: 'unknown',
  allOtherProgramConditionsReviewed: 'unknown',
};

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} musi być skończoną liczbą nieujemną.`);
  }
}

function isBatteryProductCategory(category: string | null): boolean {
  const normalized = category?.trim().toUpperCase();
  return normalized === 'MAGAZYN_ENERGII' || normalized === 'BATTERY';
}

function resolveStorageCost(input: OfferWorkspaceFinancingInput): {
  amount: number | null;
  source: OfferWorkspaceStorageCostSource;
} {
  const explicit = input.pme2?.storageCostExcludingEmsAndInverterGross;
  if (explicit !== undefined) {
    assertFiniteNonNegative(explicit, 'Jawny koszt magazynu bez EMS i falownika');
    return { amount: explicit, source: 'explicit' };
  }

  const batteryLines = input.selectedPricingLines.filter((line) => isBatteryProductCategory(line.category));
  if (batteryLines.length === 0 || batteryLines.some((line) => line.amountGross === null)) {
    return { amount: null, source: 'unavailable' };
  }
  return {
    amount: batteryLines.reduce((sum, line) => sum + (line.amountGross as number), 0),
    source: 'battery-product-lines',
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function missingPme2Inputs(
  assumptions: OfferWorkspacePme2Assumptions | undefined,
  storageCostGross: number | null,
  batteryCapacityKwh: number | null,
  pvPowerKwp: number | null,
  billingModel: BillingModel | null,
): string[] {
  const missing: string[] = [];
  if (storageCostGross === null) {
    missing.push('Koszt magazynu kwalifikowany do PME2: podaj kwotę bez EMS i falownika albo oznaczone pozycje magazynu.');
  }
  if (batteryCapacityKwh === null) missing.push('Pojemność magazynu energii.');
  if (pvPowerKwp === null) missing.push('Moc instalacji PV.');
  if (billingModel === null) missing.push('Model rozliczeń: net-billing albo net-metering.');
  if (!assumptions?.applicationDate) missing.push('Data planowanego wniosku PME2.');
  if (!assumptions?.projectCostDates?.length) missing.push('Daty poniesienia kosztów przedsięwzięcia.');
  if (!assumptions || assumptions.installationDate === undefined || assumptions.installationDate === null) {
    missing.push('Data montażu magazynu.');
  }
  if (!assumptions || assumptions.osdConfirmationDate === undefined || assumptions.osdConfirmationDate === null) {
    missing.push('Data potwierdzenia OSD.');
  }
  if (!assumptions?.budgetAvailabilityEvidence || assumptions.budgetAvailabilityEvidence.status === 'unknown') {
    missing.push('Potwierdzona dostępność budżetu naboru.');
  }

  const customer = assumptions?.customerEligibility;
  if (!customer?.reviewStatus || customer.reviewStatus === 'unknown') {
    missing.push('Przegląd kwalifikowalności klienta.');
  }
  for (const key of Object.keys(evidenceLabels) as (keyof Pme2EligibilityEvidence)[]) {
    if (!customer?.evidence?.[key] || customer.evidence[key] === 'unknown') {
      missing.push(`Dowód warunku PME2: ${evidenceLabels[key]}.`);
    }
  }
  return unique(missing);
}

function calculatePme2Estimate(input: OfferWorkspaceFinancingInput): OfferWorkspacePme2Estimate {
  const storageCost = resolveStorageCost(input);
  const missingInputs = missingPme2Inputs(
    input.pme2,
    storageCost.amount,
    input.batteryCapacityKwh,
    input.pvPowerKwp,
    input.billingModel,
  );

  if (input.clientType === 'B2B') {
    return {
      status: 'not-applicable',
      formulaMaximumGross: null,
      conditionalGross: null,
      confirmedEligibleGross: null,
      budgetAvailabilityStatus: 'not-assessed',
      budgetConditionedPotentialGross: null,
      awardGuaranteed: false,
      euBonusStatus: 'not-assessed',
      storageCostExcludingEmsAndInverterGross: storageCost.amount,
      storageCostSource: storageCost.source,
      reasons: ['PME2 nie jest dostępne dla klienta B2B.'],
      missingInputs: [],
    };
  }

  if (storageCost.amount === null || input.batteryCapacityKwh === null
    || input.pvPowerKwp === null || input.billingModel === null) {
    return {
      status: 'unknown',
      formulaMaximumGross: null,
      conditionalGross: null,
      confirmedEligibleGross: null,
      budgetAvailabilityStatus: 'not-assessed',
      budgetConditionedPotentialGross: null,
      awardGuaranteed: false,
      euBonusStatus: input.pme2?.requestEuManufacturingBonus === undefined
        ? 'not-assessed'
        : input.pme2.requestEuManufacturingBonus ? 'requires-confirmation' : 'not-requested',
      storageCostExcludingEmsAndInverterGross: storageCost.amount,
      storageCostSource: storageCost.source,
      reasons: missingInputs,
      missingInputs,
    };
  }

  const assumptions = input.pme2;
  const customer = assumptions?.customerEligibility;
  const applicationDateMissing = !assumptions?.applicationDate;
  const coreResult = calculatePme2Offer({
    // The formula is date-independent; missing date is reported and cannot confirm eligibility.
    applicationDate: assumptions?.applicationDate ?? PME2_RULES.applicationFrom,
    projectCostDates: assumptions?.projectCostDates ?? [],
    installationDate: assumptions?.installationDate ?? null,
    osdConfirmationDate: assumptions?.osdConfirmationDate ?? null,
    batteryCapacityKwh: input.batteryCapacityKwh,
    pvPowerKwp: input.pvPowerKwp,
    storageCostExcludingEmsAndInverterGross: storageCost.amount,
    billingModel: input.billingModel,
    requestEuManufacturingBonus: assumptions?.requestEuManufacturingBonus ?? false,
    budgetAvailabilityEvidence: assumptions?.budgetAvailabilityEvidence ?? {
      status: 'unknown',
      checkedOn: null,
      evidenceReference: null,
    },
    eligibilityReview: {
      status: applicationDateMissing ? 'unknown' : customer?.reviewStatus ?? 'unknown',
      reasons: customer?.reviewReasons ?? [],
    },
    evidence: { ...unknownPme2Evidence, ...customer?.evidence },
  });

  const reasons = [...coreResult.eligibilityReasons];
  if (applicationDateMissing) reasons.push('Brak daty planowanego wniosku PME2 do oceny kwalifikowalności.');
  const eligibilityStatus = applicationDateMissing && coreResult.eligibilityStatus === 'confirmed'
    ? 'unknown'
    : coreResult.eligibilityStatus;

  return {
    status: eligibilityStatus,
    formulaMaximumGross: coreResult.formulaMaximumGross,
    conditionalGross: coreResult.potentialGross,
    confirmedEligibleGross: eligibilityStatus === 'confirmed' ? coreResult.confirmedEligibleGross : null,
    budgetAvailabilityStatus: coreResult.budgetAvailabilityStatus,
    budgetConditionedPotentialGross: coreResult.budgetConditionedPotentialGross,
    awardGuaranteed: false,
    euBonusStatus: assumptions?.requestEuManufacturingBonus === undefined
      ? 'not-assessed'
      : coreResult.euBonusStatus,
    storageCostExcludingEmsAndInverterGross: storageCost.amount,
    storageCostSource: storageCost.source,
    reasons: unique(reasons),
    missingInputs,
  };
}

function missingThermomodernizationInputs(
  assumptions: OfferWorkspaceThermomodernizationAssumptions,
): string[] {
  const missing: string[] = [];
  const required: Array<[keyof OfferWorkspaceThermomodernizationAssumptions, string]> = [
    ['ownerOrCoOwnerOfExistingSingleFamilyHome', 'Status własności istniejącego domu jednorodzinnego.'],
    ['eligibleExpenditureConfirmed', 'Potwierdzenie, że wydatek kwalifikuje się do ulgi.'],
    ['eligibleInvoiceCostsGross', 'Jawny koszt kwalifikowany z faktur brutto.'],
    ['deductibleVatGross', 'Kwota VAT podlegającego odliczeniu (wpisz 0, jeśli nie dotyczy).'],
    ['otherReimbursementsGross', 'Inne zwroty kosztów (wpisz 0, jeśli nie dotyczy).'],
    ['previouslyUsedDeductionGross', 'Wcześniej wykorzystany limit ulgi (wpisz 0, jeśli nie dotyczy).'],
    ['taxableBaseBeforeDeductionGross', 'Podstawa opodatkowania przed odliczeniem.'],
    ['taxRegime', 'Rzeczywista forma opodatkowania.'],
    ['taxBands', 'Jawne progi i stawki podatkowe.'],
    ['firstExpenseDate', 'Data pierwszego wydatku.'],
    ['asOfDate', 'Data, na którą oceniane są założenia podatkowe.'],
    ['grantScope', 'Informacja, czy dotacja pokrywa ten sam zakres kosztów.'],
  ];
  for (const [key, label] of required) {
    if (assumptions[key] === undefined) missing.push(label);
  }
  if (assumptions.completionDate === undefined) missing.push('Data zakończenia przedsięwzięcia albo jawne potwierdzenie, że nie zostało zakończone.');
  if (assumptions.grantScope === 'separate' && assumptions.grantReimbursementGross === undefined) {
    missing.push('Kwota dotacji/zwrotu przypadająca na zakres objęty ulgą.');
  }
  return unique(missing);
}

function emptyThermomodernizationEstimate(
  status: OfferWorkspaceTaxStatus,
  missingInputs: string[] = [],
): OfferWorkspaceTaxEstimate {
  return {
    status,
    eligibleCostAfterVatAndReimbursementsGross: null,
    conditionalDeductionThisYearGross: null,
    theoreticalTaxSavingGross: null,
    conditionalTaxSavingGross: null,
    confirmedTaxSavingGross: null,
    grantReimbursementGrossUsed: null,
    grantReimbursementSource: 'unavailable',
    reasons: missingInputs,
    missingInputs,
  };
}

function calculateThermomodernizationEstimate(
  input: OfferWorkspaceFinancingInput,
  pme2: OfferWorkspacePme2Estimate,
): OfferWorkspaceTaxEstimate {
  const assumptions = input.thermomodernization;
  if (!assumptions) {
    return emptyThermomodernizationEstimate('not-requested');
  }
  if (assumptions.grantScope !== undefined
    && !['same-as-pme2', 'separate', 'none', 'unknown'].includes(assumptions.grantScope)) {
    throw new TypeError('Zakres dotacji dla ulgi musi być jawnie określony.');
  }
  if (input.clientType === 'B2B' && assumptions.grantScope === 'same-as-pme2') {
    throw new TypeError('Zakres PME2 nie może być przypisany do klienta B2B.');
  }

  const missingInputs = missingThermomodernizationInputs(assumptions);
  let reimbursementGross: number | null = null;
  let reimbursementSource: OfferWorkspaceTaxGrantSource = 'unavailable';
  let conditionalGrantApplied = false;

  switch (assumptions.grantScope) {
    case 'same-as-pme2':
      if (assumptions.grantReimbursementGross !== undefined) {
        reimbursementGross = assumptions.grantReimbursementGross;
        reimbursementSource = 'explicit';
      } else if (pme2.conditionalGross !== null) {
        reimbursementGross = pme2.conditionalGross;
        reimbursementSource = 'pme2-potential';
        conditionalGrantApplied = reimbursementGross > 0;
      }
      break;
    case 'separate':
      if (assumptions.grantReimbursementGross !== undefined) {
        reimbursementGross = assumptions.grantReimbursementGross;
        reimbursementSource = 'explicit';
      }
      break;
    case 'none':
      if (assumptions.grantReimbursementGross !== undefined && assumptions.grantReimbursementGross !== 0) {
        throw new RangeError('Przy zakresie dotacji „none” kwota dotacji musi wynosić 0.');
      }
      reimbursementGross = 0;
      reimbursementSource = 'none';
      break;
    case 'unknown':
      missingInputs.push('Określ, czy dotacja obejmuje ten sam zakres kosztów co ulga.');
      break;
    case undefined:
      break;
  }

  if (assumptions.grantScope === 'same-as-pme2' && input.clientType === 'B2B'
    && assumptions.grantReimbursementGross === undefined) {
    missingInputs.push('Klient B2B nie może korzystać z PME2; wskaż inną dotację albo brak dotacji dla tego zakresu.');
  }
  if (reimbursementGross === null && assumptions.grantScope !== 'unknown' && assumptions.grantScope !== undefined) {
    if (!missingInputs.includes('Wyliczalna kwota potencjalnej dotacji PME2 na ten sam zakres.')) {
      missingInputs.push(assumptions.grantScope === 'same-as-pme2'
        ? 'Wyliczalna kwota potencjalnej dotacji PME2 na ten sam zakres.'
        : 'Kwota dotacji/zwrotu przypadająca na zakres objęty ulgą.');
    }
  }

  if (missingInputs.length > 0 || reimbursementGross === null) {
    return emptyThermomodernizationEstimate('not-calculated', unique(missingInputs));
  }
  assertFiniteNonNegative(reimbursementGross, 'Kwota dotacji/zwrotu kosztów');

  const calculation = calculateThermomodernizationRelief({
    ownerOrCoOwnerOfExistingSingleFamilyHome: assumptions.ownerOrCoOwnerOfExistingSingleFamilyHome as EvidenceStatus,
    eligibleExpenditureConfirmed: assumptions.eligibleExpenditureConfirmed as EvidenceStatus,
    eligibleInvoiceCostsGross: assumptions.eligibleInvoiceCostsGross as number,
    deductibleVatGross: assumptions.deductibleVatGross as number,
    grantReimbursementGross: reimbursementGross,
    otherReimbursementsGross: assumptions.otherReimbursementsGross as number,
    previouslyUsedDeductionGross: assumptions.previouslyUsedDeductionGross as number,
    taxableBaseBeforeDeductionGross: assumptions.taxableBaseBeforeDeductionGross as number,
    taxRegime: assumptions.taxRegime as TaxRegime,
    taxBands: assumptions.taxBands as TaxBand[],
    firstExpenseDate: assumptions.firstExpenseDate as string,
    completionDate: assumptions.completionDate as string | null,
    asOfDate: assumptions.asOfDate as string,
  });
  const confirmedTaxSavingGross = conditionalGrantApplied ? null : calculation.confirmedTaxSavingGross;
  const reasons = [...calculation.eligibilityReasons];
  if (conditionalGrantApplied) {
    reasons.push('Wyliczenie podatkowe zakłada warunkowo potencjalną dotację PME2 na ten sam zakres; nagroda nie jest gwarantowana.');
  }

  return {
    status: calculation.eligibilityStatus,
    eligibleCostAfterVatAndReimbursementsGross: calculation.eligibleCostAfterVatAndReimbursementsGross,
    conditionalDeductionThisYearGross: calculation.conditionalDeductionThisYearGross,
    theoreticalTaxSavingGross: calculation.theoreticalTaxSavingGross,
    conditionalTaxSavingGross: calculation.conditionalTaxSavingGross,
    confirmedTaxSavingGross,
    grantReimbursementGrossUsed: reimbursementGross,
    grantReimbursementSource: reimbursementSource,
    reasons: unique(reasons),
    missingInputs: [],
  };
}

export function calculateOfferWorkspaceFinancing(
  input: OfferWorkspaceFinancingInput,
): OfferWorkspaceFinancingResult {
  if (input.clientType !== 'B2C' && input.clientType !== 'B2B') {
    throw new TypeError('Typ klienta musi być jawnie B2C albo B2B.');
  }
  for (const line of input.selectedPricingLines) {
    if (!line.id.trim()) throw new TypeError('Każda wybrana pozycja cenowa musi mieć identyfikator.');
    if (line.amountGross !== null) assertFiniteNonNegative(line.amountGross, `Kwota brutto pozycji ${line.id}`);
  }
  if (input.batteryCapacityKwh !== null) assertFiniteNonNegative(input.batteryCapacityKwh, 'Pojemność magazynu');
  if (input.pvPowerKwp !== null) assertFiniteNonNegative(input.pvPowerKwp, 'Moc PV');
  if (input.billingModel !== null && input.billingModel !== 'net-billing' && input.billingModel !== 'net-metering') {
    throw new TypeError('Model rozliczeń musi być jawnie net-billing albo net-metering.');
  }

  const pme2 = calculatePme2Estimate(input);
  const tax = calculateThermomodernizationEstimate(input, pme2);
  const conditionalPme2 = pme2.status === 'not-applicable' ? 0 : pme2.conditionalGross;
  const taxRequested = input.thermomodernization !== undefined;
  const combinedGrantGross = input.thermomodernization?.grantScope === 'same-as-pme2'
    && input.thermomodernization.grantReimbursementGross !== undefined
    ? input.thermomodernization.grantReimbursementGross
    : conditionalPme2;
  const hasConditionalCalculation = pme2.status !== 'not-applicable' || taxRequested;
  const conditionalCombinedGross = hasConditionalCalculation && combinedGrantGross !== null
    && (!taxRequested || tax.conditionalTaxSavingGross !== null)
    ? combinedGrantGross + (tax.conditionalTaxSavingGross ?? 0)
    : null;

  const confirmedPme2 = pme2.status === 'not-applicable' || pme2.status === 'ineligible'
    || pme2.conditionalGross === 0
    ? 0
    : null;
  const confirmedTax = tax.status === 'ineligible'
    ? 0
    : tax.confirmedTaxSavingGross;
  const hasConfirmedCalculation = pme2.status !== 'not-applicable' || taxRequested;
  const confirmedCombinedGross = hasConfirmedCalculation && confirmedPme2 !== null
    && (!taxRequested || confirmedTax !== null)
    ? confirmedPme2 + (confirmedTax ?? 0)
    : null;

  return {
    ruleVersion: OFFER_FINANCING_RULE_VERSION,
    clientType: input.clientType,
    pme2,
    thermomodernization: tax,
    conditionalCombinedGross,
    confirmedCombinedGross,
    awardGuaranteed: false,
  };
}
