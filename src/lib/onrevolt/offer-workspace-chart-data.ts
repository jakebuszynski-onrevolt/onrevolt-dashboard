import type { OfferMeasurementInterval } from './offer-measurements';

export type OfferWorkspaceDayProfile = {
  period: string;
  dayType: 'workday' | 'free';
  date: string;
  hours: Array<{ hour: number; importKwh: number | null; exportKwh: number | null }>;
};

type ChartInterval = Pick<OfferMeasurementInterval, 'localStart' | 'startUtc' | 'endUtc' | 'import' | 'export'>;
type Direction = 'import' | 'export';

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function dateWithOffset(date: Date, days: number) {
  const value = new Date(date.getTime());
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// Mirrors the module-private Polish holiday rules in energy-scenario.ts.
function isPolishPublicHoliday(date: string) {
  const year = Number(date.slice(0, 4));
  const holidays = new Set([
    `${year}-01-01`, `${year}-01-06`, `${year}-05-01`, `${year}-05-03`, `${year}-08-15`,
    `${year}-11-01`, `${year}-11-11`, `${year}-12-25`, `${year}-12-26`,
  ]);
  if (year >= 2025) holidays.add(`${year}-12-24`);
  const easter = easterSunday(year);
  holidays.add(dateWithOffset(easter, 1));
  holidays.add(dateWithOffset(easter, 60));
  return holidays.has(date);
}

function isValidDateKey(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function dayTypeFor(date: string): OfferWorkspaceDayProfile['dayType'] {
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return weekday === 0 || weekday === 6 || isPolishPublicHoliday(date) ? 'free' : 'workday';
}

function roundKwh(value: number) {
  return Math.round(value * 1000) / 1000;
}

function parseLocalStart(value: string) {
  const match = value.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})(?:[+-]\d{2}:\d{2}|Z)$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (hour > 23 || minute > 59 || second !== 0) return null;
  return { hour, minute };
}

function completeDayProfile(date: string, intervals: ChartInterval[]): OfferWorkspaceDayProfile | null {
  if (intervals.length !== 24 && intervals.length !== 96) return null;
  const minutesPerInterval = intervals.length === 24 ? 60 : 15;
  const intervalMs = minutesPerInterval * 60_000;
  const sorted = intervals.slice().sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  const byHour = Array.from({ length: 24 }, () => [] as ChartInterval[]);
  const localSlots = new Set<number>();
  let previousEnd: number | null = null;

  for (const interval of sorted) {
    const start = Date.parse(interval.startUtc);
    const end = Date.parse(interval.endUtc);
    const local = parseLocalStart(interval.localStart);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== intervalMs || !local
      || interval.localStart.slice(0, 10) !== date
      || local.minute % minutesPerInterval !== 0
      || (previousEnd != null && start !== previousEnd)) return null;
    const localSlot = local.hour * 60 + local.minute;
    if (localSlots.has(localSlot)) return null;
    localSlots.add(localSlot);
    previousEnd = end;
    byHour[local.hour].push(interval);
  }

  const intervalsPerHour = 60 / minutesPerInterval;
  if (byHour.some((hourIntervals) => hourIntervals.length !== intervalsPerHour)) return null;

  const hourlyValues = (direction: Direction): Array<number | null> | null => {
    const readings = sorted.map((interval) => interval[direction]);
    const present = readings.filter((reading) => reading != null);
    if (!present.length) return Array.from({ length: 24 }, () => null);
    if (present.length !== readings.length || present.some((reading) => reading!.source !== 'measured'
      || !Number.isFinite(reading!.valueKwh) || reading!.valueKwh < 0)) return null;
    return byHour.map((hourIntervals) => roundKwh(hourIntervals.reduce((sum, interval) => sum + interval[direction]!.valueKwh, 0)));
  };

  const importKwh = hourlyValues('import');
  const exportKwh = hourlyValues('export');
  if (!importKwh || !exportKwh || (importKwh.every((value) => value == null) && exportKwh.every((value) => value == null))) return null;

  return {
    period: date.slice(0, 7),
    dayType: dayTypeFor(date),
    date,
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, importKwh: importKwh[hour], exportKwh: exportKwh[hour] })),
  };
}

export function buildOfferWorkspaceDayProfiles(intervals: readonly ChartInterval[]): OfferWorkspaceDayProfile[] {
  const days = new Map<string, ChartInterval[]>();
  for (const interval of intervals) {
    const date = interval.localStart.slice(0, 10);
    if (!isValidDateKey(date)) continue;
    const day = days.get(date) || [];
    day.push(interval);
    days.set(date, day);
  }

  const selected = new Map<string, OfferWorkspaceDayProfile>();
  for (const date of Array.from(days.keys()).sort()) {
    const profile = completeDayProfile(date, days.get(date)!);
    if (!profile) continue;
    const key = `${profile.period}/${profile.dayType}`;
    if (!selected.has(key)) selected.set(key, profile);
  }

  return Array.from(selected.values()).sort((a, b) => a.period.localeCompare(b.period) || a.date.localeCompare(b.date));
}
