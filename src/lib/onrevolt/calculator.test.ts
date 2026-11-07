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
  assert.equal(Object.hasOwn(result, 'rawSaleNet'), false);
});

test('ręczna cena sprzedaży wyznacza zysk i marżę od kosztu oraz liczy VAT z niezaokrąglonej sumy', () => {
  const result = calculateConfigurationLine({
    quantity: 1,
    unitPurchaseNet: 10000,
    purchaseVatRate: 0.23,
    operatingCostNet: 0,
    marginRate: 0.3,
    saleVatRate: 0.23,
    unitSaleNet: 12345.67,
  });

  assert.equal(result.totalCostNet, 10000);
  assert.equal(result.saleNet, 12345.67);
  assert.equal(result.rawSaleNet, 12345.67);
  assert.equal(result.saleGross, 15185.17);
  assert.equal(result.saleVatValue, 2839.5);
  assert.equal(result.marginNet, 2345.67);
  assert.equal(result.profitNet, 2345.67);
});

test('ręczna cena mnoży się przez ilość, a koszt PER_LINE pozostaje naliczany raz', () => {
  const result = calculateConfigurationLine({
    quantity: 3,
    unitPurchaseNet: 100,
    purchaseVatRate: 0.23,
    operatingCostNet: 10,
    operatingCostBasis: 'PER_LINE',
    marginRate: 0.3,
    saleVatRate: 0.23,
    unitSaleNet: 12345.67,
  });

  assert.equal(result.rawSaleNet, 37037.01);
  assert.equal(result.saleNet, 37037.01);
  assert.equal(result.totalCostNet, 310);
  assert.equal(result.saleGross, 45555.52);
  assert.equal(result.profitNet, 36727.01);
});

test('ręczna cena obsługuje zerowy koszt i dodatnią sprzedaż', () => {
  const result = calculateConfigurationLine({
    quantity: 1,
    unitPurchaseNet: 0,
    purchaseVatRate: 0.23,
    operatingCostNet: 0,
    marginRate: 0,
    saleVatRate: 0.23,
    unitSaleNet: 50,
  });

  assert.equal(result.totalCostNet, 0);
  assert.equal(result.marginNet, 50);
  assert.equal(result.profitNet, 50);
});

test('VAT sprzedaży zaokrągla brutto z dokładnej ręcznej ceny jednostkowej', () => {
  const result = calculateConfigurationLine({
    quantity: 1,
    unitPurchaseNet: 0,
    purchaseVatRate: 0.23,
    operatingCostNet: 0,
    marginRate: 0,
    saleVatRate: 0.23,
    unitSaleNet: 0.02439024,
  });

  assert.equal(result.rawSaleNet, 0.02439024);
  assert.equal(result.saleNet, 0.02);
  assert.equal(result.saleGross, 0.03);
  assert.equal(result.saleVatValue, 0.01);
});

test('wymuszona cena nadal ma pierwszeństwo przed ręczną ceną jednostkową', () => {
  const result = calculateConfigurationLine({
    quantity: 2,
    unitPurchaseNet: 100,
    purchaseVatRate: 0.23,
    operatingCostNet: 0,
    marginRate: 0.3,
    saleVatRate: 0.23,
    forcedSaleNet: 250,
    unitSaleNet: 200,
  });

  assert.equal(result.saleNet, 250);
  assert.equal(Object.hasOwn(result, 'rawSaleNet'), false);
});

test('kalkulator odrzuca ujemną, nieskończoną i nienumeryczną ręczną cenę', () => {
  for (const unitSaleNet of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => calculateConfigurationLine({
      quantity: 1,
      unitPurchaseNet: 0,
      purchaseVatRate: 0.23,
      operatingCostNet: 0,
      marginRate: 0,
      saleVatRate: 0.23,
      unitSaleNet,
    }), /cena sprzedaży|Nieprawidłowa wartość pola unitSaleNet/i);
  }
});

test('kalkulator odrzuca ręczną sumę netto lub brutto poza limitem Decimal(12,2)', () => {
  for (const [unitSaleNet, quantity] of [[5_000_000_000, 2], [8_200_000_000, 1]]) {
    assert.throws(() => calculateConfigurationLine({
      quantity,
      unitPurchaseNet: 0,
      purchaseVatRate: 0.23,
      operatingCostNet: 0,
      marginRate: 0,
      saleVatRate: 0.23,
      unitSaleNet,
    }), /Łączna cena pozycji przekracza limit/);
  }
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
