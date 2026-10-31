import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOfferWorkspaceDayProfiles, type OfferWorkspaceDayProfile } from './offer-workspace-chart-data';
import type { OfferMeasurementInterval } from './offer-measurements';

type ChartInterval = Pick<OfferMeasurementInterval, 'localStart' | 'startUtc' | 'endUtc' | 'import' | 'export'>;

function measured(valueKwh: number) {
  return { valueKwh, source: 'measured' as const, fileIds: ['source-file-id-must-not-leak'] };
}

function completeDay(date: string, options: {
  minutesPerInterval?: 15 | 60;
  importValue?: number | null;
  exportValue?: number | null;
  source?: 'measured' | 'estimated';
  missingImportAt?: number;
  missingExportAt?: number;
} = {}): ChartInterval[] {
  const minutes = options.minutesPerInterval ?? 15;
  const intervalMs = minutes * 60_000;
  const base = Date.parse(`${date}T00:00:00+02:00`);
  const result: ChartInterval[] = [];
  let index = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += minutes) {
      const start = base + index * intervalMs;
      const localStart = `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+02:00`;
      const reading = (value: number | null | undefined, missingAt?: number) => value == null || index === missingAt
        ? null
        : { valueKwh: value, source: options.source ?? 'measured', fileIds: ['source-file-id-must-not-leak'] };
      result.push({
        localStart,
        startUtc: new Date(start).toISOString(),
        endUtc: new Date(start + intervalMs).toISOString(),
        import: reading(options.importValue ?? 0.25, options.missingImportAt),
        export: reading(options.exportValue ?? null, options.missingExportAt),
      });
      index += 1;
    }
  }
  return result;
}

function dstDay(date: string, hours: string[]) {
  const base = Date.parse(`${date}T00:00:00+02:00`);
  return hours.map((hour, index) => {
    const start = base + index * 60 * 60_000;
    return {
      localStart: `${date}T${hour}:00:00+02:00`,
      startUtc: new Date(start).toISOString(),
      endUtc: new Date(start + 60 * 60_000).toISOString(),
      import: measured(1),
      export: null,
    };
  });
}

test('agreguje rzeczywiste interwały 15-minutowe do 24 godzin i zachowuje brak eksportu jako null', () => {
  const profiles = buildOfferWorkspaceDayProfiles(completeDay('2026-06-01'));
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].hours.length, 24);
  assert.deepEqual(profiles[0].hours.slice(0, 2), [
    { hour: 0, importKwh: 1, exportKwh: null },
    { hour: 1, importKwh: 1, exportKwh: null },
  ]);
  assert.equal(JSON.stringify(profiles).includes('source-file-id-must-not-leak'), false);
});

test('wybiera pierwszy kompletny dzień roboczy i wolny, uwzględniając polskie święto', () => {
  const profiles = buildOfferWorkspaceDayProfiles([
    ...completeDay('2026-05-01'),
    ...completeDay('2026-05-02'),
    ...completeDay('2026-05-04'),
    ...completeDay('2026-05-05'),
  ]);
  assert.deepEqual(profiles.map(({ date, dayType }) => ({ date, dayType })), [
    { date: '2026-05-01', dayType: 'free' },
    { date: '2026-05-04', dayType: 'workday' },
  ]);
});

test('pomija niepełny lub szacowany dzień i wybiera pierwszy późniejszy dzień kompletny', () => {
  const incomplete = completeDay('2026-06-01', { missingImportAt: 12 });
  const estimated = completeDay('2026-06-02', { source: 'estimated' });
  const profiles = buildOfferWorkspaceDayProfiles([
    ...incomplete,
    ...estimated,
    ...completeDay('2026-06-03'),
  ]);
  assert.equal(profiles.find(({ dayType }) => dayType === 'workday')?.date, '2026-06-03');
});

test('pomija dni zmiany czasu z 23 lub 25 lokalnymi godzinami', () => {
  const springHours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')).filter((hour) => hour !== '02');
  const autumnHours = [
    ...Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')).slice(0, 3),
    '02',
    ...Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0')).slice(3),
  ];
  const profiles = buildOfferWorkspaceDayProfiles([
    ...dstDay('2026-03-29', springHours),
    ...dstDay('2026-10-25', autumnHours),
  ]);
  assert.deepEqual(profiles, [] satisfies OfferWorkspaceDayProfile[]);
});

test('pomija lukę wewnątrz doby zamiast tworzyć częściowy profil', () => {
  const intervals = completeDay('2026-06-01').filter((_, index) => index !== 12);
  assert.deepEqual(buildOfferWorkspaceDayProfiles(intervals), []);

  const duplicateQuarter = completeDay('2026-06-01');
  duplicateQuarter[3] = { ...duplicateQuarter[3], localStart: duplicateQuarter[2].localStart };
  assert.deepEqual(buildOfferWorkspaceDayProfiles(duplicateQuarter), []);
});
