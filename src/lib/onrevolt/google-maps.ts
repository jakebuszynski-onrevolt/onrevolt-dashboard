const GOOGLE_GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const GOOGLE_STATIC_MAPS_URL = 'https://maps.googleapis.com/maps/api/staticmap';

export type GoogleAddressResult = {
  placeId: string;
  address: string;
  latitude: number;
  longitude: number;
  precision: string;
};

export class GoogleMapsConfigurationError extends Error {
  constructor() {
    super('Brak GOOGLE_MAPS_API_KEY. Włącz Geocoding API i Maps Static API w Google Cloud, a następnie dodaj klucz po stronie serwera.');
    this.name = 'GoogleMapsConfigurationError';
  }
}

function apiKey() {
  const value = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!value) throw new GoogleMapsConfigurationError();
  return value;
}

function coordinate(value: unknown, min: number, max: number, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Nieprawidłowa wartość pola ${label}`);
  }
  return parsed;
}

export function normalizeGoogleGeocodingResponse(payload: any): GoogleAddressResult[] {
  if (payload?.status === 'ZERO_RESULTS') return [];
  if (payload?.status !== 'OK' || !Array.isArray(payload?.results)) {
    const detail = typeof payload?.error_message === 'string' ? `: ${payload.error_message}` : '';
    throw new Error(`Google Geocoding API zwróciło status ${payload?.status || 'UNKNOWN'}${detail}`);
  }

  return payload.results.flatMap((result: any) => {
    const latitude = Number(result?.geometry?.location?.lat);
    const longitude = Number(result?.geometry?.location?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    const country = (result.address_components || [])
      .find((component: any) => component.types?.includes('country'))?.short_name;
    if (country && country !== 'PL') return [];
    return [{
      placeId: String(result.place_id || `${latitude},${longitude}`),
      address: String(result.formatted_address || '').trim(),
      latitude,
      longitude,
      precision: String(result?.geometry?.location_type || 'APPROXIMATE'),
    }];
  }).filter((result: GoogleAddressResult) => result.address);
}

export function buildGoogleGeocodingUrl(query: string, key = apiKey()) {
  const url = new URL(GOOGLE_GEOCODING_URL);
  url.searchParams.set('address', query.trim());
  url.searchParams.set('components', 'country:PL');
  url.searchParams.set('language', 'pl');
  url.searchParams.set('region', 'pl');
  url.searchParams.set('key', key);
  return url;
}

export async function searchGoogleAddresses(query: string) {
  const normalized = query.trim();
  if (normalized.length < 3) throw new Error('Wpisz co najmniej 3 znaki adresu');
  const response = await fetch(buildGoogleGeocodingUrl(normalized), {
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Nie udało się wyszukać adresu w Google Maps (HTTP ${response.status})`);
  return normalizeGoogleGeocodingResponse(await response.json());
}

export function buildGoogleSatelliteUrl(
  latitude: number,
  longitude: number,
  options: { zoom?: number; width?: number; height?: number; scale?: 1 | 2; key?: string } = {},
) {
  const lat = coordinate(latitude, -90, 90, 'latitude');
  const lng = coordinate(longitude, -180, 180, 'longitude');
  const zoom = Math.min(21, Math.max(17, Math.round(options.zoom ?? 19)));
  const width = Math.min(640, Math.max(320, Math.round(options.width ?? 640)));
  const height = Math.min(640, Math.max(240, Math.round(options.height ?? 454)));
  const url = new URL(GOOGLE_STATIC_MAPS_URL);
  url.searchParams.set('center', `${lat.toFixed(7)},${lng.toFixed(7)}`);
  url.searchParams.set('zoom', String(zoom));
  url.searchParams.set('size', `${width}x${height}`);
  url.searchParams.set('scale', String(options.scale ?? 2));
  url.searchParams.set('maptype', 'satellite');
  url.searchParams.set('format', 'jpg');
  url.searchParams.set('language', 'pl');
  url.searchParams.set('region', 'pl');
  url.searchParams.set('key', options.key || apiKey());
  return url;
}

export async function fetchGoogleSatelliteImage(
  latitude: number,
  longitude: number,
  options: { zoom?: number } = {},
) {
  const response = await fetch(buildGoogleSatelliteUrl(latitude, longitude, options), {
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Nie udało się pobrać zdjęcia satelitarnego Google (HTTP ${response.status})`);
  const contentType = response.headers.get('content-type')?.split(';')[0] || '';
  if (!contentType.startsWith('image/')) {
    throw new Error('Google Maps nie zwróciło obrazu satelitarnego. Sprawdź uprawnienia klucza API.');
  }
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType };
}
