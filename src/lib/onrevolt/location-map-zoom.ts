export const DEFAULT_LOCATION_MAP_ZOOM = 21;
export const MIN_LOCATION_MAP_ZOOM = 18;
export const MAX_LOCATION_MAP_ZOOM = 22;

export function validateLocationMapZoom(value?: number): number {
  const zoom = value === undefined ? DEFAULT_LOCATION_MAP_ZOOM : value;
  if (!Number.isInteger(zoom) || zoom < MIN_LOCATION_MAP_ZOOM || zoom > MAX_LOCATION_MAP_ZOOM) {
    throw new Error(`Przybliżenie mapy musi być liczbą całkowitą od ${MIN_LOCATION_MAP_ZOOM} do ${MAX_LOCATION_MAP_ZOOM}.`);
  }
  return zoom;
}
