import assert from 'node:assert/strict';
import test from 'node:test';
import { productDeleteBlockReason, ProductUsageCounts } from './product-lifecycle';

const emptyCounts: ProductUsageCounts = {
  templateItems: 0,
  configItems: 0,
  existingAssets: 0,
  installationPlannedItems: 0,
  installed: 0,
  purchaseOrderItems: 0,
  stockReservations: 0,
};

test('pozwala usunąć produkt bez powiązań', () => {
  assert.equal(productDeleteBlockReason(emptyCounts), null);
});

test('wskazuje wszystkie miejsca użycia produktu', () => {
  const reason = productDeleteBlockReason({
    ...emptyCounts,
    templateItems: 2,
    installed: 1,
    purchaseOrderItems: 3,
  });

  assert.match(reason || '', /szablonach konfiguracji: 2/);
  assert.match(reason || '', /zamontowanych urządzeniach: 1/);
  assert.match(reason || '', /zamówieniach: 3/);
});
