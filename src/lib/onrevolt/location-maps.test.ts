import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLocationMapViewerUrl,
  locationMapProviderValues,
  normalizeLocationMapProvider,
  toPolish1992,
} from './location-maps';
import { locationMapImageInternals } from './location-map-images';

const latitude = 52.3892246;
const longitude = 17.1588914;

test('normalizuje źródło mapy i zachowuje zgodność starych lokalizacji z Google', () => {
  assert.equal(normalizeLocationMapProvider('geoportal2'), 'GEOPORTAL2');
  assert.equal(normalizeLocationMapProvider(null), 'GOOGLE');
  assert.equal(normalizeLocationMapProvider('nieznane'), 'GOOGLE');
});

test('buduje linki wszystkich map dla tej samej lokalizacji', () => {
  const urls = Object.fromEntries(locationMapProviderValues.map((provider) => [
    provider,
    buildLocationMapViewerUrl(provider, latitude, longitude),
  ]));
  assert.match(urls.GOOGLE, /52\.3892246,17\.1588914/);
  assert.match(urls.GOOGLE, /,59m\/data=/);
  assert.match(urls.STREETMAP, /#52\.3892246,17\.1588914,22z$/);
  assert.match(urls.SATELLITES_PRO, /#52\.3892246,17\.1588914,20$/);
  assert.match(urls.ARCGIS_WAYBACK, /mapCenter=17\.1588914%2C52\.3892246%2C20/);
  assert.match(urls.ARCGIS, /center=17\.1588914%2C52\.3892246/);
  assert.match(urls.ARCGIS, /level=20/);
  assert.match(urls.GEOPORTAL2, /mylayers=\+wmts5%3AORTOFOTOMAPA%40EPSG%3A2180\+/);
});

test('przelicza współrzędne Google na układ PL-1992 używany przez Geoportal2', () => {
  const point = toPolish1992(latitude, longitude);
  assert.ok(Math.abs(point.easting - 374749.1) < 0.2);
  assert.ok(Math.abs(point.northing - 504182.71) < 0.2);
});

test('buduje obrazy ArcGIS i GUGiK w proporcji pola pierwszej strony oferty', () => {
  const arcgisUrl = locationMapImageInternals.buildArcgisCurrentUrl(latitude, longitude);
  assert.equal(arcgisUrl.searchParams.get('size'), '1280,908');
  assert.equal(arcgisUrl.searchParams.get('format'), 'jpg');

  const gugikUrl = locationMapImageInternals.buildGugikUrl(latitude, longitude);
  assert.equal(gugikUrl.searchParams.get('CRS'), 'EPSG:2180');
  assert.equal(gugikUrl.searchParams.get('WIDTH'), '1280');
  assert.equal(gugikUrl.searchParams.get('HEIGHT'), '908');
  assert.match(gugikUrl.searchParams.get('BBOX') || '', /^504159\./);
});
