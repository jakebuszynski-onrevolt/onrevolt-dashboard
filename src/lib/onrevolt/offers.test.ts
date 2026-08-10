import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
