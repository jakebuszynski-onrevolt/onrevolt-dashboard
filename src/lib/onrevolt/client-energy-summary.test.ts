import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClientEnergyActualDays,
  clientEnergyProfileSourceLabel,
  summarizeClientEnergyInvoices,
  energyInvoicesInAnalysisPeriod,
} from './client-energy-summary';
import type { OfferMeasurementInterval } from './offer-measurements';

test('faktury w analizie czerwiec-maj nie mieszają lat ani nie dzielą kwot bez danych', () => {
  const result = energyInvoicesInAnalysisPeriod([
    { id: 'inside', billingPeriodFrom: '2025-06-01', billingPeriodTo: '2026-05-31' },
    { id: 'outside', billingPeriodFrom: '2026-06-01', billingPeriodTo: '2026-07-31' },
    { id: 'crossing', billingPeriodFrom: '2025-05-01', billingPeriodTo: '2025-06-30' },
    { id: 'undated' },
  ], { startMonth: '2025-06', endDate: '2026-05-31' });
  assert.deepEqual(result.included.map(invoice => invoice.id), ['inside']);
  assert.equal(result.crossingCount, 1);
  assert.equal(result.undatedCount, 1);
});

test('sumuje kwoty tylko dla rozłącznych okresów faktur', () => {
  const summary = summarizeClientEnergyInvoices([
    { id: 'a', invoiceNumber: 'A', billingPeriodFrom: '2026-01-01', billingPeriodTo: '2026-01-31', amountGross: '120.50' },
    { id: 'b', invoiceNumber: 'B', billingPeriodFrom: '2026-01-20', billingPeriodTo: '2026-02-19', amountGross: 80 },
    { id: 'c', invoiceNumber: 'C', billingPeriodFrom: '2026-03-01', billingPeriodTo: '2026-03-31', amountGross: 0 },
  ]);

  assert.deepEqual(summary.overlappingIds, ['a', 'b']);
  assert.equal(summary.totalGross, 0);
  assert.deepEqual(summary.included.map((invoice) => invoice.id), ['c']);
});

test('brak okresu lub kwoty nie tworzy kosztu ani rocznej ekstrapolacji', () => {
  const summary = summarizeClientEnergyInvoices([
    { id: 'no-period', amountGross: 500 },
    { id: 'no-amount', billingPeriodFrom: '2026-02-01', billingPeriodTo: '2026-02-28' },
  ]);

  assert.equal(summary.totalGross, null);
  assert.deepEqual(summary.invalidPeriodIds, ['no-period']);
  assert.deepEqual(summary.missingAmountIds, ['no-amount']);
});

test('etykiety RE zachowują kierunki poboru i oddania', () => {
  assert.equal(clientEnergyProfileSourceLabel('xlsx', 'import'), '↓ XLSX');
  assert.equal(clientEnergyProfileSourceLabel('real', 'export'), '↑ real');
  assert.equal(clientEnergyProfileSourceLabel('standard', 'export'), '↑ --');
});

function intervalsForDay(date: string, count = 24, missingExportHour = -1): OfferMeasurementInterval[] {
  return Array.from({ length: count }, (_, index) => {
    const hour = index;
    const start = new Date(`${date}T00:00:00.000Z`.replace('00:00:00', `${String(hour).padStart(2, '0')}:00:00`));
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const localStart = `${date}T${String(hour).padStart(2, '0')}:00:00+00:00`;
    const reading = { valueKwh: hour / 10, source: 'measured' as const, fileIds: ['file-1'] };
    return {
      localStart,
      localEnd: `${date}T${String((hour + 1) % 24).padStart(2, '0')}:00:00+00:00`,
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
      occurrence: 0,
      import: reading,
      export: hour === missingExportHour ? null : reading,
    };
  });
}

test('udostępnia dzień tylko przy 24 kolejnych godzinach rzeczywistych pomiarów', () => {
  const complete = buildClientEnergyActualDays(intervalsForDay('2026-06-10'));
  assert.equal(complete.length, 1);
  assert.equal(complete[0].hours.length, 24);
  assert.equal(complete[0].hours[23].importKwh, 2.3);

  assert.deepEqual(buildClientEnergyActualDays(intervalsForDay('2026-06-11', 23)), []);
  assert.deepEqual(buildClientEnergyActualDays(intervalsForDay('2026-06-12', 24, 7).map((row) => ({ ...row, import: null }))), []);
});
