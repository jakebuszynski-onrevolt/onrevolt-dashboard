import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import OfferWorkspaceCalculationControls from './OfferWorkspaceCalculationControls';
import { offerWorkspaceCalculationInputKey, offerWorkspaceCalculationPreflightError } from './OfferWorkspacePanel';
import {
  defaultOfferCalculationAssumptions,
  emptyOfferWorkspaceDraft,
  offerWorkspaceDraftWithCalculationValue,
  type OfferWorkspaceDraft,
} from 'lib/onrevolt/offer-workspace';
import type { OfferWorkspaceCalculation } from 'lib/onrevolt/offer-workspace-calculation-types';

function renderControls(calculation: OfferWorkspaceCalculation | null, calculationDisabled = false, clientType = 'B2C', options: {
  loading?: boolean;
  stale?: boolean;
  error?: string;
  draft?: OfferWorkspaceDraft;
} = {}): string {
  const draft = options.draft ? { ...options.draft } : emptyOfferWorkspaceDraft();
  if (!options.draft) {
    draft.saleVatMode = 'STANDARD_23';
    draft.currentSettlement = 'NET_BILLING';
    draft.targetSettlement = 'NET_BILLING';
  }
  draft.calculation = {
    ...defaultOfferCalculationAssumptions(),
    billingCycleStartMonth: '2025-03',
    initialCreditKwh: 1.25,
    initialCreditLots: [{ kwh: 1.25, creditedMonth: '2025-01', expiresMonth: '2026-02' }],
    initialDepositPln: 25,
    initialDepositLots: [{ amountPln: 25, creditedMonth: '2025-02', expiresMonth: '2026-02', refundCapPln: 7.5 }],
    ...(options.draft?.calculation || {}),
  };
  return renderToStaticMarkup(createElement(ChakraProvider, null, createElement(OfferWorkspaceCalculationControls, {
    draft,
    clientType,
    disabled: false,
    calculationDisabled,
    calculation,
    calculationLoading: options.loading ?? false,
    calculationMode: options.loading ? 'recommend' : null,
    calculationProgress: null,
    calculationIsStale: options.stale ?? false,
    calculationError: options.error ?? '',
    onChange: () => undefined,
    onCalculate: () => undefined,
    onSelectRanking: () => undefined,
  })));
}

test('kontrolki pokazują miesięczną kotwicę i jawne daty obu typów sald', () => {
  const markup = renderControls(null);

  assert.match(markup, /placeholder="2 \(domyślnie\)"/);
  assert.match(markup, /aria-label="Początek cyklu rozliczeniowego \[YYYY-MM\]"/);
  assert.match(markup, /stan na początek pierwszego miesiąca danych pomiarowych, nie saldo na dziś/);
  assert.match(markup, /aria-label="Saldo opustu transzy 1 \[kWh\]"/);
  assert.match(markup, /aria-label="Saldo depozytu transzy 1 \[zł\]"/);
  assert.match(markup, /aria-label="Miesiąc uznania transzy energii 1"/);
  assert.match(markup, /aria-label="Miesiąc wygaśnięcia transzy energii 1"/);
  assert.match(markup, /aria-label="Miesiąc uznania transzy depozytu 1"/);
  assert.match(markup, /aria-label="Miesiąc wygaśnięcia transzy depozytu 1"/);
  assert.match(markup, /aria-label="Limit zwrotu transzy depozytu 1 \[zł\]"/);
  assert.match(markup, /type="month"/);
  assert.match(markup, /max="2026-02"/);
  assert.match(markup, /Dodaj transzę/);
});

test('zgoda na model PV pozostaje jawna, a ulga nie wymaga zgody na szacunek', () => {
  const b2cMarkup = renderControls(null);
  const b2bMarkup = renderControls(null, false, 'B2B');

  const pvConsent = b2cMarkup.match(/<input[^>]*aria-label="Prognoza PV oparta na pomiarach ENEA i modelowanej autokonsumpcji"[^>]*>/)?.[0];
  assert.ok(pvConsent);
  assert.doesNotMatch(pvConsent || '', /checked=""/);
  assert.doesNotMatch(b2cMarkup, /aria-label="Szacunkowa ulga/);
  assert.doesNotMatch(b2bMarkup, /Szacunkowa ulga 12%: pełny limit 53 000 zł i wystarczający dochód/);
});

test('calculationDisabled blokuje tylko obliczenia, pozostawiając pola edytowalne', () => {
  const markup = renderControls(null, true);
  const cycleStartInput = markup.match(/<input[^>]*aria-label="Początek cyklu rozliczeniowego \[YYYY-MM\]"[^>]*>/)?.[0];

  assert.match(markup, /<button[^>]*disabled=""[^>]*>/);
  assert.ok(cycleStartInput);
  assert.doesNotMatch(cycleStartInput || '', /\sdisabled(?:="")?/);
});

test('uwagi są domyślnie zwinięte, zachowują pełną treść i nie ukrywają blokady wyniku', () => {
  const markup = renderControls({
    status: 'blocked', reasons: ['Brak wymaganej taryfy.'],
    warnings: ['Pierwsze założenie.', 'Drugie założenie.'], recommendationEligible: false,
    baselineAnnualCostPln: null, proposedAnnualCostPln: null, annualSavingsPln: null,
    systemCostPln: null, costAfterFinancingPln: null, paybackYears: null,
    grantPln: null, taxReliefPln: null, rankings: [], recommendedTemplateIds: null,
  });
  const details = markup.match(/<details[^>]*data-testid="calculation-warnings"[^>]*>[\s\S]*?<\/details>/)?.[0];
  assert.ok(details);
  assert.doesNotMatch(details.split('>')[0], /\sopen(?:[\s=>])/);
  assert.match(details, /<summary[^>]*>/);
  assert.match(details, /Uwagi i założenia do wyniku \(2\)/);
  assert.match(details, /Pierwsze założenie\./);
  assert.match(details, /Drugie założenie\./);
  assert.match(markup, /Brak wymaganej taryfy\./);
  assert.doesNotMatch(details, /Brak wymaganej taryfy\./);
  assert.doesNotMatch(renderControls(null), /data-testid="calculation-warnings"/);
});

test('ranking pokazuje lata zwrotu z dokładnością do jednego miejsca po przecinku', () => {
  const calculation: OfferWorkspaceCalculation = {
    status: 'ready', reasons: [], warnings: [], recommendationEligible: true,
    baselineAnnualCostPln: 1000, proposedAnnualCostPln: 500, annualSavingsPln: 500,
    systemCostPln: 2000, costAfterFinancingPln: 2000, paybackYears: 1.99,
    grantPln: 0, taxReliefPln: 0,
    rankings: [{ templateIds: ['battery'], name: 'Magazyn', annualSavingsPln: 500, costAfterFinancingPln: 2000, paybackYears: 1.99, recommendationEligible: true }],
    recommendedTemplateIds: null,
  };
  const markup = renderControls(calculation);

  assert.match(markup, /zwrot 2 lat/);
  assert.doesNotMatch(markup, /zwrot 1 lat|zwrot 1,99 lat/);
});

test('rekomendacja pokazuje wyliczony zakres baterii i liczbę pominiętych konfiguracji, bez nieaktualnych metadanych', () => {
  const calculation: OfferWorkspaceCalculation = {
    status: 'blocked', reasons: ['Brak gotowych konfiguracji w zakresie.'], warnings: [], recommendationEligible: false,
    baselineAnnualCostPln: null, proposedAnnualCostPln: null, annualSavingsPln: null,
    systemCostPln: null, costAfterFinancingPln: null, paybackYears: null,
    grantPln: null, taxReliefPln: null, rankings: [], recommendedTemplateIds: null,
    recommendationBatteryBounds: {
      basis: 'daily_consumption',
      averageDailyConsumptionKwh: 51.5953774858,
      totalConsumptionKwh: 18_832.309782317,
      dayCount: 365,
      minimumDailyConsumptionMultiplier: 0.5,
      maximumDailyConsumptionMultiplier: 2,
      minimumBatteryCapacityKwh: 25.7976887429,
      maximumBatteryCapacityKwh: 103.190754972,
      totalCandidatesBeforeFilter: 19,
      excludedCandidates: 3,
    },
    recommendationPvBounds: {
      maximumBatteryKwhPerPvKwp: 2.5,
      pvBasis: 'existing_plus_added',
      totalCandidatesBeforeFilter: 16,
      excludedCandidates: 1,
    },
  };
  const markup = renderControls(calculation);

  assert.match(markup, /data-testid="recommendation-battery-bounds"/);
  assert.match(markup, /Średnie zużycie: 51,6 kWh\/dobę · Magazyn: 25,8–103,2 kWh \(0,5–2× dobowe zużycie\)\. Maksymalnie 2,5 kWh magazynu na 1 kWp łącznej mocy PV \(istniejąca \+ dodawana\)\. Tylko gotowe konfiguracje\./);
  assert.match(markup, /Pominięto: 3 poza zakresem magazynu; 1 poza zakresem produkcji PV\./);
  assert.doesNotMatch(renderControls(calculation, false, 'B2C', { stale: true }), /recommendation-battery-bounds/);

  const keepCalculation = {
    ...calculation,
    recommendationBatteryBounds: {
      basis: 'existing_pv' as const,
      existingPvPowerKw: 9.9,
      minimumBatteryKwhPerPvKwp: 0.5 as const,
      maximumBatteryKwhPerPvKwp: 5 as const,
      minimumBatteryCapacityKwh: 4.95,
      maximumBatteryCapacityKwh: 49.5,
      totalCandidatesBeforeFilter: 19,
      excludedCandidates: 16,
    },
    recommendationPvBounds: undefined,
  };
  const keepMarkup = renderControls(keepCalculation);
  assert.match(keepMarkup, /Magazyn: 5–49,5 kWh \(0,5–5× istniejąca moc PV: 9,9 kWp\)\./);
  assert.match(keepMarkup, /Pominięto: 16 poza zakresem istniejącej PV\./);
  assert.doesNotMatch(keepMarkup, /Średnie zużycie|dobowe zużycie|2,5 kWh|dodawana/);

  const selectedCalculation = { ...calculation, recommendationBatteryBounds: undefined };
  assert.doesNotMatch(renderControls(selectedCalculation), /recommendation-battery-bounds/);
});

test('szacowany ranking nie udaje rekomendacji i nie zamienia brakujących kwot w zero', () => {
  const calculation = {
    status: 'ready' as const, reasons: [], warnings: [], recommendationEligible: false,
    baselineAnnualCostPln: null, proposedAnnualCostPln: null, annualSavingsPln: null,
    systemCostPln: null, costAfterFinancingPln: null, paybackYears: null,
    estimatedPaybackYears: 1.85, estimatedRecommendedTemplateIds: ['battery'],
    grantPln: null, taxReliefPln: null,
    rankings: [{ templateIds: ['battery'], name: 'Magazyn', annualSavingsPln: null,
      costAfterFinancingPln: null, paybackYears: 4, estimatedPaybackYears: 1.85, recommendationEligible: false }],
    recommendedTemplateIds: ['battery'],
  } as OfferWorkspaceCalculation;
  const markup = renderControls(calculation);

  assert.match(markup, /Najkrótszy szacunkowy zwrot/);
  assert.match(markup, /Wybierz szacunkowy wariant/);
  assert.match(markup, /porównanie częściowe/);
  assert.match(markup, /szacunkowy zwrot 1,9 lat/);
  assert.match(markup, /Dokładny szacunek: 1,85 lat/);
  assert.match(markup, /Korzyść sprzętu przy tej samej taryfie: — zł\/rok · szacunkowo po finansowaniu —/);
  assert.doesNotMatch(markup, /· rekomendowana|po finansowaniu 0,00 zł/);
});

test('częściowy ranking pokazuje licznik, znaleziony wariant i kontynuację bez deklaracji pełnego optimum', () => {
  const calculation: OfferWorkspaceCalculation = {
    status: 'ready', reasons: [], warnings: [], recommendationEligible: true,
    baselineAnnualCostPln: 1000, proposedAnnualCostPln: 500, annualSavingsPln: 500,
    systemCostPln: 2000, costAfterFinancingPln: 2000, paybackYears: 2, grantPln: 0, taxReliefPln: 0,
    rankings: [{ templateIds: ['battery'], name: 'Magazyn', annualSavingsPln: 500,
      costAfterFinancingPln: 2000, paybackYears: 2, recommendationEligible: true }],
    recommendedTemplateIds: ['battery'],
    recommendationSearch: {
      version: 1, candidateSignature: 'f'.repeat(64), evaluatedCandidateIds: ['candidate-1', 'candidate-2'],
      totalCandidates: 40, evaluatedCandidates: 2, batchNumber: 1, batchEvaluated: 2,
      hasMore: true, phase: 'coarse',
    },
  };
  const markup = renderControls(calculation);
  assert.match(markup, /Sprawdzono 2 z 40 konfiguracji/);
  assert.match(markup, /Najlepszy znaleziony wariant/);
  assert.match(markup, />Szukaj dalej</);
  assert.match(markup, /Magazyn · najlepszy znaleziony wariant/);
  assert.doesNotMatch(markup, /Magazyn · rekomendowana/);

  const running = renderControls(calculation, false, 'B2C', { loading: true, error: 'Poprzednia próba zawiodła.' });
  assert.match(running, /Trwa dalsze szukanie. Poprzedni wynik pozostaje widoczny./);
  assert.match(running, /Poprzednia próba zawiodła\./);
  assert.match(running, /Sprawdzono 2 z 40 konfiguracji/);

  const stale = renderControls(calculation, false, 'B2C', { stale: true });
  const continuationButton = stale.match(/<button[^>]*>Szukaj dalej<\/button>/)?.[0];
  assert.ok(continuationButton);
  assert.match(continuationButton || '', /disabled=""/);
});

test('pełne i zablokowane częściowe wyszukiwanie pokazują właściwy stan i kontynuację', () => {
  const base: OfferWorkspaceCalculation = {
    status: 'blocked', reasons: ['Brak porównywalnych danych.'], warnings: [],
    baselineAnnualCostPln: null, proposedAnnualCostPln: null, annualSavingsPln: null,
    systemCostPln: null, costAfterFinancingPln: null, paybackYears: null, grantPln: null, taxReliefPln: null,
    rankings: [], recommendedTemplateIds: null,
    recommendationSearch: {
      version: 1, candidateSignature: 'f'.repeat(64), evaluatedCandidateIds: [],
      totalCandidates: 12, evaluatedCandidates: 0, batchNumber: 1, batchEvaluated: 0,
      hasMore: true, phase: 'coarse',
    },
  };
  const partial = renderControls(base);
  assert.match(partial, /Brak porównywalnego wariantu w tej partii/);
  assert.match(partial, /Sprawdzono 0 z 12 konfiguracji/);
  assert.match(partial, />Szukaj dalej</);

  const exhausted = renderControls({
    ...base,
    recommendationSearch: { ...base.recommendationSearch!, evaluatedCandidateIds: Array.from({ length: 12 }, (_, index) => `candidate-${index + 1}`), evaluatedCandidates: 12, batchNumber: 4, hasMore: false, phase: 'complete' },
  });
  assert.match(exhausted, /Sprawdzono wszystkie 12 konfiguracji/);
  assert.doesNotMatch(exhausted, />Szukaj dalej</);

  const three = renderControls({
    ...base,
    recommendationSearch: { ...base.recommendationSearch!, totalCandidates: 3, evaluatedCandidateIds: ['a', 'b', 'c'], evaluatedCandidates: 3, hasMore: false, phase: 'complete' },
  });
  assert.match(three, /Sprawdzono wszystkie 3 konfiguracje/);
});

test('globalne przeszkody blokują rekomendację, chowają stary ranking i warningi, ale nie blokują wybranej diagnostyki', () => {
  const invalidDraft = emptyOfferWorkspaceDraft();
  invalidDraft.pvStrategy = 'ADD_TEMPLATE';
  invalidDraft.currentSettlement = 'NET_BILLING';
  invalidDraft.targetSettlement = 'NET_METERING';
  const staleRecommendation: OfferWorkspaceCalculation = {
    status: 'blocked', reasons: ['Brak danych wejściowych.'],
    warnings: Array.from({ length: 225 }, (_, index) => `Ostrzeżenie ${index + 1}.`),
    baselineAnnualCostPln: null, proposedAnnualCostPln: null, annualSavingsPln: null,
    systemCostPln: null, costAfterFinancingPln: null, paybackYears: null,
    grantPln: null, taxReliefPln: null, rankings: [], recommendedTemplateIds: null,
    recommendationSearch: {
      version: 1, candidateSignature: 'f'.repeat(64), evaluatedCandidateIds: Array.from({ length: 50 }, (_, index) => `candidate-${index + 1}`),
      totalCandidates: 225, evaluatedCandidates: 50, batchNumber: 1, batchEvaluated: 50,
      hasMore: true, phase: 'coarse',
    },
  };

  const recommendationMarkup = renderControls(staleRecommendation, false, 'B2C', { draft: invalidDraft });
  const recommendButton = recommendationMarkup.match(/<button[^>]*>[\s\S]*?Rekomenduj konfigurację[\s\S]*?<\/button>/)?.[0];
  const selectedButton = recommendationMarkup.match(/<button[^>]*>[\s\S]*?Oblicz wybrany wariant[\s\S]*?<\/button>/)?.[0];
  assert.match(recommendationMarkup, /VAT sprzedaży/);
  assert.match(recommendationMarkup, /nachylenie dodatkowej PV, azymut dodatkowej PV, straty modelu PV/);
  assert.match(recommendationMarkup, /net-metering nie jest jeszcze dostępne/);
  assert.match(recommendButton || '', /disabled=""/);
  assert.doesNotMatch(selectedButton || '', /disabled=""/);
  assert.doesNotMatch(recommendationMarkup, /recommendation-search-status|calculation-warnings|Sprawdzono 50 z 225|Ostrzeżenie 225/);
  assert.doesNotMatch(recommendationMarkup, />Szukaj dalej</);

  const selectedCalculation: OfferWorkspaceCalculation = {
    ...staleRecommendation,
    warnings: ['Diagnostyka wybranego zestawu.'],
    recommendationSearch: undefined,
  };
  const selectedMarkup = renderControls(selectedCalculation, false, 'B2C', { draft: invalidDraft });
  assert.match(selectedMarkup, /Diagnostyka wybranego zestawu\./);
  assert.match(selectedMarkup, /Nie można przygotować pełnego wyniku/);
  assert.doesNotMatch(selectedMarkup, /recommendation-search-status/);
});

test('brak docelowego sposobu rozliczeń pokazuje konkretną przeszkodę i blokuje tylko rekomendację', () => {
  const incompleteDraft = emptyOfferWorkspaceDraft();
  incompleteDraft.saleVatMode = 'STANDARD_23';
  incompleteDraft.currentSettlement = 'NET_BILLING';
  const markup = renderControls(null, false, 'B2C', { draft: incompleteDraft });
  const recommendButton = markup.match(/<button[^>]*>[\s\S]*?Rekomenduj konfigurację[\s\S]*?<\/button>/)?.[0];
  const selectedButton = markup.match(/<button[^>]*>[\s\S]*?Oblicz wybrany wariant[\s\S]*?<\/button>/)?.[0];

  assert.match(markup, /docelowy sposób rozliczeń/);
  assert.match(markup, /Docelowe rozliczenie wybierz w kroku System rozliczeń/);
  assert.doesNotMatch(markup, /obecny sposób rozliczeń/);
  assert.match(recommendButton || '', /disabled=""/);
  assert.doesNotMatch(selectedButton || '', /disabled=""/);
});

test('datowane luki cenowe mają krótkie podsumowanie i rozwijane komunikaty', () => {
  const calculation: OfferWorkspaceCalculation = {
    status: 'blocked', reasons: ['Brak pełnego profilu.'],
    warnings: [
      'Brak ceny taryfy dla 2026-01-01.',
      'Brak ceny taryfy dla 2026-01-02.',
      'Sprawdź model techniczny zestawu.',
    ],
    baselineAnnualCostPln: null, proposedAnnualCostPln: null, annualSavingsPln: null,
    systemCostPln: null, costAfterFinancingPln: null, paybackYears: null,
    grantPln: null, taxReliefPln: null, rankings: [], recommendedTemplateIds: null,
  };
  const markup = renderControls(calculation);

  assert.match(markup, /Luki cenowe wymagają weryfikacji\. Liczba dat: 2/);
  assert.match(markup, /Szczegóły dat \(2\)/);
  assert.match(markup, /Brak ceny taryfy dla 2026-01-01/);
  assert.match(markup, /Brak ceny taryfy dla 2026-01-02/);
  assert.match(markup, /Sprawdź model techniczny zestawu/);
});

test('wyczyszczenie wymaganego salda zapisuje null i unieważnia poprzednią kalkulację', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.targetOperatorId = 1;
  draft.targetTariffId = 27;
  draft.calculation = {
    ...defaultOfferCalculationAssumptions(),
    initialCreditKwh: 0,
    initialDepositPln: 0,
  };
  const previousKey = offerWorkspaceCalculationInputKey(draft);

  const cleared = offerWorkspaceDraftWithCalculationValue(draft, 'initialCreditKwh', null);

  assert.equal(draft.calculation.initialCreditKwh, 0);
  assert.equal(cleared.calculation?.initialCreditKwh, null);
  assert.notEqual(offerWorkspaceCalculationInputKey(cleared), previousKey);
  assert.equal(offerWorkspaceCalculationPreflightError(cleared), null);
});

test('brakujące dane ulgi są czerwone tylko w opcjonalnym trybie dokładnym', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.financing.considerTaxRelief = true;
  const simple = renderControls(null, false, 'B2C', { draft });
  assert.doesNotMatch(simple, /Uzupełnij wymagane pola/);
  assert.doesNotMatch(simple, /aria-label="Podstawa opodatkowania/);
  assert.match(simple, /Ulga szacunkowa 12%/);
  draft.calculation = { ...defaultOfferCalculationAssumptions(), taxDetailedCalculation: true };
  const html = renderControls(null, false, 'B2C', { draft });
  assert.match(html, /Uzupełnij wymagane pola \(3\)/);
  const input = html.match(/<input[^>]*aria-label="Podstawa opodatkowania przed ulgą \[zł\]"[^>]*>/)?.[0];
  assert.match(input || '', /aria-invalid="true"/);
  assert.match(html, /<select[^>]*aria-label="Stawka podatku w symulacji \[%\]"/);
  assert.match(html, /12% — domyślnie w symulacji/);
  draft.calculation = { ...defaultOfferCalculationAssumptions(), taxDetailedCalculation: false, taxRatePercent: 19 };
  const estimated = renderControls(null, false, 'B2C', { draft });
  assert.doesNotMatch(estimated, /Uzupełnij wymagane pola/);
  assert.match(estimated, /Ulga szacunkowa 19%/);
  assert.doesNotMatch(renderControls(null, false, 'B2B', { draft }), /Uzupełnij wymagane pola/);
});

test('geometria dodatkowej PV jest wymagana tylko przy dodawaniu PV; zero jest poprawne', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.financing.considerTaxRelief = false;
  draft.pvStrategy = 'ADD_TEMPLATE';
  assert.match(renderControls(null, false, 'B2C', { draft }), /Uzupełnij wymagane pola \(2\)/);
  draft.calculation = { ...defaultOfferCalculationAssumptions(), addedPvTiltDegrees: 0, addedPvAzimuthDegrees: 0, taxRatePercent: 0 };
  const html = renderControls(null, false, 'B2C', { draft });
  assert.doesNotMatch(html, /Uzupełnij wymagane pola/);
  assert.match(html, /0% — zapisana stawka/);
});
