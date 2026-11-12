import type { EnergyMeasurementInterval } from './energy-measurement-document';

type MeasurementFilePeriod = { periodYear: number; periodMonth: number; kind: string };

const warsawFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

type WarsawParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function warsawParts(epoch: number): WarsawParts {
  const parts = Object.fromEntries(warsawFormatter.formatToParts(new Date(epoch)).map(({ type, value }) => [type, value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function utcWallEpoch({ year, month, day, hour, minute, second }: WarsawParts): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function formatWarsawInstant(epoch: number): string {
  const parts = warsawParts(epoch);
  const offsetMinutes = Math.round((utcWallEpoch(parts) - epoch) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absoluteOffset = Math.abs(offsetMinutes);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    + `T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`
    + `${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, '0')}:${String(absoluteOffset % 60).padStart(2, '0')}`;
}

function warsawMonthStartUtc(year: number, month: number): number {
  const wallMidnight = utcWallEpoch({ year, month, day: 1, hour: 0, minute: 0, second: 0 });
  let candidate = wallMidnight;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const adjustment = wallMidnight - utcWallEpoch(warsawParts(candidate));
    if (adjustment === 0) return candidate;
    candidate += adjustment;
  }
  throw new Error(`Nie można wyznaczyć północy Europe/Warsaw dla ${year}-${String(month).padStart(2, '0')}.`);
}

function monthGrid(year: number, month: number): EnergyMeasurementInterval[] {
  const start = warsawMonthStartUtc(year, month);
  const until = warsawMonthStartUtc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);
  const occurrences = new Map<number, number>();
  const intervals: EnergyMeasurementInterval[] = [];

  for (let startUtc = start; startUtc < until; startUtc += 60 * 60_000) {
    const endUtc = startUtc + 60 * 60_000;
    const endParts = warsawParts(endUtc);
    const endWall = utcWallEpoch(endParts);
    const occurrence = (occurrences.get(endWall) || 0) + 1;
    occurrences.set(endWall, occurrence);
    intervals.push({
      localStart: formatWarsawInstant(startUtc),
      localEnd: formatWarsawInstant(endUtc),
      startUtc: new Date(startUtc).toISOString(),
      endUtc: new Date(endUtc).toISOString(),
      valueKwh: 0,
      source: 'modelled',
      occurrence,
    });
  }
  return intervals;
}

function parsePeriodKey(period: string): { year: number; month: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match || Number(match[1]) < 1) throw new Error(`Nieprawidłowy miesiąc okresu analizy: ${period}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

/**
 * Selects exact-year measurements when available, otherwise the closest calendar year.
 * Project ownership filtering belongs to the caller, before this function is called.
 */
export function selectOfferMeasurementFilesForPeriod<T extends MeasurementFilePeriod>(
  files: readonly T[],
  periodKeys: readonly string[],
): Array<T & { targetPeriod: string }> {
  const targets = periodKeys.map((period) => ({ period, ...parsePeriodKey(period) }));
  if (new Set(periodKeys).size !== periodKeys.length) throw new Error('Lista miesięcy okresu analizy zawiera powtórzenia.');

  const selected: Array<T & { targetPeriod: string }> = [];
  for (const target of targets) {
    for (const kind of ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'] as const) {
      const candidates = files.filter((file) => file.periodMonth === target.month && file.kind === kind);
      if (!candidates.length) continue;

      const availableYears = Array.from(new Set(candidates.map((file) => file.periodYear)));
      const chosenYear = availableYears.includes(target.year)
        ? target.year
        : availableYears.reduce((best, year) => {
          const distance = Math.abs(year - target.year);
          const bestDistance = Math.abs(best - target.year);
          return distance < bestDistance || (distance === bestDistance && year < best) ? year : best;
        });

      for (const file of candidates) {
        if (file.periodYear === chosenYear) selected.push({ ...file, targetPeriod: target.period });
      }
    }
  }
  return selected;
}

function isWeekend(year: number, month: number, day: number): boolean {
  const weekday = new Date(utcWallEpoch({ year, month, day, hour: 0, minute: 0, second: 0 })).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function validateCompleteSourceMonth(intervals: readonly EnergyMeasurementInterval[]) {
  if (!intervals.length) throw new Error('Brak pomiarów źródłowych do modelowania miesiąca.');
  for (const interval of intervals) {
    if (!Number.isFinite(interval.valueKwh) || interval.valueKwh < 0) {
      throw new Error('Model miesiąca wymaga nieujemnych i skończonych wartości kWh.');
    }
  }

  const firstStart = Date.parse(intervals[0].startUtc);
  if (!Number.isFinite(firstStart)) throw new Error('Nieprawidłowy początek miesiąca źródłowego.');
  const firstParts = warsawParts(firstStart);
  const year = firstParts.year;
  const month = firstParts.month;
  const expected = monthGrid(year, month);
  if (expected.length !== intervals.length) throw new Error('Miesiąc źródłowy nie zawiera pełnej siatki pomiarów godzinowych.');

  for (let index = 0; index < expected.length; index += 1) {
    const actual = intervals[index];
    const grid = expected[index];
    if (actual.startUtc !== grid.startUtc || actual.endUtc !== grid.endUtc
      || actual.localStart !== grid.localStart || actual.localEnd !== grid.localEnd
      || actual.occurrence !== grid.occurrence) {
      throw new Error('Miesiąc źródłowy nie zawiera pełnej, chronologicznej siatki pomiarów Europe/Warsaw.');
    }
  }
  return { year, month };
}

/** Reuses a complete Warsaw calendar month as an explicitly modelled, monthly-normalized estimate. */
export function projectMeasurementMonth(
  intervals: readonly EnergyMeasurementInterval[],
  targetPeriod: string,
): EnergyMeasurementInterval[] {
  const target = parsePeriodKey(targetPeriod);
  const source = validateCompleteSourceMonth(intervals);
  if (source.month !== target.month) {
    throw new Error('Modelowany miesiąc musi mieć ten sam miesiąc kalendarzowy co pomiary źródłowe.');
  }
  if (source.year === target.year) return intervals.slice();

  const sourceBuckets = new Map<string, { total: number; count: number }>();
  for (const interval of intervals) {
    const parts = warsawParts(Date.parse(interval.startUtc));
    const key = `${isWeekend(parts.year, parts.month, parts.day) ? 'weekend' : 'weekday'}/${parts.hour}`;
    const bucket = sourceBuckets.get(key) || { total: 0, count: 0 };
    bucket.total += interval.valueKwh;
    bucket.count += 1;
    sourceBuckets.set(key, bucket);
  }

  const raw = monthGrid(target.year, target.month).map((interval) => {
    const parts = warsawParts(Date.parse(interval.startUtc));
    const key = `${isWeekend(parts.year, parts.month, parts.day) ? 'weekend' : 'weekday'}/${parts.hour}`;
    const bucket = sourceBuckets.get(key);
    if (!bucket || bucket.count === 0) {
      throw new Error(`Brak pomiarów źródłowych dla typu dnia i godziny ${key}; nie można uzupełnić miesiąca.`);
    }
    return { ...interval, valueKwh: bucket.total / bucket.count };
  });

  const sourceTotal = intervals.reduce((sum, interval) => sum + interval.valueKwh, 0);
  const projectedTotal = raw.reduce((sum, interval) => sum + interval.valueKwh, 0);
  if (sourceTotal === 0 && projectedTotal === 0) return raw;
  if (projectedTotal <= 0 || !Number.isFinite(projectedTotal)) {
    throw new Error('Nie można znormalizować modelu miesiąca do sumy energii źródłowej.');
  }
  const scale = sourceTotal / projectedTotal;
  return raw.map((interval) => ({ ...interval, valueKwh: interval.valueKwh * scale }));
}
