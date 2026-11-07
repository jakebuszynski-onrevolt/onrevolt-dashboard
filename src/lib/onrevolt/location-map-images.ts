import sharp from 'sharp';
import {
  fetchGoogleSatelliteImage,
  LocationMapTimeoutError,
  LocationMapUpstreamError,
  LocationMapValidationError,
} from './google-maps';
import {
  LocationMapProvider,
  normalizeLocationMapProvider,
  toPolish1992,
} from './location-maps';
import { validateLocationMapZoom } from './location-map-zoom';

const ARCGIS_CURRENT_EXPORT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export';
const ARCGIS_CURRENT_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
const ARCGIS_WAYBACK_TILE_URL = 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/GoogleMapsCompatible/MapServer/tile';
const GUGIK_HIGH_RESOLUTION_WMS_URL = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution';
const WAYBACK_RELEASE_ID = 26334;
const IMAGE_WIDTH = 1280;
const IMAGE_HEIGHT = 908;
const TILE_SIZE = 256;

export type LocationMapImage = {
  bytes: Buffer;
  contentType: string;
  provider: LocationMapProvider;
};

function coordinate(value: number, min: number, max: number, label: string) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new LocationMapValidationError(`Nieprawidłowa wartość pola ${label}`);
  }
  return value;
}

function webMercator(latitude: number, longitude: number) {
  const lat = coordinate(latitude, -85.05112878, 85.05112878, 'latitude');
  const lng = coordinate(longitude, -180, 180, 'longitude');
  const radius = 6378137;
  return {
    x: radius * lng * Math.PI / 180,
    y: radius * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)),
  };
}

function imageExtent(latitude: number, longitude: number, zoom = 21) {
  const center = webMercator(latitude, longitude);
  const resolution = 156543.03392804097 / (2 ** zoom);
  const halfWidth = resolution * IMAGE_WIDTH / 2;
  const halfHeight = resolution * IMAGE_HEIGHT / 2;
  return {
    center,
    bbox: [center.x - halfWidth, center.y - halfHeight, center.x + halfWidth, center.y + halfHeight],
  };
}

function isTimeoutError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
}

async function fetchImage(url: URL | string, sourceName: string, timeout = 50_000) {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
      headers: { 'User-Agent': 'onRevolt CRM map renderer/1.0' },
    });
    if (!response.ok) {
      throw new LocationMapUpstreamError(`Nie udało się pobrać obrazu ${sourceName} (HTTP ${response.status})`);
    }
    const contentType = response.headers.get('content-type')?.split(';')[0] || '';
    if (!contentType.startsWith('image/')) {
      throw new LocationMapUpstreamError(`${sourceName} nie zwróciło obrazu`);
    }
    return { bytes: Buffer.from(await response.arrayBuffer()), contentType };
  } catch (error) {
    if (error instanceof LocationMapTimeoutError || error instanceof LocationMapUpstreamError || error instanceof LocationMapValidationError) {
      throw error;
    }
    if (isTimeoutError(error)) {
      throw new LocationMapTimeoutError(`pobierania obrazu ${sourceName}`, timeout);
    }
    throw new LocationMapUpstreamError(`Nie udało się połączyć z usługą ${sourceName}. Sprawdź połączenie i spróbuj ponownie.`);
  }
}

async function addAttribution(bytes: Buffer, label: string) {
  const safeLabel = label.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[character] || character));
  const overlay = Buffer.from(
    `<svg width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}"><style>.t{font:20px Arial,sans-serif;fill:#fff}</style><rect x="${IMAGE_WIDTH - 430}" y="${IMAGE_HEIGHT - 38}" width="430" height="38" fill="#000" fill-opacity=".62"/><text class="t" x="${IMAGE_WIDTH - 14}" y="${IMAGE_HEIGHT - 12}" text-anchor="end">${safeLabel}</text></svg>`,
  );
  return sharp(bytes)
    .resize(IMAGE_WIDTH, IMAGE_HEIGHT, { fit: 'cover' })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

function buildArcgisCurrentUrl(latitude: number, longitude: number) {
  const { bbox } = imageExtent(latitude, longitude);
  const url = new URL(ARCGIS_CURRENT_EXPORT_URL);
  url.searchParams.set('bbox', bbox.map((value) => value.toFixed(2)).join(','));
  url.searchParams.set('bboxSR', '3857');
  url.searchParams.set('imageSR', '3857');
  url.searchParams.set('size', `${IMAGE_WIDTH},${IMAGE_HEIGHT}`);
  url.searchParams.set('format', 'jpg');
  url.searchParams.set('f', 'image');
  return url;
}

function tilePixel(latitude: number, longitude: number, zoom: number) {
  const lat = coordinate(latitude, -85.05112878, 85.05112878, 'latitude');
  const lng = coordinate(longitude, -180, 180, 'longitude');
  const worldSize = TILE_SIZE * (2 ** zoom);
  const sinLatitude = Math.sin(lat * Math.PI / 180);
  return {
    x: (lng + 180) / 360 * worldSize,
    y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * worldSize,
  };
}

async function fetchArcgisWaybackImage(latitude: number, longitude: number, zoom = 21) {
  return fetchArcgisTileImage(latitude, longitude, zoom, {
    tileUrl: (zoom, row, column) => `${ARCGIS_WAYBACK_TILE_URL}/${WAYBACK_RELEASE_ID}/${zoom}/${row}/${column}`,
    sourceName: 'ArcGIS Wayback',
    attribution: 'Esri World Imagery Wayback',
  });
}

function buildGugikUrl(latitude: number, longitude: number, zoom = 21) {
  const { easting, northing } = toPolish1992(latitude, longitude);
  const footprintScale = 2 ** (21 - zoom);
  const halfWidth = 32.5 * footprintScale;
  const halfHeight = 23 * footprintScale;
  const url = new URL(GUGIK_HIGH_RESOLUTION_WMS_URL);
  url.searchParams.set('SERVICE', 'WMS');
  url.searchParams.set('REQUEST', 'GetMap');
  url.searchParams.set('VERSION', '1.3.0');
  url.searchParams.set('LAYERS', 'raster');
  url.searchParams.set('STYLES', '');
  url.searchParams.set('CRS', 'EPSG:2180');
  // WMS 1.3 follows the northing/easting axis order declared by EPSG:2180.
  url.searchParams.set('BBOX', [
    northing - halfHeight,
    easting - halfWidth,
    northing + halfHeight,
    easting + halfWidth,
  ].map((value) => value.toFixed(2)).join(','));
  url.searchParams.set('WIDTH', String(IMAGE_WIDTH));
  url.searchParams.set('HEIGHT', String(IMAGE_HEIGHT));
  url.searchParams.set('FORMAT', 'image/jpeg');
  return url;
}

async function fetchArcgisTileImage(
  latitude: number,
  longitude: number,
  effectiveZoom: number,
  options: {
    tileUrl: (sourceZoom: number, row: number, column: number) => string;
    sourceName: string;
    attribution: string;
  },
) {
  const sourceZoom = Math.min(effectiveZoom, 20);
  const upscaleFactor = 2 ** (effectiveZoom - sourceZoom);
  const viewportWidth = IMAGE_WIDTH / upscaleFactor;
  const viewportHeight = IMAGE_HEIGHT / upscaleFactor;
  const center = tilePixel(latitude, longitude, sourceZoom);
  const originX = center.x - viewportWidth / 2;
  const originY = center.y - viewportHeight / 2;
  const firstColumn = Math.floor(originX / TILE_SIZE);
  const lastColumn = Math.ceil((originX + viewportWidth) / TILE_SIZE) - 1;
  const firstRow = Math.floor(originY / TILE_SIZE);
  const lastRow = Math.ceil((originY + viewportHeight) / TILE_SIZE) - 1;
  const tiles: Array<{ column: number; row: number; bytes: Buffer }> = [];

  await Promise.all(Array.from({ length: lastRow - firstRow + 1 }, (_, rowOffset) => (
    Promise.all(Array.from({ length: lastColumn - firstColumn + 1 }, async (_, columnOffset) => {
      const column = firstColumn + columnOffset;
      const row = firstRow + rowOffset;
      const image = await fetchImage(options.tileUrl(sourceZoom, row, column), options.sourceName);
      tiles.push({ column, row, bytes: image.bytes });
    }))
  )));

  const overlays = await Promise.all(tiles.map(async (tile) => {
    // Round the fractional viewport origin to the nearest source pixel. Since
    // tile boundaries are 256 px apart, adjacent placements stay gap-free.
    const tileLeft = Math.round(tile.column * TILE_SIZE - originX);
    const tileTop = Math.round(tile.row * TILE_SIZE - originY);
    const left = Math.max(0, tileLeft);
    const top = Math.max(0, tileTop);
    const right = Math.min(viewportWidth, tileLeft + TILE_SIZE);
    const bottom = Math.min(viewportHeight, tileTop + TILE_SIZE);
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return null;
    const input = await sharp(tile.bytes)
      .extract({ left: left - tileLeft, top: top - tileTop, width, height })
      .toBuffer();
    return { input, left, top };
  }));

  const nativeImage = await sharp({
    create: { width: viewportWidth, height: viewportHeight, channels: 3, background: '#d9dee8' },
  }).composite(overlays.filter((overlay): overlay is NonNullable<typeof overlay> => overlay !== null))
    .jpeg({ quality: 90 })
    .toBuffer();
  const output = await sharp(nativeImage)
    .resize(IMAGE_WIDTH, IMAGE_HEIGHT, { fit: 'fill' })
    .jpeg({ quality: 90 })
    .toBuffer();
  return addAttribution(output, options.attribution);
}

async function fetchArcgisCurrentImage(latitude: number, longitude: number, zoom: number) {
  return fetchArcgisTileImage(latitude, longitude, zoom, {
    tileUrl: (sourceZoom, row, column) => `${ARCGIS_CURRENT_TILE_URL}/${sourceZoom}/${row}/${column}`,
    sourceName: 'ArcGIS World Imagery',
    attribution: 'Esri, Maxar, Earthstar Geographics',
  });
}

async function fetchGugikImage(latitude: number, longitude: number, zoom: number) {
  const image = await fetchImage(buildGugikUrl(latitude, longitude, zoom), 'GUGiK');
  return addAttribution(image.bytes, 'Źródło: GUGiK');
}

export async function fetchLocationMapImage(
  providerValue: unknown,
  latitude: number,
  longitude: number,
  options: { zoom?: number } = {},
): Promise<LocationMapImage> {
  const provider = normalizeLocationMapProvider(providerValue);
  let zoom: number;
  try {
    zoom = validateLocationMapZoom(options.zoom);
  } catch (error) {
    throw new LocationMapValidationError(error instanceof Error ? error.message : 'Nieprawidłowa wartość pola zoom');
  }
  if (provider === 'GOOGLE' || provider === 'SATELLITES_PRO') {
    const image = await fetchGoogleSatelliteImage(latitude, longitude, { zoom: zoom - 1 });
    return { ...image, provider };
  }
  if (provider === 'ARCGIS_WAYBACK') {
    return {
      bytes: await fetchArcgisTileImage(latitude, longitude, zoom, {
        tileUrl: (sourceZoom, row, column) => `${ARCGIS_WAYBACK_TILE_URL}/${WAYBACK_RELEASE_ID}/${sourceZoom}/${row}/${column}`,
        sourceName: 'ArcGIS Wayback',
        attribution: 'Esri World Imagery Wayback',
      }),
      contentType: 'image/jpeg',
      provider,
    };
  }
  if (provider === 'GEOPORTAL2') {
    return { bytes: await fetchGugikImage(latitude, longitude, zoom), contentType: 'image/jpeg', provider };
  }
  return { bytes: await fetchArcgisCurrentImage(latitude, longitude, zoom), contentType: 'image/jpeg', provider };
}

export const locationMapImageInternals = {
  buildArcgisCurrentUrl,
  buildGugikUrl,
  fetchArcgisWaybackImage,
  tilePixel,
};
