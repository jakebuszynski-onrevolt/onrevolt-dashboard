import assert from 'node:assert/strict';
import test from 'node:test';
import { sumConfiguration } from './calculator';
import {
  enumerateOfferCandidates,
  type ApprovedConfigurationTemplate,
  type OfferCandidateEnumerationInput,
  type OfferCandidateItemSnapshot,
  type OfferCandidateSnapshot,
} from './offer-candidates';
import {
  calculateOfferEconomics,
  type ConfirmedFinancingReduction,
  type EconomicsProvenance,
  type OfferEconomicsCandidateInput,
  type OfferEconomicsInput,
  type OfferEconomicsVerification,
  type OfferEconomicsVerificationEvidence,
} from './offer-economics';

function proof(reference = 'test://dowod'): EconomicsProvenance {
  return {
    source: 'Zweryfikowany zestaw testowy',
    reference,
    verifiedAt: '2026-10-29T12:00:00.000Z',
  };
}

function candidateSnapshot(id: string, investmentGross = 10800): OfferCandidateSnapshot {
  const saleNet = Math.round((investmentGross / 1.08) * 100) / 100;
  const totals = sumConfiguration([{
    quantity: 1,
    unitPurchaseNet: 10000,
    purchaseVatRate: 0.23,
    operatingCostNet: 0,
    marginRate: 0,
    saleVatRate: 0.08,
    forcedSaleNet: saleNet,
  }]);
  const line = totals.lines[0];
  const item: OfferCandidateItemSnapshot = {
    templateId: 'approved-battery-template',
    templateVersion: 3,
    position: 1,
    productId: 'battery-product-16',
    productSku: 'BAT-16',
    productName: 'Magazyn 16 kWh',
    productCategory: 'MAGAZYN',
    description: 'Magazyn energii 16 kWh',
    role: 'BATTERY',
    supplyMode: 'ONREVOLT_SUPPLIED',
    quantity: 1,
    isOptional: false,
    requiresReview: false,
    resolvedCosts: {} as NonNullable<OfferCandidateItemSnapshot['resolvedCosts']>,
    saleVatRate: 0.08,
    calculation: line,
    missingPriceReason: null,
  };

  return {
    id,
    pvStrategy: 'KEEP_EXISTING',
    templateIds: ['approved-battery-template'],
    templateVersions: [3],
    totals,
    existingPv: { powerKw: 9.9, tiltDegrees: 40, azimuthDegrees: 170 },
    addedPvGeometry: null,
    pvGeometryReviewRequired: false,
    existingPvKw: 9.9,
    addedPvKw: 0,
    totalPvKw: 9.9,
    batteryCapacityKwh: 16,
    batteryPowerKw: 8,
    items: [item],
    requiresReview: false,
    reviewReasons: [],
    missingPrices: [],
  };
}

function candidateInput(
  id: string,
  annualNetOperatingCashflowsGross: number[],
  options: {
    investmentGross?: number;
    verification?: Partial<OfferEconomicsVerification>;
    confirmedFinancingReductions?: ConfirmedFinancingReduction[];
    snapshot?: OfferCandidateSnapshot;
  } = {},
): OfferEconomicsCandidateInput {
  const verification: OfferEconomicsVerification = {
    physical: 'verified',
    tariff: 'verified',
    pv: 'verified',
    compatibility: 'verified',
    ...options.verification,
  };
  const verificationEvidence: OfferEconomicsVerificationEvidence = {
    physical: proof(`test://${id}/physical`),
    tariff: proof(`test://${id}/tariff`),
    pv: proof(`test://${id}/pv`),
    compatibility: proof(`test://${id}/compatibility`),
  };
  return {
    candidate: options.snapshot ?? candidateSnapshot(id, options.investmentGross),
    investmentGross: options.investmentGross ?? 10800,
    investmentProvenance: proof(`test://${id}/investment`),
    annualNetOperatingCashflowsGross,
    cashflowProvenance: proof(`test://${id}/cashflows`),
    verification,
    verificationEvidence,
    verificationReasons: { physical: [], tariff: [], pv: [], compatibility: [] },
    confirmedFinancingReductions: options.confirmedFinancingReductions ?? [],
  };
}

function inputFor(
  candidates: OfferEconomicsCandidateInput[],
  overrides: Partial<OfferEconomicsInput> = {},
): OfferEconomicsInput {
  return {
    horizonYears: 3,
    annualDiscountRate: 0,
    annualCashflowTiming: 'uniform-through-year',
    rankingBaselineId: 'ZERO_INVESTMENT',
    tariffOnlyBaseline: {
      upfrontCostGross: 0,
      annualNetOperatingCashflowsGross: [0, 0, 0],
      provenance: proof('test://tariff-baseline'),
    },
    candidates,
    ...overrides,
  };
}

function reduction(
  id: string,
  amountGross: number,
  year: number,
  timing: ConfirmedFinancingReduction['timing'],
  kind: ConfirmedFinancingReduction['kind'] = 'GRANT_AWARD',
): ConfirmedFinancingReduction {
  return {
    id,
    kind,
    confirmationStatus: 'confirmed',
    amountGross,
    year,
    timing,
    provenance: proof(`test://financing/${id}`),
  };
}

test('utrzymuje osobne baseline’y i rekomenduje wg jawnie wybranego punktu odniesienia', () => {
  const candidate = candidateInput('battery', [5000, 5000, 5000]);
  const result = calculateOfferEconomics(inputFor([candidate], {
    rankingBaselineId: 'TARIFF_ONLY',
    tariffOnlyBaseline: {
      upfrontCostGross: 6000,
      annualNetOperatingCashflowsGross: [1000, 1000, 1000],
      provenance: proof('test://tariff-only'),
    },
  }));
  const comparisons = result.candidateAssessments[0].comparisons;

  assert.ok(comparisons);
  assert.equal(result.baselines.ZERO_INVESTMENT.upfrontCostGross, 0);
  assert.equal(result.baselines.TARIFF_ONLY.upfrontCostGross, 6000);
  assert.equal(comparisons.ZERO_INVESTMENT.paybackYearsPrecise, 2.16);
  assert.equal(comparisons.TARIFF_ONLY.upfrontInvestmentDeltaGross, 4800);
  assert.equal(comparisons.TARIFF_ONLY.paybackYearsPrecise, 1.2);
  assert.equal(result.rankedCandidates[0].paybackYearsPrecise, comparisons.TARIFF_ONLY.paybackYearsPrecise);
  assert.equal(result.recommendedCandidateId, 'battery');
});

test('liczy jawny horyzont, NPV, korzyść netto i osobno precyzyjny oraz podłogowy zwrot', () => {
  const result = calculateOfferEconomics(inputFor([candidateInput('battery', [5000, 5000, 5000])], {
    annualDiscountRate: 0.1,
  }));
  const comparison = result.candidateAssessments[0].comparisons!.ZERO_INVESTMENT;
  const expectedNpv = -10800 + 5000 * (1 - (1 / (1.1 ** 3))) / Math.log(1.1);

  assert.equal(comparison.longTermNetBenefitGross, 4200);
  assert.ok(Math.abs(comparison.netPresentValueGross - expectedNpv) < 1e-8);
  assert.equal(comparison.paybackYearsPrecise, 2.16);
  assert.equal(comparison.paybackYearsDisplayFloor, 2);
});

test('wpływ dotacji jest zdarzeniem w terminie, a nie równomierną oszczędnością', () => {
  const atYearEnd = calculateOfferEconomics(inputFor([candidateInput('end', [3000, 3000, 3000], {
    confirmedFinancingReductions: [reduction('grant-end', 6000, 2, 'end-of-year')],
  })])).candidateAssessments[0].comparisons!.ZERO_INVESTMENT;
  const atYearStart = calculateOfferEconomics(inputFor([candidateInput('start', [3000, 3000, 3000], {
    confirmedFinancingReductions: [reduction('grant-start', 6000, 2, 'start-of-year')],
  })])).candidateAssessments[0].comparisons!.ZERO_INVESTMENT;

  assert.equal(atYearEnd.paybackYearsPrecise, 2);
  assert.equal(atYearStart.paybackYearsPrecise, 1.6);
  assert.equal(atYearEnd.confirmedFinancingReductionsGross, 6000);
});

test('niepotwierdzona redukcja jest odrzucana zamiast obniżać nakład', () => {
  const unconfirmed = {
    ...reduction('uncertain-tax', 5000, 1, 'end-of-year', 'TAX_SAVING'),
    confirmationStatus: 'requires-confirmation',
  } as unknown as ConfirmedFinancingReduction;

  assert.throws(
    () => calculateOfferEconomics(inputFor([candidateInput('battery', [5000, 5000, 5000], {
      confirmedFinancingReductions: [unconfirmed],
    })])),
    /niepotwierdzone finansowanie/i,
  );
});

test('kandydat bez potwierdzonej fizyki pozostaje poza obliczeniami mimo podanej korzyści podatkowej', () => {
  const candidate = candidateInput('unverified', [5000, 5000, 5000], {
    verification: { physical: 'unverified' },
    confirmedFinancingReductions: [reduction('tax-saving', 4000, 1, 'end-of-year', 'TAX_SAVING')],
  });
  const result = calculateOfferEconomics(inputFor([candidate]));

  assert.equal(result.candidateAssessments[0].eligibilityStatus, 'not-eligible');
  assert.equal(result.candidateAssessments[0].comparisons, null);
  assert.equal(result.rankedCandidates.length, 0);
  assert.equal(result.recommendedCandidateId, null);
});

test('status zweryfikowany wymaga kompletu dowodów, a niezweryfikowany gate ma uzasadnienie', () => {
  const candidate = candidateInput('missing-evidence', [5000, 5000, 5000], {
    verification: { pv: 'unverified' },
  });
  candidate.verificationReasons.pv = ['Nie potwierdzono profilu PV.'];
  candidate.verificationEvidence.pv = { source: '', reference: '', verifiedAt: 'nie-data' };
  const result = calculateOfferEconomics(inputFor([candidate]));

  assert.equal(result.candidateAssessments[0].eligibilityStatus, 'not-eligible');
  assert.match(result.candidateAssessments[0].exclusionReasons.join(' '), /Nie potwierdzono profilu PV/);
  assert.match(result.candidateAssessments[0].exclusionReasons.join(' '), /brak wskazania źródła/);
});

test('snapshot z przeglądem lub brakującą ceną nie kwalifikuje się do rankingu', () => {
  const reviewedSnapshot = candidateSnapshot('reviewed');
  reviewedSnapshot.requiresReview = true;
  reviewedSnapshot.reviewReasons = [];
  const missingPriceSnapshot = candidateSnapshot('missing-price');
  missingPriceSnapshot.missingPrices = ['Bateria / cena zakupu'];
  const result = calculateOfferEconomics(inputFor([
    candidateInput('reviewed', [5000, 5000, 5000], { snapshot: reviewedSnapshot }),
    candidateInput('missing-price', [5000, 5000, 5000], { snapshot: missingPriceSnapshot }),
  ]));

  assert.equal(result.candidateAssessments[0].eligibilityStatus, 'not-eligible');
  assert.match(result.candidateAssessments[0].exclusionReasons.join(' '), /wymaga przeglądu/);
  assert.equal(result.candidateAssessments[1].eligibilityStatus, 'not-eligible');
  assert.match(result.candidateAssessments[1].exclusionReasons.join(' '), /Brak wymaganej ceny/);
  assert.equal(result.rankedCandidates.length, 0);
});

test('akceptuje wyłącznie zerową pozycję CLIENT_OWNED_USED utworzoną przez enumerator', () => {
  const template: ApprovedConfigurationTemplate = {
    id: 'battery-with-client-inverter',
    familyKey: 'battery-client-inverter',
    name: 'Magazyn z falownikiem klienta',
    version: 1,
    isActive: true,
    kind: 'MAGAZYN',
    clientType: 'B2C',
    roofType: null,
    powerKw: 8,
    capacityKwh: 16,
    requiresExistingPv: true,
    requiresExistingInverter: true,
    items: [
      {
        id: 'battery-line',
        position: 1,
        quantity: 1,
        role: 'BATTERY',
        supplyMode: 'ONREVOLT_SUPPLIED',
        description: 'Magazyn 16 kWh',
        productId: 'battery-16',
        product: {
          sku: 'BAT-16',
          name: 'Magazyn 16 kWh',
          prices: [{ purchaseNet: 10000, purchaseVatRate: 0.23 }],
        },
        operatingCostNet: 0,
        marginRate: 0.2,
        saleVatRate: 0.08,
        isOptional: false,
        requiresReview: false,
      },
      {
        id: 'client-inverter-line',
        position: 2,
        quantity: 1,
        role: 'INVERTER',
        supplyMode: 'CLIENT_OWNED_USED',
        description: 'Istniejący falownik klienta',
        productId: 'client-inverter',
        product: null,
        saleVatRate: 0.08,
        isOptional: false,
        requiresReview: false,
      },
    ],
  };
  const enumerationInput: OfferCandidateEnumerationInput = {
    approvedConfigurationTemplates: [template],
    clientType: 'B2C',
    roofType: 'UNKNOWN',
    pvStrategy: 'KEEP_EXISTING',
    existingPv: { powerKw: 9.9, tiltDegrees: 40, azimuthDegrees: 170 },
    addedPvGeometry: null,
    existingPvCompatibilityEvidence: 'yes',
    existingInverterCompatibilityEvidence: 'yes',
    saleVatMode: 'MIXED',
  };
  const snapshot = enumerateOfferCandidates(enumerationInput).candidates[0];
  assert.ok(snapshot);
  const inverter = snapshot.items.find((item) => item.role === 'INVERTER');
  assert.ok(inverter);
  assert.equal(inverter.supplyMode, 'CLIENT_OWNED_USED');
  assert.equal(inverter.resolvedCosts, null);
  assert.equal(inverter.missingPriceReason, null);
  assert.equal(inverter.calculation?.saleGross, 0);

  const investmentGross = snapshot.totals!.saleGross;
  const result = calculateOfferEconomics(inputFor([candidateInput(snapshot.id, [5000, 5000, 5000], {
    investmentGross,
    snapshot,
  })]));
  assert.equal(result.candidateAssessments[0].eligibilityStatus, 'eligible');
  assert.ok(result.candidateAssessments[0].comparisons);

  const nonzeroOwnedLine: OfferCandidateSnapshot = {
    ...snapshot,
    items: snapshot.items.map((item) => item.role === 'INVERTER'
      ? { ...item, calculation: { ...item.calculation!, saleGross: 1 } }
      : item),
  };
  const rejected = calculateOfferEconomics(inputFor([candidateInput('nonzero-owned-inverter', [5000, 5000, 5000], {
    investmentGross,
    snapshot: nonzeroOwnedLine,
  })]));
  assert.equal(rejected.candidateAssessments[0].eligibilityStatus, 'not-eligible');
  assert.match(rejected.candidateAssessments[0].exclusionReasons.join(' '), /zerową kalkulacją/);
});

test('rankuje precyzyjny czas zwrotu, nawet gdy wyświetlana liczba lat jest taka sama', () => {
  const slower = candidateInput('slower', [4300, 4300, 4300]);
  const faster = candidateInput('faster', [4500, 4500, 4500]);
  const result = calculateOfferEconomics(inputFor([slower, faster]));

  assert.equal(result.rankedCandidates[0].id, 'faster');
  assert.equal(result.rankedCandidates[0].paybackYearsPrecise, 2.4);
  assert.equal(result.rankedCandidates[0].paybackYearsDisplayFloor, 2);
  assert.equal(result.rankedCandidates[1].paybackYearsDisplayFloor, 2);
});

test('ujemny rok przepływu jest zachowany i nie tworzy fałszywego odzyskania nakładu', () => {
  const result = calculateOfferEconomics(inputFor([candidateInput('negative-year', [6000, -1000, 1000]) ]));
  const comparison = result.candidateAssessments[0].comparisons!.ZERO_INVESTMENT;

  assert.deepEqual(comparison.annualIncrementalCashflowsGross, [6000, -1000, 1000]);
  assert.equal(comparison.paybackYearsPrecise, null);
  assert.equal(result.recommendedCandidateId, null);
});

test('brak zwrotu w horyzoncie i wyłącznie niedodatnie przepływy dają null', () => {
  const result = calculateOfferEconomics(inputFor([
    candidateInput('too-slow', [2000, 2000, 2000]),
    candidateInput('negative', [-100, 0, -50]),
  ]));

  assert.deepEqual(result.rankedCandidates.map((candidate) => candidate.paybackYearsPrecise), [null, null]);
  assert.equal(result.recommendedCandidateId, null);
});

test('zero nakładu oraz zerowe przepływy są obsługiwane bez dzielenia przez zero', () => {
  const zeroInvestment = candidateInput('free', [0, 0, 0], {
    investmentGross: 0,
    snapshot: candidateSnapshot('free', 0),
  });
  const result = calculateOfferEconomics(inputFor([zeroInvestment]));
  const comparison = result.candidateAssessments[0].comparisons!.ZERO_INVESTMENT;

  assert.equal(comparison.paybackYearsPrecise, 0);
  assert.equal(comparison.paybackYearsDisplayFloor, 0);
  assert.equal(comparison.longTermNetBenefitGross, 0);
  assert.equal(comparison.netPresentValueGross, 0);
});

test('równe wyniki mają deterministyczny tie-break po stabilnym ID', () => {
  const result = calculateOfferEconomics(inputFor([
    candidateInput('zeta', [5000, 5000, 5000]),
    candidateInput('alpha', [5000, 5000, 5000]),
  ]));

  assert.deepEqual(result.rankedCandidates.map((candidate) => candidate.id), ['alpha', 'zeta']);
});

test('waliduje horyzont, stopę, długość szeregów, NaN, wartości ujemne i daty dowodów', () => {
  const validCandidate = candidateInput('valid', [5000, 5000, 5000]);

  assert.throws(() => calculateOfferEconomics(inputFor([validCandidate], { horizonYears: 0 })), /Horyzont/);
  assert.throws(() => calculateOfferEconomics(inputFor([validCandidate], { annualDiscountRate: Number.NaN })), /skończoną/);
  assert.throws(() => calculateOfferEconomics(inputFor([candidateInput('short', [5000])])), /dokładnie 3/);
  assert.throws(() => calculateOfferEconomics(inputFor([candidateInput('nan', [5000, Number.NaN, 5000])])), /skończony/);
  assert.throws(() => calculateOfferEconomics(inputFor([candidateInput('negative-cost', [1, 1, 1], {
    investmentGross: -1,
    snapshot: candidateSnapshot('negative-cost', -1),
  })])), /nieujemną/);
  assert.throws(() => calculateOfferEconomics(inputFor([candidateInput('negative-rate', [1, 1, 1])], {
    annualDiscountRate: -0.01,
  })), /nieujemną/);

  const invalidProofCandidate = candidateInput('bad-date', [1, 1, 1]);
  invalidProofCandidate.cashflowProvenance.verifiedAt = '2026-02-31';
  assert.equal(
    calculateOfferEconomics(inputFor([invalidProofCandidate])).candidateAssessments[0].eligibilityStatus,
    'not-eligible',
  );
});

test('weryfikuje unikalność i terminy potwierdzonych redukcji', () => {
  const duplicate = [
    reduction('same', 100, 1, 'end-of-year'),
    reduction('same', 100, 2, 'end-of-year'),
  ];
  assert.throws(() => calculateOfferEconomics(inputFor([candidateInput('duplicate', [1, 1, 1], {
    confirmedFinancingReductions: duplicate,
  })])), /unikalne/);
  assert.throws(() => calculateOfferEconomics(inputFor([candidateInput('outside-horizon', [1, 1, 1], {
    confirmedFinancingReductions: [reduction('late', 100, 4, 'start-of-year')],
  })])), /zakresie 1-3/);
  assert.throws(() => calculateOfferEconomics(inputFor([candidateInput('negative-grant', [1, 1, 1], {
    confirmedFinancingReductions: [reduction('negative', -1, 1, 'end-of-year')],
  })])), /nieujemną/);
});
