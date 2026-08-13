import sharp from 'sharp';
import { fetchGoogleSatelliteImage } from './google-maps';
import {
  LocationMapProvider,
  normalizeLocationMapProvider,
  toPolish1992,
} from './location-maps';

const ARCGIS_CURRENT_EXPORT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export';
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
    throw new Error(`Nieprawidłowa wartość pola ${label}`);
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

function imageExtent(latitude: number, longitude: number) {
  const center = webMercator(latitude, longitude);
  const resolution = 156543.03392804097 / (2 ** 21);
  const halfWidth = resolution * IMAGE_WIDTH / 2;
  const halfHeight = resolution * IMAGE_HEIGHT / 2;
  return {
    center,
    bbox: [center.x - halfWidth, center.y - halfHeight, center.x + halfWidth, center.y + halfHeight],
  };
}

async function fetchImage(url: URL | string, sourceName: string, timeout = 20_000) {
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(timeout),
    headers: { 'User-Agent': 'onRevolt CRM map renderer/1.0' },
  });
  if (!response.ok) throw new Error(`Nie udało się pobrać obrazu ${sourceName} (HTTP ${response.status})`);
  const contentType = response.headers.get('content-type')?.split(';')[0] || '';
  if (!contentType.startsWith('image/')) throw new Error(`${sourceName} nie zwróciło obrazu`);
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType };
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

async function fetchArcgisWaybackImage(latitude: number, longitude: number) {
  const sourceZoom = 20;
  const center = tilePixel(latitude, longitude, sourceZoom);
  const left = center.x - IMAGE_WIDTH / 2;
  const top = center.y - IMAGE_HEIGHT / 2;
  const firstColumn = Math.floor(left / TILE_SIZE);
  const lastColumn = Math.floor((left + IMAGE_WIDTH - 1) / TILE_SIZE);
  const firstRow = Math.floor(top / TILE_SIZE);
  const lastRow = Math.floor((top + IMAGE_HEIGHT - 1) / TILE_SIZE);
  const tiles: Array<{ column: number; row: number; bytes: Buffer }> = [];

  await Promise.all(Array.from({ length: lastRow - firstRow + 1 }, (_, rowOffset) => (
    Promise.all(Array.from({ length: lastColumn - firstColumn + 1 }, async (_, columnOffset) => {
      const column = firstColumn + columnOffset;
      const row = firstRow + rowOffset;
      const url = `${ARCGIS_WAYBACK_TILE_URL}/${WAYBACK_RELEASE_ID}/${sourceZoom}/${row}/${column}`;
      const image = await fetchImage(url, 'ArcGIS Wayback');
      tiles.push({ column, row, bytes: image.bytes });
    }))
  )));

  const canvas = sharp({
    create: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, channels: 3, background: '#d9dee8' },
  });
  const bytes = await canvas.composite(tiles.map((tile) => ({
    input: tile.bytes,
    left: Math.round(tile.column * TILE_SIZE - left),
    top: Math.round(tile.row * TILE_SIZE - top),
  }))).jpeg({ quality: 90 }).toBuffer();
  const zoomedBytes = await sharp(bytes)
    .extract({
      left: IMAGE_WIDTH / 4,
      top: IMAGE_HEIGHT / 4,
      width: IMAGE_WIDTH / 2,
      height: IMAGE_HEIGHT / 2,
    })
    .resize(IMAGE_WIDTH, IMAGE_HEIGHT)
    .jpeg({ quality: 90 })
    .toBuffer();
  return addAttribution(zoomedBytes, 'Esri World Imagery Wayback');
}

function buildGugikUrl(latitude: number, longitude: number) {
  const { easting, northing } = toPolish1992(latitude, longitude);
  const halfWidth = 32.5;
  const halfHeight = 23;
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

async function fetchArcgisCurrentImage(latitude: number, longitude: number) {
  const image = await fetchImage(buildArcgisCurrentUrl(latitude, longitude), 'ArcGIS World Imagery');
  return addAttribution(image.bytes, 'Esri, Maxar, Earthstar Geographics');
}

async function fetchGugikImage(latitude: number, longitude: number) {
  const image = await fetchImage(buildGugikUrl(latitude, longitude), 'GUGiK');
  return addAttribution(image.bytes, 'Źródło: GUGiK');
}

export async function fetchLocationMapImage(providerValue: unknown, latitude: number, longitude: number): Promise<LocationMapImage> {
  const provider = normalizeLocationMapProvider(providerValue);
  if (provider === 'GOOGLE' || provider === 'SATELLITES_PRO') {
    const image = await fetchGoogleSatelliteImage(latitude, longitude, { zoom: 20 });
    return { ...image, provider };
  }
  if (provider === 'ARCGIS_WAYBACK') {
    return { bytes: await fetchArcgisWaybackImage(latitude, longitude), contentType: 'image/jpeg', provider };
  }
  if (provider === 'GEOPORTAL2') {
    return { bytes: await fetchGugikImage(latitude, longitude), contentType: 'image/jpeg', provider };
  }
  return { bytes: await fetchArcgisCurrentImage(latitude, longitude), contentType: 'image/jpeg', provider };
}

export const locationMapImageInternals = {
  buildArcgisCurrentUrl,
  buildGugikUrl,
  tilePixel,
};
