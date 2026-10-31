import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateOfferWorkspaceFinancing,
  type OfferWorkspaceFinancingInput,
  type OfferWorkspaceThermomodernizationAssumptions,
} from './offer-workspace-financing';
import type { Pme2EligibilityEvidence } from './offer-financing-v2';

const yesEvidence: Pme2EligibilityEvidence = {
  individualApplicant: 'yes',
  residentialBuilding: 'yes',
  gridConnectedProsumer: 'yes',
  energyContractNotForBusiness: 'yes',
  newCertifiedBattery: 'yes',
  backupCapabilityDocumented: 'yes',
  compliantEmsDocumented: 'yes',
  noOtherSubsidyForSameScope: 'yes',
  within50KwMicroinstallationLimit: 'yes',
  allOtherProgramConditionsReviewed: 'yes',
};

const base: OfferWorkspaceFinancingInput = {
  clientType: 'B2C',
  selectedPricingLines: [
    { id: 'battery', category: 'MAGAZYN_ENERGII', amountGross: 40000 },
    { id: 'inverter', category: 'FALOWNIK', amountGross: 6000 },
    { id: 'ems', category: 'SYSTEM_MONITORUJACY', amountGross: 3000 },
  ],
  batteryCapacityKwh: 20,
  pvPowerKwp: 9.9,
  billingModel: 'net-billing',
};

const completePme2: NonNullable<OfferWorkspaceFinancingInput['pme2']> = {
  applicationDate: '2026-10-29',
  projectCostDates: ['2026-10-29'],
  installationDate: '2026-10-29',
  osdConfirmationDate: '2026-10-29',
  budgetAvailabilityEvidence: {
    status: 'available',
    checkedOn: '2026-10-29',
    evidenceReference: 'test: budget availability check',
  },
  customerEligibility: {
    reviewStatus: 'confirmed',
    reviewReasons: ['Warunki przyjęto do scenariusza planistycznego.'],
    evidence: yesEvidence,
  },
};

const completeTax: OfferWorkspaceThermomodernizationAssumptions = {
  ownerOrCoOwnerOfExistingSingleFamilyHome: 'yes',
  eligibleExpenditureConfirmed: 'yes',
  eligibleInvoiceCostsGross: 40000,
  deductibleVatGross: 0,
  otherReimbursementsGross: 0,
  previouslyUsedDeductionGross: 0,
  taxableBaseBeforeDeductionGross: 100000,
  taxRegime: 'progressive',
  taxBands: [
    { upperBoundGross: 85528, marginalRate: 0.12 },
    { upperBoundGross: null, marginalRate: 0.32 },
  ],
  firstExpenseDate: '2026-10-29',
  completionDate: '2026-10-29',
  asOfDate: '2026-10-29',
  grantScope: 'same-as-pme2',
};

test('bez założeń pokazuje potencjał formuły z oznaczonej baterii i listę braków, bez potwierdzonej kwoty', () => {
  const result = calculateOfferWorkspaceFinancing(base);

  assert.equal(result.pme2.formulaMaximumGross, 12000);
  assert.equal(result.pme2.conditionalGross, 12000);
  assert.equal(result.pme2.status, 'unknown');
  assert.equal(result.pme2.confirmedEligibleGross, null);
  assert.equal(result.pme2.budgetAvailabilityStatus, 'unknown');
  assert.equal(result.pme2.budgetConditionedPotentialGross, null);
  assert.equal(result.pme2.storageCostExcludingEmsAndInverterGross, 40000);
  assert.equal(result.pme2.storageCostSource, 'battery-product-lines');
  assert.equal(result.pme2.awardGuaranteed, false);
  assert.ok(result.pme2.missingInputs.some((item) => item.includes('kwalifikowalności klienta')));
  assert.equal(result.thermomodernization.status, 'not-requested');
  assert.equal(result.thermomodernization.conditionalTaxSavingGross, null);
  assert.equal(result.thermomodernization.confirmedTaxSavingGross, null);
  assert.equal(result.conditionalCombinedGross, 12000);
  assert.equal(result.confirmedCombinedGross, null);
});

test('koszt jawny ma pierwszeństwo, a nieoznaczona cena całego szablonu nie staje się kosztem baterii', () => {
  const explicit = calculateOfferWorkspaceFinancing({
    ...base,
    pme2: { storageCostExcludingEmsAndInverterGross: 20000 },
  });
  assert.equal(explicit.pme2.formulaMaximumGross, 6000);
  assert.equal(explicit.pme2.storageCostSource, 'explicit');

  const ambiguous = calculateOfferWorkspaceFinancing({
    ...base,
    selectedPricingLines: [{ id: 'template', category: 'MIXED', amountGross: 49000 }],
  });
  assert.equal(ambiguous.pme2.formulaMaximumGross, null);
  assert.equal(ambiguous.pme2.conditionalGross, null);
  assert.equal(ambiguous.pme2.storageCostExcludingEmsAndInverterGross, null);
  assert.ok(ambiguous.pme2.missingInputs.some((item) => item.includes('bez EMS i falownika')));
});

test('PME2 respektuje limity, status niegwarantowanej dotacji i zachowuje powody niekwalifikowalności', () => {
  const eligible = calculateOfferWorkspaceFinancing({ ...base, pme2: completePme2 });
  assert.equal(eligible.pme2.status, 'confirmed');
  assert.equal(eligible.pme2.confirmedEligibleGross, 12000);
  assert.equal(eligible.pme2.budgetConditionedPotentialGross, 12000);
  assert.equal(eligible.pme2.awardGuaranteed, false);
  assert.equal(eligible.confirmedCombinedGross, null);

  const belowRatio = calculateOfferWorkspaceFinancing({
    ...base,
    batteryCapacityKwh: 19.79,
    pme2: completePme2,
  });
  assert.equal(belowRatio.pme2.status, 'ineligible');
  assert.equal(belowRatio.pme2.conditionalGross, 0);
  assert.match(belowRatio.pme2.reasons.join(' '), /dwukrotność mocy PV/);

  const closedBudget = calculateOfferWorkspaceFinancing({
    ...base,
    pme2: {
      ...completePme2,
      budgetAvailabilityEvidence: {
        status: 'unavailable',
        checkedOn: '2026-10-29',
        evidenceReference: 'test: budget unavailable',
      },
    },
  });
  assert.equal(closedBudget.pme2.conditionalGross, 12000);
  assert.equal(closedBudget.pme2.budgetAvailabilityStatus, 'unavailable');
  assert.equal(closedBudget.pme2.budgetConditionedPotentialGross, 0);
});

test('klient B2B nie otrzymuje wyliczenia PME2 ani kwoty zastępczej', () => {
  const result = calculateOfferWorkspaceFinancing({
    ...base,
    clientType: 'B2B',
    pme2: completePme2,
  });
  assert.equal(result.pme2.status, 'not-applicable');
  assert.equal(result.pme2.formulaMaximumGross, null);
  assert.equal(result.pme2.conditionalGross, null);
  assert.equal(result.pme2.confirmedEligibleGross, null);
  assert.match(result.pme2.reasons.join(' '), /B2B/);
  assert.equal(result.conditionalCombinedGross, null);
  assert.equal(result.confirmedCombinedGross, null);
});

test('klient B2B nie może oznaczyć dotacji PME2 jako zakresu ulgi', () => {
  assert.throws(() => calculateOfferWorkspaceFinancing({
    ...base,
    clientType: 'B2B',
    thermomodernization: completeTax,
  }), /nie może być przypisany do klienta B2B/);
});

test('ulga używa jawnych progów podatkowych, odejmuje potencjalną dotację z tego samego zakresu', () => {
  const result = calculateOfferWorkspaceFinancing({
    ...base,
    pme2: completePme2,
    thermomodernization: completeTax,
  });

  assert.equal(result.pme2.conditionalGross, 12000);
  assert.equal(result.thermomodernization.grantReimbursementGrossUsed, 12000);
  assert.equal(result.thermomodernization.grantReimbursementSource, 'pme2-potential');
  assert.equal(result.thermomodernization.eligibleCostAfterVatAndReimbursementsGross, 28000);
  assert.ok(Math.abs((result.thermomodernization.conditionalTaxSavingGross ?? 0) - 6254.4) < 1e-8);
  assert.equal(result.thermomodernization.confirmedTaxSavingGross, null);
  assert.match(result.thermomodernization.reasons.join(' '), /nie jest gwarantowana/);
  assert.ok(Math.abs((result.conditionalCombinedGross ?? 0) - 18254.4) < 1e-8);
  assert.equal(result.confirmedCombinedGross, null);
});

test('jawna już otrzymana dotacja w tym samym zakresie zastępuje, a nie sumuje się z potencjałem PME2', () => {
  const result = calculateOfferWorkspaceFinancing({
    ...base,
    pme2: completePme2,
    thermomodernization: { ...completeTax, grantReimbursementGross: 5000 },
  });
  assert.equal(result.pme2.conditionalGross, 12000);
  assert.equal(result.thermomodernization.grantReimbursementGrossUsed, 5000);
  assert.ok(Math.abs((result.conditionalCombinedGross ?? 0) - (5000 + (result.thermomodernization.conditionalTaxSavingGross ?? 0))) < 1e-8);
  assert.notEqual(result.conditionalCombinedGross, 12000 + (result.thermomodernization.conditionalTaxSavingGross ?? 0));
});

test('niepełne dane podatkowe nie podstawiają stawki ani dowodów i wyświetlają braki', () => {
  const result = calculateOfferWorkspaceFinancing({
    ...base,
    thermomodernization: {
      eligibleInvoiceCostsGross: 40000,
      grantScope: 'none',
    },
  });

  assert.equal(result.thermomodernization.status, 'not-calculated');
  assert.equal(result.thermomodernization.conditionalTaxSavingGross, null);
  assert.equal(result.thermomodernization.confirmedTaxSavingGross, null);
  assert.ok(result.thermomodernization.missingInputs.some((item) => item.includes('formę opodatkowania') || item.includes('forma opodatkowania')));
  assert.ok(result.thermomodernization.missingInputs.some((item) => item.includes('progi i stawki')));
  assert.ok(result.thermomodernization.missingInputs.some((item) => item.includes('własności')));
  assert.equal(result.confirmedCombinedGross, null);
});

test('nieznany zakres dotacji blokuje połączenie ulgi i nie tworzy podwójnej korzyści', () => {
  const result = calculateOfferWorkspaceFinancing({
    ...base,
    thermomodernization: { ...completeTax, grantScope: 'unknown' },
  });
  assert.equal(result.thermomodernization.status, 'not-calculated');
  assert.equal(result.thermomodernization.conditionalTaxSavingGross, null);
  assert.ok(result.thermomodernization.missingInputs.some((item) => item.includes('ten sam zakres kosztów')));
  assert.equal(result.conditionalCombinedGross, null);
});

test('odrzuca sprzeczną kwotę zwrotu przy zadeklarowanym braku dotacji', () => {
  assert.throws(() => calculateOfferWorkspaceFinancing({
    ...base,
    thermomodernization: { ...completeTax, grantScope: 'none', grantReimbursementGross: 1 },
  }), /musi wynosić 0/);
});
