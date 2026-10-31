import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const cssExtensions = (require as any).extensions as Record<string, (module: any) => void>;
cssExtensions['.css'] = (module) => {
  module.exports = {
    __esModule: true,
    default: new Proxy({}, { get: (_target, key) => String(key) }),
  };
};

const rollingMonths = Array.from({ length: 12 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 9 + index, 1));
  const period = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const isJune = period === '2026-06';
  return {
    period,
    importKwh: isJune ? 345 : 10,
    exportKwh: isJune ? 78 : 2,
    importAvailable: true,
    exportAvailable: true,
  };
});

test('SSR pokazuje cztery KPI, nieznane PV i oddziela średnią dobę od pomiaru', async () => {
  const { default: ClientEnergySummary } = await import('./ClientEnergySummary');
  const markup = renderToStaticMarkup(createElement(ClientEnergySummary, {
    projectId: 'project-1',
    profile: {
      annualKwh: 3400,
      source: 'RE',
      warnings: [],
      months: [{
        key: '2026-06', year: 2026, month: 6, label: 'Czerwiec', totalKwh: 280,
        sharePercent: 8.2, hourly: Array.from({ length: 24 }, (_, hour) => hour / 10), sourceFiles: 1,
        hasData: true, importSource: 'xlsx', exportSource: 'real',
      }],
    },
    annualConsumptionKwh: 3400,
    consumptionSource: 'Wspólny profil RE',
    hasPv: true,
    invoices: [],
    initialData: {
      months: rollingMonths,
      days: ['2025-10-14', '2026-06-12'].map((date) => ({
        date, period: date.slice(0, 7),
        hours: Array.from({ length: 24 }, (_, hour) => ({ hour, importKwh: 1.5, exportKwh: hour > 10 ? 0.25 : null })),
      })),
      issues: [],
    },
  }));

  assert.equal((markup.match(/<article class=/g) || []).length, 4);
  assert.match(markup, /Średnia doba · profil RE/);
  assert.match(markup, /Profil godzinowy, nie rzeczywisty dzień pomiarowy/);
  assert.match(markup, /Produkcja PV/);
  assert.match(markup, /Autokonsumpcja PV[\s\S]*?Brak danych/);
  assert.match(markup, /data-series="import"/);
  assert.match(markup, /data-series="export"/);
  assert.match(markup, /455 kWh/);
  assert.match(markup, /100 kWh/);
  assert.match(markup, /październik 2025 – wrzesień 2026/);
  assert.match(markup, /paź 25/);
  assert.match(markup, /wrz 26/);
  assert.doesNotMatch(markup, /Rok profilu energii/);
  assert.doesNotMatch(markup, /Ładowanie pomiarów ENEA/);
  assert.match(markup, /↓ XLSX/);
  assert.match(markup, /↑ real/);
});

test('SSR nie annualizuje kosztów częściowych faktur', async () => {
  const { default: ClientEnergySummary } = await import('./ClientEnergySummary');
  const markup = renderToStaticMarkup(createElement(ClientEnergySummary, {
    projectId: 'project-2', profile: null, annualConsumptionKwh: 0,
    consumptionSource: 'Brak danych', hasPv: false,
    invoices: [{ id: 'invoice-1', invoiceNumber: 'FV/1', billingPeriodFrom: '2026-01-01', billingPeriodTo: '2026-01-31', amountGross: 150 }],
    initialData: { months: [], days: [], issues: ['Plik testowy: brak danych pomiarowych.'] },
  }));

  assert.match(markup, /Szacowany koszt wg taryfy/);
  assert.match(markup, /Faktury za dokładny okres/);
  assert.match(markup, /Brak danych do wyceny taryfowej/);
  assert.match(markup, /150,00 zł/);
  assert.match(markup, /Plik testowy: brak danych pomiarowych/);
  assert.match(markup, /disabled=""/);
  assert.doesNotMatch(markup, /Roczny rachunek/);
});

test('koszt taryfowy działa bez faktur i ujawnia założenia rozliczenia PV', async () => {
  const { default: ClientEnergySummary } = await import('./ClientEnergySummary');
  const cost = {
    status: 'ready' as const, vatBasis: 'GROSS' as const, totalPln: 1234.56,
    energyPln: 1400, distributionPln: 500, fixedPln: 100,
    exportValuePln: null, settlementBenefitPln: 765.44, settled: true,
    pricedHours: 8760, totalHours: 8760, tariffLabels: ['ENEA G11'], issues: [],
    assumptions: ['Początkowe saldo opustu: 0 kWh.', 'Dla brakujących dawnych cen przyjęto aktualny cennik G11.'],
  };
  const props = { projectId: 'cost-test', profile: null, annualConsumptionKwh: 0,
    consumptionSource: '', hasPv: true, invoices: [],
    initialData: { months: rollingMonths, days: [], issues: [], cost } };
  const markup = renderToStaticMarkup(createElement(ClientEnergySummary, props));
  assert.match(markup, /1\s?234,56 zł/);
  assert.match(markup, /Brutto · po rozliczeniu oddania/);
  assert.match(markup, /ENEA G11/);
  assert.match(markup, /Wyceniono 8760\/8760 godzin/);
  assert.match(markup, /Początkowe saldo opustu: 0 kWh/);
  assert.match(markup, /aktualny cennik G11/);
  assert.doesNotMatch(markup, /Brak faktur z prawidłowym okresem/);
  const masked = renderToStaticMarkup(createElement(ClientEnergySummary, { ...props, maskValues: true }));
  assert.doesNotMatch(masked, /1\s?234,56 zł|Początkowe saldo opustu/);
});

test('niepełna wycena netto nie udaje rozliczenia PV, a zero pozostaje kwotą', async () => {
  const { default: ClientEnergySummary } = await import('./ClientEnergySummary');
  const markup = renderToStaticMarkup(createElement(ClientEnergySummary, {
    projectId: 'cost-partial', profile: null, annualConsumptionKwh: 0,
    consumptionSource: '', hasPv: true, invoices: [],
    initialData: { months: [], days: [], issues: [], cost: {
      status: 'partial', vatBasis: 'NET', totalPln: 0, energyPln: 0, distributionPln: 0,
      fixedPln: 0, exportValuePln: null, settlementBenefitPln: null, settled: false,
      pricedHours: 24, totalHours: 48, tariffLabels: ['C11'],
      issues: ['Brak oddania w części okresu.'], assumptions: [],
    } },
  }));
  assert.match(markup, /0,00 zł/);
  assert.match(markup, /Netto · przed rozliczeniem oddania · niepełny okres/);
  assert.match(markup, /Brak oddania w części okresu/);
  assert.match(markup, /Wyceniono 24\/48 godzin/);
  assert.doesNotMatch(markup, /po rozliczeniu oddania/);
});

test('PV pokazuje szacowane wartości, odnośnik modelu i zakres częściowej autokonsumpcji', async () => {
  const { default: ClientEnergySummary } = await import('./ClientEnergySummary');
  const props = {
    projectId: 'project-pv', profile: null, annualConsumptionKwh: 0,
    consumptionSource: '', hasPv: true, invoices: [],
    initialData: { months: rollingMonths, days: [], issues: [], pv: {
      productionKwh: 9876, selfConsumptionKwh: 2345, coveredMonths: 10, totalMonths: 12,
      modelUrl: 'https://my.onrevolt.com/pv/?mode=manual&capacityKwp=9.9&tilt=40',
      note: '', issues: ['Oddanie w części godzin przewyższa model PV.'],
    } },
  };
  const markup = renderToStaticMarkup(createElement(ClientEnergySummary, props));
  assert.match(markup, /9\s?876 kWh/);
  assert.match(markup, /2\s?345 kWh/);
  assert.match(markup, /Szacunek modelu PV/);
  assert.match(markup, /nie pomiar z falownika/);
  assert.match(markup, /capacityKwp=9.9&amp;tilt=40/);
  assert.match(markup, /10\/12 mies., bez ekstrapolacji/);
  assert.match(markup, /Oddanie w części godzin przewyższa model PV/);
  const hourlyCoverage = renderToStaticMarkup(createElement(ClientEnergySummary, {
    ...props, initialData: { ...props.initialData, pv: {
      ...props.initialData.pv, coveredHours: 8759, totalHours: 8760,
    } },
  }));
  assert.match(hourlyCoverage, /8759\/8760 godz., bez ekstrapolacji/);
  assert.doesNotMatch(hourlyCoverage, /10\/12 mies/);
  const masked = renderToStaticMarkup(createElement(ClientEnergySummary, { ...props, maskValues: true }));
  assert.doesNotMatch(masked, /9\s?876 kWh|2\s?345 kWh/);
  assert.match(masked, /Przeliczanie danych/);
});

test('PV rozróżnia zerową autokonsumpcję od nieznanej i pokazuje powód braku szacunku', async () => {
  const { default: ClientEnergySummary } = await import('./ClientEnergySummary');
  const base = {
    projectId: 'project-pv', profile: null, annualConsumptionKwh: 0,
    consumptionSource: '', hasPv: true, invoices: [],
  };
  const pv = { productionKwh: 1234, selfConsumptionKwh: 0, coveredMonths: 12, totalMonths: 12, modelUrl: null, note: '', issues: [] };
  const zero = renderToStaticMarkup(createElement(ClientEnergySummary, {
    ...base, initialData: { months: [], days: [], issues: [], pv },
  }));
  assert.match(zero, /Autokonsumpcja PV<\/span><strong>0 kWh/);
  const unknown = renderToStaticMarkup(createElement(ClientEnergySummary, {
    ...base, initialData: { months: [], days: [], issues: [], pv: { ...pv, selfConsumptionKwh: null, note: 'Potwierdź obecność magazynu w okresie pomiarów.' } },
  }));
  assert.match(unknown, /1\s?234 kWh/);
  assert.match(unknown, /Potwierdź obecność magazynu/);
});

test('profil miesięczny RE bez XLSX pokazuje linię profilu, nie serię poboru z sieci', async () => {
  const { default: ClientEnergySummary } = await import('./ClientEnergySummary');
  const profileMonths = rollingMonths.map((month, index) => {
    const [year, monthNumber] = month.period.split('-').map(Number);
    return {
      key: month.period,
      year,
      month: monthNumber,
      label: month.period,
      totalKwh: 180 + index * 5,
      sharePercent: 8,
      hourly: Array.from({ length: 24 }, (_, hour) => hour / 10),
      sourceFiles: 1,
      hasData: true,
      importSource: 'forecast',
      exportSource: 'forecast',
    };
  });
  const markup = renderToStaticMarkup(createElement(ClientEnergySummary, {
    projectId: 'project-re-only',
    profile: { annualKwh: 3400, months: profileMonths, source: 'RE', warnings: [] },
    annualConsumptionKwh: 3400,
    consumptionSource: 'Wspólny profil RE',
    hasPv: true,
    invoices: [],
    initialData: {
      months: rollingMonths.map((month) => ({ ...month, importKwh: null, exportKwh: null, importAvailable: false, exportAvailable: false })),
      days: [],
      issues: [],
    },
  }));

  assert.match(markup, /data-series="load"/);
  assert.match(markup, /Szacowane zużycie budynku · profil RE/);
  assert.match(markup, /Zużycie z profilu: październik 2025 – wrzesień 2026/);
  assert.doesNotMatch(markup, /data-series="import"/);
  assert.doesNotMatch(markup, /data-series="export"/);
  assert.doesNotMatch(markup, /Brak pomiarów poboru i oddania w tym okresie/);
});

test('maskowanie ukrywa KPI poprzedniego okresu do zakończenia przeliczenia', async () => {
  const { default: ClientEnergySummary } = await import('./ClientEnergySummary');
  const markup = renderToStaticMarkup(createElement(ClientEnergySummary, {
    projectId: 'project-mask', profile: null, annualConsumptionKwh: 8888,
    consumptionSource: 'Poprzedni okres', hasPv: false,
    invoices: [{ id: 'old-invoice', invoiceNumber: 'OLD', billingPeriodFrom: '2026-01-01', billingPeriodTo: '2026-01-31', amountGross: 9999 }],
    maskValues: true,
    initialData: { months: rollingMonths, days: [], issues: [] },
  }));

  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /Proszę czekać – przeliczam dane/);
  assert.doesNotMatch(markup, /8\s?888 kWh/);
  assert.doesNotMatch(markup, /9\s?999,00 zł/);
  assert.doesNotMatch(markup, /OLD/);
});

test('request key rozróżnia projekty i odrzuca stan z poprzedniego żądania', async () => {
  const { areClientEnergySummaryLoadStatesEqual, getClientEnergySummaryRequestKey, isCurrentClientEnergySummaryLoadState } = await import('./ClientEnergySummary');
  const currentKey = getClientEnergySummaryRequestKey('project-current', '2026-07:refresh-2');
  const staleState = { requestKey: getClientEnergySummaryRequestKey('project-current', '2026-06:refresh-1'), status: 'ready' as const };
  const currentState = { requestKey: currentKey, status: 'error' as const, error: 'HTTP 500' };

  assert.equal(currentKey, JSON.stringify(['project-current', '2026-07:refresh-2']));
  assert.equal(isCurrentClientEnergySummaryLoadState(staleState, currentKey), false);
  assert.equal(isCurrentClientEnergySummaryLoadState(currentState, currentKey), true);
  assert.equal(areClientEnergySummaryLoadStatesEqual(
    { ...currentState, warnings: ['Brak faktur'] },
    { ...currentState, warnings: ['Brak faktur'] },
  ), true);
  assert.equal(areClientEnergySummaryLoadStatesEqual(
    { ...currentState, warnings: ['Brak faktur'] },
    { ...currentState, warnings: ['Brak danych PV'] },
  ), false);
});

test('błąd bieżącego profilu OSD nie pozwala użyć starego audytu jako deklaracji do oferty', async () => {
  const { resolveClientAnnualConsumption } = await import('./ClientEnergySummary');
  const annualKwh = resolveClientAnnualConsumption({
    hasOperatorData: true,
    hasEnergyInvoices: false,
    profileStatus: 'error',
    profileAnnualKwh: null,
    manualSourceSelected: false,
    manualAnnualKwh: 12400,
  });

  assert.equal(annualKwh, null);
  assert.equal(resolveClientAnnualConsumption({
    hasOperatorData: false,
    hasEnergyInvoices: false,
    profileStatus: 'error',
    manualSourceSelected: false,
    manualAnnualKwh: 12400,
  }), null);
  assert.equal(resolveClientAnnualConsumption({
    hasOperatorData: false,
    hasEnergyInvoices: false,
    profileStatus: 'error',
    manualSourceSelected: true,
    manualAnnualKwh: 12400,
  }), 12400);
  assert.equal(resolveClientAnnualConsumption({
    hasOperatorData: true,
    hasEnergyInvoices: false,
    profileStatus: 'ready',
    profileAnnualKwh: 9700,
    manualSourceSelected: false,
    manualAnnualKwh: 12400,
  }), 9700);
});
