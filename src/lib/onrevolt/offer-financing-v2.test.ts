import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateOfferProjection,
  calculatePme2Offer,
  calculateThermomodernizationRelief,
  rankOfferProjections,
  THERMOMODERNIZATION_DEDUCTION_LIMIT_GROSS,
  type OfferProjectionInput,
  type Pme2OfferInput,
  type ThermomodernizationReliefInput,
} from './offer-financing-v2';

const yesEvidence = {
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
} as const;

const pmeBase: Pme2OfferInput = {
  applicationDate: '2026-10-20',
  projectCostDates: ['2025-11-01', '2029-12-31'],
  installationDate: '2025-11-15',
  osdConfirmationDate: '2025-12-01',
  batteryCapacityKwh: 20,
  pvPowerKwp: 9.9,
  storageCostExcludingEmsAndInverterGross: 50000,
  billingModel: 'net-billing',
  requestEuManufacturingBonus: false,
  budgetAvailabilityEvidence: {
    status: 'available',
    checkedOn: '2026-10-20',
    evidenceReference: 'https://przydomowemagazyny.gov.pl/ogloszenie-naboru',
  },
  eligibilityReview: { status: 'confirmed', reasons: ['Dokumenty sprawdzone przez doradcę.'] },
  evidence: yesEvidence,
};

const taxBase: ThermomodernizationReliefInput = {
  ownerOrCoOwnerOfExistingSingleFamilyHome: 'yes',
  eligibleExpenditureConfirmed: 'yes',
  eligibleInvoiceCostsGross: 40000,
  deductibleVatGross: 0,
  grantReimbursementGross: 10000,
  otherReimbursementsGross: 0,
  previouslyUsedDeductionGross: 0,
  taxableBaseBeforeDeductionGross: 100000,
  taxRegime: 'progressive',
  taxBands: [
    { upperBoundGross: 85528, marginalRate: 0.12 },
    { upperBoundGross: null, marginalRate: 0.32 },
  ],
  firstExpenseDate: '2026-03-04',
  completionDate: '2029-12-31',
  asOfDate: '2029-12-31',
};

const projectionBase: OfferProjectionInput = {
  investmentGross: 40000,
  annualSavingsGross: [10000, 10000, 10000, 10000],
  subsidyReceipts: [{ year: 1, timing: 'end-of-year', amountGross: 8000 }],
  taxSavingReceipts: [{ year: 2, timing: 'end-of-year', amountGross: 3000 }],
  annualSavingsTiming: 'uniform-through-year',
  annualDiscountRate: 0,
};

test('PME2 liczy dotację z trzech limitów i utrzymuje warunkowy status naboru', () => {
  const result = calculatePme2Offer(pmeBase);
  assert.equal(result.eligibilityStatus, 'confirmed');
  assert.equal(result.formulaMaximumGross, 15000);
  assert.equal(result.confirmedEligibleGross, 15000);
  assert.equal(result.budgetAvailabilityStatus, 'available');
  assert.equal(result.budgetConditionedPotentialGross, 15000);
  assert.equal(result.awardGuaranteed, false);
  assert.equal(result.thermalStorageIncluded, false);
});

test('nie wylicza samodzielnie limitu 50 kW ani nie domyśla dostępności budżetu', () => {
  const result = calculatePme2Offer({
    ...pmeBase,
    budgetAvailabilityEvidence: { status: 'unknown', checkedOn: null, evidenceReference: null },
    evidence: { ...yesEvidence, within50KwMicroinstallationLimit: 'unknown' },
  });
  assert.equal(result.eligibilityStatus, 'unknown');
  assert.equal(result.potentialGross, 15000);
  assert.equal(result.budgetConditionedPotentialGross, null);
  assert.match(result.eligibilityReasons.join(' '), /limitu 50 kW/);
  assert.throws(() => calculatePme2Offer({
    ...pmeBase,
    budgetAvailabilityEvidence: { status: 'available', checkedOn: null, evidenceReference: null },
  }), /wymaga daty sprawdzenia/);
});

test('daty montażu i potwierdzenia OSD wchodzą do kontroli okresu kwalifikowalności', () => {
  const oldInstallation = calculatePme2Offer({ ...pmeBase, installationDate: '2025-10-31' });
  const unknownOsd = calculatePme2Offer({ ...pmeBase, osdConfirmationDate: null });
  assert.equal(oldInstallation.eligibilityStatus, 'ineligible');
  assert.equal(unknownOsd.eligibilityStatus, 'unknown');
});

test('net-metering ogranicza dotację do 8000 zł, a premia UE wymaga potwierdzenia', () => {
  const result = calculatePme2Offer({ ...pmeBase, billingModel: 'net-metering', requestEuManufacturingBonus: true });
  assert.equal(result.formulaMaximumGross, 8000);
  assert.equal(result.euBonusStatus, 'requires-confirmation');
});

test('nie uznaje nieznanej kwalifikowalności za potwierdzoną, ale pokazuje kwotę warunkową', () => {
  const result = calculatePme2Offer({
    ...pmeBase,
    eligibilityReview: { status: 'unknown', reasons: [] },
    evidence: { ...yesEvidence, backupCapabilityDocumented: 'unknown' },
  });
  assert.equal(result.eligibilityStatus, 'unknown');
  assert.equal(result.potentialGross, 15000);
  assert.equal(result.confirmedEligibleGross, null);
  assert.match(result.eligibilityReasons.join(' '), /zasilania awaryjnego/);
});

test('odrzuca magazyn tuż poniżej progu 10 kWh i proporcji 2x PV', () => {
  const belowMinimum = calculatePme2Offer({ ...pmeBase, batteryCapacityKwh: 9.99, pvPowerKwp: 4 });
  const belowRatio = calculatePme2Offer({ ...pmeBase, batteryCapacityKwh: 19.79, pvPowerKwp: 9.9 });
  assert.equal(belowMinimum.eligibilityStatus, 'ineligible');
  assert.equal(belowMinimum.potentialGross, 0);
  assert.equal(belowRatio.eligibilityStatus, 'ineligible');
});

test('sprawdza inclusive daty naboru i pełną historię kosztów', () => {
  assert.equal(calculatePme2Offer(pmeBase).eligibilityStatus, 'confirmed');
  const beforeApplication = calculatePme2Offer({ ...pmeBase, applicationDate: '2026-10-19' });
  const historicalCost = calculatePme2Offer({ ...pmeBase, projectCostDates: ['2025-10-31'] });
  const afterCostWindow = calculatePme2Offer({ ...pmeBase, projectCostDates: ['2030-01-01'] });
  assert.equal(beforeApplication.eligibilityStatus, 'ineligible');
  assert.equal(historicalCost.eligibilityStatus, 'ineligible');
  assert.equal(afterCostWindow.eligibilityStatus, 'ineligible');
});

test('cena 3000 zł/kWh jest granicznie dopuszczalna, wyższa cena wyklucza', () => {
  const atLimit = calculatePme2Offer({ ...pmeBase, storageCostExcludingEmsAndInverterGross: 60000 });
  const overLimit = calculatePme2Offer({ ...pmeBase, storageCostExcludingEmsAndInverterGross: 60000.01 });
  assert.equal(atLimit.eligibilityStatus, 'confirmed');
  assert.equal(overLimit.eligibilityStatus, 'ineligible');
});

test('limit 30% kwalifikowanego kosztu może być niższy niż limity kwotowe', () => {
  const result = calculatePme2Offer({ ...pmeBase, storageCostExcludingEmsAndInverterGross: 20000 });
  assert.equal(result.formulaMaximumGross, 6000);
});

test('brak naboru lub inna dotacja wyklucza, nawet gdy wyliczenie limitu jest dodatnie', () => {
  const outOfWindow = calculatePme2Offer({ ...pmeBase, applicationDate: '2027-10-02' });
  const duplicateFunding = calculatePme2Offer({
    ...pmeBase,
    evidence: { ...yesEvidence, noOtherSubsidyForSameScope: 'no' },
  });
  assert.equal(outOfWindow.potentialGross, 0);
  assert.equal(duplicateFunding.potentialGross, 0);
  assert.equal(duplicateFunding.eligibilityStatus, 'ineligible');
});

test('PME2 wymaga jawnych dat kosztów i odrzuca ujemne, nieskończone oraz NaN dane', () => {
  const noDates = calculatePme2Offer({ ...pmeBase, projectCostDates: [] });
  assert.equal(noDates.eligibilityStatus, 'unknown');
  assert.equal(noDates.potentialGross, 15000);
  assert.throws(() => calculatePme2Offer({ ...pmeBase, batteryCapacityKwh: -1 }), /nieujemną/);
  assert.throws(() => calculatePme2Offer({ ...pmeBase, storageCostExcludingEmsAndInverterGross: Number.NaN }), /nieujemną/);
  assert.throws(() => calculatePme2Offer({ ...pmeBase, pvPowerKwp: Number.POSITIVE_INFINITY }), /nieujemną/);
  assert.throws(() => calculatePme2Offer({ ...pmeBase, billingModel: 'other' as Pme2OfferInput['billingModel'] }), /Model rozliczeń/);
});

test('ulga odejmuje VAT do odliczenia, dotację i zwroty, a limit pomniejsza o wcześniejsze użycie', () => {
  const result = calculateThermomodernizationRelief({
    ...taxBase,
    eligibleInvoiceCostsGross: 70000,
    deductibleVatGross: 10000,
    grantReimbursementGross: 5000,
    otherReimbursementsGross: 2000,
    previouslyUsedDeductionGross: 20000,
    taxableBaseBeforeDeductionGross: 100000,
    taxRegime: 'flat',
    taxBands: [{ upperBoundGross: null, marginalRate: 0.19 }],
  });
  assert.equal(result.eligibleCostAfterVatAndReimbursementsGross, 53000);
  assert.equal(result.theoreticalDeductionGross, 33000);
  assert.equal(result.confirmedDeductionThisYearGross, 33000);
  assert.equal(result.conditionalTaxSavingGross, 6270);
  assert.equal(result.theoreticalTaxSavingGross, 6270);
});

test('rzeczywista korzyść podatkowa uwzględnia przejście przez próg 12%/32%', () => {
  const result = calculateThermomodernizationRelief({ ...taxBase, eligibleInvoiceCostsGross: 10000, grantReimbursementGross: 0 });
  assert.equal(result.theoreticalDeductionGross, 10000);
  assert.ok(Math.abs(result.taxBeforeDeductionGross - 14894.4) < 1e-8);
  assert.ok(Math.abs(result.taxAfterDeductionGross - 11694.4) < 1e-8);
  assert.ok(Math.abs(result.conditionalTaxSavingGross - 3200) < 1e-8);
  assert.notEqual(result.conditionalTaxSavingGross, result.theoreticalDeductionGross * 0.12);
});

test('ryczałt liczy podatek z jawnej podstawy i jawnej stawki', () => {
  const result = calculateThermomodernizationRelief({
    ...taxBase,
    taxRegime: 'lump-sum',
    taxBands: [{ upperBoundGross: null, marginalRate: 0.085 }],
    taxableBaseBeforeDeductionGross: 20000,
    eligibleInvoiceCostsGross: 10000,
    grantReimbursementGross: 0,
  });
  assert.equal(result.conditionalDeductionThisYearGross, 10000);
  assert.ok(Math.abs(result.conditionalTaxSavingGross - 850) < 1e-8);
});

test('nieznane warunki i przyszłe niewykorzystane odliczenie nie są gwarantowaną korzyścią', () => {
  const result = calculateThermomodernizationRelief({
    ...taxBase,
    ownerOrCoOwnerOfExistingSingleFamilyHome: 'unknown',
    eligibleExpenditureConfirmed: 'unknown',
    completionDate: null,
    asOfDate: '2028-06-01',
    eligibleInvoiceCostsGross: 30000,
    grantReimbursementGross: 0,
    taxableBaseBeforeDeductionGross: 5000,
  });
  assert.equal(result.eligibilityStatus, 'unknown');
  assert.equal(result.confirmedTaxSavingGross, null);
  assert.equal(result.theoreticalUnusedDeductionGross, 25000);
  assert.equal(result.unusedPotentialCarryForwardGross, 25000);
  assert.equal(result.carryForwardCountedAsGuaranteedBenefit, false);
});

test('po terminie trzech lat bez zakończenia ulga jest niekwalifikowana', () => {
  const result = calculateThermomodernizationRelief({
    ...taxBase,
    firstExpenseDate: '2026-01-01',
    completionDate: null,
    asOfDate: '2030-01-01',
  });
  assert.equal(result.completionDeadline, '2029-12-31');
  assert.equal(result.eligibilityStatus, 'ineligible');
  assert.equal(result.confirmedDeductionThisYearGross, null);
  assert.equal(result.conditionalDeductionThisYearGross, 0);
  assert.equal(result.conditionalTaxSavingGross, 0);
  assert.ok(result.theoreticalTaxSavingGross > 0);
});

test('zero pozostaje poprawną wartością, a ujemne, NaN i niespójne koszty są odrzucane', () => {
  const zero = calculateThermomodernizationRelief({
    ...taxBase,
    eligibleInvoiceCostsGross: 0,
    deductibleVatGross: 0,
    grantReimbursementGross: 0,
    otherReimbursementsGross: 0,
    previouslyUsedDeductionGross: THERMOMODERNIZATION_DEDUCTION_LIMIT_GROSS,
    taxableBaseBeforeDeductionGross: 0,
    taxBands: [{ upperBoundGross: null, marginalRate: 0.12 }],
  });
  assert.equal(zero.theoreticalDeductionGross, 0);
  assert.equal(zero.conditionalTaxSavingGross, 0);
  assert.throws(() => calculateThermomodernizationRelief({ ...taxBase, deductibleVatGross: -1 }), /nieujemną/);
  assert.throws(() => calculateThermomodernizationRelief({ ...taxBase, taxableBaseBeforeDeductionGross: Number.NaN }), /nieujemną/);
  assert.throws(() => calculateThermomodernizationRelief({ ...taxBase, grantReimbursementGross: 40001 }), /nie mogą przekroczyć/);
});

test('projekcja pokazuje przepływy, NPV i interpoluje zwrot z ujemnym rokiem', () => {
  const result = calculateOfferProjection({
    investmentGross: 20000,
    annualSavingsGross: [10000, -2000, 15000],
    subsidyReceipts: [{ year: 0, timing: 'end-of-year', amountGross: 2000 }],
    taxSavingReceipts: [{ year: 1, timing: 'end-of-year', amountGross: 1000 }],
    annualSavingsTiming: 'uniform-through-year',
    annualDiscountRate: 0,
  });
  assert.equal(result.years[0].cumulativeCashFlowGross, -18000);
  assert.equal(result.years[2].cumulativeCashFlowGross, -9000);
  assert.equal(result.paybackYears, 2.6);
  assert.equal(result.discountedPaybackYears, 2.6);
  assert.equal(result.netPresentValueGross, 6000);
});

test('dotacja otrzymana na koniec roku nie jest wstecznie rozsmarowana w paybacku', () => {
  const endOfYear = calculateOfferProjection({
    investmentGross: 100,
    annualSavingsGross: [0],
    subsidyReceipts: [{ year: 1, timing: 'end-of-year', amountGross: 200 }],
    taxSavingReceipts: [],
    annualSavingsTiming: 'uniform-through-year',
    annualDiscountRate: 0,
  });
  const startOfYear = calculateOfferProjection({
    investmentGross: 100,
    annualSavingsGross: [0],
    subsidyReceipts: [{ year: 1, timing: 'start-of-year', amountGross: 200 }],
    taxSavingReceipts: [],
    annualSavingsTiming: 'uniform-through-year',
    annualDiscountRate: 0,
  });
  assert.equal(endOfYear.paybackYears, 1);
  assert.equal(startOfYear.paybackYears, 0);
});

test('brak zwrotu w horyzoncie zwraca null, a ujemne oszczędności pozostają w przepływach', () => {
  const result = calculateOfferProjection({ ...projectionBase, annualSavingsGross: [5000, -10000, 1000] });
  assert.equal(result.years[2].savingsGross, -10000);
  assert.equal(result.paybackAchieved, false);
  assert.equal(result.paybackYears, null);
  assert.equal(result.discountedPaybackYears, null);
});

test('zerowy nakład ma zwrot w chwili zero; NaN i ujemne koszty nie przechodzą walidacji', () => {
  const zero = calculateOfferProjection({
    investmentGross: 0,
    annualSavingsGross: [0],
    subsidyReceipts: [],
    taxSavingReceipts: [],
    annualSavingsTiming: 'uniform-through-year',
    annualDiscountRate: 0,
  });
  assert.equal(zero.paybackYears, 0);
  assert.equal(zero.netPresentValueGross, 0);
  assert.throws(() => calculateOfferProjection({ ...projectionBase, investmentGross: -1 }), /nieujemną/);
  assert.throws(() => calculateOfferProjection({ ...projectionBase, annualSavingsGross: [Number.NaN] }), /skończona/);
  assert.throws(() => calculateOfferProjection({ ...projectionBase, annualDiscountRate: Number.NaN }), /nieujemną/);
});

test('ranking używa niezaokrąglonego payback, potem niższego kosztu netto, bez paybacku na końcu', () => {
  const faster = calculateOfferProjection({
    investmentGross: 100,
    annualSavingsGross: [60, 100],
    subsidyReceipts: [],
    taxSavingReceipts: [],
    annualSavingsTiming: 'uniform-through-year',
    annualDiscountRate: 0,
  });
  const tiedLowerCost = calculateOfferProjection({
    investmentGross: 90,
    annualSavingsGross: [60, 100],
    subsidyReceipts: [],
    taxSavingReceipts: [],
    annualSavingsTiming: 'uniform-through-year',
    annualDiscountRate: 0,
  });
  const noPayback = calculateOfferProjection({
    investmentGross: 1000,
    annualSavingsGross: [1],
    subsidyReceipts: [],
    taxSavingReceipts: [],
    annualSavingsTiming: 'uniform-through-year',
    annualDiscountRate: 0,
  });
  const ranked = rankOfferProjections([
    { id: 'faster', projection: faster },
    { id: 'lower-cost', projection: tiedLowerCost },
    { id: 'no-payback', projection: noPayback },
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ['lower-cost', 'faster', 'no-payback']);
  assert.equal(ranked[0].rank, 1);
});

test('przepływ z dotacji i ulgi wymaga jawnej kwoty, terminu i mieści się w horyzoncie', () => {
  assert.throws(() => calculateOfferProjection({ ...projectionBase, subsidyReceipts: [{ year: 5, timing: 'end-of-year', amountGross: 1 }] }), /zakresie/);
  assert.throws(() => calculateOfferProjection({ ...projectionBase, taxSavingReceipts: [{ year: 1, timing: 'end-of-year', amountGross: -1 }] }), /nieujemną/);
});
