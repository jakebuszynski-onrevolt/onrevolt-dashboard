import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadEnergyMeasurementBatch } from './energy-measurement-upload';

test('błąd jednego miesiąca nie zatrzymuje pozostałych; wynik identyfikuje każdy odrzucony plik', async () => {
  const files = ['wrzesień.xlsx', 'grudzień.xlsx', 'faktura.pdf', 'styczeń.xlsx'].map(name => ({ name }));
  const calls: string[] = [];
  const result = await uploadEnergyMeasurementBatch(files, async file => {
    calls.push(file.name);
    if (file.name === 'wrzesień.xlsx') throw new Error('Brak pomiarów za 15–30 września.');
    return { reSync: { status: 'not_linked' } };
  });
  assert.deepEqual(calls, ['wrzesień.xlsx', 'grudzień.xlsx', 'styczeń.xlsx']);
  assert.deepEqual(result.imported, ['grudzień.xlsx', 'styczeń.xlsx']);
  assert.match(result.errors[0], /^wrzesień.xlsx: Brak pomiarów/);
  assert.match(result.errors[1], /^faktura.pdf:/);
  assert.equal(result.storedWithoutRe, true);
  assert.deepEqual(result.reWarnings, []);
});

test('zapisany plik z błędem synchronizacji RE jest sukcesem CRM z osobnym ostrzeżeniem', async () => {
  const result = await uploadEnergyMeasurementBatch([{ name: 'styczeń.xlsx' }], async () => ({ reSync: { status: 'failed', message: 'Brak odpowiedzi RE' } }));
  assert.deepEqual(result.imported, ['styczeń.xlsx']);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.reWarnings, ['styczeń.xlsx: Brak odpowiedzi RE']);
});
