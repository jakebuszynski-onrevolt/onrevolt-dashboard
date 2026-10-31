import { emptyOfferWorkspaceDraft } from './offer-workspace';
import type { OfferPvProfileInput } from './offer-pv-profile';

export type ProjectPvSettings = {
  powerKw: number | null;
  tiltDegrees: number | null;
  azimuthDegrees: number | null;
  lossPercent: number | null;
};

export type ProjectPvSettingsPatch = {
  tiltDegrees: number | null;
  azimuthDegrees: number | null;
  lossPercent: number | null;
  expectedRevision: number;
};

export type PvSourceAudit = {
  existingPvKw?: unknown;
  roofTiltDeg?: unknown;
  roofOrientation?: unknown;
  settlementSystem?: unknown;
} | null;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function storedNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (value && typeof value === 'object' && 'toNumber' in value
    && typeof value.toNumber === 'function') {
    const number = value.toNumber();
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function roofAzimuthDegrees(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const azimuths: Record<string, number> = {
    N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
  };
  return azimuths[value.trim().toUpperCase()] ?? null;
}

export function projectPvSettingsFromSources({
  draftExists,
  draftInput,
  energyAudit,
}: {
  draftExists: boolean;
  draftInput?: unknown;
  energyAudit: PvSourceAudit;
}): ProjectPvSettings {
  if (draftExists) {
    const existingPv = objectRecord(objectRecord(draftInput)?.existingPv);
    return {
      powerKw: storedNumber(existingPv?.powerKw),
      tiltDegrees: storedNumber(existingPv?.tiltDegrees),
      azimuthDegrees: storedNumber(existingPv?.azimuthDegrees),
      lossPercent: storedNumber(existingPv?.lossPercent),
    };
  }

  const powerKw = storedNumber(energyAudit?.existingPvKw);
  const hasExistingPv = powerKw != null && powerKw > 0;
  return {
    powerKw,
    tiltDegrees: hasExistingPv ? storedNumber(energyAudit?.roofTiltDeg) : null,
    azimuthDegrees: hasExistingPv ? roofAzimuthDegrees(energyAudit?.roofOrientation) : null,
    lossPercent: null,
  };
}

function requiredNullableNumber(value: unknown, label: string, min: number, max: number): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' && !(typeof value === 'string' && value.trim())) {
    throw new Error(`${label}: wymagana liczba od ${min} do ${max} albo null.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label}: wymagana liczba od ${min} do ${max} albo null.`);
  }
  return number;
}

export function parseProjectPvSettingsPatch(value: unknown): ProjectPvSettingsPatch {
  const patch = objectRecord(value);
  if (!patch) throw new Error('pvSettings musi być obiektem.');
  for (const field of ['tiltDegrees', 'azimuthDegrees', 'lossPercent', 'expectedRevision']) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) {
      throw new Error(`Brak pola pvSettings.${field}.`);
    }
  }
  if (!Number.isSafeInteger(patch.expectedRevision) || Number(patch.expectedRevision) < 0) {
    throw new Error('pvSettings.expectedRevision musi być nieujemną liczbą całkowitą.');
  }
  return {
    tiltDegrees: requiredNullableNumber(patch.tiltDegrees, 'Nachylenie PV', 0, 90),
    azimuthDegrees: requiredNullableNumber(patch.azimuthDegrees, 'Azymut PV', 0, 360),
    lossPercent: requiredNullableNumber(patch.lossPercent, 'Straty PV', 0, 99),
    expectedRevision: patch.expectedRevision as number,
  };
}

export function parseProjectPvPower(value: unknown): number {
  const power = parseNullableProjectPvPower(value);
  if (power === null) throw new Error('Uzupełnij moc istniejącej PV.');
  return power;
}

export function parseNullableProjectPvPower(value: unknown): number | null {
  return requiredNullableNumber(value, 'Moc istniejącej PV', 0, 10000);
}

export function mergeProjectPvSettingsIntoDraft(
  input: unknown,
  powerKw: number | null,
  patch: ProjectPvSettingsPatch,
) {
  const source = objectRecord(input);
  if (!source) throw new Error('Szkic oferty PV musi być obiektem.');
  const currentPv = objectRecord(source.existingPv) || {};
  return {
    ...source,
    existingPv: {
      ...currentPv,
      powerKw,
      tiltDegrees: patch.tiltDegrees,
      azimuthDegrees: patch.azimuthDegrees,
      lossPercent: patch.lossPercent,
    },
  };
}

export function seedProjectPvWorkspaceDraft(
  energyAudit: PvSourceAudit,
  targetTariff: { osdId: number; tariffId: number } | null = null,
) {
  const draft = emptyOfferWorkspaceDraft();
  const settlement = typeof energyAudit?.settlementSystem === 'string'
    ? energyAudit.settlementSystem.trim().toUpperCase().replace(/[- ]/g, '_')
    : '';
  const knownSettlement = settlement === 'NET_METERING' || settlement === 'NETMETERING'
    ? 'NET_METERING'
    : settlement === 'NET_BILLING' || settlement === 'NETBILLING'
      ? 'NET_BILLING'
      : null;
  draft.currentSettlement = knownSettlement;
  draft.targetSettlement = knownSettlement;
  if (targetTariff) {
    draft.targetOperatorId = targetTariff.osdId;
    draft.targetTariffId = targetTariff.tariffId;
  }
  return draft;
}

export function projectPvSettingsPowerFromDraft(input: unknown): number | null {
  return storedNumber(objectRecord(objectRecord(input)?.existingPv)?.powerKw);
}

export function completeProjectPvProfileInput(
  existingPvValue: unknown,
  latitudeValue: unknown,
  longitudeValue: unknown,
  period: { fromUtc: string; untilUtc: string },
): OfferPvProfileInput {
  const existingPv = objectRecord(existingPvValue);
  if (!existingPv) throw new Error('Brak danych istniejącej PV.');
  const latitude = requiredNullableNumber(latitudeValue, 'Szerokość geograficzna', -90, 90);
  const longitude = requiredNullableNumber(longitudeValue, 'Długość geograficzna', -180, 180);
  const powerKw = parseProjectPvPower(existingPv.powerKw);
  const tiltDegrees = requiredNullableNumber(existingPv.tiltDegrees, 'Nachylenie PV', 0, 90);
  const azimuthDegrees = requiredNullableNumber(existingPv.azimuthDegrees, 'Azymut PV', 0, 360);
  const lossPercent = requiredNullableNumber(existingPv.lossPercent, 'Straty PV', 0, 99);
  if (latitude === null || longitude === null || tiltDegrees === null || azimuthDegrees === null || lossPercent === null) {
    throw new Error('Uzupełnij współrzędne, nachylenie, azymut i straty PV.');
  }
  return {
    latitude,
    longitude,
    powerKw,
    tiltDegrees,
    azimuthDegrees,
    lossPercent,
    ...period,
  };
}

export function annualPvProductionKwh(hours: Array<{ pvKwh: number }>): number {
  const total = hours.reduce((sum, hour) => {
    if (!Number.isFinite(hour.pvKwh) || hour.pvKwh < 0) throw new Error('Nieprawidłowa wartość produkcji PV.');
    return sum + hour.pvKwh;
  }, 0);
  return Math.round(total * 1000) / 1000;
}
