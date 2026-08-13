import proj4 from 'proj4';

export const locationMapProviderValues = [
  'GOOGLE',
  'STREETMAP',
  'SATELLITES_PRO',
  'ARCGIS_WAYBACK',
  'ARCGIS',
  'GEOPORTAL2',
] as const;

export type LocationMapProvider = (typeof locationMapProviderValues)[number];

export const LOCATION_MAP_IMAGE_VERSION = '3';

export type LocationMapProviderOption = {
  value: LocationMapProvider;
  label: string;
  imageSource: string;
};

export const locationMapProviders: LocationMapProviderOption[] = [
  { value: 'GOOGLE', label: 'Google Maps', imageSource: 'Google Maps' },
  { value: 'STREETMAP', label: 'Streetmap.pl', imageSource: 'Esri World Imagery' },
  { value: 'SATELLITES_PRO', label: 'Satellites.pro', imageSource: 'Google Maps' },
  { value: 'ARCGIS_WAYBACK', label: 'ArcGIS Wayback', imageSource: 'Esri World Imagery Wayback' },
  { value: 'ARCGIS', label: 'ArcGIS World Imagery', imageSource: 'Esri World Imagery' },
  { value: 'GEOPORTAL2', label: 'Geoportal2', imageSource: 'GUGiK - ortofotomapa wysokiej rozdzielczości' },
];

const providerValues = new Set<string>(locationMapProviderValues);
const EPSG_2180 = '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs +type=crs';

proj4.defs('EPSG:2180', EPSG_2180);

function coordinate(value: number, min: number, max: number, label: string) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Nieprawidłowa wartość pola ${label}`);
  }
  return value;
}

export function normalizeLocationMapProvider(value: unknown): LocationMapProvider {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return providerValues.has(normalized) ? normalized as LocationMapProvider : 'GOOGLE';
}

export function locationMapProviderLabel(value: unknown) {
  const provider = normalizeLocationMapProvider(value);
  return locationMapProviders.find((option) => option.value === provider)?.label || 'Google Maps';
}

export function locationMapImageSource(value: unknown) {
  const provider = normalizeLocationMapProvider(value);
  return locationMapProviders.find((option) => option.value === provider)?.imageSource || 'Google Maps';
}

export function toPolish1992(latitude: number, longitude: number) {
  const lat = coordinate(latitude, -90, 90, 'latitude');
  const lng = coordinate(longitude, -180, 180, 'longitude');
  const [easting, northing] = proj4('EPSG:4326', 'EPSG:2180', [lng, lat]);
  return { easting, northing };
}

export function buildLocationMapViewerUrl(providerValue: unknown, latitude: number, longitude: number) {
  const provider = normalizeLocationMapProvider(providerValue);
  const lat = coordinate(latitude, -90, 90, 'latitude');
  const lng = coordinate(longitude, -180, 180, 'longitude');
  const latText = lat.toFixed(7);
  const lngText = lng.toFixed(7);

  if (provider === 'GOOGLE') {
    return `https://www.google.com/maps/@${latText},${lngText},59m/data=!3m1!1e3`;
  }
  if (provider === 'STREETMAP') {
    return `https://www.streetmap.pl/satelita/#${latText},${lngText},22z`;
  }
  if (provider === 'SATELLITES_PRO') {
    return `https://satellites.pro/Poland_map#${latText},${lngText},20`;
  }
  if (provider === 'ARCGIS_WAYBACK') {
    return `https://livingatlas.arcgis.com/wayback/#mapCenter=${lngText}%2C${latText}%2C20&mode=explore&active=26334`;
  }
  if (provider === 'ARCGIS') {
    const basemapUrl = encodeURIComponent('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer');
    return `https://www.arcgis.com/apps/mapviewer/index.html?basemapUrl=${basemapUrl}&center=${lngText}%2C${latText}&level=20`;
  }

  const { easting, northing } = toPolish1992(lat, lng);
  const bbox = [
    easting - 32.5,
    northing - 23,
    easting + 32.5,
    northing + 23,
  ].map((value) => value.toFixed(2)).join(',');
  const url = new URL('https://polska.geoportal2.pl/map/www/mapa.php');
  url.searchParams.set('CFGF', 'wms');
  url.searchParams.set('bbox', bbox);
  url.searchParams.set('mylayers', ' wmts5:ORTOFOTOMAPA@EPSG:2180 ');
  url.searchParams.set('myqlayers', '');
  return url.toString();
}
