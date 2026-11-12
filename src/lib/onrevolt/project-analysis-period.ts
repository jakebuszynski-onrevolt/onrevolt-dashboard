export type ProjectAnalysisPeriod = {
  startMonth: string;
  endMonth: string;
  endDate: string;
  periodKeys: string[];
  fromUtc: string;
  untilUtc: string;
};

const MIN_START_ORDINAL = 2000 * 12;
const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;
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

type CivilDateTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function civilDateTimeAt(epoch: number): CivilDateTime {
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

function utcEpoch({ year, month, day, hour, minute, second }: CivilDateTime): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function ordinalFor(year: number, month: number): number {
  return year * 12 + month - 1;
}

function monthAt(ordinal: number): { year: number; month: number; key: string } {
  const year = Math.floor(ordinal / 12);
  const month = ordinal - year * 12 + 1;
  return { year, month, key: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}` };
}

function parseMonth(value: unknown): number {
  if (typeof value !== 'string') throw new Error('Miesiąc początkowy musi mieć format RRRR-MM.');
  const match = monthPattern.exec(value);
  if (!match) throw new Error('Miesiąc początkowy musi mieć format RRRR-MM.');
  const year = Number(match[1]);
  if (year < 1) throw new Error('Rok miesiąca początkowego musi być większy od zera.');
  return ordinalFor(year, Number(match[2]));
}

function warsawMonthAt(date: Date): { year: number; month: number } {
  const epoch = date.getTime();
  if (!Number.isFinite(epoch)) throw new Error('Nieprawidłowa bieżąca data.');
  const parts = civilDateTimeAt(epoch);
  return { year: parts.year, month: parts.month };
}

function warsawMidnightUtc(ordinal: number): string {
  const { year, month } = monthAt(ordinal);
  const target = { year, month, day: 1, hour: 0, minute: 0, second: 0 };
  const targetWallEpoch = utcEpoch(target);
  let candidate = targetWallEpoch;

  for (let attempt = 0; attempt < 5; attempt++) {
    const representedWallEpoch = utcEpoch(civilDateTimeAt(candidate));
    const adjustment = targetWallEpoch - representedWallEpoch;
    if (adjustment === 0) return new Date(candidate).toISOString();
    candidate += adjustment;
  }

  throw new Error(`Nie można wyznaczyć północy Europe/Warsaw dla ${monthAt(ordinal).key}.`);
}

function daysInMonth(year: number, month: number): number {
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(year, month, 0);
  lastDay.setUTCHours(0, 0, 0, 0);
  return lastDay.getUTCDate();
}

/** Persist this default on creation; existing projects retain their saved or legacy period. */
export function defaultNewProjectAnalysisStartMonth(now: Date = new Date()): string {
  const { year, month } = warsawMonthAt(now);
  // Only a complete April–March year can be used with historical hourly data.
  const startMonth = `${year - (month >= 4 ? 1 : 2)}-04`;
  return resolveProjectAnalysisPeriod(startMonth, now).startMonth;
}

export function resolveProjectAnalysisPeriod(
  startMonth?: string | null,
  now: Date = new Date(),
): ProjectAnalysisPeriod {
  const { year: currentYear, month: currentMonth } = warsawMonthAt(now);
  const lastClosedOrdinal = ordinalFor(currentYear, currentMonth) - 1;
  const maximumStartOrdinal = lastClosedOrdinal - 11;
  if (maximumStartOrdinal < MIN_START_ORDINAL) {
    throw new Error('Brak 12 zamkniętych miesięcy w obsługiwanym zakresie od 2000-01.');
  }

  const resolvedStartOrdinal = startMonth == null ? maximumStartOrdinal : parseMonth(startMonth);
  if (resolvedStartOrdinal < MIN_START_ORDINAL) {
    throw new Error('Okres analizy nie może zaczynać się przed 2000-01.');
  }
  if (resolvedStartOrdinal > maximumStartOrdinal) {
    throw new Error(`Okres analizy musi kończyć się nie później niż ${monthAt(lastClosedOrdinal).key}.`);
  }

  const endOrdinal = resolvedStartOrdinal + 11;
  const start = monthAt(resolvedStartOrdinal);
  const end = monthAt(endOrdinal);
  const periodKeys = Array.from({ length: 12 }, (_, index) => monthAt(resolvedStartOrdinal + index).key);

  return {
    startMonth: start.key,
    endMonth: end.key,
    endDate: `${end.key}-${String(daysInMonth(end.year, end.month)).padStart(2, '0')}`,
    periodKeys,
    fromUtc: warsawMidnightUtc(resolvedStartOrdinal),
    untilUtc: warsawMidnightUtc(endOrdinal + 1),
  };
}
