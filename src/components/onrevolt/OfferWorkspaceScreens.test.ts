import assert from 'node:assert/strict';
import test from 'node:test';
import { offerSavingsFinancialRows, offerSystemExpandedPanels, offerWorkspaceCalculationPresentation } from './OfferWorkspaceScreens';
import type { OfferBillingMonthResult } from 'lib/onrevolt/offer-workspace-billing';
import type { OfferWorkspaceCalculation } from 'lib/onrevolt/offer-workspace-calculation-types';
import type { OfferTariffRateState } from 'lib/onrevolt/offer-workspace-tariffs';

const readyRates: OfferTariffRateState = { status: 'ready', tariff: {} as Extract<OfferTariffRateState, { status: 'ready' }>['tariff'] };
const loadingRates: OfferTariffRateState = { status: 'loading' };
const unavailableRates: OfferTariffRateState = { status: 'unavailable', message: 'Brak taryfy.' };

test('stawki są domyślnie zwinięte przy obu wczytanych taryfach', () => {
  assert.deepEqual(offerSystemExpandedPanels(readyRates, readyRates, null), [0]);
});

test('stawki pozostają rozwinięte, gdy którejkolwiek taryfy brakuje', () => {
  for (const missing of [loadingRates, unavailableRates]) {
    assert.deepEqual(offerSystemExpandedPanels(missing, readyRates, null), [0, 1]);
    assert.deepEqual(offerSystemExpandedPanels(readyRates, missing, null), [0, 1]);
  }
});

test('asynchroniczne wczytanie obu taryf zwija stawki bez zmiany pozostałych sekcji', () => {
  assert.deepEqual(offerSystemExpandedPanels(loadingRates, loadingRates, null), [0, 1]);
  assert.deepEqual(offerSystemExpandedPanels(readyRates, loadingRates, null), [0, 1]);
  assert.deepEqual(offerSystemExpandedPanels(readyRates, readyRates, null), [0]);
});

test('ręczny wybór sekcji jest zachowany również po ponownym wczytaniu taryf', () => {
  for (const userExpanded of [[0, 1], [0, 1, 2], [], [1, 2]]) {
    assert.equal(offerSystemExpandedPanels(readyRates, readyRates, userExpanded), userExpanded);
    assert.equal(offerSystemExpandedPanels(loadingRates, readyRates, userExpanded), userExpanded);
    assert.equal(offerSystemExpandedPanels(readyRates, readyRates, userExpanded), userExpanded);
  }
});

test('tabela finansowa zestawia zwrócone rachunki miesięczne bez ponownego sumowania', () => {
  const baselineJanuary = { month: '2026-01', cashDuePln: 125 } as OfferBillingMonthResult;
  const baselineFebruary = { month: '2026-02', cashDuePln: 118 } as OfferBillingMonthResult;
  const proposedJanuary = { month: '2026-01', cashDuePln: 64 } as OfferBillingMonthResult;
  const calculation = {
    status: 'ready',
    baselineBill: { months: [baselineJanuary, baselineFebruary] },
    proposedBill: { months: [proposedJanuary] },
  } as unknown as OfferWorkspaceCalculation;

  const rows = offerSavingsFinancialRows(calculation);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].baseline, baselineJanuary);
  assert.equal(rows[0].proposed, proposedJanuary);
  assert.equal(rows[1].baseline, baselineFebruary);
  assert.equal(rows[1].proposed, null);
});

test('tabela finansowa nie pokazuje niepełnego ani zablokowanego wyniku', () => {
  assert.deepEqual(offerSavingsFinancialRows(null), []);
  assert.deepEqual(offerSavingsFinancialRows({ status: 'blocked' } as OfferWorkspaceCalculation), []);
});

test('rozbicie używa wartości serwera i ukrywa payback przy braku kwalifikacji', () => {
  const calculation = {
    status: 'ready',
    annualSavingsPln: 800,
    tariffOnlyAnnualSavingsPln: 250,
    hardwareAnnualSavingsPln: 550,
    tariffOnlyAnnualCostPln: 12500,
    paybackYears: 3.2,
    recommendationEligible: false,
    recommendationReasons: ['Brak odpowiedniego wariantu sprzętu.'],
  } as unknown as OfferWorkspaceCalculation;

  assert.deepEqual(offerWorkspaceCalculationPresentation(calculation), {
    recommendationEligible: false,
    recommendationReasons: ['Brak odpowiedniego wariantu sprzętu.'],
    paybackYears: null,
    breakdown: [
      { label: 'Sama zmiana taryfy', value: 250 },
      { label: 'Dodatkowa korzyść ze sprzętu', value: 550 },
      { label: 'Rachunek po samej zmianie taryfy', value: 12500 },
    ],
  });
});

test('opcjonalne rozbicie nie tworzy wartości, a dopuszczona rekomendacja zachowuje payback', () => {
  const calculation = {
    status: 'ready',
    annualSavingsPln: 0,
    tariffOnlyAnnualSavingsPln: 0,
    paybackYears: 4.9,
    recommendationEligible: true,
    recommendationReasons: [],
  } as unknown as OfferWorkspaceCalculation;

  const presentation = offerWorkspaceCalculationPresentation(calculation);
  assert.equal(presentation.recommendationEligible, true);
  assert.equal(presentation.paybackYears, 4);
  assert.deepEqual(presentation.breakdown, [{ label: 'Sama zmiana taryfy', value: 0 }]);
});
