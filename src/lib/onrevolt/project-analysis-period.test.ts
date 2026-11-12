import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultNewProjectAnalysisStartMonth, resolveProjectAnalysisPeriod } from './project-analysis-period';

test('new projects start with the latest complete April–March year', () => {
  for (const [now, expected] of [
    ['2026-11-09T12:00:00Z', '2025-04'],
    ['2027-01-01T12:00:00Z', '2025-04'],
    ['2027-03-31T21:59:59Z', '2025-04'],
    ['2027-03-31T22:00:00Z', '2026-04'],
  ]) {
    const date = new Date(now);
    const start = defaultNewProjectAnalysisStartMonth(date);
    assert.equal(start, expected);
    const period = resolveProjectAnalysisPeriod(start, date);
    assert.equal(period.periodKeys.length, 12);
    assert.equal(period.endMonth, `${Number(expected.slice(0, 4)) + 1}-03`);
    assert.ok(new Date(period.untilUtc).getTime() <= date.getTime());
  }
});

test('persisted April remains selected when the next analysis year closes', () => {
  const start = defaultNewProjectAnalysisStartMonth(new Date('2026-11-09T12:00:00Z'));
  assert.equal(resolveProjectAnalysisPeriod(start, new Date('2028-04-02T12:00:00Z')).startMonth, '2025-04');
});

test('legacy null defaults to the previous 12 fully closed Warsaw months', () => {
  const period = resolveProjectAnalysisPeriod(null, new Date('2026-10-31T23:30:00.000Z'));

  assert.equal(period.startMonth, '2025-11');
  assert.equal(period.endMonth, '2026-10');
  assert.equal(period.endDate, '2026-10-31');
  assert.equal(period.periodKeys.length, 12);
  assert.deepEqual(period.periodKeys, [
    '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
    '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
  ]);
  assert.equal(period.fromUtc, '2025-10-31T23:00:00.000Z');
  assert.equal(period.untilUtc, '2026-10-31T23:00:00.000Z');
});

test('selected month resolves exactly 12 inclusive months and Warsaw UTC boundaries', () => {
  const period = resolveProjectAnalysisPeriod('2025-10', new Date('2026-10-30T12:00:00.000Z'));

  assert.equal(period.startMonth, '2025-10');
  assert.equal(period.endMonth, '2026-09');
  assert.equal(period.endDate, '2026-09-30');
  assert.equal(period.periodKeys.length, 12);
  assert.equal(period.periodKeys[0], '2025-10');
  assert.equal(period.periodKeys[11], '2026-09');
  assert.equal(period.fromUtc, '2025-09-30T22:00:00.000Z');
  assert.equal(period.untilUtc, '2026-09-30T22:00:00.000Z');
});

test('endDate includes leap day when the 12-month period ends in February', () => {
  const period = resolveProjectAnalysisPeriod('2023-03', new Date('2024-03-15T12:00:00.000Z'));

  assert.equal(period.endMonth, '2024-02');
  assert.equal(period.endDate, '2024-02-29');
  assert.equal(period.periodKeys.length, 12);
});

test('strict month format, minimum year and latest closed start are enforced', () => {
  const now = new Date('2026-10-30T12:00:00.000Z');
  assert.throws(() => resolveProjectAnalysisPeriod('2026-10', now), /kończyć się nie później/);
  assert.throws(() => resolveProjectAnalysisPeriod('2025-11', now), /kończyć się nie później/);
  assert.throws(() => resolveProjectAnalysisPeriod('1999-12', now), /przed 2000-01/);
  assert.throws(() => resolveProjectAnalysisPeriod('2026-1', now), /format RRRR-MM/);
  assert.throws(() => resolveProjectAnalysisPeriod('0000-01', now), /większy od zera/);
});

test('month boundary uses Warsaw local month at year rollover', () => {
  const period = resolveProjectAnalysisPeriod('2024-01', new Date('2026-10-30T12:00:00.000Z'));

  assert.equal(period.endMonth, '2024-12');
  assert.equal(period.fromUtc, '2023-12-31T23:00:00.000Z');
  assert.equal(period.untilUtc, '2024-12-31T23:00:00.000Z');
});
