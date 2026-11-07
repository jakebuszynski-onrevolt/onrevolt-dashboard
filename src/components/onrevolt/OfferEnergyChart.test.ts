import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import {
  energyStepPath,
  niceEnergyCeil,
  offerEnergyAxisCeil,
  offerChartValuation,
  offerEnergyChartRows,
  offerEnergyChartProvenance,
  OfferEnergyPlot,
  OfferEnergySummary,
  type EnergyChartRow,
  type OfferEnergyForecast,
} from './OfferEnergyChart';
import type { WorkspaceData } from './OfferWorkspacePanel';
import type { OfferWorkspaceValuationScenario, OfferWorkspaceValuationValues } from 'lib/onrevolt/offer-workspace-valuation';

const row = (loadKwh: number | null): EnergyChartRow => ({
  label: '', title: '', loadKwh, pvKwh: null, directKwh: null,
  importKwh: null, exportKwh: null,
});

function renderPlot(rows: EnergyChartRow[], annual: boolean) {
  const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
  const previousReact = globalWithReact.React;
  globalWithReact.React = React;
  try {
    return renderToStaticMarkup(createElement(ChakraProvider, null, createElement(OfferEnergyPlot, { rows, annual })));
  } finally {
    if (previousReact === undefined) delete globalWithReact.React;
    else globalWithReact.React = previousReact;
  }
}

test('wykres zachowuje schodki i szerokość pola z mockupa', () => {
  assert.equal(energyStepPath([row(2), row(5)], 'loadKwh', value => 100 - value), 'M58 98L519 98L519 95L980 95');
});

test('wykres prognozy uzupełnia magazyn po miesiącu i dokładnej godzinie wybranego dnia', () => {
  const measurements = { months: [{ period: '2026-01', importKwh: 20, exportKwh: 4 }], dayProfiles: [{ period: '2026-01', date: '2026-01-05', dayType: 'workday', hours: [{ hour: 0, importKwh: 2, exportKwh: 0 }] }] };
  const forecast = { measurements, energy: { months: [], dayProfiles: [] }, battery: { months: { '2026-01': 12 }, hours: { '2026-01-05T00': 0, '2026-01-05T01': 3, '2026-01-06T01': 7 } } } as unknown as OfferEnergyForecast;
  const workspace = { measurements } as unknown as WorkspaceData;
  assert.equal(offerEnergyChartRows(workspace, 'all', 'workday', true, forecast)[0].batteryKwh, 12);
  const rows = offerEnergyChartRows(workspace, '2026-01', 'workday', true, forecast);
  assert.equal(rows[0].batteryKwh, 0);
  assert.equal(rows[1].batteryKwh, 3);
  assert.equal(rows[2].batteryKwh, null);
});

test('brakujące dane przerywają linię zamiast udawać zero lub ciągłość', () => {
  const path = energyStepPath([row(2), row(null), row(0)], 'loadKwh', value => value);
  assert.equal((path.match(/M/g) || []).length, 2);
  assert.ok(path.endsWith('L980 0'));
  assert.equal(energyStepPath([row(null), row(null)], 'pvKwh', value => value), '');
});

test('skala mockupa obejmuje także małe wartości godzinowe', () => {
  assert.equal(niceEnergyCeil(0), 1);
  assert.equal(niceEnergyCeil(0.34), 0.4);
  assert.equal(niceEnergyCeil(1876), 2000);
});

test('skala miesięczna zaokrągla dodatni zakres do tysięcy, zachowując zakres godzinowy i oddanie', () => {
  assert.equal(offerEnergyAxisCeil(2670, true), 3000);
  assert.equal(offerEnergyAxisCeil(2670, false), 4000);

  const chartRow = { ...row(2670), title: 'styczeń', label: 'sty', importKwh: 2670, exportKwh: 2670 };
  const markup = renderPlot([chartRow], true);
  assert.match(markup, /data-energy-plot="annual"/);
  assert.match(markup, />3[\s\u00a0\u202f]?000<\/text>/);
  assert.match(markup, /data-series="export"/);
  assert.match(markup, /<text x="48" y="175"[^>]*>oddanie<\/text>/);
});

test('wykres łączy model i pomiary po okresie oraz dokładnej dacie, a miesiąc pokazuje 24 godziny', () => {
  const workspace = {
    measurements: {
      months: [{period:'2026-02',importKwh:200,exportKwh:20},{period:'2026-01',importKwh:100,exportKwh:10}],
      dayProfiles: [{period:'2026-01',date:'2026-01-05',dayType:'workday',hours:Array.from({length:24},(_,hour)=>({hour,importKwh:hour,exportKwh:0}))}],
    },
    energy: {
      months: [{period:'2026-01',loadKwh:130,pvKwh:40,directKwh:30},{period:'2026-02',loadKwh:250,pvKwh:70,directKwh:50}],
      dayProfiles: [{date:'2026-01-05',hours:Array.from({length:24},(_,hour)=>({hour,loadKwh:hour+1,pvKwh:2,directKwh:1}))}],
    },
  } as unknown as WorkspaceData;
  const annual = offerEnergyChartRows(workspace,'all','workday');
  assert.deepEqual(annual.map(r=>[r.importKwh,r.loadKwh,r.pvKwh,r.directKwh]),[[100,130,40,30],[200,250,70,50]]);
  const hourly = offerEnergyChartRows(workspace,'2026-01','workday');
  assert.equal(hourly.length,24);
  assert.equal(hourly[23].label,'23');
  assert.equal(hourly[23].loadKwh,24);
  assert.ok(offerEnergyChartRows(workspace,'2026-01','free').every(r=>r.loadKwh===null && r.importKwh===null));
  assert.ok(offerEnergyChartRows(workspace,'all','workday',true).every(r=>r.loadKwh===null && r.importKwh===null));
});

test('przyszły wykres używa prognozowanych pomiarów i energii bez zmiany serii mockupa', () => {
  const workspace = {
    clientType: 'B2C',
    measurements: { months: [], dayProfiles: [] },
  } as unknown as WorkspaceData;
  const forecast: OfferEnergyForecast = {
    measurements: {
      periods: [],
      months: [{ period: '2026-01', importKwh: 84, exportKwh: 22 }],
      dayProfiles: [{ period: '2026-01', date: '2026-01-05', dayType: 'workday', hours: [
        { hour: 0, importKwh: 4, exportKwh: 1 },
      ] }],
      totalsImportKwh: 84,
      totalsExportKwh: 22,
      intervalCount: 1,
      missingDirections: [],
      issues: [],
    },
    energy: {
      quality: 'MODELLED',
      source: 'test',
      model: 'test',
      months: [{ period: '2026-01', loadKwh: 120, pvKwh: 80, directKwh: 54 }],
      dayProfiles: [{ date: '2026-01-05', hours: [{ hour: 0, loadKwh: 6, pvKwh: 2, directKwh: 1 }] }],
      totals: { loadKwh: 120, pvKwh: 80, directKwh: 54 },
      issues: [],
      modelBelowExportKwh: 0,
    },
  };

  const annual = offerEnergyChartRows(workspace, 'all', 'workday', true, forecast);
  assert.deepEqual(annual.map(({ importKwh, exportKwh, loadKwh, pvKwh, directKwh }) => [importKwh, exportKwh, loadKwh, pvKwh, directKwh]), [
    [84, 22, 120, 80, 54],
  ]);
  const hourly = offerEnergyChartRows(workspace, '2026-01', 'workday', true, forecast);
  assert.deepEqual([hourly[0].importKwh, hourly[0].exportKwh, hourly[0].loadKwh, hourly[0].pvKwh], [4, 1, 6, 2]);
});

test('roczny profil RE zachowuje etykietę MODELLED i nie opisuje przepływów jako pomiarów operatora', () => {
  const labels = offerEnergyChartProvenance({
    quality: 'MODELLED', source: 'Roczne zużycie · profil godzinowy RE', model: 'RE · model PV',
    months: [], dayProfiles: [], totals: { loadKwh: 6000, pvKwh: 0, directKwh: 0 }, issues: [], modelBelowExportKwh: 0,
    modelledMeasurements: { provenance: { kind: 'annual-consumption', source: 'Roczne zużycie · profil godzinowy RE', annualConsumptionKwh: 6000 },
      months: [], dayProfiles: [], totalsImportKwh: 6000, totalsExportKwh: 0, intervalCount: 8760 },
  });

  assert.ok(labels);
  assert.match(labels.sourceNote, /MODELLED/u);
  assert.match(labels.sourceNote, /rocznej deklaracji RE/u);
  assert.doesNotMatch(labels.sourceNote, /pomiary operatora/u);
  assert.match(labels.sourceNote, /PV z modelu pogodowego/u);
  assert.equal(labels.periodAriaLabel, 'Miesiąc profilu modelowanego');
});

test('roczny profil z potwierdzonym brakiem PV nie opisuje produkcji z modelu pogodowego', () => {
  const labels = offerEnergyChartProvenance({
    quality: 'MODELLED', source: 'Roczne zużycie · profil godzinowy RE', model: 'RE · bez instalacji PV',
    months: [], dayProfiles: [], totals: { loadKwh: 6000, pvKwh: 0, directKwh: 0 }, issues: [], modelBelowExportKwh: 0,
    modelledMeasurements: { provenance: { kind: 'annual-consumption', source: 'Roczne zużycie · profil godzinowy RE', annualConsumptionKwh: 6000 },
      months: [], dayProfiles: [], totalsImportKwh: 6000, totalsExportKwh: 0, intervalCount: 8760 },
  });

  assert.ok(labels);
  assert.match(labels.sourceNote, /potwierdzono brak instalacji PV/u);
  assert.doesNotMatch(labels.sourceNote, /PV z modelu pogodowego/u);
});

const valuationValues = (overrides: Partial<OfferWorkspaceValuationValues> = {}): OfferWorkspaceValuationValues => ({
  importKwh: 100,
  exportKwh: 20,
  importValuePln: 125,
  exportValuePln: 4,
  averageBuyPlnPerKwh: 1.25,
  averageSellPlnPerKwh: 0.2,
  ...overrides,
});

test('offerChartValuation wybiera totals dla all, dokładny dzień reprezentatywny albo null', () => {
  const annual = valuationValues({ importValuePln: 1500 });
  const representativeDay = valuationValues({ importKwh: 8, exportKwh: 2, importValuePln: 10, exportValuePln: 0.4 });
  const scenario: OfferWorkspaceValuationScenario = {
    settlement: 'NET_BILLING',
    source: 'PROJECT_HISTORY',
    totals: annual,
    months: [{ period: '2026-01', ...valuationValues({ importValuePln: 130 }) }],
    days: [{ date: '2026-01-05', period: '2026-01', dayType: 'workday', totals: representativeDay, hours: [] }],
    issues: [],
  };

  assert.equal(offerChartValuation(scenario, 'all'), annual);
  assert.equal(offerChartValuation(scenario, '2026-01', '2026-01-05'), representativeDay);
  assert.equal(offerChartValuation(scenario, '2026-01', '2026-01-06'), null);
  assert.equal(offerChartValuation(scenario, '2026-02', '2026-02-02'), null);
  assert.equal(offerChartValuation(null, 'all'), null);
});

function renderSummary(netMetering: boolean, valuation: OfferWorkspaceValuationValues) {
  const rows: EnergyChartRow[] = [row(100), { ...row(100), exportKwh: 20, loadKwh: 120, pvKwh: 30, directKwh: 15 }];
  const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
  const previousReact = globalWithReact.React;
  globalWithReact.React = React;
  try {
    return renderToStaticMarkup(createElement(ChakraProvider, null, createElement(OfferEnergySummary, {
      rows,
      netMetering,
      b2b: false,
      valuation,
      sourceNote: 'Pomiary testowe',
    })));
  } finally {
    if (previousReact === undefined) delete globalWithReact.React;
    else globalWithReact.React = previousReact;
  }
}

test('OfferEnergySummary renderuje kwoty i średnie NET_BILLING, także wartości równe zero', () => {
  const markup = renderSummary(false, valuationValues({
    importValuePln: 0,
    exportValuePln: 1250.5,
    averageBuyPlnPerKwh: 0,
    averageSellPlnPerKwh: 0.125,
  }));

  assert.match(markup, /data-energy-value="import"[^>]*>0,00 zł/);
  assert.match(markup, /data-energy-value="export"[^>]*>1\s?250,50 zł/);
  assert.match(markup, /data-energy-price="buy"[^>]*>0,0000 zł\/kWh/);
  assert.match(markup, /data-energy-price="sell"[^>]*>0,1250 zł\/kWh/);
  assert.doesNotMatch(markup, /Rozliczenie ilościowe · opust/);
  assert.match(markup, /Pomiary testowe/);
});

test('OfferEnergySummary pokazuje opust ilościowy eksportu przy NET_METERING', () => {
  const markup = renderSummary(true, valuationValues({ importValuePln: 42.5, averageBuyPlnPerKwh: 0.425 }));

  assert.match(markup, /data-energy-value="import"[^>]*>42,50 zł/);
  assert.match(markup, /data-energy-price="buy"[^>]*>0,4250 zł\/kWh/);
  assert.equal((markup.match(/Rozliczenie ilościowe · opust/g) || []).length, 2);
  assert.doesNotMatch(markup, /data-energy-value="export"[^>]*>4,00 zł/);
  assert.doesNotMatch(markup, /data-energy-price="sell"[^>]*>0,2000 zł\/kWh/);
});
