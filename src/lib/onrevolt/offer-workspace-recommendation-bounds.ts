export type RecommendationBatteryEnergyInterval = {
  startUtc: string;
  endUtc: string;
  loadKwh: number | null;
};

export type OfferWorkspaceRecommendationDailyBatteryBounds = {
  basis: 'daily_consumption';
  averageDailyConsumptionKwh: number;
  totalConsumptionKwh: number;
  dayCount: number;
  minimumDailyConsumptionMultiplier: 0.5;
  maximumDailyConsumptionMultiplier: 2;
  minimumBatteryCapacityKwh: number;
  maximumBatteryCapacityKwh: number;
};

export type OfferWorkspaceRecommendationExistingPvBatteryBounds = {
  basis: 'existing_pv';
  existingPvPowerKw: number;
  minimumBatteryKwhPerPvKwp: number;
  maximumBatteryKwhPerPvKwp: number;
  minimumBatteryCapacityKwh: number;
  maximumBatteryCapacityKwh: number;
};

export type OfferWorkspaceRecommendationBatteryBounds =
  | OfferWorkspaceRecommendationDailyBatteryBounds
  | OfferWorkspaceRecommendationExistingPvBatteryBounds
  | { basis: 'pv_production'; totalConsumptionKwh: number; minimumPvProductionKwh: number; maximumPvProductionKwh: number;
      minimumBatteryCapacityKwh: number; maximumBatteryCapacityKwh: number };

export type RecommendationBatteryBoundsResult =
  | { bounds: OfferWorkspaceRecommendationBatteryBounds; reason: null }
  | { bounds: null; reason: string };

export const INCOMPLETE_RECOMMENDATION_CONSUMPTION_REASON =
  'Nie można wyznaczyć zakresu pojemności magazynu: profil zużycia nie obejmuje kompletnego okresu pomiarowego lub zawiera brakujące albo nieprawidłowe interwały.';
export const INVALID_EXISTING_PV_RECOMMENDATION_REASON =
  'Nie można wyznaczyć zakresu magazynu: moc istniejącej instalacji PV musi być dodatnia i skończona.';
export const OFFER_RECOMMENDATION_MIN_BATTERY_KWH_PER_EXISTING_PV_KWP = 2;
export const OFFER_RECOMMENDATION_MAX_BATTERY_KWH_PER_EXISTING_PV_KWP = 3;
export const OFFER_RECOMMENDATION_MAX_BATTERY_KWH_PER_PV_KWP = 3;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const warsawParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function localParts(timestamp: number): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  if (!Number.isFinite(timestamp)) return null;
  const values = Object.fromEntries(warsawParts.formatToParts(timestamp)
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const { year, month, day, hour, minute, second } = values;
  if (![year, month, day, hour, minute, second].every(Number.isInteger)) return null;
  return { year, month, day, hour, minute, second };
}

function isLocalMidnight(timestamp: number): boolean {
  const parts = localParts(timestamp);
  return Boolean(parts && parts.hour === 0 && parts.minute === 0 && parts.second === 0 && timestamp % 1000 === 0);
}

function calendarDayNumber(parts: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

type RecommendationConsumptionProfile = {
  totalConsumptionKwh: number;
  dayCount: number;
};

function readCompleteRecommendationConsumptionProfile(
  intervals: readonly RecommendationBatteryEnergyInterval[] | null | undefined,
  period: { fromUtc: string; untilUtc: string } | null | undefined,
): { profile: RecommendationConsumptionProfile; reason: null } | { profile: null; reason: string } {
  if (!Array.isArray(intervals) || intervals.length === 0 || !period
    || typeof period.fromUtc !== 'string' || typeof period.untilUtc !== 'string') {
    return { profile: null, reason: INCOMPLETE_RECOMMENDATION_CONSUMPTION_REASON };
  }

  const periodStart = Date.parse(period.fromUtc);
  const periodEnd = Date.parse(period.untilUtc);
  if (!Number.isFinite(periodStart) || !Number.isFinite(periodEnd) || periodEnd <= periodStart
    || !isLocalMidnight(periodStart) || !isLocalMidnight(periodEnd)) {
    return { profile: null, reason: INCOMPLETE_RECOMMENDATION_CONSUMPTION_REASON };
  }

  let totalConsumptionKwh = 0;
  let expectedStart = periodStart;
  for (const interval of intervals) {
    const start = typeof interval?.startUtc === 'string' ? Date.parse(interval.startUtc) : Number.NaN;
    const end = typeof interval?.endUtc === 'string' ? Date.parse(interval.endUtc) : Number.NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start !== expectedStart || end - start !== HOUR_MS
      || typeof interval.loadKwh !== 'number' || !Number.isFinite(interval.loadKwh) || interval.loadKwh < 0) {
      return { profile: null, reason: INCOMPLETE_RECOMMENDATION_CONSUMPTION_REASON };
    }
    totalConsumptionKwh += interval.loadKwh;
    if (!Number.isFinite(totalConsumptionKwh)) {
      return { profile: null, reason: INCOMPLETE_RECOMMENDATION_CONSUMPTION_REASON };
    }
    expectedStart = end;
  }
  if (expectedStart !== periodEnd) {
    return { profile: null, reason: INCOMPLETE_RECOMMENDATION_CONSUMPTION_REASON };
  }

  const firstLocal = localParts(periodStart);
  const lastLocal = localParts(periodEnd);
  if (!firstLocal || !lastLocal) return { profile: null, reason: INCOMPLETE_RECOMMENDATION_CONSUMPTION_REASON };
  const dayCount = calendarDayNumber(lastLocal) - calendarDayNumber(firstLocal);
  if (!Number.isSafeInteger(dayCount) || dayCount <= 0) {
    return { profile: null, reason: INCOMPLETE_RECOMMENDATION_CONSUMPTION_REASON };
  }

  return { profile: { totalConsumptionKwh, dayCount }, reason: null };
}

/** Full period validation remains required for candidate simulation, even when consumption does not set KEEP_EXISTING bounds. */
export function validateOfferWorkspaceRecommendationConsumptionProfile(
  intervals: readonly RecommendationBatteryEnergyInterval[] | null | undefined,
  period: { fromUtc: string; untilUtc: string } | null | undefined,
): string | null {
  return readCompleteRecommendationConsumptionProfile(intervals, period).reason;
}

/** Calculates ADD_TEMPLATE bounds from complete consumption over the measured/modelled period. */
export function calculateOfferWorkspaceRecommendationBatteryBounds(
  intervals: readonly RecommendationBatteryEnergyInterval[] | null | undefined,
  period: { fromUtc: string; untilUtc: string } | null | undefined,
): RecommendationBatteryBoundsResult {
  const profile = readCompleteRecommendationConsumptionProfile(intervals, period);
  if (!profile.profile) return { bounds: null, reason: profile.reason };

  const averageDailyConsumptionKwh = profile.profile.totalConsumptionKwh / profile.profile.dayCount;
  const bounds: OfferWorkspaceRecommendationDailyBatteryBounds = {
    basis: 'daily_consumption',
    averageDailyConsumptionKwh,
    totalConsumptionKwh: profile.profile.totalConsumptionKwh,
    dayCount: profile.profile.dayCount,
    minimumDailyConsumptionMultiplier: 0.5,
    maximumDailyConsumptionMultiplier: 2,
    minimumBatteryCapacityKwh: 0.5 * averageDailyConsumptionKwh,
    maximumBatteryCapacityKwh: 2 * averageDailyConsumptionKwh,
  };
  if (![bounds.averageDailyConsumptionKwh, bounds.totalConsumptionKwh, bounds.dayCount,
    bounds.minimumDailyConsumptionMultiplier, bounds.maximumDailyConsumptionMultiplier,
    bounds.minimumBatteryCapacityKwh, bounds.maximumBatteryCapacityKwh].every(Number.isFinite)) {
    return { bounds: null, reason: INCOMPLETE_RECOMMENDATION_CONSUMPTION_REASON };
  }
  return { bounds, reason: null };
}

/** Calculates KEEP_EXISTING bounds from existing PV power only. */
export function calculateOfferWorkspaceExistingPvBatteryBounds(
  existingPvPowerKw: number | null | undefined,
): RecommendationBatteryBoundsResult {
  if (typeof existingPvPowerKw !== 'number' || !Number.isFinite(existingPvPowerKw) || existingPvPowerKw <= 0) {
    return { bounds: null, reason: INVALID_EXISTING_PV_RECOMMENDATION_REASON };
  }
  const bounds: OfferWorkspaceRecommendationExistingPvBatteryBounds = {
    basis: 'existing_pv',
    existingPvPowerKw,
    minimumBatteryKwhPerPvKwp: OFFER_RECOMMENDATION_MIN_BATTERY_KWH_PER_EXISTING_PV_KWP,
    maximumBatteryKwhPerPvKwp: OFFER_RECOMMENDATION_MAX_BATTERY_KWH_PER_EXISTING_PV_KWP,
    minimumBatteryCapacityKwh: OFFER_RECOMMENDATION_MIN_BATTERY_KWH_PER_EXISTING_PV_KWP * existingPvPowerKw,
    maximumBatteryCapacityKwh: OFFER_RECOMMENDATION_MAX_BATTERY_KWH_PER_EXISTING_PV_KWP * existingPvPowerKw,
  };
  if (![bounds.existingPvPowerKw, bounds.minimumBatteryKwhPerPvKwp, bounds.maximumBatteryKwhPerPvKwp,
    bounds.minimumBatteryCapacityKwh, bounds.maximumBatteryCapacityKwh].every(Number.isFinite)) {
    return { bounds: null, reason: INVALID_EXISTING_PV_RECOMMENDATION_REASON };
  }
  return { bounds, reason: null };
}

export function filterOfferCandidatesByRecommendationBatteryBounds<T extends { batteryCapacityKwh: number }>(
  candidates: readonly T[],
  bounds: OfferWorkspaceRecommendationBatteryBounds,
): { candidates: T[]; totalCandidatesBeforeFilter: number; excludedCandidates: number } {
  const filtered = candidates.filter(candidate => Number.isFinite(candidate.batteryCapacityKwh)
    && candidate.batteryCapacityKwh >= bounds.minimumBatteryCapacityKwh
    && candidate.batteryCapacityKwh <= bounds.maximumBatteryCapacityKwh);
  return {
    candidates: filtered,
    totalCandidatesBeforeFilter: candidates.length,
    excludedCandidates: candidates.length - filtered.length,
  };
}

export function filterOfferCandidatesByRecommendationPvBounds<T extends { batteryCapacityKwh: number; totalPvKw: number }>(
  candidates: readonly T[],
  maximumBatteryKwhPerPvKwp = OFFER_RECOMMENDATION_MAX_BATTERY_KWH_PER_PV_KWP,
): { candidates: T[]; totalCandidatesBeforeFilter: number; excludedCandidates: number } {
  const filtered = candidates.filter(candidate => Number.isFinite(candidate.batteryCapacityKwh)
    && Number.isFinite(candidate.totalPvKw)
    && candidate.totalPvKw > 0
    && candidate.batteryCapacityKwh >= OFFER_RECOMMENDATION_MIN_BATTERY_KWH_PER_EXISTING_PV_KWP * candidate.totalPvKw
    && candidate.batteryCapacityKwh <= maximumBatteryKwhPerPvKwp * candidate.totalPvKw);
  return {
    candidates: filtered,
    totalCandidatesBeforeFilter: candidates.length,
    excludedCandidates: candidates.length - filtered.length,
  };
}

export function filterOfferCandidatesByPvProduction<T extends { addedPvKw: number }>(
  candidates: readonly T[], consumptionKwh: number, existingPvKwh: number, addedPvKwh: ReadonlyMap<number, number>,
): { candidates: T[]; totalCandidatesBeforeFilter: number; excludedCandidates: number } {
  if (!Number.isFinite(consumptionKwh) || consumptionKwh <= 0 || !Number.isFinite(existingPvKwh) || existingPvKwh < 0) {
    throw new Error('Brak poprawnego zużycia lub produkcji PV do porównania zakresu 80–120%.');
  }
  const filtered = candidates.filter(candidate => {
    const added = candidate.addedPvKw === 0 ? 0 : addedPvKwh.get(candidate.addedPvKw);
    if (added == null || !Number.isFinite(added) || added < 0) throw new Error('Brak kompletnego modelu dodawanej PV do filtrowania.');
    const production = existingPvKwh + added;
    return production >= consumptionKwh * 0.8 - 1e-6 && production <= consumptionKwh * 1.2 + 1e-6;
  });
  return { candidates: filtered, totalCandidatesBeforeFilter: candidates.length, excludedCandidates: candidates.length - filtered.length };
}
