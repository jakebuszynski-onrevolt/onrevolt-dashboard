import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSaleVatRate } from 'lib/onrevolt/configuration-vat';
import { resolveTemplateItemSaleVat } from 'lib/onrevolt/configuration-templates';
import {
  applyConfigItemFieldEdit,
  calculateItems,
  configurationItemsFromConfiguration,
  defaultOperatingCostBasis,
  defaultPricingModeForProduct,
  isStaleCatalogPrice,
  itemFromProduct,
  itemFromTemplate,
  itemToPayload,
  needsLegacyCostReview,
} from './ConfiguratorWorkspace';

test('nowe pozycje produktowe dziedziczą katalog, a ręczne rozpoczynają jako indywidualne', () => {
  assert.equal(defaultPricingModeForProduct('product-1'), 'CATALOG');
  assert.equal(defaultPricingModeForProduct(), 'INDIVIDUAL');
  assert.equal(defaultOperatingCostBasis('CATALOG'), 'PER_UNIT');
  assert.equal(defaultOperatingCostBasis('INDIVIDUAL'), 'PER_UNIT');
  assert.equal(defaultOperatingCostBasis('LEGACY'), 'PER_LINE');

  const product = itemFromProduct({
    id: 'product-1', name: 'Moduł', category: 'FOTOWOLTAIKA', prices: [{
      id: 'price-2', purchaseNet: 100, purchaseVatRate: 0.23, operatingCostNet: 12,
      marginRate: 0.2, saleVatRate: 0.08,
    }],
  });
  assert.equal(product.pricingMode, 'CATALOG');
  assert.equal(product.operatingCostBasis, 'PER_UNIT');
  assert.equal(product.catalogPriceId, 'price-2');
  assert.equal(product.operatingCostNet, '12');
  assert.equal(product.saleVatRate, '8');

  const manual = itemFromProduct();
  assert.equal(manual.pricingMode, 'INDIVIDUAL');
  assert.equal(manual.operatingCostBasis, 'PER_UNIT');
});

test('szablon CATALOG pobiera wszystkie koszty z najnowszej ceny produktu', () => {
  const item = itemFromTemplate({
    id: 'template-item', productId: 'product-1', position: 1, quantity: 2,
    role: 'MAIN_EQUIPMENT', supplyMode: 'ONREVOLT_SUPPLIED', pricingMode: 'CATALOG',
    operatingCostBasis: 'PER_UNIT', unitPurchaseNet: 999, purchaseVatRate: 0.05,
    operatingCostNet: 999, marginRate: 0.9,
    product: { id: 'product-1', name: 'Moduł', category: 'FOTOWOLTAIKA', prices: [{
      id: 'price-latest', purchaseNet: 110, purchaseVatRate: 0.23, operatingCostNet: 14,
      marginRate: 0.25, saleVatRate: 0.08,
    }] },
  });

  assert.equal(item.unitPurchaseNet, '110');
  assert.equal(item.purchaseVatRate, '23');
  assert.equal(item.operatingCostNet, '14');
  assert.equal(item.marginRate, '25');
  assert.equal(item.saleVatRate, '8');
  assert.equal(item.catalogPriceId, 'price-latest');
  assert.equal(item.operatingCostBasis, 'PER_UNIT');
});

test('pozycje legacy zachowują koszt za pozycję i wymagają jawnego przeglądu przy ilości większej niż jeden', () => {
  const legacy = { pricingMode: 'LEGACY' as const, operatingCostBasis: 'PER_LINE' as const, quantity: '3' };
  assert.equal(needsLegacyCostReview(legacy), true);
  assert.equal(needsLegacyCostReview({ ...legacy, pricingMode: 'INDIVIDUAL' }), true);
  assert.equal(needsLegacyCostReview({ ...legacy, quantity: '1' }), false);
  assert.equal(needsLegacyCostReview({ ...legacy, operatingCostBasis: 'PER_UNIT' }), false);
  assert.equal(needsLegacyCostReview({ ...legacy, pricingMode: 'CATALOG' }), false);
});

test('różny identyfikator najnowszej ceny oznacza nieaktualną migawkę katalogową', () => {
  const products = [{ id: 'product-1', name: 'Moduł', category: 'FOTOWOLTAIKA', prices: [{
    id: 'price-current', purchaseNet: 100, purchaseVatRate: 0.23, operatingCostNet: 10, marginRate: 0.2,
  }] }];
  assert.equal(isStaleCatalogPrice({ productId: 'product-1', pricingMode: 'CATALOG', catalogPriceId: 'price-old' }, products), true);
  assert.equal(isStaleCatalogPrice({ productId: 'product-1', pricingMode: 'CATALOG', catalogPriceId: 'price-current' }, products), false);
  assert.equal(isStaleCatalogPrice({ productId: 'product-1', pricingMode: 'INDIVIDUAL', catalogPriceId: 'price-old' }, products), false);
});

test('niejednoznaczna cena katalogowa nie jest po cichu zastępowana ceną bazową', () => {
  const item = itemFromProduct({
    id: 'product-1', name: 'Moduł', category: 'FOTOWOLTAIKA', prices: [{
      id: 'price-ambiguous', purchaseNet: 100, currentPurchaseNet: 0,
      purchaseVatRate: 0.23, operatingCostNet: 12, marginRate: 0.2,
    }],
  });
  assert.equal(item.pricingMode, 'CATALOG');
  assert.equal(item.unitPurchaseNet, '');
  assert.equal(item.requiresReview, true);
  assert.match(item.notes, /weryfikacji/);
  const totals = calculateItems([item], 'MIXED');
  assert.equal(totals.pricingComplete, false);
  assert.equal(totals.purchaseNet, null);
  assert.equal(totals.saleGross, null);
});

test('po zapisie edytor odtwarza pozycje z ID zwróconymi przez PUT i czyści flagi jednorazowe', () => {
  const savedItem = {
    id: 'database-row-after-put',
    productId: 'product-1',
    position: 1,
    description: 'Moduł',
    quantity: 2,
    role: 'MAIN_EQUIPMENT',
    supplyMode: 'ONREVOLT_SUPPLIED',
    unitPurchaseNet: 125,
    purchaseVatRate: 0.23,
    operatingCostNet: 8,
    marginRate: 0.2,
    unitSaleNet: 125.12345678,
    saleVatRate: 0.08,
    pricingMode: 'CATALOG',
    operatingCostBasis: 'PER_UNIT',
    catalogPriceId: 'price-saved',
    isOptional: false,
    requiresReview: false,
    _requireCurrentCatalogPrice: true,
    _recalculateCatalogPrice: true,
    _previewCatalogSaleVat: true,
  } as unknown as Parameters<typeof configurationItemsFromConfiguration>[0]['items'][number];

  const [hydrated] = configurationItemsFromConfiguration({ items: [savedItem] });
  assert.equal(hydrated.id, 'database-row-after-put');
  assert.equal(hydrated.catalogPriceId, 'price-saved');
  assert.equal(hydrated.requireCurrentCatalogPrice, undefined);
  assert.equal(hydrated.recalculateCatalogPrice, undefined);
  assert.equal(hydrated.previewCatalogSaleVat, undefined);
  assert.equal(hydrated.unitSaleNet, '125.12345678');
  assert.equal(calculateItems([hydrated], 'MIXED').saleNet, 250.25);
  assert.equal(calculateItems([hydrated], 'MIXED').saleGross, 270.27);
  assert.equal(itemToPayload(hydrated, 'MIXED').unitSaleNet, 125.12345678);

  const afterMarginEdit = applyConfigItemFieldEdit(hydrated, 'marginRate', '35');
  assert.equal(afterMarginEdit.unitSaleNet, null);
  assert.equal(itemToPayload(afterMarginEdit, 'MIXED').unitSaleNet, null);
  const afterCostEdit = applyConfigItemFieldEdit(hydrated, 'operatingCostNet', '9');
  assert.equal(afterCostEdit.unitSaleNet, '125.12345678');
  assert.equal(itemToPayload(afterCostEdit, 'MIXED').unitSaleNet, 125.12345678);
});

test('VAT mieszany korzysta z ceny katalogowej, a jawny tryb globalny nadal ma pierwszeństwo', () => {
  const saleVatRate = resolveTemplateItemSaleVat({
    productId: 'product-1',
    pricingMode: 'CATALOG',
    product: { name: 'Moduł', prices: [{
      id: 'price-1', purchaseNet: 100, purchaseVatRate: 0.23,
      operatingCostNet: 10, marginRate: 0.2, saleVatRate: 0.08,
    }] },
  });

  assert.equal(resolveSaleVatRate('MIXED', saleVatRate), 0.08);
  assert.equal(resolveSaleVatRate('REDUCED_8', saleVatRate), 0.08);
  assert.equal(resolveSaleVatRate('STANDARD_23', saleVatRate), 0.23);
});

test('stały VAT nie wymaga brakującej stawki produktu, lecz mieszany wymaga jawnego VAT pozycji', () => {
  const item = {
    id: 'template-item', productId: 'product-1', position: 1, quantity: 1,
    role: 'MAIN_EQUIPMENT', supplyMode: 'ONREVOLT_SUPPLIED', pricingMode: 'CATALOG' as const,
    unitPurchaseNet: 100, purchaseVatRate: 0.23, operatingCostNet: 10, marginRate: 0.2,
    product: { id: 'product-1', name: 'Moduł', category: 'FOTOWOLTAIKA', prices: [{
      id: 'price-1', purchaseNet: 100, purchaseVatRate: 0.23,
      operatingCostNet: 10, marginRate: 0.2, saleVatRate: null,
    }] },
  };

  assert.equal(itemFromTemplate(item, false).saleVatRate, '');
  assert.throws(() => itemFromTemplate(item, true), /VAT sprzedaży/);
});
