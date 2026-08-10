import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { parseConsumptionWorkbook } from './energy-profile';

test('parser profilu ENEA rozdziela godziny dni roboczych i wolnych', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Dzień', 'Energia czynna pobrana po bilansowaniu'],
    ['2026-07-06 13:00', 2.5],
    ['2026-07-11 13:00', 1.25],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Dane');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  const parsed = parseConsumptionWorkbook(bytes);
  assert.equal(parsed.totalKwh, 3.75);
  assert.equal(parsed.weekdayDates.size, 1);
  assert.equal(parsed.weekendDates.size, 1);
  assert.equal(parsed.weekdaySums[12], 2.5);
  assert.equal(parsed.weekendSums[12], 1.25);
});

