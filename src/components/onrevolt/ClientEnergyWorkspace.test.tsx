import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

(require as any).extensions['.css'] = (module: any) => {
  module.exports = { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
};

test('formularz ma cztery sekcje, magazyn bez PV i zachowuje źródła danych', async () => {
  const { default: Workspace } = await import('./ClientEnergyWorkspace');
  const html = renderToStaticMarkup(createElement(Workspace, {
    settings: { hasOperatorData: true, hasEnergyInvoices: true, annualConsumptionKwh: '3000',
      terrainType: '', buildingType: '', roofShape: '', settlementSystem: '', energySupplier: '',
      connectionType: '', heatingSource: '', heatingSourceDetail: '', connectionPowerKw: '',
      existingPvKw: '0', existingBatteryKwh: '16', phaseCount: '' },
    onChange() {}, operator: 'ENEA', tariff: 'G11', onAccountChange() {}, catalog: [],
    catalogLoading: false, hasTariffHistory: false, tariffSummary: 'Historia taryf',
    range: '', measurementMonths: 0, invoiceCount: 0, annualKwh: 3000,
    annualSource: 'Deklaracja klienta', manualAnnualVisible: false,
    measurements: 'Zachowany import ENEA', invoices: 'Zachowane faktury OCR', summary: 'Podsumowanie rzeczywistych danych',
    saving: true, onSave() {}, onPrepareOffer() {},
  }));
  assert.equal((html.match(/data-energy-section=/g) || []).length, 4);
  assert.match(html, /Istniejący magazyn energii/);
  assert.match(html, /Puste pole lub 0 kWh oznacza brak istniejącego magazynu energii/);
  assert.match(html, /value="16"/);
  assert.doesNotMatch(html, /Moc istniejącej instalacji PV/);
  assert.match(html, /Zachowany import ENEA/);
  assert.match(html, /Zachowane faktury OCR/);
  assert.match(html, /Historia taryf/);
  assert.match(html, /disabled=""[^>]*>Przygotuj ofertę/);
});

test('integracja zachowuje synchronizację, zapis i blokuje ofertę po błędzie zapisu', () => {
  const source = readFileSync('src/components/onrevolt/ClientProfile.tsx', 'utf8');
  assert.match(source, /if \(!await saveEnergyOverview\(true\)\) return;/);
  assert.match(source, /setActiveJourneyKey\('offer'\)/);
  assert.match(source, /variant="energy" mode="invoices"/);
  assert.match(source, /uploadEnergyXlsxFiles\(event\.dataTransfer\.files\)/);
  assert.match(source, /meterNumber: energyAccount\.meterNumber/);
  assert.match(source, /phaseCount: energyDataSettings\.phaseCount/);
});
