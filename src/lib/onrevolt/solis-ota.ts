export type SolisFirmwareRelease = {
  version: string;
  size: number;
  createdAt: string | null;
};

export type SolisOtaState = 'IDLE' | 'WAITING' | 'DOWNLOADING' | 'VERIFYING' | 'CURRENT' | 'FAILED';

export const SOLIS_RAPID_COMMANDS = [
  'OTA_CHECK_NOW',
  'EXPORT_BLOCK_ON',
  'EXPORT_BLOCK_OFF',
  'PV_BLOCK_ON',
  'PV_BLOCK_OFF',
] as const;

export type SolisRapidCommand = typeof SOLIS_RAPID_COMMANDS[number];
export type SolisRapidCommandState = 'IDLE' | 'PENDING' | 'EXPIRED' | 'ACKNOWLEDGED' | 'FAILED';

export type SolisRapidCommandStateInput = {
  sequence: number;
  command: string | null;
  expiresAt: string | null;
  acknowledgedSequence: number;
  acknowledgedAt: string | null;
  ok: boolean | null;
};

export type SolisOtaStateInput = {
  firmwareVersion: string | null;
  targetVersion: string | null;
  otaEnabled: boolean;
  lastStatus: string | null;
};

const versionPattern = /^[A-Za-z0-9._-]{1,80}$/;
const minimumRapidCommandFirmware = '2026.09.02.4';

export function isValidSolisFirmwareVersion(value: string) {
  return versionPattern.test(value.trim());
}

export function isSolisStationType(value: string | null | undefined) {
  return String(value || '').toLowerCase().includes('solis');
}

export function isValidSolisRapidCommand(value: string): value is SolisRapidCommand {
  return SOLIS_RAPID_COMMANDS.includes(value.trim().toUpperCase() as SolisRapidCommand);
}

export function supportsSolisRapidCommands(firmwareVersion: string | null | undefined) {
  const version = String(firmwareVersion || '').trim();
  if (!isValidSolisFirmwareVersion(version)) return false;
  return version.localeCompare(minimumRapidCommandFirmware, undefined, {
    numeric: true,
    sensitivity: 'base',
  }) >= 0;
}

export function deriveSolisRapidCommandState(
  input: SolisRapidCommandStateInput,
  now = new Date(),
): SolisRapidCommandState {
  const pendingSequence = input.sequence > input.acknowledgedSequence;
  if (input.command && pendingSequence) {
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (!expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt <= now) return 'EXPIRED';
    return 'PENDING';
  }
  if (input.acknowledgedSequence > 0 && input.acknowledgedAt) {
    return input.ok === false ? 'FAILED' : 'ACKNOWLEDGED';
  }
  return 'IDLE';
}

export function deriveSolisOtaState(input: SolisOtaStateInput): SolisOtaState {
  const status = String(input.lastStatus || '').trim().toLowerCase();
  const targetReached = Boolean(
    input.firmwareVersion
      && input.targetVersion
      && input.firmwareVersion === input.targetVersion,
  );

  if (input.otaEnabled) {
    if (status.includes('downloading')) return 'DOWNLOADING';
    if (status === 'updated' || status.includes('validation')) return 'VERIFYING';
    if (targetReached) return 'VERIFYING';
    return 'WAITING';
  }

  if (status.includes('fail') || status.includes('rollback')) return 'FAILED';
  if (targetReached && ['current', 'healthy', 'updated'].some((value) => status.includes(value))) return 'CURRENT';
  return 'IDLE';
}

function parseRelease(value: unknown): (SolisFirmwareRelease & { url: string }) | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const version = String(record.version || '').trim();
  const url = String(record.url || '').trim();
  const sha256 = String(record.sha256 || '').trim().toLowerCase();
  const size = Number(record.size);
  const createdAt = String(record.created_at || '').trim() || null;

  if (!isValidSolisFirmwareVersion(version)) return null;
  if (!/^https:\/\//i.test(url)) return null;
  if (!/^[a-f0-9]{64}$/.test(sha256)) return null;
  if (!Number.isInteger(size) || size <= 0) return null;

  return { version, url, size, createdAt };
}

export async function listSolisFirmwareReleases(): Promise<SolisFirmwareRelease[]> {
  const releasesUrl = process.env.ONREVOLT_SOLIS_RELEASES_URL?.trim();
  if (!releasesUrl) {
    throw new Error('Brak ONREVOLT_SOLIS_RELEASES_URL dla wydań firmware Solis');
  }
  const endpoint = new URL(releasesUrl);
  if (endpoint.protocol !== 'https:') {
    throw new Error('Katalog firmware Solis musi używać HTTPS');
  }

  const response = await fetch(endpoint, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Katalog firmware Solis zwrócił HTTP ${response.status}`);
  }
  const payload = await response.json() as { releases?: unknown };
  if (!Array.isArray(payload.releases)) {
    throw new Error('Katalog firmware Solis ma nieprawidłowy format');
  }

  const releases = new Map<string, SolisFirmwareRelease>();
  for (const candidate of payload.releases) {
    const release = parseRelease(candidate);
    if (!release || releases.has(release.version)) continue;
    releases.set(release.version, {
      version: release.version,
      size: release.size,
      createdAt: release.createdAt,
    });
  }

  return Array.from(releases.values()).sort((left, right) => (
    right.version.localeCompare(left.version, undefined, { numeric: true, sensitivity: 'base' })
  ));
}
