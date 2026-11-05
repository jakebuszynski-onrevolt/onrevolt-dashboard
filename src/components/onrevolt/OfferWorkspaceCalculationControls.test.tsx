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
} from 'lib/onrevolt/offer-workspace';
import type { OfferWorkspaceCalculation } from 'lib/onrevolt/offer-workspace-calculation-types';

function renderControls(calculation: OfferWorkspaceCalculation | null, calculationDisabled = false, clientType = 'B2C'): string {
  const draft = emptyOfferWorkspaceDraft();
  draft.calculation = {
    ...defaultOfferCalculationAssumptions(),
    billingCycleStartMonth: '2025-03',
    initialCreditKwh: 1.25,
    initialCreditLots: [{ kwh: 1.25, creditedMonth: '2025-01', expiresMonth: '2026-02' }],
    initialDepositPln: 25,
    initialDepositLots: [{ amountPln: 25, creditedMonth: '2025-02', expiresMonth: '2026-02', refundCapPln: 7.5 }],
  };
  return renderToStaticMarkup(createElement(ChakraProvider, null, createElement(OfferWorkspaceCalculationControls, {
    draft,
    clientType,
    disabled: false,
    calculationDisabled,
    calculation,
    calculationLoading: false,
    calculationMode: null,
    calculationProgress: null,
    calculationIsStale: false,
    calculationError: '',
    onChange: () => undefined,
    onCalculate: () => undefined,
    onSelectRanking: () => undefined,
  })));
}

test('kontrolki pokazują miesięczną kotwicę i jawne daty obu typów sald', () => {
  const markup = renderControls(null);

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

test('zgody na dodatkowe założenia są jawne, domyślnie wyłączone i ulga dotyczy tylko B2C', () => {
  const b2cMarkup = renderControls(null);
  const b2bMarkup = renderControls(null, false, 'B2B');

  const pvConsent = b2cMarkup.match(/<input[^>]*aria-label="Prognoza PV oparta na pomiarach ENEA i modelowanej autokonsumpcji"[^>]*>/)?.[0];
  const taxConsent = b2cMarkup.match(/<input[^>]*aria-label="Szacunkowa ulga 12%: pełny limit 53 000 zł i wystarczający dochód"[^>]*>/)?.[0];
  assert.ok(pvConsent);
  assert.ok(taxConsent);
  assert.doesNotMatch(pvConsent || '', /checked=""/);
  assert.doesNotMatch(taxConsent || '', /checked=""/);
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

test('ranking pokazuje lata zwrotu zaokrąglone w dół', () => {
  const calculation: OfferWorkspaceCalculation = {
    status: 'ready', reasons: [], warnings: [], recommendationEligible: true,
    baselineAnnualCostPln: 1000, proposedAnnualCostPln: 500, annualSavingsPln: 500,
    systemCostPln: 2000, costAfterFinancingPln: 2000, paybackYears: 1.99,
    grantPln: 0, taxReliefPln: 0,
    rankings: [{ templateIds: ['battery'], name: 'Magazyn', annualSavingsPln: 500, costAfterFinancingPln: 2000, paybackYears: 1.99, recommendationEligible: true }],
    recommendedTemplateIds: null,
  };
  const markup = renderControls(calculation);

  assert.match(markup, /zwrot 1 lat/);
  assert.doesNotMatch(markup, /zwrot 2 lat|zwrot 1,99 lat/);
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
  assert.match(markup, /Wybierz zwycięski wariant/);
  assert.match(markup, /porównanie częściowe/);
  assert.match(markup, /szacunkowy zwrot 1 lat/);
  assert.match(markup, /Dokładny szacunek: 1,85 lat/);
  assert.match(markup, /Korzyść sprzętu przy tej samej taryfie: — zł\/rok · szacunkowo po finansowaniu —/);
  assert.doesNotMatch(markup, /· rekomendowana|po finansowaniu 0,00 zł/);
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
