import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import { emptyOfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import { priceOfferWorkspaceConfiguration } from 'lib/onrevolt/offer-workspace-pricing';
import type { OfferWorkspaceCalculation } from 'lib/onrevolt/offer-workspace-calculation-types';
import type { WorkspaceTemplate } from './OfferWorkspacePanel';
import OfferWorkspaceConfiguration from './OfferWorkspaceConfiguration';

function catalogTemplate({
  id,
  name,
  kind = 'MAGAZYN',
  powerKw = null,
  capacityKwh = null,
  hasPrice = true,
  saleVatRate = 0.08,
}: {
  id: string;
  name: string;
  kind?: string;
  powerKw?: number | null;
  capacityKwh?: number | null;
  hasPrice?: boolean;
  saleVatRate?: number | null;
}): WorkspaceTemplate {
  return {
    id, familyKey: id, name, version: 1, kind, clientType: 'B2C_B2B', roofType: null, goal: null,
    powerKw, capacityKwh, sortOrder: 0, requiresExistingPv: false, requiresExistingInverter: false, notes: null,
    items: [{
      id: `${id}-item`, position: 1, description: `${name} · urządzenie`, quantity: 1,
      role: 'CORE', supplyMode: 'ONREVOLT_SUPPLIED', unitPurchaseNet: null, purchaseVatRate: null,
      operatingCostNet: 100, marginRate: 0.2, saleVatRate, isOptional: false, requiresReview: false,
      product: {
        id: `${id}-product`, name: `${name} Model`, sku: `${id}-sku`, legacySku: null,
        category: kind === 'MAGAZYN' ? 'BATTERY' : 'PV', producer: 'Producent', availability: 'AVAILABLE',
        powerCapacity: null,
        prices: hasPrice ? [{
          purchaseNet: 1000, currentPurchaseNet: 1200, purchaseVatRate: 0.23,
          operatingCostNet: 100, marginRate: 0.2, saleVatRate, currency: 'PLN', validFrom: '2026-01-01T00:00:00.000Z',
        }] : [],
      },
    }],
  };
}

const battery = catalogTemplate({ id: 'battery-10', name: 'Magazyn 10 kWh', capacityKwh: 10 });
const pv = catalogTemplate({ id: 'pv-6', name: 'PV 6 kWp', kind: 'PV_DACH_SKOSNY', powerKw: 6, saleVatRate: 0.23 });

function renderConfiguration({
  templates = [battery, pv],
  draft = emptyOfferWorkspaceDraft(),
  clientType = 'B2C',
  calculation = null,
  calculationIsStale = false,
}: {
  templates?: WorkspaceTemplate[];
  draft?: ReturnType<typeof emptyOfferWorkspaceDraft>;
  clientType?: string;
  calculation?: OfferWorkspaceCalculation | null;
  calculationIsStale?: boolean;
} = {}) {
  return renderToStaticMarkup(createElement(ChakraProvider, null, createElement(OfferWorkspaceConfiguration, {
    draft, templates, clientType, disabled: false, calculationDisabled: false,
    calculation, calculationLoading: false, calculationMode: null, calculationProgress: null,
    calculationIsStale, calculationError: '', onCalculate: () => undefined,
    onSelectRanking: () => undefined, onChange: () => undefined,
  })));
}

function renderedMoney(value: number) {
  return new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function evaluatedCalculation(calculation: OfferWorkspaceCalculation, templateIds: string[]) {
  return { ...calculation, evaluatedTemplateIds: templateIds } as OfferWorkspaceCalculation;
}

test('pusty wybór pokazuje krótką listę z ceną katalogową MIXED i nie zmienia VAT szkicu REVIEW', () => {
  const draft = emptyOfferWorkspaceDraft();
  const templates = [battery, pv, catalogTemplate({ id: 'pv-unpriced', name: 'PV bez ceny', kind: 'PV_DACH_PLASKI', powerKw: 8, hasPrice: false })];
  const markup = renderConfiguration({ draft, templates });
  const expected = priceOfferWorkspaceConfiguration([battery], 'MIXED', 'B2C').systemCostBeforeFinancing!;

  assert.match(markup, /Dostępne konfiguracje katalogowe/);
  assert.match(markup, /Cena katalogowa wg stawek pozycji · brutto/);
  assert.match(markup, /Magazyn 10 kWh/);
  assert.match(markup, /PV 6 kWp/);
  assert.match(markup, /10 kWh/);
  assert.match(markup, /6 kWp/);
  assert.ok(markup.includes(renderedMoney(expected)));
  assert.match(markup, /Nieustalona cena · .*Brak aktualnej ceny katalogowej/);
  assert.match(markup, /aria-label="Wybierz Magazyn 10 kWh"/);
  assert.match(markup, /aria-label="Wybierz PV 6 kWp"/);
  assert.match(markup, /Potwierdź VAT sprzedaży, aby wyliczyć koszt wybranej konfiguracji/);
  assert.equal(draft.saleVatMode, 'REVIEW');
  assert.equal((markup.match(/VAT od sprzedaży/g) || []).length, 1);
});

test('pusty katalog odróżnia brak kwalifikujących się zestawów od braku wyboru', () => {
  const markup = renderConfiguration({ templates: [] });

  assert.match(markup, /Brak dostępnych zestawów katalogowych PV ani magazynów energii/);
  assert.doesNotMatch(markup, /Nie wybrano konfiguracji\. Cena katalogowa/);
});

test('wybrany koszt katalogowy jest widoczny bez kalkulacji i pozostaje netto dla B2B', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = [battery.id];
  draft.saleVatMode = 'MIXED';
  const expected = priceOfferWorkspaceConfiguration([battery], 'MIXED', 'B2B').systemCostBeforeFinancing!;
  const markup = renderConfiguration({ templates: [battery], draft, clientType: 'B2B' });

  assert.match(markup, /Koszt systemu przed finansowaniem: [^\"]+ zł/);
  assert.ok(markup.includes(`aria-label="Koszt systemu przed finansowaniem: ${renderedMoney(expected)} zł"`));
  assert.ok(markup.includes(renderedMoney(expected)));
  assert.match(markup, /Cena jednostkowa netto \[zł\]/);
  assert.match(markup, /Przed finansowaniem · cena katalogowa/);
  assert.match(markup, /aria-label="Koszt systemu przed finansowaniem"/);
  assert.match(markup, /aria-label="Koszt systemu po dofinansowaniach"/);
  assert.match(markup, /Koszt systemu po dofinansowaniach/);
  assert.match(markup, /Nie obliczono/);
  assert.match(markup, /Nie uwzględniono/);
  assert.doesNotMatch(markup, /Ranking konfiguracji/);
});

test('wybrany koszt pozostaje nieustalony przy VAT REVIEW, bez zastępowania trybu', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = [battery.id];
  const markup = renderConfiguration({ templates: [battery], draft });

  assert.match(markup, /Koszt systemu przed finansowaniem: niepełna wycena katalogowa/);
  assert.match(markup, /Potwierdź VAT/);
  assert.match(markup, /Potwierdź VAT sprzedaży, aby wyliczyć koszt wybranej konfiguracji/);
  assert.equal(draft.saleVatMode, 'REVIEW');
  assert.doesNotMatch(markup, /Dostępne konfiguracje katalogowe/);
});

test('zablokowane obliczenie pokazuje znane wartości częściowe i powody bez rekomendacji', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = [battery.id];
  draft.saleVatMode = 'MIXED';
  draft.financing.considerGrant = true;
  const calculation: OfferWorkspaceCalculation = {
    status: 'blocked', reasons: ['Brak kompletnych danych taryfy docelowej.'], warnings: [],
    baselineAnnualCostPln: 1200, proposedAnnualCostPln: null, annualSavingsPln: 200,
    tariffOnlyAnnualCostPln: 1100, tariffOnlyAnnualSavingsPln: 100, hardwareAnnualSavingsPln: 50,
    systemCostPln: 2400, costAfterFinancingPln: 2100, paybackYears: 4,
    grantPln: 300, taxReliefPln: null,
    rankings: [{ templateIds: [battery.id], name: 'Nieukończony ranking', annualSavingsPln: 200, costAfterFinancingPln: 2100, paybackYears: 4 }],
    recommendedTemplateIds: [battery.id],
  };
  const markup = renderConfiguration({ templates: [battery], draft, calculation: evaluatedCalculation(calculation, [battery.id]) });

  assert.match(markup, /Dane częściowe/);
  assert.match(markup, /Brak kompletnych danych taryfy docelowej/);
  assert.match(markup, /wartość częściowa/);
  assert.match(markup, /Znane wartości cząstkowe/);
  assert.match(markup, /Koszt systemu z obliczenia/);
  assert.match(markup, /Koszt po finansowaniu z obliczenia/);
  assert.match(markup, /Kwota cząstkowa:/);
  assert.match(markup, /Dotacja · szacunek warunkowy/);
  assert.match(markup, /Szacunek częściowy/);
  assert.match(markup, /Koszt systemu po dofinansowaniach/);
  assert.match(markup, /Szacunek częściowy · bez rekomendacji/);
  assert.match(markup, /Sama zmiana taryfy/);
  assert.doesNotMatch(markup, /Rekomendacja systemu|Ranking konfiguracji|zwrot 4 lat|Kryterium: najkrótszy czas zwrotu/);
});

test('gotowy status bez obliczonego zwrotu nie tworzy automatycznej rekomendacji', () => {
  const calculation: OfferWorkspaceCalculation = {
    status: 'ready', reasons: [], warnings: [],
    baselineAnnualCostPln: 1200, proposedAnnualCostPln: 1000, annualSavingsPln: 200,
    systemCostPln: 2400, costAfterFinancingPln: 2100, paybackYears: null,
    grantPln: null, taxReliefPln: null, rankings: [], recommendedTemplateIds: [battery.id],
  };
  const markup = renderConfiguration({ templates: [battery], calculation });

  assert.doesNotMatch(markup, /Rekomendacja systemu|Wariant wskazany przez obliczenie zwrotu/);
  assert.match(markup, /Brak automatycznej rekomendacji bez obliczenia zwrotu/);
});

test('częściowy wynik zachowuje jawnie diagnostyczne porównanie zestawów bez czasu zwrotu', () => {
  const calculation: OfferWorkspaceCalculation = {
    status: 'blocked', reasons: ['Nieznane historyczne saldo opustu.'], warnings: [],
    baselineAnnualCostPln: null, proposedAnnualCostPln: 1000, annualSavingsPln: null,
    systemCostPln: 2400, costAfterFinancingPln: null, paybackYears: null,
    grantPln: null, taxReliefPln: null,
    rankings: [{ templateIds: [battery.id], name: 'Porównanie magazynu', annualSavingsPln: 200,
      costAfterFinancingPln: null, paybackYears: 4, recommendationEligible: false, reasons: ['Wymaga weryfikacji modelu.'] }],
    recommendedTemplateIds: null,
  };
  const markup = renderConfiguration({ templates: [battery], calculation });
  assert.match(markup, /Porównanie magazynu · porównanie częściowe/);
  assert.match(markup, /Korzyść sprzętu przy tej samej taryfie:/);
  assert.match(markup, /Wymaga weryfikacji modelu/);
  assert.doesNotMatch(markup, /zwrot 4 lat|· rekomendowana/);
});

test('szacunkowy zwrot jest oznaczony osobno i pokazuje zielony koszt końcowy wyłącznie z wyliczonych pól', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = [battery.id];
  draft.saleVatMode = 'MIXED';
  draft.financing.considerGrant = true;
  draft.financing.considerTaxRelief = true;
  const calculation = {
    status: 'ready' as const, reasons: [], warnings: [], recommendationEligible: false,
    baselineAnnualCostPln: 1200, proposedAnnualCostPln: 1000, annualSavingsPln: 200,
    systemCostPln: 2400, costAfterFinancingPln: 2050, paybackYears: null,
    estimatedPaybackYears: 3.76, estimatedRecommendedTemplateIds: [battery.id],
    grantPln: 250, taxReliefPln: 100,
    rankings: [{ templateIds: [battery.id], name: 'Magazyn 10 kWh', annualSavingsPln: 100,
      costAfterFinancingPln: 2050, paybackYears: null, estimatedPaybackYears: 3.76, recommendationEligible: false }],
    recommendedTemplateIds: null,
    evaluatedTemplateIds: [battery.id],
  };
  const markup = renderConfiguration({ templates: [battery], draft, calculation });

  assert.match(markup, /Szacunkowy czas zwrotu/);
  assert.match(markup, /Dokładny szacunek: 3,76 lat/);
  assert.match(markup, /aria-label="Dotacja · szacunek warunkowy"/);
  assert.match(markup, /aria-label="Ulga termomodernizacyjna · szacunek warunkowy"/);
  assert.match(markup, /Wybrany najkrótszy szacunkowy zwrot/);
  assert.match(markup, /Magazyn 10 kWh/);
  assert.match(markup, /Wybrany wariant/);
  assert.match(markup, /aria-label="Koszt systemu po dofinansowaniach"/);
  assert.ok(markup.includes(renderedMoney(2050)));
  assert.ok(markup.includes(renderedMoney(250)));
  assert.ok(markup.includes(renderedMoney(100)));
  assert.doesNotMatch(markup, /Rekomendacja systemu|Wariant wskazany przez obliczenie zwrotu/);
});

test('zmieniona cena w ofercie aktualizuje tabelę i oznacza pozycję bez zmiany modelu', () => {
  const draft = { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: [battery.id], saleVatMode: 'REDUCED_8' as const,
    configurationEdits: [{ templateId: battery.id, items: [{ itemId: battery.items[0].id,
      description: 'Opis indywidualny', pricing: { unitPurchaseNet: 1500 } }] }] };
  const markup = renderConfiguration({ templates: [battery], draft });
  assert.match(markup, /Opis indywidualny/);
  assert.match(markup, /Magazyn 10 kWh Model/);
  assert.match(markup, /Zmieniona w tej ofercie/);
  assert.match(markup, /Cena indywidualna przed finansowaniem/);
  assert.ok(markup.includes(renderedMoney((1500 + 100) * 1.2 * 1.08)));
  assert.equal(battery.items[0].description, 'Magazyn 10 kWh · urządzenie');
});

test('usunięta pozycja katalogowa w lokalnym szkicu pokazuje konflikt bez wywrócenia widoku', () => {
  const draft = { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: [battery.id],
    configurationEdits: [{ templateId: battery.id, items: [{ itemId: 'no-longer-in-catalog', description: 'Zachowaj wpis' }] }] };
  const markup = renderConfiguration({ templates: [battery], draft });
  assert.match(markup, /Własne zmiany pozostają w szkicu/);
  assert.match(markup, /Wczytaj pozycje konfiguracji ponownie/);
});

test('nieaktualna kalkulacja nie jest pokazywana jako bieżący szacunek finansowania', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = [battery.id];
  draft.saleVatMode = 'MIXED';
  draft.financing.considerGrant = true;
  const calculation: OfferWorkspaceCalculation = {
    status: 'ready', reasons: [], warnings: [], recommendationEligible: true,
    baselineAnnualCostPln: 1200, proposedAnnualCostPln: 1000, annualSavingsPln: 200,
    systemCostPln: 2400, costAfterFinancingPln: 2100, paybackYears: 4,
    grantPln: 300, taxReliefPln: 0, rankings: [], recommendedTemplateIds: [battery.id],
  };
  const markup = renderConfiguration({ templates: [battery], draft, calculation: evaluatedCalculation(calculation, [battery.id]), calculationIsStale: true });

  assert.match(markup, /aria-label="Koszt systemu po dofinansowaniach"/);
  assert.match(markup, /Obliczenie jest nieaktualne/);
  assert.match(markup, /Dotacja · szacunek warunkowy/);
  assert.doesNotMatch(markup, /Wariant wskazany przez obliczenie zwrotu/);
});

test('zwycięzca estymacji jest jawny, ale jego finansowanie nie trafia pod inną zaznaczoną konfigurację', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = [pv.id];
  draft.saleVatMode = 'MIXED';
  draft.financing.considerGrant = true;
  draft.financing.considerTaxRelief = true;
  const calculation = {
    status: 'ready' as const, reasons: [], warnings: [], recommendationEligible: false,
    recommendationReasons: ['Wymaga potwierdzenia zgodności technicznej.'],
    baselineAnnualCostPln: 1200, proposedAnnualCostPln: 900, annualSavingsPln: 300,
    systemCostPln: 2400, costAfterFinancingPln: 20000, paybackYears: null,
    estimatedPaybackYears: 2.5, estimatedRecommendedTemplateIds: [battery.id],
    grantPln: 45000, taxReliefPln: 35000,
    rankings: [{ templateIds: [battery.id], name: 'Zwycięski magazyn', annualSavingsPln: 500,
      costAfterFinancingPln: null, paybackYears: null, estimatedPaybackYears: 2.5, recommendationEligible: false }],
    recommendedTemplateIds: null, evaluatedTemplateIds: [battery.id],
  };
  const markup = renderConfiguration({ templates: [battery, pv], draft, calculation });

  assert.match(markup, /Najkrótszy szacunkowy zwrot/);
  assert.match(markup, /Zwycięski magazyn/);
  assert.match(markup, /Wybierz zwycięski wariant/);
  assert.match(markup, /Obliczenie dotyczy innej lub niepotwierdzonej konfiguracji/);
  assert.ok(markup.includes(`aria-label="Aktualny rachunek roczny: ${renderedMoney(1200)} zł"`));
  assert.match(markup, /aria-label="Prognozowany rachunek roczny: nie obliczono"/);
  assert.match(markup, /aria-label="Łączna zmiana rachunku rocznego: nie obliczono"/);
  assert.match(markup, /aria-label="Czas zwrotu z dodatkowego sprzętu: nie obliczono"/);
  assert.equal((markup.match(/Wybierz wskazany zestaw, aby zobaczyć jego podsumowanie\./g) || []).length, 1);
  assert.match(markup, /title="Dokładny szacunek: 2,5 lat"/);
  assert.doesNotMatch(markup, new RegExp(renderedMoney(45000)));
  assert.doesNotMatch(markup, new RegExp(renderedMoney(35000)));
  assert.doesNotMatch(markup, new RegExp(renderedMoney(20000)));
  assert.doesNotMatch(markup, /Analiza wariantu/);
});

test('odznaczone finansowanie ma kwotę zero, gdy wynik dotyczy zaznaczonego zestawu', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = [battery.id];
  draft.saleVatMode = 'MIXED';
  const calculation: OfferWorkspaceCalculation = {
    status: 'ready', reasons: [], warnings: [], recommendationEligible: true,
    baselineAnnualCostPln: 1200, proposedAnnualCostPln: 1000, annualSavingsPln: 200,
    systemCostPln: 2400, costAfterFinancingPln: 2400, paybackYears: 5,
    grantPln: 0, taxReliefPln: 0, rankings: [], recommendedTemplateIds: [battery.id],
  };
  const markup = renderConfiguration({ templates: [battery], draft, calculation: evaluatedCalculation(calculation, [battery.id]) });

  assert.match(markup, /Nie uwzględniono w kosztach: 0,00 zł/);
  assert.match(markup, /Nie uwzględniono · 0 zł/);
  assert.match(markup, /aria-label="Koszt systemu po dofinansowaniach"/);
});

test('finansowanie pokazuje stawki ulgi bez pytania o dochód na start', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.financing.considerTaxRelief = true;
  const html = renderConfiguration({ draft });
  assert.match(html, /aria-label="Stawka podatku dla ulgi"/);
  assert.match(html, /aria-pressed="true"[^>]*>12%/);
  assert.match(html, /Ulga szacunkowa 12%/);
  assert.doesNotMatch(html, /aria-label="Podstawa opodatkowania/);
});
