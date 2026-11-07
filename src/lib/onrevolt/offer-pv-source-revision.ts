import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const PV_SOURCE = 'PVGIS 6 / SARAH-3';
const REFERENCE_PERIOD = '2020-2024';

export type OfferPvSourceLocation = { latitude: number; longitude: number };

type PvgisMetadata = {
  source?: unknown;
  period?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  sha256?: unknown;
};

const runtimeDigestCache = new Map<string, { fingerprint: string; digest: string }>();

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function coordinateKey(latitude: number, longitude: number): string {
  const format = (value: number) => {
    if (Object.is(value, -0)) return '-0.000000';

    const absolute = Math.abs(value);
    const scaled = absolute * 1_000_000;
    const binaryHalfTie = absolute * 128;
    if (Number.isInteger(binaryHalfTie) && Math.abs(binaryHalfTie % 2) === 1) {
      const lower = Math.floor(scaled);
      const rounded = lower % 2 === 0 ? lower : lower + 1;
      const whole = Math.trunc(rounded / 1_000_000);
      const fraction = String(rounded % 1_000_000).padStart(6, '0');
      return `${value < 0 ? '-' : ''}${whole}.${fraction}`;
    }

    return value.toFixed(6);
  };
  return `sarah3-v6-2020-2024-${format(latitude)}-${format(longitude)}`;
}

function absoluteFile(value: string | undefined): string | null {
  if (!value || !path.isAbsolute(value)) return null;
  const resolved = path.resolve(value);
  return existsSync(resolved) && statSync(resolved).isFile() ? resolved : null;
}

function absoluteDirectory(value: string | undefined): string | null {
  if (!value || !path.isAbsolute(value)) return null;
  const resolved = path.resolve(value);
  return existsSync(resolved) && statSync(resolved).isDirectory() ? resolved : null;
}

function runtimeDigest(file: string): { digest: string; size: number; modifiedAtMs: number } {
  const stats = statSync(file);
  const fingerprint = `${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
  const cached = runtimeDigestCache.get(file);
  const digest = cached?.fingerprint === fingerprint ? cached.digest : sha256(readFileSync(file));
  if (!cached || cached.fingerprint !== fingerprint) runtimeDigestCache.set(file, { fingerprint, digest });
  return { digest, size: stats.size, modifiedAtMs: stats.mtimeMs };
}

function cacheFiles(toolsDirectory: string, location: OfferPvSourceLocation) {
  const csvPath = path.join(toolsDirectory, 'pvgis-cache', `${coordinateKey(location.latitude, location.longitude)}.csv.gz`);
  // pvgis_data.py uses Path.with_suffix('.json') on the .csv.gz path.
  return { csvPath, metadataPath: csvPath.replace(/\.csv\.gz$/u, '.csv.json') };
}

export function isOfferPvSourceUpdateActive(location: OfferPvSourceLocation): boolean {
  const toolsDirectory = absoluteDirectory(process.env.ONREVOLT_PV_TOOLS_DIR);
  if (!toolsDirectory) return false;
  const { csvPath } = cacheFiles(toolsDirectory, location);
  return existsSync(csvPath.replace(/\.gz$/u, '.lock'));
}

function rawDataIdentity(location: OfferPvSourceLocation, csvPath: string, metadataPath: string) {
  const csvExists = existsSync(csvPath);
  const metadataExists = existsSync(metadataPath);
  if (!csvExists && !metadataExists) return null;
  if (!csvExists || !metadataExists || !statSync(csvPath).isFile() || !statSync(metadataPath).isFile()) {
    throw new Error('Niekompletne dane PVGIS: brakuje pliku CSV lub metadanych.');
  }

  const compressedBytes = readFileSync(csvPath);
  const metadataBytes = readFileSync(metadataPath);
  let metadata: PvgisMetadata;
  try {
    metadata = JSON.parse(metadataBytes.toString('utf8')) as PvgisMetadata;
  } catch {
    throw new Error('Nieprawidłowe metadane zapisanych danych PVGIS.');
  }
  const actualChecksum = sha256(compressedBytes);
  if (typeof metadata.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(metadata.sha256)
    || metadata.sha256 !== actualChecksum) {
    throw new Error('Niezgodna suma kontrolna zapisanych danych PVGIS.');
  }
  if (metadata.source !== PV_SOURCE || metadata.period !== REFERENCE_PERIOD
    || typeof metadata.latitude !== 'number' || !Number.isFinite(metadata.latitude)
    || typeof metadata.longitude !== 'number' || !Number.isFinite(metadata.longitude)
    || coordinateKey(metadata.latitude, metadata.longitude) !== coordinateKey(location.latitude, location.longitude)) {
    throw new Error('Metadane zapisanych danych PVGIS nie odpowiadają źródłu, okresowi lub lokalizacji.');
  }

  return {
    compressedBytesSha256: actualChecksum,
    metadataBytesSha256: sha256(metadataBytes),
  };
}

/**
 * Fingerprint the inputs that can change a PV profile. A missing raw PVGIS
 * cache is a cold source and deliberately returns null, so callers cannot
 * reuse or persist a result under an incomplete identity.
 */
export function getOfferPvSourceRevision(location: OfferPvSourceLocation): string | null {
  const toolsDirectory = absoluteDirectory(process.env.ONREVOLT_PV_TOOLS_DIR);
  const pythonPath = absoluteFile(process.env.ONREVOLT_PV_PYTHON);
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'offer-pv-profile.py');
  if (!toolsDirectory || !pythonPath || !existsSync(scriptPath) || !statSync(scriptPath).isFile()) return null;

  const modelPaths = ['engine.py', 'solar_model.py', 'pvgis_data.py'].map(name => path.join(toolsDirectory, name));
  if (modelPaths.some(file => !existsSync(file) || !statSync(file).isFile())) return null;
  const { csvPath, metadataPath } = cacheFiles(toolsDirectory, location);
  // The PVGIS writer publishes the CSV and its sidecar in two atomic renames
  // while holding this per-location lock; a transient pair mismatch is not a
  // stable source revision.
  if (existsSync(csvPath.replace(/\.gz$/u, '.lock'))) return null;
  const rawData = rawDataIdentity(location, csvPath, metadataPath);
  if (!rawData) return null;

  const runtime = runtimeDigest(pythonPath);
  const fingerprintInput = {
    revision: 1,
    runtime: {
      path: path.resolve(pythonPath).toLocaleLowerCase('en-US'),
      sha256: runtime.digest,
      size: runtime.size,
      modifiedAtMs: runtime.modifiedAtMs,
    },
    sources: [scriptPath, ...modelPaths].map(file => ({
      name: path.relative(process.cwd(), file).replace(/\\/gu, '/'),
      sha256: sha256(readFileSync(file)),
    })),
    rawData,
  };
  return sha256(JSON.stringify(fingerprintInput));
}
