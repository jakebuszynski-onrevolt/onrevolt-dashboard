import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSaleVatRateForMode,
  defaultVatModeForClientType,
  resolveSaleVatRate,
  vatBreakdown,
} from './configuration-vat';

test('proposes configuration VAT from the client type', () => {
  assert.equal(defaultVatModeForClientType('B2C'), 'REDUCED_8');
  assert.equal(defaultVatModeForClientType('B2B'), 'STANDARD_23');
  assert.equal(defaultVatModeForClientType('UNKNOWN'), 'REVIEW');
});

test('configuration rate overrides line rate outside mixed mode', () => {
  assert.equal(defaultSaleVatRateForMode('REDUCED_8'), 0.08);
  assert.equal(resolveSaleVatRate('STANDARD_23', 0.08), 0.23);
  assert.equal(resolveSaleVatRate('MIXED', 0.08), 0.08);
});

test('groups offer VAT by rate', () => {
  assert.deepEqual(vatBreakdown([
    { saleNet: 1000, saleGross: 1080, saleVatRate: 0.08 },
    { saleNet: 500, saleGross: 540, saleVatRate: 0.08 },
    { saleNet: 200, saleGross: 246, saleVatRate: 0.23 },
    { saleNet: 0, saleGross: 0, saleVatRate: 0 },
  ]), [
    { rate: 0.08, net: 1500, vat: 120, gross: 1620 },
    { rate: 0.23, net: 200, vat: 46, gross: 246 },
  ]);
});
