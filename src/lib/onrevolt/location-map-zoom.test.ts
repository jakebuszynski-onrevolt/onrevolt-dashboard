import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOCATION_MAP_ZOOM,
  MAX_LOCATION_MAP_ZOOM,
  MIN_LOCATION_MAP_ZOOM,
  validateLocationMapZoom,
} from './location-map-zoom';

test('location map zoom defaults to 21 and accepts the inclusive supported range', () => {
  assert.equal(DEFAULT_LOCATION_MAP_ZOOM, 21);
  assert.equal(MIN_LOCATION_MAP_ZOOM, 18);
  assert.equal(MAX_LOCATION_MAP_ZOOM, 22);
  assert.equal(validateLocationMapZoom(), 21);
  assert.equal(validateLocationMapZoom(18), 18);
  assert.equal(validateLocationMapZoom(22), 22);
});

test('location map zoom rejects values outside the range and non-integers', () => {
  for (const value of [17, 23, 18.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => validateLocationMapZoom(value));
  }
});
