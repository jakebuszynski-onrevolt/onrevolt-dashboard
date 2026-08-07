import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeEnergyInvoices } from './energy-data';

test('annualizes consumption from a half-year invoice period', () => {
  const summary = summarizeEnergyInvoices([{
    energyConsumptionKwh: 2400,
    billingPeriodFrom: '2026-01-01',
    billingPeriodTo: '2026-06-30',
  }]);

  assert.equal(summary.invoiceCount, 1);
  assert.equal(summary.totalKwh, 2400);
  assert.equal(summary.coveredMonths, 5.9);
  assert.ok(summary.annualizedKwh > 4800 && summary.annualizedKwh < 4850);
});

test('uses billing cycle when invoice period is unavailable', () => {
  const summary = summarizeEnergyInvoices([
    { energyConsumptionKwh: '500', billingCycleMonths: 2 },
    { energyConsumptionKwh: 250, billingCycleMonths: 1 },
    { energyConsumptionKwh: null, billingCycleMonths: 1 },
  ]);

  assert.equal(summary.invoiceCount, 2);
  assert.equal(summary.totalKwh, 750);
  assert.ok(summary.coveredMonths > 2.9 && summary.coveredMonths < 3.1);
  assert.ok(summary.annualizedKwh > 2950 && summary.annualizedKwh < 3050);
});

test('returns zero estimate when invoices do not contain recognized consumption', () => {
  assert.deepEqual(summarizeEnergyInvoices([
    { energyConsumptionKwh: null, billingCycleMonths: 2 },
  ]), {
    invoiceCount: 0,
    totalKwh: 0,
    coveredDays: 0,
    coveredMonths: 0,
    annualizedKwh: 0,
  });
});
