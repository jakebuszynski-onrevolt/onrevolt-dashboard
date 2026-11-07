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

export class LocationMapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationMapValidationError';
  }
}

export class LocationMapTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`Przekroczono limit czasu (${Math.round(timeoutMs / 1000)} s) podczas ${operation}. Spróbuj ponownie później.`);
    this.name = 'LocationMapTimeoutError';
  }
}

export class LocationMapUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationMapUpstreamError';
  }
}

export class LocationMapGoogleStaticEogError extends LocationMapUpstreamError {
  constructor() {
    super('Google Static Maps nie udostępnia zdjęć satelitarnych dla tego konta lub regionu EOG. Google Maps i Satellites.pro korzystają z tego samego źródła zdjęć.');
    this.name = 'LocationMapGoogleStaticEogError';
  }
}

const GOOGLE_STATIC_EOG_UNAVAILABLE_BODY = 'Your request cannot be served because satellite and hybrid map types are not available for your account and region. Learn more here: https://developers.google.com/maps/comms/eea/maps-static.';

function isTimeoutError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  const cause = (error as Error & { cause?: unknown }).cause;
  return cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
}

function mapFetchError(error: unknown, operation: string, timeoutMs: number): Error {
  if (error instanceof GoogleMapsConfigurationError
    || error instanceof LocationMapValidationError
    || error instanceof LocationMapTimeoutError
    || error instanceof LocationMapUpstreamError) {
    return error;
  }
  if (isTimeoutError(error)) return new LocationMapTimeoutError(operation, timeoutMs);
  return new LocationMapUpstreamError(`Nie udało się połączyć z ${operation}. Sprawdź połączenie z usługą i spróbuj ponownie.`);
}

function apiKey() {
  const value = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!value) throw new GoogleMapsConfigurationError();
  return value;
}

function coordinate(value: unknown, min: number, max: number, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new LocationMapValidationError(`Nieprawidłowa wartość pola ${label}`);
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
  const timeoutMs = 30_000;
  let response: Response;
  try {
    response = await fetch(buildGoogleGeocodingUrl(normalized), {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw mapFetchError(error, 'Google Maps Geocoding API', timeoutMs);
  }
  if (!response.ok) {
    throw new LocationMapUpstreamError(`Nie udało się wyszukać adresu w Google Maps (HTTP ${response.status})`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw mapFetchError(error, 'Google Maps Geocoding API', timeoutMs);
  }
  return normalizeGoogleGeocodingResponse(payload);
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
  const timeoutMs = 50_000;
  try {
    const response = await fetch(buildGoogleSatelliteUrl(latitude, longitude, options), {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      if (response.status === 403 && (await response.text()).trim() === GOOGLE_STATIC_EOG_UNAVAILABLE_BODY) {
        throw new LocationMapGoogleStaticEogError();
      }
      throw new LocationMapUpstreamError(`Nie udało się pobrać zdjęcia satelitarnego Google (HTTP ${response.status})`);
    }
    const contentType = response.headers.get('content-type')?.split(';')[0] || '';
    if (!contentType.startsWith('image/')) {
      throw new LocationMapUpstreamError('Google Maps nie zwróciło obrazu satelitarnego. Sprawdź uprawnienia klucza API.');
    }
    return { bytes: Buffer.from(await response.arrayBuffer()), contentType };
  } catch (error) {
    throw mapFetchError(error, 'pobierania zdjęcia satelitarnego Google Maps', timeoutMs);
  }
}
