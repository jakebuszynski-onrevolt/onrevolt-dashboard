import childProcess from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { getOfferPvSourceRevision, isOfferPvSourceUpdateActive } from './offer-pv-source-revision';

const MAX_HOURS = 366 * 24;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 4096;
const TIMEOUT_MS = 120000;
const PROFILE_CACHE_MAX = 16;
const PROFILE_CACHE_TTL_MS = 60 * 60 * 1000;
const PROFILE_INFLIGHT_MAX = 16;
const PV_SOURCE = 'PVGIS 6 / SARAH-3';
const PV_MODEL = 'Hay-Davies · Martin–Ruiz · Faiman · Huld (cSi 2025)';
const REFERENCE_PERIOD = '2020-2024';

export type OfferPvProfileInput = {
  latitude: number;
  longitude: number;
  powerKw: number;
  tiltDegrees: number;
  azimuthDegrees: number;
  lossPercent: number;
  fromUtc: string;
  untilUtc: string;
};

export type OfferPvProfile = {
  hours: Array<{ startUtc: string; pvKwh: number }>;
  source: string;
  model: string;
  quality: 'MODELLED';
  referencePeriod: string | null;
  temporalBasis: 'typical-hourly-climatology' | 'zero-capacity';
  measuredHistory: false;
  note: string;
};

type NormalizedInput = OfferPvProfileInput & { startMs: number; hourCount: number };
type RuntimeProfile = { hours: Array<{ startUtc: string; pvKwh: number }>; source: string; model: string; referencePeriod: string };
type CachedProfile = { expiresAt: number; profile: OfferPvProfile };
export type OfferPvProfileRead = { profile: OfferPvProfile; sourceRevision: string | null };

export class OfferPvSourceRevisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferPvSourceRevisionError';
  }
}

const profileCache = new Map<string, CachedProfile>();
const profileInflight = new Map<string, Promise<OfferPvProfileRead>>();
let activeProfileComputations = 0;

function numberInRange(value: unknown, minimum: number, maximum: number, name: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Nieprawidłowe pole profilu PV: ${name}`);
  }
  return value;
}

function utcHour(value: unknown, name: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00(?:\.000)?Z$/.test(value)) {
    throw new Error(`${name} musi wskazywać pełną godzinę UTC z sufiksem Z`);
  }
  if (value.startsWith('0000-')) throw new Error(`Nieprawidłowa data UTC w polu ${name}`);
  const millis = Date.parse(value);
  const canonical = Number.isFinite(millis) ? new Date(millis).toISOString() : '';
  if (!canonical || canonical !== value.replace(/(?:\.000)?Z$/, '.000Z')) {
    throw new Error(`Nieprawidłowa data UTC w polu ${name}`);
  }
  return millis;
}

function normalizeInput(input: OfferPvProfileInput): NormalizedInput {
  if (!input || typeof input !== 'object') throw new Error('Brak danych profilu PV');
  const latitude = numberInRange(input.latitude, -90, 90, 'latitude');
  const longitude = numberInRange(input.longitude, -180, 180, 'longitude');
  const powerKw = numberInRange(input.powerKw, 0, 100000, 'powerKw');
  if (powerKw > 0 && powerKw < 0.001) throw new Error('Moc PV musi wynosić co najmniej 0,001 kW');
  const tiltDegrees = numberInRange(input.tiltDegrees, 0, 90, 'tiltDegrees');
  const azimuthDegrees = numberInRange(input.azimuthDegrees, 0, 360, 'azimuthDegrees');
  const lossPercent = numberInRange(input.lossPercent, 0, 99.9, 'lossPercent');
  const startMs = utcHour(input.fromUtc, 'fromUtc');
  const untilMs = utcHour(input.untilUtc, 'untilUtc');
  const durationMs = untilMs - startMs;
  const hourCount = durationMs / 3600000;
  if (!Number.isInteger(hourCount) || hourCount < 1) throw new Error('Przedział profilu PV musi zawierać pełne godziny UTC');
  if (hourCount > MAX_HOURS) throw new Error('Przedział profilu PV przekracza limit 366 dni');
  return {
    latitude, longitude, powerKw, tiltDegrees, azimuthDegrees, lossPercent,
    fromUtc: new Date(startMs).toISOString(), untilUtc: new Date(untilMs).toISOString(),
    startMs, hourCount,
  };
}

function expectedStart(startMs: number, index: number) {
  return new Date(startMs + index * 3600000).toISOString();
}

function cloneProfile(profile: OfferPvProfile): OfferPvProfile {
  return { ...profile, hours: profile.hours.map((hour) => ({ ...hour })) };
}

function cacheKey(input: NormalizedInput, sourceRevision: string) {
  return JSON.stringify([
    sourceRevision,
    input.latitude,
    input.longitude,
    input.powerKw,
    input.tiltDegrees,
    input.azimuthDegrees,
    input.lossPercent,
    input.fromUtc,
    input.untilUtc,
  ]);
}

function coldInFlightKey(input: NormalizedInput) {
  return `cold:${JSON.stringify([
    input.latitude, input.longitude, input.powerKw, input.tiltDegrees, input.azimuthDegrees,
    input.lossPercent, input.fromUtc, input.untilUtc,
  ])}`;
}

function getCachedProfile(key: string): OfferPvProfile | null {
  const cached = profileCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    profileCache.delete(key);
    return null;
  }
  profileCache.delete(key);
  profileCache.set(key, cached);
  return cloneProfile(cached.profile);
}

function rememberProfile(key: string, profile: OfferPvProfile) {
  const now = Date.now();
  for (const [cachedKey, cached] of profileCache) {
    if (cached.expiresAt <= now) profileCache.delete(cachedKey);
  }
  profileCache.delete(key);
  profileCache.set(key, { expiresAt: now + PROFILE_CACHE_TTL_MS, profile: cloneProfile(profile) });
  while (profileCache.size > PROFILE_CACHE_MAX) {
    const oldestKey = profileCache.keys().next().value;
    if (oldestKey === undefined) break;
    profileCache.delete(oldestKey);
  }
}

function validateRuntimeProfile(value: unknown, input: NormalizedInput): RuntimeProfile {
  if (!value || typeof value !== 'object') throw new Error('Nieprawidłowy wynik profilu PV');
  const result = value as Partial<RuntimeProfile>;
  if (result.source !== PV_SOURCE || result.model !== PV_MODEL || result.referencePeriod !== REFERENCE_PERIOD) {
    throw new Error('Wynik profilu PV ma nieoczekiwane źródło lub model');
  }
  if (!Array.isArray(result.hours) || result.hours.length !== input.hourCount) {
    throw new Error('Niepełne pokrycie godzinowe profilu PV');
  }
  const hours = result.hours.map((hour, index) => {
    if (!hour || typeof hour !== 'object' || hour.startUtc !== expectedStart(input.startMs, index)) {
      throw new Error('Wynik profilu PV zawiera lukę, duplikat lub nieprawidłową godzinę UTC');
    }
    if (typeof hour.pvKwh !== 'number' || !Number.isFinite(hour.pvKwh) || hour.pvKwh < 0) {
      throw new Error('Wynik profilu PV zawiera nieprawidłową produkcję');
    }
    return { startUtc: hour.startUtc, pvKwh: hour.pvKwh };
  });
  return { hours, source: PV_SOURCE, model: PV_MODEL, referencePeriod: REFERENCE_PERIOD };
}

function zeroProfile(input: NormalizedInput): OfferPvProfile {
  return {
    hours: Array.from({ length: input.hourCount }, (_, index) => ({ startUtc: expectedStart(input.startMs, index), pvKwh: 0 })),
    source: 'CRM zero-capacity bypass (no external weather data)',
    model: 'Exact zero-output bypass',
    quality: 'MODELLED',
    referencePeriod: null,
    temporalBasis: 'zero-capacity',
    measuredHistory: false,
    note: 'Moc instalacji wynosi 0 kW; wartości zerowe nie pochodzą z pomiarów ani z danych pogodowych.',
  };
}

function configuredPath(name: string, directory: boolean) {
  const configured = process.env[name];
  if (!configured) throw new Error(`Brak wymaganej zmiennej środowiskowej ${name}`);
  if (!path.isAbsolute(configured)) throw new Error(`${name} musi być ścieżką bezwzględną`);
  const resolved = path.resolve(configured);
  if (!existsSync(resolved) || (directory ? !statSync(resolved).isDirectory() : !statSync(resolved).isFile())) {
    throw new Error(`${name} nie wskazuje ${directory ? 'katalogu' : 'pliku'}`);
  }
  return resolved;
}

function childEnvironment(toolsDir: string, pythonPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    ONREVOLT_PV_TOOLS_DIR: toolsDir,
    ONREVOLT_PV_PYTHON: pythonPath,
    PYTHONUTF8: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  };
  for (const key of ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function runPython(input: NormalizedInput): Promise<string> {
  const toolsDir = configuredPath('ONREVOLT_PV_TOOLS_DIR', true);
  const pythonPath = configuredPath('ONREVOLT_PV_PYTHON', false);
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'offer-pv-profile.py');
  if (!existsSync(scriptPath)) throw new Error('Nie znaleziono skryptu profilu PV CRM');

  const payload = {
    latitude: input.latitude,
    longitude: input.longitude,
    powerKw: input.powerKw,
    tiltDegrees: input.tiltDegrees,
    azimuthDegrees: input.azimuthDegrees,
    lossPercent: input.lossPercent,
    fromUtc: input.fromUtc,
    untilUtc: input.untilUtc,
  };
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(pythonPath, [scriptPath], {
      cwd: toolsDir,
      env: childEnvironment(toolsDir, pythonPath),
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    timer = setTimeout(() => {
      child.kill();
      fail(new Error('Przekroczono limit czasu profilu PV'));
    }, TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        fail(new Error('Wynik profilu PV przekracza limit rozmiaru'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const remaining = MAX_STDERR_BYTES - Buffer.byteLength(stderr);
      if (remaining > 0) stderr += chunk.subarray(0, remaining).toString('utf8');
    });
    child.on('error', (error) => fail(new Error(`Nie udało się uruchomić Pythona dla profilu PV: ${error.message}`)));
    child.stdin.on('error', (error) => fail(new Error(`Nie udało się przekazać danych profilu PV: ${error.message}`)));
    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(timer);
      if (code !== 0) {
        fail(new Error(`Model PV zakończył się błędem${stderr ? `: ${stderr.trim()}` : ''}`));
        return;
      }
      settled = true;
      resolve(Buffer.concat(stdout, stdoutBytes).toString('utf8'));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function computeProfile(normalized: NormalizedInput): Promise<OfferPvProfile> {
  const raw = await runPython(normalized);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Model PV zwrócił nieprawidłowy JSON');
  }
  const result = validateRuntimeProfile(parsed, normalized);
  return {
    ...result,
    quality: 'MODELLED',
    temporalBasis: 'typical-hourly-climatology',
    measuredHistory: false,
    note: `Modelowany typowy profil godzinowy; średnia dla ${REFERENCE_PERIOD} według miesiąca, dnia i godziny UTC. To nie jest historia pomiarowa.`,
  };
}

export async function readOfferPvProfileWithSourceRevision(input: OfferPvProfileInput): Promise<OfferPvProfileRead> {
  const normalized = normalizeInput(input);
  if (normalized.powerKw === 0) return { profile: zeroProfile(normalized), sourceRevision: null };

  const coldKey = coldInFlightKey(normalized);
  const coldPending = profileInflight.get(coldKey);
  if (coldPending) return coldPending.then(result => ({ ...result, profile: cloneProfile(result.profile) }));
  if (isOfferPvSourceUpdateActive(normalized)) {
    throw new OfferPvSourceRevisionError('Dane PVGIS dla tej lokalizacji są właśnie aktualizowane. Ponów obliczenia.');
  }

  const sourceRevisionBefore = getOfferPvSourceRevision(normalized);
  if (sourceRevisionBefore === null && isOfferPvSourceUpdateActive(normalized)) {
    throw new OfferPvSourceRevisionError('Dane PVGIS dla tej lokalizacji są właśnie aktualizowane. Ponów obliczenia.');
  }
  const keyBefore = sourceRevisionBefore ? cacheKey(normalized, sourceRevisionBefore) : null;
  if (keyBefore) {
    const cached = getCachedProfile(keyBefore);
    if (cached) return { profile: cached, sourceRevision: sourceRevisionBefore };

    const pending = profileInflight.get(keyBefore);
    if (pending) return pending.then(result => ({ ...result, profile: cloneProfile(result.profile) }));
  }
  if (activeProfileComputations >= PROFILE_INFLIGHT_MAX) {
    throw new Error('Osiągnięto limit 16 równoległych obliczeń profilu PV');
  }

  activeProfileComputations += 1;
  const inFlightKey = keyBefore ?? coldKey;
  const task = (async (): Promise<OfferPvProfileRead> => {
    const profile = await computeProfile(normalized);
    const sourceRevisionAfter = getOfferPvSourceRevision(normalized);
    if (!sourceRevisionAfter) {
      throw new OfferPvSourceRevisionError('Nie udało się ustalić rewizji źródła PV po obliczeniu profilu.');
    }
    if (sourceRevisionBefore !== null && sourceRevisionAfter !== sourceRevisionBefore) {
      throw new OfferPvSourceRevisionError('Źródło PV zmieniło się podczas generowania profilu. Ponów obliczenia.');
    }
    rememberProfile(cacheKey(normalized, sourceRevisionAfter), profile);
    return { profile, sourceRevision: sourceRevisionAfter };
  })();
  profileInflight.set(inFlightKey, task);
  try {
    const result = await task;
    return { ...result, profile: cloneProfile(result.profile) };
  } finally {
    activeProfileComputations -= 1;
    if (profileInflight.get(inFlightKey) === task) profileInflight.delete(inFlightKey);
  }
}

export async function readOfferPvProfile(input: OfferPvProfileInput): Promise<OfferPvProfile> {
  return (await readOfferPvProfileWithSourceRevision(input)).profile;
}
