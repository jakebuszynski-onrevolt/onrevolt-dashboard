import { NextResponse } from 'next/server';
import {
  GoogleMapsConfigurationError,
  LocationMapTimeoutError,
  LocationMapValidationError,
} from './google-maps';
import { validateLocationMapZoom } from './location-map-zoom';

function parseCoordinate(searchParams: { get(name: string): string | null }, key: string, min: number, max: number) {
  const rawValue = searchParams.get(key);
  if (rawValue === null || !rawValue.trim()) {
    throw new LocationMapValidationError(`Brak wymaganej współrzędnej ${key}`);
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new LocationMapValidationError(`Nieprawidłowa wartość pola ${key}`);
  }
  return value;
}

export function parseSatelliteCoordinates(searchParams: { get(name: string): string | null }) {
  return {
    latitude: parseCoordinate(searchParams, 'lat', -90, 90),
    longitude: parseCoordinate(searchParams, 'lng', -180, 180),
  };
}

export function parseSatelliteZoom(searchParams: { get(name: string): string | null }) {
  const rawValue = searchParams.get('zoom');
  if (rawValue === null) return validateLocationMapZoom();
  if (!/^(?:0|[1-9]\d*)$/.test(rawValue)) {
    throw new LocationMapValidationError('Nieprawidłowa wartość pola zoom');
  }
  try {
    return validateLocationMapZoom(Number(rawValue));
  } catch {
    throw new LocationMapValidationError('Nieprawidłowa wartość pola zoom');
  }
}

export function satelliteMapErrorResponse(error: unknown) {
  const status = error instanceof GoogleMapsConfigurationError
    ? 503
    : error instanceof LocationMapTimeoutError
      ? 504
      : error instanceof LocationMapValidationError
        ? 400
        : 502;
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ ok: false, error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
