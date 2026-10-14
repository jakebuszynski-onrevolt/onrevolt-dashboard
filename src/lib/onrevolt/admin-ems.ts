import { deriveSolisOtaState, isSolisStationType } from './solis-ota';

export type AdminEmsGroup = 'SOLIS' | 'VICTRON' | 'RETERMINAL' | 'ESP32' | 'PGE' | 'OTHER';
export type AdminEmsFirmwareState =
  | 'CURRENT'
  | 'UPDATE_AVAILABLE'
  | 'UPDATING'
  | 'FAILED'
  | 'UNKNOWN'
  | 'MISSING';

export type AdminEmsRapidCommandState = 'IDLE' | 'PENDING' | 'EXPIRED' | 'ACKNOWLEDGED' | 'ACKED' | 'FAILED' | null;
export type AdminEmsRapidCommandDisplayState =
  | 'PENDING'
  | 'FAILED'
  | 'EXPIRED'
  | 'ACKED'
  | 'APPLIED'
  | 'NOT_APPLIED'
  | 'UNKNOWN';

export const ADMIN_EMS_COMMAND_POLL_INTERVAL_MS = 5_000;
export const ADMIN_EMS_COMMAND_POLL_LIMIT = 6;

export function deduplicateAdminEmsStations<T extends { station: string }>(stations: T[]) {
  const unique = new Map<string, T>();
  for (const station of stations) {
    const stationId = station.station.trim();
    if (stationId && !unique.has(stationId)) unique.set(stationId, station);
  }
  return Array.from(unique.values());
}

export function isAdminEmsCommandPollEligible(state: AdminEmsRapidCommandState, attempts: number) {
  return state === 'PENDING' && attempts < ADMIN_EMS_COMMAND_POLL_LIMIT;
}

export function isAdminEmsLoadRequestCurrent(requestId: number, latestRequestId: number, mounted: boolean) {
  return mounted && requestId === latestRequestId;
}

export function getAdminEmsRapidCommandDisplayState(
  state: AdminEmsRapidCommandState,
  commandOk: boolean | null,
  exportStateMatches: boolean | null,
): AdminEmsRapidCommandDisplayState {
  if (state === 'PENDING') return 'PENDING';
  if (state === 'FAILED' || ((state === 'ACKED' || state === 'ACKNOWLEDGED') && commandOk === false)) return 'FAILED';
  if (state === 'EXPIRED') return 'EXPIRED';
  if (state === 'ACKED' || state === 'ACKNOWLEDGED') return commandOk === true ? 'ACKED' : 'UNKNOWN';
  if (exportStateMatches === true) return 'APPLIED';
  if (exportStateMatches === false) return 'NOT_APPLIED';
  return 'UNKNOWN';
}

export function isAdminEmsExportCommand(commandName: string | null | undefined) {
  return commandName === 'EXPORT_BLOCK_ON' || commandName === 'EXPORT_BLOCK_OFF';
}

export function getAdminEmsExportCommandDisplayState(
  commandName: string | null | undefined,
  state: AdminEmsRapidCommandState,
  commandOk: boolean | null,
  exportStateMatches: boolean | null,
): AdminEmsRapidCommandDisplayState {
  if (!isAdminEmsExportCommand(commandName)) {
    if (exportStateMatches === true) return 'APPLIED';
    if (exportStateMatches === false) return 'NOT_APPLIED';
    return 'UNKNOWN';
  }

  return getAdminEmsRapidCommandDisplayState(state, commandOk, exportStateMatches);
}

export function classifyAdminEmsGroup(type: string | null | undefined): AdminEmsGroup {
  const normalized = String(type || '').trim().toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);

  if (isSolisStationType(type)) return 'SOLIS';
  if (normalized.includes('victron')) return 'VICTRON';
  if (compact.includes('reterminal')) return 'RETERMINAL';

  const hasPgeToken = tokens.includes('pge');
  const hasMeterDesignation =
    tokens.some((token) => token === 'licznik' || token === 'liczniki' || token === 'meter' || token === 'meters') ||
    compact.includes('sdm630mct') ||
    compact.includes('energymeter');
  if (normalized === 'pge' || (hasPgeToken && (hasMeterDesignation || compact.includes('sx1276')))) return 'PGE';

  if (compact.includes('sdm630mct') || compact.includes('energymeter') || compact.includes('esp32')) return 'ESP32';
  return 'OTHER';
}

export function compareAdminEmsFirmwareVersions(
  left: string,
  right: string,
  prefix?: 'PGE-',
): -1 | 0 | 1 | null {
  const parse = (version: string) => {
    let normalized = version.trim();
    if (prefix) {
      if (!normalized.toUpperCase().startsWith(prefix)) return null;
      normalized = normalized.slice(prefix.length);
    }
    const parts = normalized.split('.');
    if (!parts.length || parts.some((part) => !/^\d+$/.test(part))) return null;
    return parts.map((part) => part.replace(/^0+(?=\d)/, ''));
  };

  const leftParts = parse(left);
  const rightParts = parse(right);
  if (!leftParts || !rightParts) return null;

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] || '0';
    const rightPart = rightParts[index] || '0';
    if (leftPart.length !== rightPart.length) return leftPart.length < rightPart.length ? -1 : 1;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function getAdminEmsFirmwareState(input: {
  type: string | null | undefined;
  firmwareVersion: string | null | undefined;
  firmwareTargetVersion: string | null | undefined;
  otaEnabled: boolean;
  otaLastStatus: string | null | undefined;
  latestVersion: string | null | undefined;
  latestEnergyMeterVersion?: string | null;
  latestPgeVersion?: string | null;
}): AdminEmsFirmwareState {
  if (!input.firmwareVersion) return 'MISSING';
  if (input.otaEnabled) return 'UPDATING';
  const group = classifyAdminEmsGroup(input.type);
  if (group === 'SOLIS') {
    if (!input.latestVersion) return 'UNKNOWN';
    if (input.firmwareVersion === input.latestVersion) return 'CURRENT';

    const solisOtaState = deriveSolisOtaState({
      firmwareVersion: input.firmwareVersion,
      targetVersion: input.firmwareTargetVersion,
      otaEnabled: false,
      lastStatus: input.otaLastStatus || null,
    });
    return solisOtaState === 'FAILED' ? 'FAILED' : 'UPDATE_AVAILABLE';
  }

  const otaState = deriveSolisOtaState({
    firmwareVersion: input.firmwareVersion,
    targetVersion: input.firmwareTargetVersion,
    otaEnabled: false,
    lastStatus: input.otaLastStatus || null,
  });
  if (otaState === 'FAILED') return 'FAILED';

  if (group === 'ESP32') {
    if (!input.latestEnergyMeterVersion) return 'UNKNOWN';
    const comparison = compareAdminEmsFirmwareVersions(input.firmwareVersion, input.latestEnergyMeterVersion);
    if (comparison === -1) return 'UPDATE_AVAILABLE';
    if (comparison === 0) return 'CURRENT';
  }

  if (group === 'PGE') {
    if (!input.latestPgeVersion) return 'UNKNOWN';
    const comparison = compareAdminEmsFirmwareVersions(input.firmwareVersion, input.latestPgeVersion, 'PGE-');
    if (comparison === -1) return 'UPDATE_AVAILABLE';
    if (comparison === 0) return 'CURRENT';
  }

  return 'UNKNOWN';
}
