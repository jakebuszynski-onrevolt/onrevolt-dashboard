import type { ProjectAnalysisPeriod } from './project-analysis-period';
import type { OfferWorkspaceDayProfile } from './offer-workspace-chart-data';
import {
  buildReferenceProfileProjection,
  getReferenceProfileCalculationEligibility,
  type CatalogProfile,
  type ReferenceProfileProjection,
} from './reference-profile-comparison';

const reConsumptionEngine = require('../../../public/shared/re-consumption-engine.js') as {
  buildProfile(input: { year: number; annualKwh: number }): {
    months: Array<{ month: number; year: number; totalKwh: number; hourly: number[] }>;
  };
};

const HOUR_MS = 3_600_000;
const warsawParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export type OfferAnnualConsumptionHour = {
  startUtc: string;
  endUtc: string;
  localStart: string;
  localEnd: string;
  period: string;
  date: string;
  hour: number;
  occurrence: number;
  loadKwh: number;
};

export type OfferAnnualConsumptionProfile = {
  annualConsumptionKwh: number;
  source: string;
  intervals: OfferAnnualConsumptionHour[];
  dayProfiles: OfferWorkspaceDayProfile[];
  referenceProfile?: {
    key: string;
    name: string;
    contentHash: string;
    method: string;
    projectionVersion: 1;
    notes: string[];
  };
};

type CivilParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function civilParts(epoch: number): CivilParts {
  const parts = Object.fromEntries(warsawParts.formatToParts(new Date(epoch)).map(({ type, value }) => [type, value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

function localStamp(value: CivilParts): string {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}T${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}:${String(value.second).padStart(2, '0')}`;
}

function validPeriodKeys(periodKeys: readonly string[]): boolean {
  if (periodKeys.length !== 12 || new Set(periodKeys).size !== 12
    || periodKeys.some(period => !/^\d{4}-(0[1-9]|1[0-2])$/u.test(period))) return false;
  return periodKeys.every((period, index) => {
    if (index === 0) return true;
    const [year, month] = periodKeys[index - 1].split('-').map(Number);
    const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
    return period === next;
  });
}

function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCDate();
}

function monthProfiles(periodKeys: readonly string[], annualKwh: number) {
  const years = [...new Set(periodKeys.map(period => Number(period.slice(0, 4))))];
  const byKey = new Map<string, { totalKwh: number; hourly: number[] }>();
  for (const year of years) {
    const profile = reConsumptionEngine.buildProfile({ year, annualKwh });
    for (const month of profile.months) {
      const key = `${String(month.year).padStart(4, '0')}-${String(month.month).padStart(2, '0')}`;
      if (periodKeys.includes(key)) byKey.set(key, { totalKwh: month.totalKwh, hourly: month.hourly });
    }
  }
  if (byKey.size !== periodKeys.length || [...byKey.values()].some(month => month.hourly.length !== 24
    || !Number.isFinite(month.totalKwh) || month.totalKwh < 0
    || month.hourly.some(value => !Number.isFinite(value) || value < 0))) {
    throw new Error('RE nie zwrócił kompletnego rocznego profilu zużycia.');
  }
  return byKey;
}

function validatePeriod(period: ProjectAnalysisPeriod): void {
  if (!period || !validPeriodKeys(period.periodKeys)
    || period.startMonth !== period.periodKeys[0] || period.endMonth !== period.periodKeys[11]) {
    throw new Error('Roczny profil zużycia wymaga dokładnie 12 kolejnych miesięcy.');
  }
  const start = Date.parse(period.fromUtc), until = Date.parse(period.untilUtc);
  if (!Number.isFinite(start) || !Number.isFinite(until) || start % HOUR_MS !== 0 || until % HOUR_MS !== 0 || until <= start) {
    throw new Error('Nieprawidłowe granice okresu dla rocznego profilu zużycia.');
  }
  const first = civilParts(start), last = civilParts(until);
  const endKey = period.periodKeys[11];
  const [endYear, endMonth] = endKey.split('-').map(Number);
  const untilKey = endMonth === 12 ? `${endYear + 1}-01` : `${endYear}-${String(endMonth + 1).padStart(2, '0')}`;
  if (first.day !== 1 || first.hour !== 0 || first.minute !== 0 || first.second !== 0
    || last.day !== 1 || last.hour !== 0 || last.minute !== 0 || last.second !== 0
    || `${String(first.year).padStart(4, '0')}-${String(first.month).padStart(2, '0')}` !== period.periodKeys[0]
    || `${String(last.year).padStart(4, '0')}-${String(last.month).padStart(2, '0')}` !== untilKey) {
    throw new Error('Okres rocznego profilu musi obejmować pełne miesiące czasu Europe/Warsaw.');
  }
}

/** Build a complete 12-month civil-time profile using RE by default or an eligible reference shape. */
export function buildAnnualOfferConsumptionProfile(input: {
  annualConsumptionKwh: number | null;
  period: ProjectAnalysisPeriod;
  referenceProfile?: { profile: CatalogProfile; contentHash: string };
}): OfferAnnualConsumptionProfile {
  const annualKwh = input.annualConsumptionKwh;
  if (typeof annualKwh !== 'number' || !Number.isFinite(annualKwh) || annualKwh <= 0) {
    throw new Error('Roczne zużycie musi być dodatnią, jawną wartością w kWh.');
  }
  validatePeriod(input.period);
  let profiles: ReturnType<typeof monthProfiles> | null = null;
  let referenceProjection: ReferenceProfileProjection | null = null;
  if (input.referenceProfile) {
    const { profile, contentHash } = input.referenceProfile;
    const eligibility = getReferenceProfileCalculationEligibility(profile);
    if (!eligibility.eligible) throw new Error(`${profile.name}: ${eligibility.reason || 'profil nie kwalifikuje się do projekcji.'}`);
    if (typeof contentHash !== 'string' || !/^[\da-f]{64}$/iu.test(contentHash)) {
      throw new Error('Suma kontrolna profilu referencyjnego musi być 64-znakowym SHA-256.');
    }
  } else {
    profiles = monthProfiles(input.period.periodKeys, annualKwh);
  }
  const start = Date.parse(input.period.fromUtc), until = Date.parse(input.period.untilUtc);
  const rawIntervals: Array<Omit<OfferAnnualConsumptionHour, 'loadKwh'>> = [];
  const occurrences = new Map<string, number>();
  const intervalDates = new Map<string, number[]>();

  for (let epoch = start; epoch < until; epoch += HOUR_MS) {
    const local = civilParts(epoch);
    const nextLocal = civilParts(epoch + HOUR_MS);
    const date = `${String(local.year).padStart(4, '0')}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
    const period = date.slice(0, 7);
    if (profiles && !profiles.has(period)) throw new Error(`Godzina poza zadanym okresem rocznym: ${date}.`);
    const key = `${date}/${local.hour}`;
    const occurrence = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, occurrence);
    const index = rawIntervals.length;
    rawIntervals.push({ startUtc: new Date(epoch).toISOString(), endUtc: new Date(epoch + HOUR_MS).toISOString(),
      localStart: localStamp(local), localEnd: localStamp(nextLocal), period, date, hour: local.hour, occurrence });
    const day = intervalDates.get(date) || [];
    day.push(index);
    intervalDates.set(date, day);
  }

  if (input.referenceProfile) {
    referenceProjection = buildReferenceProfileProjection(input.referenceProfile.profile, [...intervalDates.keys()]);
  }
  const referenceDaysByDate = new Map(referenceProjection?.days.map(day => [day.date, day]) || []);

  const weights = new Array<number>(rawIntervals.length).fill(0);
  for (const [date, indexes] of intervalDates) {
    let rawDayWeights: number[];
    if (referenceProjection) {
      const daily = referenceDaysByDate.get(date);
      if (!daily || daily.hours.length !== 24 || daily.hours.some(value => !Number.isFinite(value) || value < 0)) {
        throw new Error(`Profil referencyjny nie zwrócił pełnego kształtu dla ${date}.`);
      }
      const rawDayTotal = daily.hours.reduce((sum, value) => sum + value, 0);
      rawDayWeights = indexes.map(index => daily.hours[rawIntervals[index].hour]
        / occurrences.get(`${date}/${rawIntervals[index].hour}`)!);
      const representedDayTotal = rawDayWeights.reduce((sum, value) => sum + value, 0);
      if (rawDayTotal > 0) {
        if (!(representedDayTotal > 0) || !Number.isFinite(representedDayTotal)) {
          throw new Error(`Nie można zachować dobowej sumy profilu referencyjnego dla ${date}.`);
        }
        const dstCorrection = rawDayTotal / representedDayTotal;
        rawDayWeights = rawDayWeights.map(value => value * dstCorrection);
      } else if (representedDayTotal !== 0) {
        throw new Error(`Nieprawidłowa dobowa suma profilu referencyjnego dla ${date}.`);
      }
    } else {
      const [year, month] = date.split('-').map(Number);
      const profile = profiles!.get(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`)!;
      const dayCount = daysInMonth(year, month);
      const dayTarget = profile.totalKwh / dayCount;
      rawDayWeights = indexes.map(index => profile.hourly[rawIntervals[index].hour]
        / dayCount / occurrences.get(`${date}/${rawIntervals[index].hour}`)!);
      const rawDayTotal = rawDayWeights.reduce((sum, value) => sum + value, 0);
      if (!(rawDayTotal > 0) || !Number.isFinite(rawDayTotal)) throw new Error(`RE zwrócił pusty profil zużycia dla ${date}.`);
      indexes.forEach((index, offset) => { weights[index] = rawDayWeights[offset] * dayTarget / rawDayTotal; });
      continue;
    }
    const rawDayTotal = rawDayWeights.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(rawDayTotal) || rawDayTotal < 0) throw new Error(`Profil referencyjny zwrócił nieprawidłową sumę dla ${date}.`);
    indexes.forEach((index, offset) => { weights[index] = rawDayWeights[offset]; });
  }

  const periodWeightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (!(periodWeightTotal > 0) || !Number.isFinite(periodWeightTotal)) throw new Error('RE zwrócił pusty profil zużycia dla okresu.');
  const intervals = rawIntervals.map((interval, index) => ({ ...interval, loadKwh: weights[index] * annualKwh / periodWeightTotal }));
  const residualIndex = intervals.reduce((largest, interval, index) =>
    largest === -1 || interval.loadKwh > intervals[largest].loadKwh ? index : largest, -1);
  if (residualIndex === -1 || !(intervals[residualIndex].loadKwh > 0)) {
    throw new Error('Okres rocznego profilu nie zawiera godzin o dodatnim zużyciu.');
  }
  const otherIntervalsTotal = intervals.reduce((sum, interval, index) => index === residualIndex ? sum : sum + interval.loadKwh, 0);
  const residualLoad = annualKwh - otherIntervalsTotal;
  if (!Number.isFinite(residualLoad) || residualLoad < 0) {
    throw new Error('Nie można zachować dokładnej rocznej sumy bez ujemnego interwału.');
  }
  intervals[residualIndex].loadKwh = residualLoad;

  const groupedDays = new Map<string, OfferAnnualConsumptionHour[]>();
  for (const interval of intervals) {
    const day = groupedDays.get(interval.date) || [];
    day.push(interval);
    groupedDays.set(interval.date, day);
  }
  const representatives = new Map<string, OfferWorkspaceDayProfile>();
  for (const [date, rows] of groupedDays) {
    if (rows.length !== 24) continue;
    const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
    const dayType = weekday === 0 || weekday === 6 ? 'free' : 'workday';
    const key = `${date.slice(0, 7)}/${dayType}`;
    if (representatives.has(key)) continue;
    representatives.set(key, { period: date.slice(0, 7), date, dayType,
      hours: Array.from({ length: 24 }, (_, hour) => ({ hour, importKwh: null, exportKwh: null })) });
  }
  const dayProfiles = [...representatives.values()].sort((left, right) => left.period.localeCompare(right.period)
    || (left.dayType === 'workday' ? -1 : 1));
  if (input.referenceProfile && referenceProjection) {
    return {
      annualConsumptionKwh: annualKwh,
      source: `Roczne zużycie · profil referencyjny ${input.referenceProfile.profile.name}`,
      intervals,
      dayProfiles,
      referenceProfile: {
        key: input.referenceProfile.profile.key,
        name: input.referenceProfile.profile.name,
        contentHash: input.referenceProfile.contentHash,
        method: referenceProjection.method,
        projectionVersion: 1,
        notes: referenceProjection.notes,
      },
    };
  }
  return { annualConsumptionKwh: annualKwh, source: 'Roczne zużycie · profil godzinowy RE', intervals, dayProfiles };
}
