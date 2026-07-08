import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateConfigurationLine, sumConfiguration } from './calculator';

test('liczy pozycję B2C według jawnych formuł z kalkulatora', () => {
  const result = calculateConfigurationLine({
    quantity: 1,
    unitPurchaseNet: 6818,
    purchaseVatRate: 0.23,
    operatingCostNet: 200,
    marginRate: 0.3,
    saleVatRate: 0.08,
  });

  assert.equal(result.purchaseNet, 6818);
  assert.equal(result.purchaseGross, 8386.14);
  assert.equal(result.totalCostNet, 7018);
  assert.equal(result.marginNet, 2105.4);
  assert.equal(result.saleNet, 9123.4);
  assert.equal(result.saleGross, 9853.27);
  assert.equal(result.vatSurplus, 838.27);
  assert.equal(result.profitNet, 2105.4);
  assert.equal(result.profitWithVatSurplus, 2943.67);
});

test('liczy B2B bez nadwyżki VAT, kiedy konfiguracja jej nie stosuje', () => {
  const result = calculateConfigurationLine({
    quantity: 12,
    unitPurchaseNet: 3159,
    purchaseVatRate: 0.23,
    operatingCostNet: 300,
    marginRate: 0.3,
    saleVatRate: 0.23,
    includeVatSurplus: false,
  });

  assert.equal(result.purchaseNet, 37908);
  assert.equal(result.totalCostNet, 38208);
  assert.equal(result.marginNet, 11462.4);
  assert.equal(result.saleGross, 61094.59);
  assert.equal(result.vatSurplus, 0);
  assert.equal(result.profitWithVatSurplus, 11462.4);
});

test('sumuje zestaw PV/magazyn bez utraty groszy', () => {
  const totals = sumConfiguration([
    {
      quantity: 12,
      unitPurchaseNet: 329,
      purchaseVatRate: 0.23,
      operatingCostNet: 200,
      marginRate: 0.3,
      saleVatRate: 0.08,
    },
    {
      quantity: 1,
      unitPurchaseNet: 5127,
      purchaseVatRate: 0.23,
      operatingCostNet: 100,
      marginRate: 0.3,
      saleVatRate: 0.08,
    },
  ]);

  assert.equal(totals.lines.length, 2);
  assert.equal(totals.purchaseNet, 9075);
  assert.equal(totals.totalCostNet, 9375);
  assert.equal(totals.saleGross, 13162.5);
  assert.equal(totals.profitNet, 2812.5);
});
