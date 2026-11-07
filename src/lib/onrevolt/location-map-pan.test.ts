import assert from 'node:assert/strict';
import test from 'node:test';
import { toPolish1992 } from './location-maps';
import {
  LOCATION_MAP_IMAGE_HEIGHT,
  LOCATION_MAP_IMAGE_WIDTH,
  LOCATION_MAP_WEB_MERCATOR_WORLD_SIZE,
  panLocationMapCenter,
} from './location-map-pan';
import { DEFAULT_LOCATION_MAP_ZOOM } from './location-map-zoom';

test('zero movement preserves the exact center', () => {
  const center = { latitude: 52.2297, longitude: 21.0122 };
  assert.deepEqual(panLocationMapCenter(center.latitude, center.longitude, 'GOOGLE', 0, 0, 640, 454), center);
  assert.deepEqual(panLocationMapCenter(center.latitude, center.longitude, 'GEOPORTAL2', 0, 0, 640, 454), center);
});

test('moving the image right and down moves the center west and north', () => {
  const center = panLocationMapCenter(52, 19, 'GOOGLE', 24, 18, 640, 454);
  assert.ok(center.longitude < 19);
  assert.ok(center.latitude > 52);
});

test('responsive scaling preserves the same geographic movement', () => {
  const atHalfSize = panLocationMapCenter(52, 19, 'ARCGIS', 32, 22.7, 640, 454);
  const atFullSize = panLocationMapCenter(52, 19, 'ARCGIS', 64, 45.4, 1280, 908);
  assert.ok(Math.abs(atHalfSize.latitude - atFullSize.latitude) < 1e-10);
  assert.ok(Math.abs(atHalfSize.longitude - atFullSize.longitude) < 1e-10);

  const expectedNativeDx = (64 * LOCATION_MAP_IMAGE_WIDTH) / 1280;
  const expectedNativeDy = (45.4 * LOCATION_MAP_IMAGE_HEIGHT) / 908;
  assert.equal(expectedNativeDx, 64);
  assert.equal(expectedNativeDy, 45.4);
  assert.equal(LOCATION_MAP_WEB_MERCATOR_WORLD_SIZE, 256 * (2 ** 21));
});

test('omitting zoom preserves the existing zoom 21 pan result', () => {
  const implicitZoom = panLocationMapCenter(52, 19, 'GOOGLE', 73, -31, 640, 454);
  const explicitDefault = panLocationMapCenter(52, 19, 'GOOGLE', 73, -31, 640, 454, DEFAULT_LOCATION_MAP_ZOOM);
  assert.deepEqual(implicitZoom, explicitDefault);
});

test('zoom scales geographic pan inversely for Web Mercator and Geoportal', () => {
  const mercatorAt21 = panLocationMapCenter(52, 19, 'GOOGLE', 32, 0, 640, 454, 21);
  const mercatorAt20 = panLocationMapCenter(52, 19, 'GOOGLE', 32, 0, 640, 454, 20);
  const mercatorAt22 = panLocationMapCenter(52, 19, 'GOOGLE', 32, 0, 640, 454, 22);
  assert.ok(Math.abs((19 - mercatorAt20.longitude) - (2 * (19 - mercatorAt21.longitude))) < 1e-7);
  assert.ok(Math.abs((19 - mercatorAt21.longitude) - (2 * (19 - mercatorAt22.longitude))) < 1e-7);

  const geoportalAt21 = panLocationMapCenter(52, 19, 'GEOPORTAL2', 32, 0, 640, 454, 21);
  const geoportalAt20 = panLocationMapCenter(52, 19, 'GEOPORTAL2', 32, 0, 640, 454, 20);
  const start = toPolish1992(52, 19);
  const geoportal21 = toPolish1992(geoportalAt21.latitude, geoportalAt21.longitude);
  const geoportal20 = toPolish1992(geoportalAt20.latitude, geoportalAt20.longitude);
  assert.ok(Math.abs((start.easting - geoportal20.easting) - (2 * (start.easting - geoportal21.easting))) < 0.02);
});

test('Web Mercator pan scale matches the 1280 by 908 image extent at zoom 21', () => {
  const center = panLocationMapCenter(52, 19, 'SATELLITES_PRO', 128, 0, 1280, 908);
  const expectedLongitudeDelta = (128 / LOCATION_MAP_WEB_MERCATOR_WORLD_SIZE) * 360;
  assert.ok(Math.abs((19 - center.longitude) - expectedLongitudeDelta) < 1e-7);

  const north = panLocationMapCenter(52, 19, 'STREETMAP', 0, 91, 1280, 908);
  assert.ok(north.latitude > 52);
});

test('Geoportal pan applies the 65 m by 46 m EPSG:2180 map extent', () => {
  const start = toPolish1992(52, 19);
  const eastShift = panLocationMapCenter(52, 19, 'GEOPORTAL2', -1280, 0, 1280, 908);
  const east = toPolish1992(eastShift.latitude, eastShift.longitude);
  assert.ok(Math.abs((east.easting - start.easting) - 65) < 0.02);
  assert.ok(Math.abs(east.northing - start.northing) < 0.02);

  const northShift = panLocationMapCenter(52, 19, 'GEOPORTAL2', 0, 908, 1280, 908);
  const north = toPolish1992(northShift.latitude, northShift.longitude);
  assert.ok(Math.abs((north.northing - start.northing) - 46) < 0.02);
  assert.ok(Math.abs(north.easting - start.easting) < 0.02);
});

test('invalid coordinates, movement, and display dimensions are rejected', () => {
  assert.throws(() => panLocationMapCenter(Number.NaN, 19, 'GOOGLE', 0, 0, 640, 454));
  assert.throws(() => panLocationMapCenter(90, 19, 'GOOGLE', 0, 0, 640, 454));
  assert.throws(() => panLocationMapCenter(52, 181, 'GEOPORTAL2', 0, 0, 640, 454));
  assert.throws(() => panLocationMapCenter(52, 19, 'GOOGLE', Infinity, 0, 640, 454));
  assert.throws(() => panLocationMapCenter(52, 19, 'GOOGLE', 1, 0, 0, 454));
});
