import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { fetchLocationMapImage, locationMapImageInternals } from './location-map-images';
import {
  LocationMapGoogleStaticEogError,
  LocationMapTimeoutError,
  LocationMapUpstreamError,
  LocationMapValidationError,
  searchGoogleAddresses,
} from './google-maps';
import { LOCATION_MAP_IMAGE_VERSION } from './location-maps';

const latitude = 52.3892246;
const longitude = 17.1588914;
const zooms = [18, 19, 20, 21, 22];

function mockFetch(context: any, handler: typeof fetch) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
}

function mockApiKey(context: any) {
  const original = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  context.after(() => {
    if (original === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = original;
  });
}

function imageResponse(bytes: Buffer) {
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, { status: 200, headers: { 'content-type': 'image/png' } });
}

function tileColor(column: number, row: number): [number, number, number] {
  return [
    40 + ((column * 13 % 160) + 160) % 160,
    40 + ((row * 17 % 160) + 160) % 160,
    40 + (((column + row) * 19 % 160) + 160) % 160,
  ];
}

async function makeTile(column: number, row: number) {
  const color = tileColor(column, row);
  return sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: color[0], g: color[1], b: color[2] } },
  }).png().toBuffer();
}

test('każdy dostawca korzysta z oczekiwanego źródła i domyślnego przybliżenia 21', async (context) => {
  mockApiKey(context);
  const tile = await makeTile(3, 4);
  const requestedUrls: URL[] = [];
  mockFetch(context, (async (input: URL | RequestInfo) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    requestedUrls.push(url);
    return imageResponse(tile);
  }) as typeof fetch);

  for (const provider of ['GOOGLE', 'STREETMAP', 'SATELLITES_PRO', 'ARCGIS_WAYBACK', 'ARCGIS', 'GEOPORTAL2']) {
    const image = await fetchLocationMapImage(provider, latitude, longitude);
    assert.equal(image.provider, provider);
    assert.ok(image.bytes.length > 0, `${provider} should return bytes`);
  }

  const googleUrls = requestedUrls.filter((url) => url.pathname.endsWith('/maps/api/staticmap'));
  assert.equal(googleUrls.length, 2);
  for (const url of googleUrls) {
    assert.equal(url.searchParams.get('center'), `${latitude.toFixed(7)},${longitude.toFixed(7)}`);
    assert.equal(url.searchParams.get('zoom'), '20');
    assert.equal(url.searchParams.get('maptype'), 'satellite');
    assert.equal(url.searchParams.get('key'), 'test-key');
  }

  const currentTiles = requestedUrls.filter((url) => url.hostname === 'server.arcgisonline.com');
  assert.ok(currentTiles.length > 0);
  assert.ok(currentTiles.every((url) => /\/MapServer\/tile\/20\/\d+\/\d+$/.test(url.pathname)));
  assert.equal(requestedUrls.filter((url) => url.pathname.endsWith('/MapServer/export')).length, 0);
  assert.ok(requestedUrls.some((url) => /\/26334\/20\/\d+\/\d+$/.test(url.pathname)));
  assert.ok(requestedUrls.some((url) => url.hostname === 'mapy.geoportal.gov.pl'
    && url.searchParams.get('LAYERS') === 'raster'
    && url.searchParams.get('CRS') === 'EPSG:2180'));
  assert.equal(LOCATION_MAP_IMAGE_VERSION, '4');
});

test('każdy poziom przybliżenia mapuje źródła Google, ArcGIS Wayback i Geoportal na właściwy zakres', async (context) => {
  mockApiKey(context);
  const tile = await makeTile(3, 4);
  const requestedUrls: URL[] = [];
  mockFetch(context, (async (input: URL | RequestInfo) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    requestedUrls.push(url);
    return imageResponse(tile);
  }) as typeof fetch);

  for (const zoom of zooms) {
    await fetchLocationMapImage('GOOGLE', latitude, longitude, { zoom });
    await fetchLocationMapImage('ARCGIS', latitude, longitude, { zoom });
    await fetchLocationMapImage('ARCGIS_WAYBACK', latitude, longitude, { zoom });
    await fetchLocationMapImage('GEOPORTAL2', latitude, longitude, { zoom });
  }

  const googleZooms = requestedUrls
    .filter((url) => url.pathname.endsWith('/maps/api/staticmap'))
    .map((url) => Number(url.searchParams.get('zoom')));
  assert.deepEqual(googleZooms, zooms.map((zoom) => zoom - 1));

  const arcgisZooms = requestedUrls
    .filter((url) => url.hostname === 'server.arcgisonline.com')
    .map((url) => Number(url.pathname.split('/').at(-3)));
  assert.deepEqual([...new Set(arcgisZooms)].sort((a, b) => a - b), [18, 19, 20]);
  const waybackZooms = requestedUrls
    .filter((url) => url.hostname === 'wayback.maptiles.arcgis.com')
    .map((url) => Number(url.pathname.split('/').at(-3)));
  assert.deepEqual([...new Set(waybackZooms)].sort((a, b) => a - b), [18, 19, 20]);
  assert.ok(requestedUrls.every((url) => !url.pathname.endsWith('/MapServer/export')));

  const gugikUrls = requestedUrls.filter((url) => url.hostname === 'mapy.geoportal.gov.pl');
  assert.equal(gugikUrls.length, zooms.length);
  for (const [index, url] of gugikUrls.entries()) {
    const bbox = (url.searchParams.get('BBOX') || '').split(',').map(Number);
    const footprintScale = 2 ** (21 - zooms[index]);
    assert.ok(Math.abs((bbox[3] - bbox[1]) - 65 * footprintScale) < 0.03);
    assert.ok(Math.abs((bbox[2] - bbox[0]) - 46 * footprintScale) < 0.03);
  }
});

test('ArcGIS Wayback zachowuje środek, ostrość natywnego zoomu 20, proporcje i atrybucję przy zoomie 21', async (context) => {
  const center = locationMapImageInternals.tilePixel(latitude, longitude, 20);
  const centerColumn = Math.floor(center.x / 256);
  const centerRow = Math.floor(center.y / 256);
  const urls: URL[] = [];
  mockFetch(context, (async (input: URL | RequestInfo) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    urls.push(url);
    const parts = url.pathname.split('/');
    return imageResponse(await makeTile(Number(parts.at(-1)), Number(parts.at(-2))));
  }) as typeof fetch);

  const image = await fetchLocationMapImage('ARCGIS_WAYBACK', latitude, longitude, { zoom: 21 });
  const { data, info } = await sharp(image.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(image.contentType, 'image/jpeg');
  assert.equal(info.width, 1280);
  assert.equal(info.height, 908);
  assert.ok(urls.length > 0);
  assert.ok(urls.every((url) => /\/26334\/20\/\d+\/\d+$/.test(url.pathname)));

  const pixel = (x: number, y: number) => {
    const offset = (y * info.width + x) * info.channels;
    return [data[offset], data[offset + 1], data[offset + 2]];
  };
  const expectedCenter = tileColor(centerColumn, centerRow);
  for (const [actual, expected] of pixel(640, 454).map((value, index) => [value, expectedCenter[index]])) {
    assert.ok(Math.abs(actual - expected) <= 8, `center pixel channel should match source tile (${actual} vs ${expected})`);
  }

  const nativeOriginX = Math.round(center.x - 640 / 2);
  const distanceToNextTile = centerColumn * 256 + 256 - nativeOriginX - 640 / 2;
  const beforeBoundaryX = Math.round(640 + (distanceToNextTile - 12) * 2);
  const afterBoundaryX = Math.round(640 + (distanceToNextTile + 12) * 2);
  const expectedNextTile = tileColor(centerColumn + 1, centerRow);
  assert.ok(pixel(beforeBoundaryX, 454).every((value, index) => Math.abs(value - expectedCenter[index]) <= 8));
  assert.ok(pixel(afterBoundaryX, 454).every((value, index) => Math.abs(value - expectedNextTile[index]) <= 8));
  assert.ok(pixel(900, 900).every((value) => value < 130), 'dark attribution background should remain visible');
});

test('ArcGIS Wayback obsługuje przycięcie kafli wychodzących poza krawędź viewportu', async (context) => {
  const requestedUrls: URL[] = [];
  const tile = await makeTile(-1, -1);
  mockFetch(context, (async (input: URL | RequestInfo) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    requestedUrls.push(url);
    return imageResponse(tile);
  }) as typeof fetch);

  const image = await locationMapImageInternals.fetchArcgisWaybackImage(85.05112878, -180);
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1280);
  assert.equal(info.height, 908);
  assert.ok(requestedUrls.some((url) => /\/20\/\-\d+\//.test(url.pathname)));
  assert.ok(requestedUrls.some((url) => /\/20\/\d+\/\-\d+$/.test(url.pathname)));
  assert.equal(data.length, 1280 * 908 * info.channels);
});

test('nieprawidłowe przybliżenie kończy się błędem walidacji przed pobraniem mapy', async () => {
  await assert.rejects(fetchLocationMapImage('ARCGIS', latitude, longitude, { zoom: 17 }), LocationMapValidationError);
  await assert.rejects(fetchLocationMapImage('ARCGIS', latitude, longitude, { zoom: 22.5 }), LocationMapValidationError);
});

test('limity obrazu i geokodera zwracają polski błąd timeout z limitem 50 s i 30 s', async (context) => {
  mockApiKey(context);
  const originalTimeout = AbortSignal.timeout;
  const configuredTimeouts: number[] = [];
  (AbortSignal as any).timeout = (timeoutMs: number) => {
    configuredTimeouts.push(timeoutMs);
    return new AbortController().signal;
  };
  context.after(() => {
    (AbortSignal as any).timeout = originalTimeout;
  });
  mockFetch(context, (async () => {
    const error = new Error('The operation was aborted due to timeout');
    error.name = 'TimeoutError';
    throw error;
  }) as typeof fetch);

  await assert.rejects(fetchLocationMapImage('GOOGLE', latitude, longitude), (error: unknown) => {
    assert.ok(error instanceof LocationMapTimeoutError);
    assert.match(error.message, /limit czasu \(50 s\)/);
    assert.match(error.message, /Google Maps/);
    return true;
  });
  await assert.rejects(fetchLocationMapImage('ARCGIS', latitude, longitude), (error: unknown) => {
    assert.ok(error instanceof LocationMapTimeoutError);
    assert.match(error.message, /limit czasu \(50 s\)/);
    assert.match(error.message, /ArcGIS World Imagery/);
    return true;
  });
  await assert.rejects(searchGoogleAddresses('Krótka 4, Sierniki Wielkie'), (error: unknown) => {
    assert.ok(error instanceof LocationMapTimeoutError);
    assert.match(error.message, /limit czasu \(30 s\)/);
    return true;
  });
  assert.ok(configuredTimeouts.length > 3);
  assert.ok(configuredTimeouts.every((timeoutMs) => timeoutMs === 50_000 || timeoutMs === 30_000));
  assert.ok(configuredTimeouts.includes(30_000));
});

test('błędy HTTP dostawców nie uruchamiają ponowień ani zmiany źródła', async (context) => {
  mockApiKey(context);
  let requestCount = 0;
  mockFetch(context, (async () => {
    requestCount += 1;
    return new Response('upstream failure', { status: 503, headers: { 'content-type': 'text/plain' } });
  }) as typeof fetch);

  await assert.rejects(fetchLocationMapImage('GOOGLE', latitude, longitude), (error: unknown) => {
    assert.ok(error instanceof LocationMapUpstreamError);
    assert.match(error.message, /HTTP 503/);
    return true;
  });
  assert.equal(requestCount, 1);
});

test('znany błąd Google Static Maps EOG ma bezpieczny, konkretny komunikat, a inne 403 pozostają ogólne', async (context) => {
  mockApiKey(context);
  const body = 'Your request cannot be served because satellite and hybrid map types are not available for your account and region. Learn more here: https://developers.google.com/maps/comms/eea/maps-static.';
  let responseBody = body;
  mockFetch(context, (async () => new Response(responseBody, { status: 403, headers: { 'content-type': 'text/plain' } })) as typeof fetch);

  for (const provider of ['GOOGLE', 'SATELLITES_PRO']) {
    await assert.rejects(fetchLocationMapImage(provider, latitude, longitude), (error: unknown) => {
      assert.ok(error instanceof LocationMapGoogleStaticEogError);
      assert.match(error.message, /EOG/);
      assert.match(error.message, /Satellites\.pro/);
      assert.doesNotMatch(error.message, /test-key|Your request|developers\.google\.com/);
      return true;
    });
  }
  responseBody = '<html>permission denied</html>';
  await assert.rejects(fetchLocationMapImage('GOOGLE', latitude, longitude), (error: unknown) => {
    assert.ok(error instanceof LocationMapUpstreamError);
    assert.equal(error.message, 'Nie udało się pobrać zdjęcia satelitarnego Google (HTTP 403)');
    assert.doesNotMatch(error.message, /permission denied|test-key/);
    return true;
  });
});
