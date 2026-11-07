import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTemplateSaleVat, parseSaleAmount, saleInputToUnitNet, templateLineSaleAmount } from './template-sale-input';

test('B2C uses 8%, B2B 23%, a shared variant requires an explicit selection', () => {
  assert.equal(defaultTemplateSaleVat('B2C'), .08);
  assert.equal(defaultTemplateSaleVat('B2B'), .23);
  assert.equal(defaultTemplateSaleVat('B2C_B2B'), null);
});

test('unit sale entry supports Polish decimals and preserves precise net behind gross cents', () => {
  assert.equal(parseSaleAmount('12,34'), 12.34);
  assert.equal(saleInputToUnitNet('12345,67', 'net', .08), '12345.67000000');
  assert.equal(saleInputToUnitNet('108', 'gross', .08), '100.00000000');
  assert.equal(saleInputToUnitNet('123', 'gross', .23), '100.00000000');
  assert.equal(saleInputToUnitNet('0,03', 'gross', .23), '0.02439024');
  assert.equal(saleInputToUnitNet('0', 'net', null), '0.00000000');
});

test('invalid or unfinished price is not converted to zero and gross needs an explicit VAT', () => {
  for (const value of ['', ' ', '-', '-1', '12x', '1.234', '10000000000']) assert.throws(() => parseSaleAmount(value));
  assert.throws(() => saleInputToUnitNet('123', 'gross', null), /VAT/);
});

test('B2C line shows gross with chosen VAT, B2B shows net including manual gross precision', () => {
  assert.equal(templateLineSaleAmount({ saleNet: 300 }, 'B2C', .08), 324);
  assert.equal(templateLineSaleAmount({ saleNet: 300 }, 'B2B', .23), 300);
  assert.equal(templateLineSaleAmount({ saleNet: .02, rawSaleNet: .02439024 }, 'B2C', .23), .03);
  assert.equal(templateLineSaleAmount(null, 'B2B', .23), null);
});
