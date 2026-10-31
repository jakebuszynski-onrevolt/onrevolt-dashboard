import assert from 'node:assert/strict';
import test from 'node:test';
import { optionalNullableEnergyNumber } from './energy-audit-values';

test('jawne usunięcie liczby różni się od pominięcia i potwierdzonego zera', () => {
  assert.equal(optionalNullableEnergyNumber(null), null);
  assert.equal(optionalNullableEnergyNumber(undefined), undefined);
  assert.equal(optionalNullableEnergyNumber(''), undefined);
  assert.equal(optionalNullableEnergyNumber('0'), 0);
  assert.equal(optionalNullableEnergyNumber('9.9'), 9.9);
  assert.equal(optionalNullableEnergyNumber(3), 3);
  for (const value of [true, false, [], {}, ' ', -1, 'NaN', Infinity]) {
    assert.throws(() => optionalNullableEnergyNumber(value));
  }
});
