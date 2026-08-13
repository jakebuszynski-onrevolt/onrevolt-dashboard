import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGoogleGeocodingUrl,
  buildGoogleSatelliteUrl,
  normalizeGoogleGeocodingResponse,
} from './google-maps';

test('zapytanie geokodera jest ograniczone do Polski i nie ujawnia ustawień klienta', () => {
  const url = buildGoogleGeocodingUrl('Krótka 4, Sierniki Wielkie', 'test-key');
  assert.equal(url.hostname, 'maps.googleapis.com');
  assert.equal(url.searchParams.get('address'), 'Krótka 4, Sierniki Wielkie');
  assert.equal(url.searchParams.get('components'), 'country:PL');
  assert.equal(url.searchParams.get('key'), 'test-key');
});

test('normalizuje wyłącznie polskie wyniki z dokładnością Google', () => {
  const results = normalizeGoogleGeocodingResponse({
    status: 'OK',
    results: [{
      place_id: 'place-1',
      formatted_address: 'Krótka 4, 62-025 Sierniki Wielkie, Polska',
      geometry: { location: { lat: 52.1234567, lng: 17.7654321 }, location_type: 'ROOFTOP' },
      address_components: [{ short_name: 'PL', types: ['country'] }],
    }],
  });
  assert.deepEqual(results, [{
    placeId: 'place-1',
    address: 'Krótka 4, 62-025 Sierniki Wielkie, Polska',
    latitude: 52.1234567,
    longitude: 17.7654321,
    precision: 'ROOFTOP',
  }]);
});

test('zdjęcie satelitarne zachowuje proporcje pola strony Report 0 i rozdzielczość 2x', () => {
  const url = buildGoogleSatelliteUrl(52.1234567, 17.7654321, { key: 'test-key' });
  assert.equal(url.searchParams.get('center'), '52.1234567,17.7654321');
  assert.equal(url.searchParams.get('zoom'), '19');
  assert.equal(url.searchParams.get('size'), '640x454');
  assert.equal(url.searchParams.get('scale'), '2');
  assert.equal(url.searchParams.get('maptype'), 'satellite');
});
