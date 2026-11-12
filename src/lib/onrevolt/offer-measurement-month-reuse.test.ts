import assert from 'node:assert/strict';
import test from 'node:test';
import type { EnergyMeasurementInterval } from './energy-measurement-document';
import { projectMeasurementMonth, selectOfferMeasurementFilesForPeriod } from './offer-measurement-month-reuse';

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsAt(epoch: number): Parts {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(epoch)).map(({ type, value }) => [type, value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute, second: +parts.second };
}

function wallEpoch(parts: Parts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function monthStart(year: number, month: number): number {
  const wall = wallEpoch({ year, month, day: 1, hour: 0, minute: 0, second: 0 });
  let candidate = wall;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const adjustment = wall - wallEpoch(partsAt(candidate));
    if (adjustment === 0) return candidate;
    candidate += adjustment;
  }
  throw new Error('Nie można utworzyć miesiąca testowego');
}

function localString(epoch: number): string {
  const parts = partsAt(epoch);
  const offset = Math.round((wallEpoch(parts) - epoch) / 60_000);
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    + `T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`
    + `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function makeMonth(year: number, month: number, valueFor: (parts: Parts) => number): EnergyMeasurementInterval[] {
  const until = monthStart(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);
  const occurrences = new Map<number, number>();
  const intervals: EnergyMeasurementInterval[] = [];
  for (let start = monthStart(year, month); start < until; start += 60 * 60_000) {
    const end = start + 60 * 60_000;
    const endParts = partsAt(end);
    const endWall = wallEpoch(endParts);
    const occurrence = (occurrences.get(endWall) || 0) + 1;
    occurrences.set(endWall, occurrence);
    intervals.push({
      localStart: localString(start), localEnd: localString(end),
      startUtc: new Date(start).toISOString(), endUtc: new Date(end).toISOString(),
      valueKwh: valueFor(partsAt(start)), source: 'measured', occurrence,
    });
  }
  return intervals;
}

function patternedMonth(year: number, month: number) {
  return makeMonth(year, month, ({ year: localYear, month: localMonth, day, hour }) => {
    const weekday = new Date(Date.UTC(localYear, localMonth - 1, day)).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    return (hour + 1) * (weekend ? 1.7 : 0.8) + day / 100;
  });
}

function total(intervals: readonly EnergyMeasurementInterval[]) {
  return intervals.reduce((sum, interval) => sum + interval.valueKwh, 0);
}

test('selects all exact-year files, independently by direction, despite other available years', () => {
  const files = [
    { id: 'old-import', periodYear: 2025, periodMonth: 3, kind: 'ACTIVE_IMPORT' },
    { id: 'exact-import-corrupt', periodYear: 2026, periodMonth: 3, kind: 'ACTIVE_IMPORT' },
    { id: 'exact-import-duplicate', periodYear: 2026, periodMonth: 3, kind: 'ACTIVE_IMPORT' },
    { id: 'export-earlier-tie', periodYear: 2024, periodMonth: 3, kind: 'ACTIVE_EXPORT' },
    { id: 'export-later-tie', periodYear: 2028, periodMonth: 3, kind: 'ACTIVE_EXPORT' },
    { id: 'other-kind', periodYear: 2026, periodMonth: 3, kind: 'REACTIVE_IMPORT' },
  ];
  const selected = selectOfferMeasurementFilesForPeriod(files, ['2026-03']);
  assert.deepEqual(selected.map(({ id, targetPeriod }) => [id, targetPeriod]), [
    ['exact-import-corrupt', '2026-03'],
    ['exact-import-duplicate', '2026-03'],
    ['export-earlier-tie', '2026-03'],
  ]);
});

test('chooses the nearest available year and keeps all duplicates from that chosen year', () => {
  const files = [
    { id: 'far', periodYear: 2020, periodMonth: 4, kind: 'ACTIVE_IMPORT' },
    { id: 'near-a', periodYear: 2025, periodMonth: 4, kind: 'ACTIVE_IMPORT' },
    { id: 'near-b', periodYear: 2025, periodMonth: 4, kind: 'ACTIVE_IMPORT' },
    { id: 'tie-later', periodYear: 2027, periodMonth: 5, kind: 'ACTIVE_EXPORT' },
    { id: 'tie-earlier', periodYear: 2023, periodMonth: 5, kind: 'ACTIVE_EXPORT' },
  ];
  const selected = selectOfferMeasurementFilesForPeriod(files, ['2026-04', '2025-05']);
  assert.deepEqual(selected.map(({ id, targetPeriod }) => [id, targetPeriod]), [
    ['near-a', '2026-04'], ['near-b', '2026-04'], ['tie-earlier', '2025-05'],
  ]);
});

test('project isolation remains caller-owned and selecting scoped input preserves it', () => {
  const files = [
    { id: 'project-a', projectId: 'a', periodYear: 2025, periodMonth: 6, kind: 'ACTIVE_IMPORT' },
    { id: 'project-b', projectId: 'b', periodYear: 2026, periodMonth: 6, kind: 'ACTIVE_IMPORT' },
  ];
  const scopedInput = files.filter((file) => file.projectId === 'a');
  const selected = selectOfferMeasurementFilesForPeriod(scopedInput, ['2026-06']);
  assert.deepEqual(selected.map(({ id, projectId }) => [id, projectId]), [['project-a', 'a']]);
});

test('projects a month by Warsaw weekday/weekend hour means and conserves monthly kWh', () => {
  const source = patternedMonth(2025, 1);
  const original = structuredClone(source);
  const projected = projectMeasurementMonth(source, '2026-01');
  assert.equal(projected.length, 744);
  assert.ok(Math.abs(total(projected) - total(source)) < 1e-8);
  assert.ok(projected.every(({ source: origin }) => origin === 'modelled'));
  assert.deepEqual(source, original);

  const groups = new Map<string, Set<number>>();
  for (const interval of projected) {
    const parts = partsAt(Date.parse(interval.startUtc));
    const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    const dayType = weekday === 0 || weekday === 6 ? 'weekend' : 'weekday';
    const key = `${dayType}/${parts.hour}`;
    const values = groups.get(key) || new Set<number>();
    values.add(interval.valueKwh);
    groups.set(key, values);
  }
  assert.equal(groups.size, 48);
  assert.ok([...groups.values()].every((values) => values.size === 1), 'each weekday/weekend hour uses one scaled source mean');
});

test('projects leap February onto the target calendar and normalizes the longer month', () => {
  const source = patternedMonth(2023, 2);
  const projected = projectMeasurementMonth(source, '2024-02');
  assert.equal(source.length, 672);
  assert.equal(projected.length, 696);
  assert.ok(Math.abs(total(projected) - total(source)) < 1e-8);
  assert.equal(projected[0].localStart.slice(0, 10), '2024-02-01');
  assert.equal(projected.at(-1)!.localEnd.slice(0, 10), '2024-03-01');
});

test('preserves the March DST-shortened UTC grid', () => {
  const source = patternedMonth(2025, 3);
  const projected = projectMeasurementMonth(source, '2026-03');
  assert.equal(projected.length, 743);
  assert.equal(projected.filter(({ localStart }) => localStart.startsWith('2026-03-29T02:')).length, 0);
  assert.equal(projected[0].localStart, '2026-03-01T00:00:00+01:00');
  assert.equal(projected.at(-1)!.localEnd, '2026-04-01T00:00:00+02:00');
  assert.ok(Math.abs(total(projected) - total(source)) < 1e-8);
});

test('preserves both October repeated hours and their occurrence numbers', () => {
  const source = patternedMonth(2025, 10);
  const projected = projectMeasurementMonth(source, '2026-10');
  const repeated = projected.filter(({ localStart }) => localStart.startsWith('2026-10-25T02:'));
  assert.equal(projected.length, 745);
  assert.equal(repeated.length, 2);
  assert.deepEqual(repeated.map(({ occurrence }) => occurrence), [2, 1], 'occurrence follows each interval end label as in parsed ENEA data');
  assert.ok(repeated[0].startUtc < repeated[1].startUtc);
  assert.ok(Math.abs(total(projected) - total(source)) < 1e-8);
});

test('same month and year returns unchanged intervals without rewriting their provenance', () => {
  const source = patternedMonth(2025, 10);
  const result = projectMeasurementMonth(source, '2025-10');
  assert.deepEqual(result, source);
  assert.equal(result[0], source[0]);
});

test('zero-sum months remain zero without NaN and all projected intervals are modelled', () => {
  const source = makeMonth(2025, 2, () => 0);
  const projected = projectMeasurementMonth(source, '2026-02');
  assert.ok(projected.every(({ valueKwh, source: origin }) => valueKwh === 0 && origin === 'modelled'));
  assert.equal(total(projected), 0);
});

test('rejects incomplete months, missing groups, negative values, and non-finite values', () => {
  const source = patternedMonth(2025, 1);
  assert.throws(() => projectMeasurementMonth(source.slice(1), '2026-01'), /pełnej siatki/u);
  assert.throws(() => projectMeasurementMonth(source, '2026-02'), /ten sam miesiąc/u);
  const negative = source.map((interval, index) => index === 0 ? { ...interval, valueKwh: -1 } : interval);
  assert.throws(() => projectMeasurementMonth(negative, '2026-01'), /nieujemnych/u);
  const nonFinite = source.map((interval, index) => index === 0 ? { ...interval, valueKwh: Number.NaN } : interval);
  assert.throws(() => projectMeasurementMonth(nonFinite, '2026-01'), /nieujemnych/u);
});
