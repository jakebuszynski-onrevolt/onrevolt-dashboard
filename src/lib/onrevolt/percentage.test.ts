import assert from 'node:assert/strict';
import test from 'node:test';
import { percentFormValueToRate, rateToPercentFormValue } from './percentage';

test('converts stored rates to percentages used by forms', () => {
  assert.equal(rateToPercentFormValue('0.23'), '23');
  assert.equal(rateToPercentFormValue(0.3), '30');
  assert.equal(rateToPercentFormValue(null), '');
});

test('converts form percentages to stored rates and accepts a Polish decimal comma', () => {
  assert.equal(percentFormValueToRate('23'), 0.23);
  assert.equal(percentFormValueToRate('8,5'), 0.085);
  assert.equal(percentFormValueToRate(''), 0);
});
