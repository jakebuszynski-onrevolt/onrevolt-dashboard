import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOfferScenarioInput,
  mergeConfigurationLineItems,
  normalizeOfferConfigurationIds,
  offerDeleteBlockReason,
} from './offers';

test('oferta zachowuje konfigurację główną i usuwa powtórzenia', () => {
  assert.deepEqual(
    normalizeOfferConfigurationIds(['pv', 'battery', 'pv'], 'battery'),
    ['battery', 'pv'],
  );
});

test('pozycje kilku konfiguracji tworzą jeden uporządkowany snapshot', () => {
  const lines = mergeConfigurationLineItems([
    {
      id: 'battery',
      name: 'Magazyn 32 kWh',
      kind: 'ENERGY_STORAGE',
      items: [
        { position: 2, description: 'Falownik', quantity: 1, saleNet: 1000, saleGross: 1080, saleVatRate: 0.08 },
        { position: 1, description: 'Magazyn', quantity: 1, saleNet: 2000, saleGross: 2160, saleVatRate: 0.08 },
      ],
    },
    {
      id: 'pv',
      name: 'Instalacja PV 6 kWp',
      kind: 'PV',
      items: [
        { position: 1, description: 'Panele PV', quantity: 12, saleNet: 3000, saleGross: 3240, saleVatRate: 0.08 },
      ],
    },
  ]);

  assert.deepEqual(lines.map((line) => line.position), [1, 2, 3]);
  assert.deepEqual(lines.map((line) => line.description), ['Magazyn', 'Falownik', 'Panele PV']);
  assert.deepEqual(lines.map((line) => line.sourceConfigurationId), ['battery', 'battery', 'pv']);
  assert.equal(lines[2].sourceConfigurationName, 'Instalacja PV 6 kWp');
});

test('ofertę można usunąć tylko bez dalszych powiązań', () => {
  assert.equal(offerDeleteBlockReason({ contracts: 0, installations: 0, purchaseOrders: 0 }), null);
  assert.match(offerDeleteBlockReason({ contracts: 1, installations: 0, purchaseOrders: 0 }) || '', /umowę/);
  assert.match(offerDeleteBlockReason({ contracts: 0, installations: 1, purchaseOrders: 0 }) || '', /montażu/);
  assert.match(offerDeleteBlockReason({ contracts: 0, installations: 0, purchaseOrders: 1 }) || '', /zamówieniem/);
});

test('przeliczenie tworzy pełny scenariusz z rocznego zużycia i dwóch konfiguracji', () => {
  const input = buildOfferScenarioInput({
    annualConsumptionKwh: 5220,
    profileSource: 'ANNUAL_DECLARATION',
    configurations: [
      { name: 'Instalacja PV 5,7 kWp', kind: 'PV_DACH_SKOSNY', targetPowerKw: 5.7 },
      { name: 'Magazyn 16 kWh', kind: 'MAGAZYN', targetPowerKw: 10, targetCapacityKwh: 16 },
    ],
    investmentGross: 40059.12,
  });

  assert.equal(Math.round(input.monthlyConsumptionKwh.reduce((sum, value) => sum + value, 0)), 5220);
  assert.equal(input.pvPowerKw, 5.7);
  assert.equal(input.batteryCapacityKwh, 16);
  assert.equal(input.batteryMaxChargeKw, 10);
  assert.equal(input.investmentGross, 40059.12);
});

test('przeliczenie uwzględnia istniejącą instalację klienta', () => {
  const input = buildOfferScenarioInput({
    annualConsumptionKwh: 6000,
    profileSource: 'ANNUAL_DECLARATION',
    configurations: [
      { name: 'Rozbudowa PV', kind: 'PV_DACH_PLASKI', targetPowerKw: 4 },
      { name: 'Nowy magazyn', kind: 'MAGAZYN', targetPowerKw: 8, targetCapacityKwh: 12 },
    ],
    existingPvKw: 5,
    existingBatteryKwh: 4,
    investmentGross: 30000,
  });

  assert.equal(input.pvPowerKw, 9);
  assert.equal(input.batteryCapacityKwh, 16);
});

test('przeliczenie wskazuje niekompletną konfigurację zamiast używać starej mocy', () => {
  assert.throws(() => buildOfferScenarioInput({
    annualConsumptionKwh: 5000,
    configurations: [{ name: 'PV bez mocy', kind: 'PV_DACH_SKOSNY', targetPowerKw: null }],
    investmentGross: 20000,
  }), /moc docelowa PV/);
});
