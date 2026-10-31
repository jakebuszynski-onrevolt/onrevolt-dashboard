import { createHash } from 'node:crypto';

function canonical(value: unknown): unknown {
  if (value instanceof Map) return [...value].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, item]) => [key, canonical(item)]);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function offerCalculationDependencyHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });

function monthStartUtc(period: string): number {
  const approximate = Date.parse(`${period}-01T00:00:00Z`);
  // Resolve the calendar boundary through the time zone, including historical DST.
  for (let offset = -14; offset <= 14; offset++) {
    const timestamp = approximate + offset * 3600000;
    if (local.format(timestamp) === `${period}-01 00`) return timestamp;
  }
  throw new Error('Nie można ustalić początku miesiąca w Europe/Warsaw.');
}

export function offerCalculationPeriodHours(months: Array<{ period: string }>): string[] | null {
  if (months.length !== 12) return null;
  const periods = months.map(month => month.period).sort();
  if (periods.some(period => !/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))) return null;
  const monthIndex = (period: string) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5)) - 1;
  if (periods.some((period, index) => monthIndex(period) !== monthIndex(periods[0]) + index)) return null;
  const nextIndex = monthIndex(periods[11]) + 1;
  const untilPeriod = `${Math.floor(nextIndex / 12)}-${String(nextIndex % 12 + 1).padStart(2, '0')}`;
  const from = monthStartUtc(periods[0]), until = monthStartUtc(untilPeriod);
  return Array.from({ length: (until - from) / 3600000 }, (_, index) => new Date(from + index * 3600000).toISOString());
}
