import assert from 'node:assert/strict';
import test from 'node:test';
import type { CalculationResult } from './calculator';
import {
  previewTemplateItem,
  priceDifferenceColor,
  summarizeTemplatePricing,
  type TemplatePricingItem,
} from './template-manager-pricing';

function makeItem(overrides: Partial<TemplatePricingItem> = {}): TemplatePricingItem {
  return {
    description: 'Akumulator',
    quantity: 1,
    supplyMode: 'PURCHASE',
    pricingMode: 'INDIVIDUAL',
    operatingCostBasis: 'PER_LINE',
    unitPurchaseNet: 100,
    purchaseVatRate: 0.23,
    operatingCostNet: 0,
    marginRate: 0.3,
    saleVatRate: 0.23,
    ...overrides,
  };
}

function lineWithSaleNet(saleNet: number): CalculationResult {
  return {
    purchaseNet: 0,
    purchaseVatValue: 0,
    purchaseGross: 0,
    operatingCostNet: 0,
    totalCostNet: 0,
    marginNet: 0,
    saleNet,
    saleVatValue: 0,
    saleGross: saleNet,
    vatSurplus: 0,
    profitNet: 0,
    profitWithVatSurplus: 0,
  };
}

test('suggestion reflects current linked purchase price increases and decreases', () => {
  const currentProduct = {
    id: 'product-1',
    prices: [{ id: 'price-1', purchaseNet: 100, currentPurchaseNet: 120, purchaseVatRate: 0.23 }],
  };

  const increased = previewTemplateItem(makeItem({ productId: 'product-1', product: currentProduct }));
  assert.equal(increased.saved?.saleNet, 130);
  assert.equal(increased.suggested?.saleNet, 156);
  assert.equal(increased.difference, 26);
  assert.equal(priceDifferenceColor(increased.saved?.saleNet ?? null, increased.suggested?.saleNet ?? null), 'red.600');

  const decreased = previewTemplateItem(makeItem({
    productId: 'product-1',
    product: { ...currentProduct, prices: [{ ...currentProduct.prices[0], currentPurchaseNet: 80 }] },
  }));
  assert.equal(decreased.suggested?.saleNet, 104);
  assert.equal(priceDifferenceColor(decreased.saved?.saleNet ?? null, decreased.suggested?.saleNet ?? null), 'green.600');
});

test('suggestion uses explicit 30% markup even when saved and catalog margins are missing', () => {
  const preview = previewTemplateItem(makeItem({
    marginRate: undefined,
    productId: 'product-1',
    product: {
      prices: [{ purchaseNet: 100, currentPurchaseNet: 100, purchaseVatRate: 0.23 }],
    },
  }));

  assert.equal(preview.saved, null);
  assert.match(preview.savedError ?? '', /narzut/);
  assert.equal(preview.suggestedError, null);
  assert.equal(preview.suggestedCosts?.marginRate, 0.3);
  assert.equal(preview.suggested?.saleNet, 130);
});

test('saved preview uses manual unit sale while suggestion clears it and uses the 30% markup', () => {
  const preview = previewTemplateItem(makeItem({
    unitSaleNet: 12345.67,
    marginRate: undefined,
  }));

  assert.equal(preview.savedError, null);
  assert.equal(preview.saved?.saleNet, 12345.67);
  assert.equal(preview.saved?.rawSaleNet, 12345.67);
  assert.equal(preview.suggestedError, null);
  assert.equal(preview.suggested?.saleNet, 130);
});

test('linked individual suggestion keeps the operating cost basis and current purchase price', () => {
  const preview = previewTemplateItem(makeItem({
    quantity: 3,
    operatingCostNet: 7,
    operatingCostBasis: 'PER_LINE',
    productId: 'product-1',
    product: {
      prices: [{
        purchaseNet: 50,
        currentPurchaseNet: 60,
        purchaseVatRate: 0.08,
        operatingCostNet: 90,
        marginRate: 0.8,
      }],
    },
  }));

  assert.equal(preview.suggestedCosts?.unitPurchaseNet, 60);
  assert.equal(preview.suggestedCosts?.purchaseVatRate, 0.08);
  assert.equal(preview.suggestedCosts?.operatingCostNet, 7);
  assert.equal(preview.suggestedCosts?.operatingCostBasis, 'PER_LINE');
  assert.equal(preview.suggested?.totalCostNet, 187);
  assert.equal(preview.suggested?.saleNet, 243.1);
});

test('catalog suggestion uses current catalog purchase and per-unit operating costs', () => {
  const preview = previewTemplateItem(makeItem({
    quantity: 2,
    pricingMode: 'CATALOG',
    productId: 'product-1',
    product: {
      prices: [{
        id: 'price-new',
        purchaseNet: 80,
        currentPurchaseNet: 90,
        purchaseVatRate: 0.08,
        operatingCostNet: 10,
      }],
    },
  }));

  assert.equal(preview.suggestedError, null);
  assert.deepEqual(preview.suggestedCosts, {
    unitPurchaseNet: 90,
    purchaseVatRate: 0.08,
    operatingCostNet: 10,
    marginRate: 0.3,
    operatingCostBasis: 'PER_UNIT',
    catalogPriceId: 'price-new',
  });
  assert.equal(preview.suggested?.totalCostNet, 200);
  assert.equal(preview.suggested?.saleNet, 260);
});

test('missing catalog purchase is an error and ambiguous zero purchase requires review', () => {
  const missingCatalog = previewTemplateItem(makeItem({
    pricingMode: 'CATALOG',
    productId: 'product-1',
    product: { prices: [] },
  }));
  assert.equal(missingCatalog.suggested, null);
  assert.match(missingCatalog.suggestedError ?? '', /Brak aktualnej ceny katalogowej/);

  const ambiguousZero = previewTemplateItem(makeItem({
    productId: 'product-1',
    product: {
      prices: [{
        purchaseNet: 50,
        currentPurchaseNet: 0,
        purchaseVatRate: 0.23,
      }],
    },
  }));
  assert.equal(ambiguousZero.suggested, null);
  assert.match(ambiguousZero.suggestedError ?? '', /wymaga weryfikacji/);

  const nullHistoricalPurchase = previewTemplateItem(makeItem({
    productId: 'product-1',
    product: {
      prices: [{
        purchaseNet: null,
        currentPurchaseNet: 80,
        purchaseVatRate: 0.23,
      } as unknown as { purchaseNet: number; currentPurchaseNet: number; purchaseVatRate: number }],
    },
  }));
  assert.equal(nullHistoricalPurchase.suggested, null);
  assert.match(nullHistoricalPurchase.suggestedError ?? '', /cena zakupu katalogowa/);
});

test('quantity accepts numeric strings and rejects blank strings', () => {
  const numeric = previewTemplateItem(makeItem({ quantity: '2' }));
  assert.equal(numeric.saved?.saleNet, 260);
  assert.equal(numeric.suggested?.saleNet, 260);

  for (const value of ['', ' ', '\t']) {
    const blank = previewTemplateItem(makeItem({ quantity: value }));
    assert.equal(blank.saved, null);
    assert.equal(blank.suggested, null);
    assert.match(blank.savedError ?? '', /ilość/);
    assert.match(blank.suggestedError ?? '', /ilość/);
  }
});

test('suggestion rejects whitespace-only manual and catalog cost inputs', () => {
  const manualOperatingCost = previewTemplateItem(makeItem({ operatingCostNet: ' ' }));
  assert.equal(manualOperatingCost.suggested, null);
  assert.match(manualOperatingCost.suggestedError ?? '', /koszt firmy/);

  const manualPurchase = previewTemplateItem(makeItem({ unitPurchaseNet: '\t' }));
  assert.equal(manualPurchase.suggested, null);
  assert.match(manualPurchase.suggestedError ?? '', /cena pozycji ręcznej/);

  const manualVat = previewTemplateItem(makeItem({ purchaseVatRate: ' ' }));
  assert.equal(manualVat.suggested, null);
  assert.match(manualVat.suggestedError ?? '', /VAT pozycji ręcznej/);

  const linkedPurchase = previewTemplateItem(makeItem({
    productId: 'product-1',
    product: { prices: [{ purchaseNet: 100, currentPurchaseNet: ' ', purchaseVatRate: 0.23 }] },
  }));
  assert.equal(linkedPurchase.suggested, null);
  assert.match(linkedPurchase.suggestedError ?? '', /aktualna cena zakupu/);

  const linkedVat = previewTemplateItem(makeItem({
    productId: 'product-1',
    product: { prices: [{ purchaseNet: 100, currentPurchaseNet: 100, purchaseVatRate: ' ' }] },
  }));
  assert.equal(linkedVat.suggested, null);
  assert.match(linkedVat.suggestedError ?? '', /VAT zakupu/);

  const catalogOperatingCost = previewTemplateItem(makeItem({
    pricingMode: 'CATALOG',
    productId: 'product-1',
    product: { prices: [{ purchaseNet: 100, purchaseVatRate: 0.23, operatingCostNet: '\t' }] },
  }));
  assert.equal(catalogOperatingCost.suggested, null);
  assert.match(catalogOperatingCost.suggestedError ?? '', /koszt realizacji/);
});

test('excluded supply modes produce zero results without requiring pricing data', () => {
  for (const supplyMode of ['CLIENT_OWNED_USED', 'CLIENT_SUPPLIED_NEW', 'NOT_INCLUDED']) {
    const preview = previewTemplateItem(makeItem({
      supplyMode,
      quantity: Number.NaN,
      unitPurchaseNet: null,
      purchaseVatRate: null,
      operatingCostNet: null,
      marginRate: null,
      saleVatRate: null,
    }));
    assert.equal(preview.excluded, true);
    assert.equal(preview.savedError, null);
    assert.equal(preview.suggestedError, null);
    assert.equal(preview.difference, 0);
    assert.deepEqual(preview.saved, lineWithSaleNet(0));
    assert.deepEqual(preview.suggested, lineWithSaleNet(0));
  }
});

test('summary returns null for missing calculations and sums per-line rounded VAT', () => {
  assert.equal(summarizeTemplatePricing([
    previewTemplateItem(makeItem({ unitPurchaseNet: null })),
  ], 'saved'), null);

  const previews = [0.05, 0.05, 0.05].map((saleNet) => ({
    saved: lineWithSaleNet(saleNet),
    suggested: lineWithSaleNet(saleNet),
    suggestedCosts: null,
    savedError: null,
    suggestedError: null,
    excluded: false,
    difference: 0,
  }));
  assert.deepEqual(summarizeTemplatePricing(previews, 'saved'), {
    saleNet: 0.15,
    saleGross8: 0.15,
    saleGross23: 0.18,
    vatDifference: 0.03,
  });
});

test('summary calculates manual-price gross from the unrounded net', () => {
  const preview = previewTemplateItem(makeItem({
    unitPurchaseNet: 0,
    operatingCostNet: 0,
    marginRate: undefined,
    unitSaleNet: 0.02439024,
  }));
  const summary = summarizeTemplatePricing([preview], 'saved');

  assert.equal(preview.saved?.saleNet, 0.02);
  assert.equal(preview.saved?.rawSaleNet, 0.02439024);
  assert.equal(summary?.saleGross23, 0.03);
});

test('price difference color compares rounded cents and omits equal or absent values', () => {
  assert.equal(priceDifferenceColor(10, 10.004), undefined);
  assert.equal(priceDifferenceColor(10, 10.01), 'red.600');
  assert.equal(priceDifferenceColor(10, 9.99), 'green.600');
  assert.equal(priceDifferenceColor(null, 9), undefined);
});
