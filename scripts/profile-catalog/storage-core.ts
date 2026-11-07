import { createHash } from 'node:crypto';

export type CatalogSourceInput = {
  key: string;
  title: string;
  publisher: string;
  url: string;
  downloadUrl: string | null;
  retrievedAt: string;
  license: string;
  sha256: string;
  notes?: string | null;
};

type ProfilePoint = Record<string, unknown> & { value: number | null };

export type CatalogProfileInput = {
  key: string;
  sourceKey: string;
  name: string;
  category: string;
  kind: string;
  quantity: string;
  unit: string;
  timeBasis: string;
  resolutionMinutes: number;
  start: string | null;
  end: string | null;
  series: ProfilePoint[];
  metadata: Record<string, unknown>;
  quality: Record<string, unknown>;
};

export type ProfileCatalogInput = {
  sources: CatalogSourceInput[];
  profiles: CatalogProfileInput[];
};

export type PreparedSource = CatalogSourceInput & { notes: string | null };
export type PreparedProfile = CatalogProfileInput & {
  pointCount: number;
  contentHash: string;
};
export type PreparedCatalog = {
  sources: PreparedSource[];
  profiles: PreparedProfile[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
}

function requireString(value: unknown, label: string, maxLength?: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  if (maxLength !== undefined && value.length > maxLength) {
    throw new Error(`${label} exceeds ${maxLength} characters.`);
  }
  return value;
}

function requireOnlyKeys(record: Record<string, unknown>, allowed: string[], label: string): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new Error(`${label} contains unsupported field(s): ${unexpected.join(', ')}.`);
}

function optionalNote(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string or null.`);
  return value;
}

function assertJsonValue(value: unknown, label: string, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error(`${label} contains a circular reference.`);
    seen.add(value);
    value.forEach((entry, index) => assertJsonValue(entry, `${label}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  if (isRecord(value)) {
    if (seen.has(value)) throw new Error(`${label} contains a circular reference.`);
    seen.add(value);
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'undefined') throw new Error(`${label}.${key} cannot be undefined.`);
      assertJsonValue(entry, `${label}.${key}`, seen);
    }
    seen.delete(value);
    return;
  }
  throw new Error(`${label} contains a value that cannot be represented as JSON.`);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function profileContentHash(profile: Omit<PreparedProfile, 'contentHash' | 'pointCount'> | CatalogProfileInput): string {
  return sha256Hex(canonicalJson({
    sourceKey: profile.sourceKey,
    name: profile.name,
    category: profile.category,
    kind: profile.kind,
    quantity: profile.quantity,
    unit: profile.unit,
    timeBasis: profile.timeBasis,
    resolutionMinutes: profile.resolutionMinutes,
    start: profile.start,
    end: profile.end,
    series: profile.series,
    metadata: profile.metadata,
    quality: profile.quality,
  }));
}

function validateHttpUrl(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP or HTTPS URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
}

function parseUtcInstant(value: unknown, label: string): number {
  const timestamp = requireString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/i.test(timestamp)) {
    throw new Error(`${label} must be an ISO 8601 UTC instant ending in Z or +00:00.`);
  }
  const instant = Date.parse(timestamp);
  if (!Number.isFinite(instant)) throw new Error(`${label} must be a valid UTC instant.`);
  return instant;
}

function normalizeSource(value: unknown, index: number): PreparedSource {
  const label = `sources[${index}]`;
  const source = requireRecord(value, label);
  requireOnlyKeys(source, ['key', 'title', 'publisher', 'url', 'downloadUrl', 'retrievedAt', 'license', 'sha256', 'notes'], label);
  const key = requireString(source.key, `${label}.key`, 191);
  const title = requireString(source.title, `${label}.title`, 500);
  const publisher = requireString(source.publisher, `${label}.publisher`, 255);
  const url = requireString(source.url, `${label}.url`);
  validateHttpUrl(url, `${label}.url`);
  let downloadUrl: string | null;
  if (source.downloadUrl === null || source.downloadUrl === undefined) {
    downloadUrl = null;
  } else {
    downloadUrl = requireString(source.downloadUrl, `${label}.downloadUrl`);
    validateHttpUrl(downloadUrl, `${label}.downloadUrl`);
  }
  const retrievedAt = requireString(source.retrievedAt, `${label}.retrievedAt`);
  if (!Number.isFinite(Date.parse(retrievedAt))) {
    throw new Error(`${label}.retrievedAt must be a parseable date/time string.`);
  }
  const license = requireString(source.license, `${label}.license`, 255);
  const sha256 = requireString(source.sha256, `${label}.sha256`);
  if (!/^[0-9a-f]{64}$/i.test(sha256)) throw new Error(`${label}.sha256 must be a 64-character SHA-256 hex digest.`);

  return {
    key,
    title,
    publisher,
    url,
    downloadUrl,
    retrievedAt,
    license,
    sha256,
    notes: optionalNote(source.notes, `${label}.notes`),
  };
}

function validatePoint(value: unknown, label: string, seenCoordinates: Set<string>): void {
  const point = requireRecord(value, label);
  if (!Object.prototype.hasOwnProperty.call(point, 'value')) {
    throw new Error(`${label}.value is required.`);
  }
  if (point.value !== null && (typeof point.value !== 'number' || !Number.isFinite(point.value))) {
    throw new Error(`${label}.value must be a finite number or null.`);
  }

  let coordinate: string;
  if (Object.prototype.hasOwnProperty.call(point, 'timestamp')) {
    if (['month', 'season', 'dayType', 'slot'].some((coordinateKey) => Object.prototype.hasOwnProperty.call(point, coordinateKey))) {
      throw new Error(`${label} must use either a timestamp coordinate or pattern coordinates, not both.`);
    }
    const instant = parseUtcInstant(point.timestamp, `${label}.timestamp`);
    coordinate = `timestamp:${instant}`;
  } else {
    const hasMonth = Object.prototype.hasOwnProperty.call(point, 'month');
    const hasSeason = Object.prototype.hasOwnProperty.call(point, 'season');
    if ((hasMonth === hasSeason) || !Object.prototype.hasOwnProperty.call(point, 'dayType') || !Object.prototype.hasOwnProperty.call(point, 'slot')) {
      throw new Error(`${label} pattern points must contain dayType, slot, value, and exactly one of month or season.`);
    }
    const dayType = requireString(point.dayType, `${label}.dayType`);
    let period: string;
    if (hasMonth) {
      if (!Number.isInteger(point.month) || (point.month as number) < 1 || (point.month as number) > 12) {
        throw new Error(`${label}.month must be an integer from 1 to 12.`);
      }
      period = `month:${point.month}`;
    } else {
      period = `season:${requireString(point.season, `${label}.season`)}`;
    }
    if (typeof point.slot !== 'string' && typeof point.slot !== 'number') {
      throw new Error(`${label}.slot must be a string or number.`);
    }
    if (typeof point.slot === 'string') requireString(point.slot, `${label}.slot`);
    if (typeof point.slot === 'number' && !Number.isFinite(point.slot)) {
      throw new Error(`${label}.slot must be finite.`);
    }
    coordinate = `pattern:${period}|dayType:${canonicalJson(dayType)}|slot:${canonicalJson(point.slot)}`;
  }

  if (seenCoordinates.has(coordinate)) throw new Error(`${label} duplicates a series coordinate.`);
  seenCoordinates.add(coordinate);
}

function normalizeProfile(value: unknown, index: number): PreparedProfile {
  const label = `profiles[${index}]`;
  const profile = requireRecord(value, label);
  requireOnlyKeys(profile, ['key', 'sourceKey', 'name', 'category', 'kind', 'quantity', 'unit', 'timeBasis', 'resolutionMinutes', 'start', 'end', 'series', 'metadata', 'quality'], label);
  const key = requireString(profile.key, `${label}.key`, 191);
  const sourceKey = requireString(profile.sourceKey, `${label}.sourceKey`, 191);
  const name = requireString(profile.name, `${label}.name`, 500);
  const category = requireString(profile.category, `${label}.category`, 191);
  const kind = requireString(profile.kind, `${label}.kind`, 64);
  const quantity = requireString(profile.quantity, `${label}.quantity`, 100);
  const unit = requireString(profile.unit, `${label}.unit`, 64);
  const timeBasis = requireString(profile.timeBasis, `${label}.timeBasis`, 64);
  if (!Number.isSafeInteger(profile.resolutionMinutes) || (profile.resolutionMinutes as number) <= 0) {
    throw new Error(`${label}.resolutionMinutes must be a positive integer.`);
  }
  if (!Array.isArray(profile.series) || profile.series.length === 0) {
    throw new Error(`${label}.series must contain at least one point.`);
  }
  const seenCoordinates = new Set<string>();
  profile.series.forEach((point, pointIndex) => validatePoint(point, `${label}.series[${pointIndex}]`, seenCoordinates));
  const timestampFlags = profile.series.map((point) => isRecord(point) && Object.prototype.hasOwnProperty.call(point, 'timestamp'));
  const hasDatedSeries = timestampFlags.every(Boolean);
  const isPatternSeries = timestampFlags.every((hasTimestamp) => !hasTimestamp);
  if (!hasDatedSeries && !isPatternSeries) throw new Error(`${label}.series cannot mix dated and pattern points.`);
  let start: string | null;
  let end: string | null;
  if (isPatternSeries && (profile.start === null || profile.end === null)) {
    if (!isPatternSeries || profile.start !== null || profile.end !== null) {
      throw new Error(`${label}.start and ${label}.end may both be null only for pattern series.`);
    }
    start = null;
    end = null;
  } else {
    start = requireString(profile.start, `${label}.start`, 191);
    end = requireString(profile.end, `${label}.end`, 191);
    if (hasDatedSeries) {
      const startInstant = parseUtcInstant(start, `${label}.start`);
      const endInstant = parseUtcInstant(end, `${label}.end`);
      const pointInstants = profile.series.map((point, pointIndex) => parseUtcInstant((point as Record<string, unknown>).timestamp, `${label}.series[${pointIndex}].timestamp`));
      if (pointInstants[0] !== startInstant || pointInstants[pointInstants.length - 1] !== endInstant) {
        throw new Error(`${label}.start and ${label}.end must match the first and last series instants.`);
      }
      const intervalMs = (profile.resolutionMinutes as number) * 60 * 1000;
      for (let pointIndex = 1; pointIndex < pointInstants.length; pointIndex += 1) {
        const difference = pointInstants[pointIndex] - pointInstants[pointIndex - 1];
        if (difference <= 0) throw new Error(`${label}.series timestamps must be strictly increasing.`);
        if (difference !== intervalMs) {
          throw new Error(`${label}.series timestamps must be spaced exactly ${profile.resolutionMinutes} minutes apart.`);
        }
      }
    } else if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) {
      throw new Error(`${label}.start and ${label}.end must be parseable date/time strings or both null for a pattern series.`);
    }
    if (Date.parse(start) > Date.parse(end)) throw new Error(`${label}.start must not be after ${label}.end.`);
  }
  const metadata = requireRecord(profile.metadata, `${label}.metadata`);
  const quality = requireRecord(profile.quality, `${label}.quality`);
  assertJsonValue(profile.series, `${label}.series`);
  assertJsonValue(metadata, `${label}.metadata`);
  assertJsonValue(quality, `${label}.quality`);

  const normalized: CatalogProfileInput = {
    key,
    sourceKey,
    name,
    category,
    kind,
    quantity,
    unit,
    timeBasis,
    resolutionMinutes: profile.resolutionMinutes as number,
    start,
    end,
    series: profile.series as CatalogProfileInput['series'],
    metadata,
    quality,
  };
  return { ...normalized, pointCount: normalized.series.length, contentHash: profileContentHash(normalized) };
}

export function prepareCatalog(value: unknown): PreparedCatalog {
  const catalog = requireRecord(value, 'catalog');
  requireOnlyKeys(catalog, ['sources', 'profiles'], 'catalog');
  if (!Array.isArray(catalog.sources)) throw new Error('catalog.sources must be an array.');
  if (!Array.isArray(catalog.profiles)) throw new Error('catalog.profiles must be an array.');

  const sources = catalog.sources.map(normalizeSource);
  const profiles = catalog.profiles.map(normalizeProfile);
  const sourceKeys = new Set<string>();
  for (const source of sources) {
    if (sourceKeys.has(source.key)) throw new Error(`Duplicate source key: ${source.key}`);
    sourceKeys.add(source.key);
  }
  const profileKeys = new Set<string>();
  for (const profile of profiles) {
    if (profileKeys.has(profile.key)) throw new Error(`Duplicate profile key: ${profile.key}`);
    profileKeys.add(profile.key);
    if (!sourceKeys.has(profile.sourceKey)) {
      throw new Error(`Profile ${profile.key} references missing source ${profile.sourceKey}.`);
    }
  }
  return { sources, profiles };
}

export function sourceSignature(source: PreparedSource): string {
  return canonicalJson({
    key: source.key,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    downloadUrl: source.downloadUrl,
    retrievedAt: source.retrievedAt,
    license: source.license,
    sha256: source.sha256,
    notes: source.notes,
  });
}

export function profileSignature(profile: PreparedProfile): string {
  return canonicalJson({
    sourceKey: profile.sourceKey,
    name: profile.name,
    category: profile.category,
    kind: profile.kind,
    quantity: profile.quantity,
    unit: profile.unit,
    timeBasis: profile.timeBasis,
    resolutionMinutes: profile.resolutionMinutes,
    start: profile.start,
    end: profile.end,
    pointCount: profile.pointCount,
    contentHash: profile.contentHash,
    series: profile.series,
    metadata: profile.metadata,
    quality: profile.quality,
  });
}
