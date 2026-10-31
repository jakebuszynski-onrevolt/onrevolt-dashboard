import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { buildOfferMeasurementSeries as buildSeries, type BuildOfferMeasurementSeriesOptions, type OfferMeasurementFileInput } from './offer-measurements';
import { closedMeasurementPeriodKeys } from './energy-measurement-document';

const ppeNumber = '590310600030743962';

type TestBuildOptions = Omit<BuildOfferMeasurementSeriesOptions, 'periodKeys'> & {
  now?: Date;
  periodKeys?: readonly string[];
};

function buildOfferMeasurementSeries(files: OfferMeasurementFileInput[], options: TestBuildOptions) {
  const { now, ...buildOptions } = options;
  return buildSeries(files, {
    ...buildOptions,
    periodKeys: options.periodKeys || Array.from(closedMeasurementPeriodKeys(12, now ?? new Date())).sort(),
  });
}

test('zakres zamkniętych miesięcy zmienia się o północy w Warszawie, nie UTC', () => {
  assert.equal(Array.from(closedMeasurementPeriodKeys(1, new Date('2026-09-30T22:00:00Z')))[0], '2026-09');
  assert.equal(Array.from(closedMeasurementPeriodKeys(1, new Date('2026-09-30T21:59:59Z')))[0], '2026-08');
});

function warsawParts(epoch: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(epoch));
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function localMonthStartUtc(year: number, month: number) {
  const offsetMinutes = month >= 4 && month <= 10 ? 120 : 60;
  return Date.UTC(year, month - 1, 1) - offsetMinutes * 60_000;
}

function reportBytes(options: {
  kind?: 'ACTIVE_IMPORT' | 'ACTIVE_EXPORT';
  year: number;
  month: number;
  value?: number;
  status?: (index: number) => string;
  intervalMinutes?: number;
  omitIndex?: number;
  ppe?: string;
  zonedSwitch?: boolean;
  eneaAutumnLabels?: boolean;
  autumnSuffix?: string;
}) {
  const kind = options.kind || 'ACTIVE_IMPORT';
  const label = kind === 'ACTIVE_IMPORT' ? 'pobrana' : 'oddana';
  const prefix = kind === 'ACTIVE_IMPORT' ? '1' : '2';
  const days = new Date(Date.UTC(options.year, options.month, 0)).getUTCDate();
  const period = `${options.year}-${String(options.month).padStart(2, '0')}`;
  const rows: unknown[][] = [
    ['Raport zużycia'],
    [options.ppe || ppeNumber],
    [`Energia czynna ${label} ${period}-01 - ${period}-${days} w rozbiciu na strefy`],
    ['Jednostka: kWh'],
    [],
  ];
  rows.push(options.zonedSwitch
    ? ['Dzień', ...[0, 1, 2, 3].map((zone) => `Energia czynna ${label} (${prefix}.8.${zone}) po bilansowaniu`), 'Status']
    : ['Dzień', `Energia czynna ${label} po bilansowaniu`, 'Status']);

  const step = (options.intervalMinutes || 60) * 60_000;
  const monthStart = localMonthStartUtc(options.year, options.month);
  const nextMonthStart = localMonthStartUtc(options.year + (options.month === 12 ? 1 : 0), options.month === 12 ? 1 : options.month + 1);
  const totals = [0, 0, 0, 0];
  let total = 0;
  let index = 0;
  for (let end = monthStart + step; end <= nextMonthStart; end += step, index += 1) {
    if (index === options.omitIndex) continue;
    const parts = warsawParts(end);
    let timestamp = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
    if (options.eneaAutumnLabels) {
      const startParts = warsawParts(end - step);
      if (startParts.hour === '02' && startParts.month === '10' && Number(startParts.day) >= 25
        && new Date(end - step).getUTCDay() === 0) {
        timestamp = `${startParts.year}-${startParts.month}-${startParts.day} 03:00:00`;
        if (parts.hour === '03') timestamp += options.autumnSuffix ?? ' czasu zimowego';
      }
    }
    const value = options.value ?? 1;
    const status = options.status?.(index) ?? 'Dane rzeczywiste';
    if (options.zonedSwitch) {
      const localDay = Number(parts.day);
      const column = localDay <= 10 ? 0 : 1 + ((index - 240) % 3);
      const values: Array<string | number> = ['', '', '', ''];
      values[column] = column === 0 ? value : 0.1 * column;
      totals[column] += Number(values[column]);
      rows.push([timestamp, ...values, status]);
      total += Number(values[column]);
    } else {
      rows.push([timestamp, value, status]);
      total += value;
    }
  }
  rows.push(options.zonedSwitch ? ['Suma', ...totals] : ['Suma', total]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Raport ENEA');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function file(id: string, year: number, month: number, kind: 'ACTIVE_IMPORT' | 'ACTIVE_EXPORT', bytes: Buffer, projectId = 'project-1'): OfferMeasurementFileInput {
  return { id, expectedPeriod: `${year}-${String(month).padStart(2, '0')}`, expectedKind: kind, bytes, projectId };
}

test('składa zwykły miesiąc po UTC i zachowuje źródło rzeczywiste/szacowane', () => {
  const series = buildOfferMeasurementSeries([
    file('import-jan', 2026, 1, 'ACTIVE_IMPORT', reportBytes({ year: 2026, month: 1 })),
    file('export-jan', 2026, 1, 'ACTIVE_EXPORT', reportBytes({ kind: 'ACTIVE_EXPORT', year: 2026, month: 1, value: 0.25, status: () => 'Dane szacowane' })),
  ], { ppeNumber, projectId: 'project-1', now: new Date('2026-03-15T12:00:00Z') });

  assert.equal(series.intervals.length, 744);
  assert.equal(series.intervals[0].startUtc, '2025-12-31T23:00:00.000Z');
  assert.equal(series.intervals[0].endUtc, '2026-01-01T00:00:00.000Z');
  assert.equal(series.intervals[0].localEnd, '2026-01-01T01:00:00+01:00');
  assert.deepEqual(series.intervals[0].import, { valueKwh: 1, source: 'measured', fileIds: ['import-jan'] });
  assert.deepEqual(series.intervals[0].export, { valueKwh: 0.25, source: 'estimated', fileIds: ['export-jan'] });
  assert.equal(series.periods.find(({ period }) => period === '2026-01')?.missingDirections.length, 0);
  assert.equal(series.files.length, 2);
});

test('obsługuje rzeczywiste etykiety ENEA: dwa razy 03:00, drugi z dopiskiem czasu zimowego', () => {
  const series = buildOfferMeasurementSeries([
    file('import-oct', 2025, 10, 'ACTIVE_IMPORT', reportBytes({ year: 2025, month: 10, eneaAutumnLabels: true })),
  ], { ppeNumber, now: new Date('2025-11-15T12:00:00Z') });
  assert.equal(series.intervals.length, 745);
  const repeated = series.intervals.filter((row) => row.localStart.startsWith('2025-10-26T02:'));
  assert.equal(repeated.length, 2);
  assert.equal(repeated[0].startUtc, '2025-10-26T00:00:00.000Z');
  assert.equal(repeated[1].startUtc, '2025-10-26T01:00:00.000Z');
  assert.equal(series.intervals.reduce((sum, row) => sum + row.import!.valueKwh, 0), 745);
});

test('odrzuca sprzeczny lub nieznany dopisek czasu zamiast ignorować go przy powtórzonej godzinie', () => {
  for (const autumnSuffix of [' czasu letniego', ' nieznana strefa', 'Z']) {
    const bytes = reportBytes({ year: 2025, month: 10, eneaAutumnLabels: true, autumnSuffix });
    assert.throws(() => buildOfferMeasurementSeries([
      file('import-oct', 2025, 10, 'ACTIVE_IMPORT', bytes),
    ], { ppeNumber, now: new Date('2025-11-15T12:00:00Z') }), /oznaczenie czasu/);
  }
});

test('waliduje pliki wyłącznie względem jawnego okresu analizy', () => {
  const periodKeys = ['2025-12', '2026-01'];
  const series = buildOfferMeasurementSeries([
    file('import-jan', 2026, 1, 'ACTIVE_IMPORT', reportBytes({ year: 2026, month: 1 })),
  ], { ppeNumber, periodKeys });
  assert.deepEqual(series.periods.map(({ period }) => period), periodKeys);
  assert.throws(() => buildOfferMeasurementSeries([
    file('import-feb', 2026, 2, 'ACTIVE_IMPORT', reportBytes({ year: 2026, month: 2 })),
  ], { ppeNumber, periodKeys }), /wybranego okresu analizy/);
  assert.throws(() => buildOfferMeasurementSeries([], { ppeNumber, periodKeys: ['2026-13'] }), /lista miesięcy okresu analizy/);
});

test('mapuje marcową zmianę czasu na rzeczywiste interwały UTC bez brakującej godziny', () => {
  const series = buildOfferMeasurementSeries([
    file('import-mar', 2026, 3, 'ACTIVE_IMPORT', reportBytes({ year: 2026, month: 3 })),
    file('export-mar', 2026, 3, 'ACTIVE_EXPORT', reportBytes({ kind: 'ACTIVE_EXPORT', year: 2026, month: 3 })),
  ], { ppeNumber, now: new Date('2026-04-10T12:00:00Z') });
  const jump = series.intervals.find(({ localEnd }) => localEnd === '2026-03-29T03:00:00+02:00');

  assert.equal(series.intervals.length, 743);
  assert.equal(jump?.localStart, '2026-03-29T01:00:00+01:00');
  assert.equal(Date.parse(jump!.endUtc) - Date.parse(jump!.startUtc), 60 * 60_000);
  assert.equal(jump?.import?.valueKwh, 1);
  assert.equal(jump?.export?.valueKwh, 1);
  assert.equal(series.intervals.some(({ localEnd }) => localEnd.startsWith('2026-03-29T02:')), false);
});

test('zachowuje oba październikowe wystąpienia 02:00 i ich kolejność UTC', () => {
  const series = buildOfferMeasurementSeries([
    file('import-oct', 2025, 10, 'ACTIVE_IMPORT', reportBytes({ year: 2025, month: 10 })),
    file('export-oct', 2025, 10, 'ACTIVE_EXPORT', reportBytes({ kind: 'ACTIVE_EXPORT', year: 2025, month: 10 })),
  ], { ppeNumber, now: new Date('2025-11-15T12:00:00Z') });
  const repeated = series.intervals.filter(({ localEnd }) => localEnd.startsWith('2025-10-26T02:'));

  assert.equal(series.intervals.length, 745);
  assert.equal(repeated.length, 2);
  assert.deepEqual(repeated.map(({ occurrence, endUtc }) => [occurrence, endUtc]), [
    [1, '2025-10-26T00:00:00.000Z'],
    [2, '2025-10-26T01:00:00.000Z'],
  ]);
  assert.ok(repeated[0].localEnd.endsWith('+02:00'));
  assert.ok(repeated[1].localEnd.endsWith('+01:00'));
  assert.ok(repeated.every(({ import: imported, export: exported }) => imported && exported));
});

test('raportuje brakujące miesiące i kierunki bez dorabiania zużycia budynku przy istniejącym PV', () => {
  const series = buildOfferMeasurementSeries([
    file('jan-only-import', 2026, 1, 'ACTIVE_IMPORT', reportBytes({ year: 2026, month: 1 })),
  ], { ppeNumber, hasExistingPv: true, now: new Date('2026-03-15T12:00:00Z') });
  const january = series.periods.find(({ period }) => period === '2026-01');

  assert.deepEqual(january?.missingDirections, ['ACTIVE_EXPORT']);
  assert.equal(series.missingDirections.some(({ period, kind }) => period === '2026-01' && kind === 'ACTIVE_EXPORT'), true);
  assert.equal(series.missingMonths.length, 11);
  assert.equal(series.hasExistingPv, true);
  assert.equal('buildingConsumptionKwh' in series, false);
  assert.equal(series.intervals.every(({ import: imported, export: exported }) => imported && !exported), true);
});

test('odrzuca niepełny miesiąc i nie interpretuje danych 15-minutowych jako godzinowych', () => {
  const partial = file('partial', 2026, 1, 'ACTIVE_IMPORT', reportBytes({ year: 2026, month: 1, omitIndex: 20 }));
  assert.throws(() => buildOfferMeasurementSeries([partial], {
    ppeNumber, now: new Date('2026-03-15T12:00:00Z'),
  }), /pełnego miesiąca pomiarów godzinowych/);

  const quarterHour = file('quarters', 2026, 1, 'ACTIVE_IMPORT', reportBytes({ year: 2026, month: 1, intervalMinutes: 15, value: 0.25 }));
  assert.throws(() => buildOfferMeasurementSeries([quarterHour], {
    ppeNumber, now: new Date('2026-03-15T12:00:00Z'),
  }), /danych godzinowych \(agregacja 60 min\)/);
});

test('odrzuca status błędu, niezgodny PPE, projektu oraz metadane rodzaju lub okresu', () => {
  const make = (id: string, options: { status?: (index: number) => string; ppe?: string } = {}) => file(id, 2026, 1, 'ACTIVE_IMPORT', reportBytes({ year: 2026, month: 1, ...options }));
  const build = (input: OfferMeasurementFileInput[], projectId = 'project-1') => buildOfferMeasurementSeries(input, {
    ppeNumber, projectId, now: new Date('2026-03-15T12:00:00Z'),
  });

  assert.throws(() => build([make('bad-status', { status: (index) => index === 0 ? 'Brak danych' : 'Dane rzeczywiste' })]), /nieprawidłowym statusem/);
  assert.throws(() => build([make('wrong-ppe', { ppe: '590310600030743961' })]), /nie zgadza się z numerem PPE/);
  assert.throws(() => build([file('wrong-project', 2026, 1, 'ACTIVE_IMPORT', reportBytes({ year: 2026, month: 1 }), 'project-2')]), /nie należy do wskazanego projektu/);
  assert.throws(() => build([{ ...make('wrong-kind'), expectedKind: 'ACTIVE_EXPORT' }]), /Metadane pliku .* nie zgadzają się/);
  assert.throws(() => build([{ ...make('wrong-period'), expectedPeriod: '2025-12' }]), /Metadane pliku .* nie zgadzają się/);
});

test('nie sumuje duplikatów, zachowuje źródła identycznych rekordów i odrzuca sprzeczne wartości', () => {
  const first = file('import-a', 2026, 1, 'ACTIVE_IMPORT', reportBytes({ year: 2026, month: 1 }));
  const same = file('import-b', 2026, 1, 'ACTIVE_IMPORT', reportBytes({ year: 2026, month: 1 }));
  const series = buildOfferMeasurementSeries([first, same], { ppeNumber, now: new Date('2026-03-15T12:00:00Z') });
  assert.equal(series.intervals.length, 744);
  assert.equal(series.intervals[0].import?.valueKwh, 1);
  assert.deepEqual(series.intervals[0].import?.fileIds, ['import-a', 'import-b']);

  const conflicting = file('import-c', 2026, 1, 'ACTIVE_IMPORT', reportBytes({ year: 2026, month: 1, value: 2 }));
  assert.throws(() => buildOfferMeasurementSeries([first, conflicting], {
    ppeNumber, now: new Date('2026-03-15T12:00:00Z'),
  }), /Sprzeczne duplikaty pomiaru .* wartości nie są sumowane/);
});

test('zachowuje surowe wartości przy zmianie rejestru OBIS w miesiącu', () => {
  const series = buildOfferMeasurementSeries([
    file('obis-switch', 2026, 1, 'ACTIVE_IMPORT', reportBytes({ year: 2026, month: 1, zonedSwitch: true })),
  ], { ppeNumber, now: new Date('2026-03-15T12:00:00Z') });
  assert.equal(series.files[0].id, 'obis-switch');
  assert.equal(series.files[0].rowsCount, 744);
  assert.equal(series.files[0].totalKwh, Math.round(series.intervals.reduce((sum, interval) => sum + (interval.import?.valueKwh || 0), 0) * 1000) / 1000);
  assert.equal(series.intervals[0].import?.valueKwh, 1);
  assert.equal(series.intervals[240].import?.valueKwh, 0.1);
  assert.equal(series.intervals[240].import?.source, 'measured');
});
