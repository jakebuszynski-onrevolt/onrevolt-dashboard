import assert from 'node:assert/strict';
import test from 'node:test';
import { getClosedMonths, selectEneaPpe } from './enea-portal';

test('wybiera 12 pełnych miesięcy bez bieżącego miesiąca', () => {
  const months = getClosedMonths(12, new Date('2026-07-08T12:00:00.000Z'));

  assert.equal(months.length, 12);
  assert.deepEqual(months[0], {
    year: 2026,
    month: 6,
    dateFrom: '2026-06-01',
    dateTo: '2026-06-30',
  });
  assert.deepEqual(months[11], {
    year: 2025,
    month: 7,
    dateFrom: '2025-07-01',
    dateTo: '2025-07-31',
  });
});

test('dobiera PPE po ID portalu albo numerze PPE', () => {
  const ppes = [
    { id: 80085, code: '590310600031022936', name: '590310600031022936' },
    { id: 90001, code: '590310600000000000', name: 'Drugi punkt' },
  ];

  assert.equal(selectEneaPpe({ portalPpeId: '90001' }, ppes).id, 90001);
  assert.equal(selectEneaPpe({ ppeNumber: '590310600031022936' }, ppes).id, 80085);
});
