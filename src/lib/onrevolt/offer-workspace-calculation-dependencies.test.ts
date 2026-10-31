import test from 'node:test';
import assert from 'node:assert/strict';
import { offerCalculationDependencyHash, offerCalculationPeriodHours } from './offer-workspace-calculation-dependencies';

test('dependency hash is stable across property order and detects price corrections', () => {
  const left = { tariff: { revision: 1, price: 0.5 }, market: new Map([['b', 2], ['a', 1]]) };
  assert.equal(offerCalculationDependencyHash(left), offerCalculationDependencyHash({ market: new Map([['a', 1], ['b', 2]]), tariff: { price: 0.5, revision: 1 } }));
  assert.notEqual(offerCalculationDependencyHash(left), offerCalculationDependencyHash({ ...left, tariff: { revision: 1, price: 0.6 } }));
  assert.notEqual(offerCalculationDependencyHash(left), offerCalculationDependencyHash({ ...left, market: new Map([['b', 2], ['a', 1.1]]) }));
});

test('dependency range covers Warsaw calendar months across both DST changes', () => {
  const months = Array.from({ length: 12 }, (_, index) => ({ period: `2026-${String(index + 1).padStart(2, '0')}` }));
  const hours = offerCalculationPeriodHours(months)!;
  assert.equal(hours.length, 8760);
  assert.equal(hours[0], '2025-12-31T23:00:00.000Z');
  assert.equal(hours.at(-1), '2026-12-31T22:00:00.000Z');
  assert.equal(new Set(hours).size, hours.length);
  assert.equal(offerCalculationPeriodHours(months.slice(1)), null);
  assert.equal(offerCalculationPeriodHours([...months.slice(0, 11), months[0]]), null);
});
