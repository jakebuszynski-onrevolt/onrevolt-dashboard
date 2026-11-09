import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { offerSavingsFinancialRows, offerSystemExpandedPanels, offerWorkspaceCalculationPresentation, offerSystemIssues } from './OfferWorkspaceScreens';
import { emptyOfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import type { OfferBillingMonthResult } from 'lib/onrevolt/offer-workspace-billing';
import type { OfferWorkspaceCalculation } from 'lib/onrevolt/offer-workspace-calculation-types';
import type { OfferTariffRateState } from 'lib/onrevolt/offer-workspace-tariffs';

const readyRates: OfferTariffRateState = { status: 'ready', tariff: {} as Extract<OfferTariffRateState, { status: 'ready' }>['tariff'] };
const loadingRates: OfferTariffRateState = { status: 'loading' };
const unavailableRates: OfferTariffRateState = { status: 'unavailable', message: 'Brak taryfy.' };
const screensSource = readFileSync(path.resolve(__dirname, 'OfferWorkspaceScreens.tsx'), 'utf8');

test('gotowy model rocznej deklaracji pokazuje jedną informację zamiast ostrzeżeń o brakujących pomiarach', () => {
  const note = 'Zużycie jest szacowane z jawnej rocznej deklaracji według profilu referencyjnego Household. Import, oddanie, autokonsumpcja i produkcja PV są modelowane; nie są pomiarami.';
  const measurementIssues = ['Konto ENEA nie ma zapisanego numeru PPE.', 'Brak pobranych miesięcznych plików ENEA w okresie 2025-06–2026-05.',
    'Model rocznego zużycia: Roczne zużycie · profil referencyjny Household. To profil szacunkowy, nie dane pomiarowe.'];
  const workspace = { input: { issues: [] }, measurements: { issues: measurementIssues },
    energy: { issues: [note], modelledMeasurements: { provenance: { kind: 'annual-consumption' } } } } as any;
  assert.deepEqual(offerSystemIssues(workspace, emptyOfferWorkspaceDraft()), [note]);
  workspace.measurements.issues.push('Plik pomiarowy jest uszkodzony.');
  assert.deepEqual(offerSystemIssues(workspace, emptyOfferWorkspaceDraft()), ['Plik pomiarowy jest uszkodzony.', note]);
  workspace.energy = null;
  assert.deepEqual(offerSystemIssues(workspace, emptyOfferWorkspaceDraft()), measurementIssues, 'brak modelu nie ukrywa braków pomiarów');
});

test('status magazynu jest tylko do odczytu i odsyła do Danych energetycznych', () => {
  assert.match(screensSource, /Istniejący magazyn energii · Dane energetyczne/u);
  assert.match(screensSource, /Otwórz Dane energetyczne/u);
  assert.doesNotMatch(screensSource, /Magazyn energii w okresie pomiarów operatora/u);
});

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
  assert.equal(presentation.paybackYears, 4.9);
  assert.deepEqual(presentation.breakdown, [{ label: 'Sama zmiana taryfy', value: 0 }]);
});

test('porównanie sprzętu używa taryfy docelowej bez inwestycji i nie zastępuje brakującego rachunku obecnym', () => {
  const current = { month: '2026-01', cashDuePln: 44.75, importKwh: 250 } as OfferBillingMonthResult;
  const target = { month: '2026-01', cashDuePln: 300, importKwh: 250 } as OfferBillingMonthResult;
  const proposed = { month: '2026-01', cashDuePln: 125, importKwh: 100 } as OfferBillingMonthResult;
  const calculation = { status: 'ready', baselineBill: { months: [current] }, tariffOnlyBill: { months: [target] }, proposedBill: { months: [proposed] } } as OfferWorkspaceCalculation;
  assert.equal(offerSavingsFinancialRows(calculation)[0].baseline, current);
  assert.equal(offerSavingsFinancialRows(calculation, 'TARGET_TARIFF')[0].baseline, target);
  assert.equal(offerSavingsFinancialRows(calculation, 'TARGET_TARIFF')[0].proposed, proposed);
  assert.deepEqual(offerSavingsFinancialRows({ ...calculation, tariffOnlyBill: undefined }, 'TARGET_TARIFF'), []);
});
