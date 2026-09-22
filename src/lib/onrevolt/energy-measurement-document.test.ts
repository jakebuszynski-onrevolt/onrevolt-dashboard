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

for (const kind of ['pobrana', 'oddana'] as const) {
  test(`odrzuca lipcowy raport ${kind}: 168 pomiarów i 576 pustych godzin nie tworzy pełnego miesiąca`, () => {
    const rows = hourlyReport(kind, 2026, 7);
    for (let index = 6 + 168; index < rows.length - 1; index += 1) {
      rows[index][1] = null;
      rows[index][2] = null;
    }
    rows[rows.length - 1][1] = 168;
    assert.throws(() => inspectEnergyMeasurementWorkbook(workbookBytes(rows)), (error: Error) => {
      assert.match(error.message, /168\/744 poprawnych pomiarów/);
      assert.match(error.message, /statusem: 576; wartością kWh: 576/);
      assert.match(error.message, /2026-07-08 01:00:00/);
      assert.match(error.message, /Dane rzeczywiste lub Dane szacowane/);
      return true;
    });
  });
}

test('akceptuje rzeczywiste i szacowane pomiary, jawne zera oraz poprawne liczby dziesiętne', () => {
  const rows = hourlyReport('pobrana', 2026, 1);
  const values = [0, '0', ' 1,25 ', '2.5', '1e-3'];
  let total = 0;
  for (let index = 6; index < rows.length - 1; index += 1) {
    rows[index][1] = values[(index - 6) % values.length];
    rows[index][2] = index % 2 ? 'Dane rzeczywiste' : ' Dane szacowane ';
    total += Number(String(rows[index][1]).trim().replace(',', '.'));
  }
  rows.pop();
  const info = inspectEnergyMeasurementWorkbook(workbookBytes(rows));
  assert.equal(info.rowsCount, 744);
  assert.equal(info.totalKwh, Math.round(total * 1000) / 1000);
});

test('odrzuca brak kolumny Status zamiast zakładać rzeczywiste pomiary', () => {
  const rows = hourlyReport('pobrana', 2026, 1).map(row => row.slice(0, 2));
  assert.throws(() => inspectEnergyMeasurementWorkbook(workbookBytes(rows)), /Brak kolumny Status/);
});

for (const status of [null, '', '   ', 'Brak danych', 'Dane zastępcze', 'dane rzeczywiste', 'Dane rzeczywiste dodatkowe', 0]) {
  test(`odrzuca godzinę z nieobsługiwanym statusem ${JSON.stringify(status)} mimo poprawnej wartości`, () => {
    const rows = hourlyReport('pobrana', 2026, 1);
    rows[6][2] = status;
    assert.throws(() => inspectEnergyMeasurementWorkbook(workbookBytes(rows)), (error: Error) => {
      assert.match(error.message, /743\/744 poprawnych pomiarów/);
      assert.match(error.message, /statusem: 1; wartością kWh: 0/);
      assert.match(error.message, /2026-01-01 01:00:00/);
      return true;
    });
  });
}

for (const value of [null, undefined, '', '   ', '-', 'brak', '1 000', '0x10', '0b10', true, false, -1, '-0,1', 'NaN', 'Infinity', '1e309']) {
  test(`odrzuca pustą lub niepoprawną wartość ${String(value)} przy poprawnym statusie, niezależnie od wiersza Suma`, () => {
    const rows = hourlyReport('pobrana', 2026, 1);
    rows[6][1] = value;
    assert.throws(() => inspectEnergyMeasurementWorkbook(workbookBytes(rows)), (error: Error) => {
      assert.match(error.message, /743\/744 poprawnych pomiarów/);
      assert.match(error.message, /statusem: 0; wartością kWh: 1/);
      assert.match(error.message, /niepusta, poprawna i nieujemna wartość kWh/);
      return true;
    });
  });
}

test('wymaga poprawnej wartości w każdej kolumnie energii, a nie tylko w pierwszej', () => {
  const rows = hourlyReport('pobrana', 2026, 1);
  rows[5].splice(2, 0, 'Energia czynna pobrana po bilansowaniu - strefa 2');
  for (let index = 6; index < rows.length - 1; index += 1) rows[index].splice(2, 0, 0);
  rows[6][2] = null;
  assert.throws(() => inspectEnergyMeasurementWorkbook(workbookBytes(rows)), /743\/744 poprawnych pomiarów/);
});

function zonedReport(kind: 'pobrana' | 'oddana' = 'pobrana') {
  const rows = hourlyReport(kind, 2026, 8);
  const prefix = kind === 'pobrana' ? '1' : '2';
  rows[5] = ['Dzień', ...[0, 1, 2, 3].map((zone) => `Energia czynna ${kind} (${prefix}.8.${zone}) po bilansowaniu`), 'Status'];
  const totals = [0, 0, 0, 0];
  for (let index = 6; index < rows.length - 1; index += 1) {
    const hour = index - 6;
    const zone = hour < 240 ? 0 : 1 + ((hour - 240) % 3);
    const value = zone === 0 ? 0 : zone / 10;
    rows[index] = [rows[index][0], ...[0, 1, 2, 3].map((column) => column === zone ? value : ''), 'Dane rzeczywiste'];
    totals[zone] += value;
  }
  rows[rows.length - 1] = ['Suma', ...totals.map((value) => Math.round(value * 1000) / 1000)];
  return rows;
}

for (const kind of ['pobrana', 'oddana'] as const) {
  test(`akceptuje nieaktywne strefy OBIS i zmianę taryfy w miesiącu: energia ${kind}`, () => {
    const rows = zonedReport(kind);
    const info = inspectEnergyMeasurementWorkbook(workbookBytes(rows));
    assert.equal(info.rowsCount, 744);
    assert.equal(info.totalKwh, 100.8);
    assert.equal(info.kind, kind === 'pobrana' ? 'ACTIVE_IMPORT' : 'ACTIVE_EXPORT');
    rows.pop();
    assert.equal(inspectEnergyMeasurementWorkbook(workbookBytes(rows)).totalKwh, 100.8);
  });
}

test('odrzuca całkowicie pustą godzinę również w raporcie strefowym', () => {
  const rows = zonedReport();
  rows[6][1] = '';
  assert.throws(() => inspectEnergyMeasurementWorkbook(workbookBytes(rows)), /743\/744 poprawnych pomiarów/);
});

for (const value of ['brak', -1, 'Infinity', false]) {
  test(`odrzuca niepoprawną wartość strefy ${String(value)} mimo innej poprawnej strefy`, () => {
    const rows = zonedReport();
    rows[246][3] = value;
    assert.throws(() => inspectEnergyMeasurementWorkbook(workbookBytes(rows)), /743\/744 poprawnych pomiarów/);
  });
}

test('raport strefowy nadal wymaga poprawnego statusu godziny', () => {
  const rows = zonedReport();
  rows[6][5] = '';
  assert.throws(() => inspectEnergyMeasurementWorkbook(workbookBytes(rows)), /statusem: 1; wartością kWh: 0/);
});

test('nie sumuje jednocześnie rejestru łącznego i jego stref', () => {
  const rows = zonedReport();
  rows[6][2] = 1;
  assert.throws(() => inspectEnergyMeasurementWorkbook(workbookBytes(rows)), /jednocześnie energię łączną i strefową/);
});

test('sprawdza zgodność sum wszystkich stref z pomiarami', () => {
  const rows = zonedReport();
  rows[rows.length - 1][2] = 999;
  assert.throws(() => inspectEnergyMeasurementWorkbook(workbookBytes(rows)), /nie zgadza się/);
});

test('nie wymaga statusu ani pomiaru w wierszach opisowych i podsumowaniu', () => {
  const rows = hourlyReport('pobrana', 2026, 1);
  rows.push([], ['Uwagi', 'Raport za pełny miesiąc']);
  assert.equal(inspectEnergyMeasurementWorkbook(workbookBytes(rows)).rowsCount, 744);
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
