import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GoogleMapsConfigurationError,
  LocationMapGoogleStaticEogError,
  LocationMapTimeoutError,
  LocationMapUpstreamError,
  LocationMapValidationError,
} from './google-maps';
import { parseSatelliteCoordinates, parseSatelliteZoom, satelliteMapErrorResponse } from './geolocation-satellite';

test('endpoint wymaga obu współrzędnych i odrzuca wartości puste, nienumeryczne oraz poza zakresem', () => {
  assert.throws(() => parseSatelliteCoordinates(new URLSearchParams('lng=17.1')), LocationMapValidationError);
  assert.throws(() => parseSatelliteCoordinates(new URLSearchParams('lat=%20&lng=17.1')), LocationMapValidationError);
  assert.throws(() => parseSatelliteCoordinates(new URLSearchParams('lat=NaN&lng=17.1')), LocationMapValidationError);
  assert.throws(() => parseSatelliteCoordinates(new URLSearchParams('lat=91&lng=17.1')), LocationMapValidationError);
  assert.throws(() => parseSatelliteCoordinates(new URLSearchParams('lat=52.1&lng=181')), LocationMapValidationError);
  assert.deepEqual(parseSatelliteCoordinates(new URLSearchParams('lat=52.1&lng=17.1')), {
    latitude: 52.1,
    longitude: 17.1,
  });
});

test('endpoint parsuje opcjonalny zoom jako liczbę całkowitą ścisłą z domyślną wartością 21', () => {
  assert.equal(parseSatelliteZoom(new URLSearchParams()), 21);
  assert.equal(parseSatelliteZoom(new URLSearchParams('zoom=18')), 18);
  assert.equal(parseSatelliteZoom(new URLSearchParams('zoom=22')), 22);
  for (const value of ['', '17', '23', '21.0', '1e2', ' 21', '+21']) {
    assert.throws(() => parseSatelliteZoom(new URLSearchParams(`zoom=${encodeURIComponent(value)}`)), LocationMapValidationError);
  }
});

test('endpoint klasyfikuje błędy map i nie buforuje żadnego błędu', async () => {
  const cases: Array<[Error, number]> = [
    [new LocationMapValidationError('Nieprawidłowe współrzędne'), 400],
    [new GoogleMapsConfigurationError(), 503],
    [new LocationMapTimeoutError('pobierania obrazu Google Maps', 50_000), 504],
    [new LocationMapUpstreamError('Dostawca map zwrócił błąd'), 502],
    [new LocationMapGoogleStaticEogError(), 502],
  ];

  for (const [error, status] of cases) {
    const response = satelliteMapErrorResponse(error);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.error, error.message);
  }
});
