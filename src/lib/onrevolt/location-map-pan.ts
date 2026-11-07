import proj4 from 'proj4';
import { LocationMapProvider, toPolish1992 } from './location-maps';
import {
  DEFAULT_LOCATION_MAP_ZOOM,
  validateLocationMapZoom,
} from './location-map-zoom';

export const LOCATION_MAP_IMAGE_WIDTH = 1280;
export const LOCATION_MAP_IMAGE_HEIGHT = 908;
export const LOCATION_MAP_WEB_MERCATOR_ZOOM = DEFAULT_LOCATION_MAP_ZOOM;
export const LOCATION_MAP_WEB_MERCATOR_WORLD_SIZE = 256 * (2 ** LOCATION_MAP_WEB_MERCATOR_ZOOM);

const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;
const GUGIK_EXTENT_WIDTH_METERS = 65;
const GUGIK_EXTENT_HEIGHT_METERS = 46;

export type LocationMapCenter = {
  latitude: number;
  longitude: number;
};

function validateCoordinate(latitude: number, longitude: number, allowPolarLatitude: boolean) {
  const maxLatitude = allowPolarLatitude ? 90 : WEB_MERCATOR_MAX_LATITUDE;
  if (!Number.isFinite(latitude) || latitude < -maxLatitude || latitude > maxLatitude) {
    throw new Error('Nieprawidłowa szerokość geograficzna.');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('Nieprawidłowa długość geograficzna.');
  }
}

function validatePan(dx: number, dy: number, displayWidth: number, displayHeight: number) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new Error('Przesunięcie mapy musi być skończoną liczbą.');
  }
  if (!Number.isFinite(displayWidth) || displayWidth <= 0
    || !Number.isFinite(displayHeight) || displayHeight <= 0) {
    throw new Error('Rozmiar mapy musi być dodatnią, skończoną liczbą.');
  }
}

function fromWebMercatorPixel(x: number, y: number, worldSize: number): LocationMapCenter {
  const longitude = (x / worldSize) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / worldSize;
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(n));
  validateCoordinate(latitude, longitude, false);
  const rounded = { latitude: Number(latitude.toFixed(7)), longitude: Number(longitude.toFixed(7)) };
  validateCoordinate(rounded.latitude, rounded.longitude, false);
  return rounded;
}

/**
 * Returns the map center after dragging the image by a number of CSS pixels.
 * Positive dx/dy means the image moved right/down under the fixed center pin.
 */
export function panLocationMapCenter(
  latitude: number,
  longitude: number,
  provider: LocationMapProvider,
  dx: number,
  dy: number,
  displayWidth: number,
  displayHeight: number,
  zoom?: number,
): LocationMapCenter {
  const effectiveZoom = validateLocationMapZoom(zoom);
  const worldSize = 256 * (2 ** effectiveZoom);
  const isGeoportal = provider === 'GEOPORTAL2';
  validateCoordinate(latitude, longitude, isGeoportal);
  validatePan(dx, dy, displayWidth, displayHeight);

  if (dx === 0 && dy === 0) return { latitude, longitude };

  if (isGeoportal) {
    const { easting, northing } = toPolish1992(latitude, longitude);
    const zoomScale = 2 ** (LOCATION_MAP_WEB_MERCATOR_ZOOM - effectiveZoom);
    const extentWidth = GUGIK_EXTENT_WIDTH_METERS * zoomScale;
    const extentHeight = GUGIK_EXTENT_HEIGHT_METERS * zoomScale;
    const nextEasting = easting - (dx * extentWidth) / displayWidth;
    const nextNorthing = northing + (dy * extentHeight) / displayHeight;
    const [nextLongitude, nextLatitude] = proj4('EPSG:2180', 'EPSG:4326', [nextEasting, nextNorthing]);
    validateCoordinate(nextLatitude, nextLongitude, true);
    const rounded = { latitude: Number(nextLatitude.toFixed(7)), longitude: Number(nextLongitude.toFixed(7)) };
    validateCoordinate(rounded.latitude, rounded.longitude, true);
    return rounded;
  }

  const centerX = ((longitude + 180) / 360) * worldSize;
  const latitudeRadians = (latitude * Math.PI) / 180;
  const centerY = (0.5 - Math.log((1 + Math.sin(latitudeRadians)) / (1 - Math.sin(latitudeRadians))) / (4 * Math.PI))
    * worldSize;
  const imageDx = (dx * LOCATION_MAP_IMAGE_WIDTH) / displayWidth;
  const imageDy = (dy * LOCATION_MAP_IMAGE_HEIGHT) / displayHeight;

  return fromWebMercatorPixel(centerX - imageDx, centerY - imageDy, worldSize);
}
