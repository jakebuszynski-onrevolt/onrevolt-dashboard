import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { closedMeasurementPeriodKeys, inspectEnergyMeasurementWorkbook } from './energy-measurement-document';

function workbookBytes(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Raport zużycia 1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function hourlyReport(kind: 'pobrana' | 'oddana', year: number, month: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows: unknown[][] = [
    ['Raport zużycia'],
    ['590310600030743962'],
    [`Energia czynna ${kind} ${year}-${String(month).padStart(2, '0')}-01 - ${year}-${String(month).padStart(2, '0')}-${lastDay} w rozbiciu na strefy`],
    ['Jednostka: kWh'],
    [],
    ['Dzień', `Energia czynna ${kind} po bilansowaniu`, 'Status'],
  ];
  const firstEnd = Date.UTC(year, month - 1, 1, 1);
  const numberOfHours = lastDay * 24;
  for (let index = 0; index < numberOfHours; index += 1) {
    const date = new Date(firstEnd + index * 60 * 60_000);
    rows.push([date.toISOString().replace('T', ' ').slice(0, 19), 1, 'Dane rzeczywiste']);
  }
  rows.push(['Suma', numberOfHours]);
  return rows;
}

test('rozpoznaje pełny miesięczny raport godzinowy ENEA', () => {
  const info = inspectEnergyMeasurementWorkbook(workbookBytes(hourlyReport('pobrana', 2026, 1)));
  assert.equal(info.kind, 'ACTIVE_IMPORT');
  assert.equal(info.ppeNumber, '590310600030743962');
  assert.equal(info.periodYear, 2026);
  assert.equal(info.periodMonth, 1);
  assert.equal(info.aggregation, '60 min');
  assert.equal(info.rowsCount, 744);
  assert.equal(info.totalKwh, 744);
});

test('rozpoznaje godzinowy raport energii oddanej', () => {
  const info = inspectEnergyMeasurementWorkbook(workbookBytes(hourlyReport('oddana', 2026, 2)));
  assert.equal(info.kind, 'ACTIVE_EXPORT');
  assert.equal(info.periodMonth, 2);
});

test('odrzuca raport tygodniowy', () => {
  assert.throws(() => inspectEnergyMeasurementWorkbook(workbookBytes([
    ['Raport zużycia'],
    ['590310600030743962'],
    ['Energia czynna pobrana 2026-01-01 - 2026-12-31 w rozbiciu na strefy'],
    ['Tydzień', 'Energia czynna pobrana po bilansowaniu'],
    ['1 tydzień', 10],
  ])), /miesięcznego raportu godzinowego/i);
});

test('odrzuca niepełny miesiąc danych godzinowych', () => {
  const rows = hourlyReport('pobrana', 2026, 1);
  rows.splice(100, 1);
  assert.throws(
    () => inspectEnergyMeasurementWorkbook(workbookBytes(rows)),
    /pełnego miesiąca pomiarów godzinowych/i,
  );
});

test('wyznacza zakres ostatnich 12 zamkniętych miesięcy', () => {
  const keys = closedMeasurementPeriodKeys(12, new Date('2026-09-09T10:00:00Z'));
  assert.equal(keys.has('2025-09'), true);
  assert.equal(keys.has('2026-08'), true);
  assert.equal(keys.has('2025-08'), false);
  assert.equal(keys.has('2026-09'), false);
});
