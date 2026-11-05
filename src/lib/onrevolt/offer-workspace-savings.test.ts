import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  OfferBillingIntervalResult,
  OfferBillingMonthResult,
  OfferBillingScenarioResult,
} from './offer-workspace-billing';
import type { OfferWorkspaceCalculation, OfferForecastFlow } from './offer-workspace-calculation-types';
import {
  adaptOfferWorkspaceProposedBillValuation,
  buildOfferWorkspaceSavingsPresentation,
  offerSavingsBatteryTotals,
  summarizeOfferSavingsBill,
} from './offer-workspace-savings';

function billInterval(overrides: Partial<OfferBillingIntervalResult> = {}): OfferBillingIntervalResult {
  return {
    startUtc: '2025-12-31T23:00:00.000Z', endUtc: '2026-01-01T00:00:00.000Z', month: '2026-01',
    importKwh: 0, exportKwh: 0, billedImportKwh: 0, billedExportKwh: 0,
    energyCostPln: 0, distributionCostPln: 0, fixedCostPln: 0, totalCostPln: 0,
    coveredKwh: 0, coveredEnergyPln: 0, coveredDistributionPln: 0,
    exportValuePln: 0, depositEarnedPln: 0, depositUsedPln: 0, depositExpiredPln: 0,
    depositRefundedPln: 0, depositBalancePln: 0, pendingDepositPln: 0,
    creditAddedKwh: 0, creditUsedKwh: 0, creditExpiredKwh: 0, creditBalanceKwh: null, cashDuePln: 0,
    ...overrides,
  };
}

function billMonth(month: string, overrides: Partial<OfferBillingMonthResult> = {}): OfferBillingMonthResult {
  const { startUtc: _start, endUtc: _end, ...values } = billInterval({ month, ...overrides });
  return { ...values, month };
}

function billResult(
  intervals: OfferBillingIntervalResult[],
  months: OfferBillingMonthResult[],
): OfferBillingScenarioResult {
  const { month: _month, ...totals } = billMonth('');
  return { intervals, months, totals };
}

test('savings presentation restores gross purchase once and keeps paid bill components net', () => {
  const months = [
    billMonth('2026-01', { importKwh: 12, billedImportKwh: 10, energyCostPln: 6, coveredEnergyPln: 2,
      depositUsedPln: 2, distributionCostPln: 3, fixedCostPln: 24, cashDuePln: 33 }),
    billMonth('2026-02', { importKwh: 6, billedImportKwh: 5, energyCostPln: 4, coveredEnergyPln: 1,
      depositUsedPln: 1, distributionCostPln: 2.5, fixedCostPln: 12, cashDuePln: 18.5 }),
  ];
  const calculation = {
    proposedBill: { months, intervals: [], totals: {} },
    estimatedAnnualTargetCostPln: [100, 90],
    estimatedAnnualTariffOnlyCostPln: [130, 120],
    estimatedAnnualSavingsPln: [30, 30],
    estimateHorizonYears: 2,
    estimatedPaybackYears: 1.75,
    costAfterFinancingPln: 50,
  } as unknown as OfferWorkspaceCalculation;

  const result = buildOfferWorkspaceSavingsPresentation(calculation, 'NET_BILLING');
  assert.ok(result.annualBill);
  assert.equal(result.annualBill.representedMonths, 2);
  assert.equal(result.annualBill.totals.importKwh, 18);
  assert.equal(result.annualBill.totals.rateBasisImportKwh, 15);
  assert.equal(result.annualBill.totals.grossPurchaseEnergyCostPln, 13);
  assert.equal(result.annualBill.totals.averageEnergyPurchasePlnPerKwh, 0.866667);
  assert.equal(result.annualBill.totals.averageDistributionPurchasePlnPerKwh, 0.366667);
  assert.equal(result.annualBill.averageMonthlyFixedCostPln, 18);
  assert.equal(result.annualBill.totals.paidEnergyCostPln, 10);
  assert.equal(result.annualBill.totals.paidDistributionCostPln, 5.5);
  assert.equal(result.annualBill.totals.cashDuePln, 51.5);
  assert.equal(summarizeOfferSavingsBill(calculation.proposedBill as OfferBillingScenarioResult,
    'NET_BILLING').averageMonthlyFixedCostPln, 18);
  assert.equal(result.projection?.totalSavingsPln, 60);
  assert.equal(result.projection?.netSavingsAfterCostPln, 10);
  assert.equal(result.projection?.estimatedPaybackYears, 1);
});

test('net-metering rate uses billed plus covered kWh and zero import has no fabricated rate', () => {
  const fullyCovered = billInterval({ importKwh: 4, billedImportKwh: 0, coveredKwh: 4,
    coveredEnergyPln: 2, coveredDistributionPln: 1, fixedCostPln: 5 });
  const adapted = adaptOfferWorkspaceProposedBillValuation(
    billResult([fullyCovered], [billMonth('2026-01', { importKwh: 4, coveredKwh: 4, coveredEnergyPln: 2,
      coveredDistributionPln: 1, fixedCostPln: 5 })]), 'NET_METERING',
    [{ date: '2026-01-01', period: '2026-01', dayType: 'workday', hours: [{ hour: 0, importKwh: 4, exportKwh: 0 }] }],
  );
  assert.equal(adapted.totals.averageBuyPlnPerKwh, 0.75);
  assert.equal(adapted.days[0].hours[0].importKwh, 4);

  const zeroImport = adaptOfferWorkspaceProposedBillValuation(
    billResult([billInterval()], [billMonth('2026-01')]), 'NET_METERING', [],
  );
  assert.equal(zeroImport.totals.averageBuyPlnPerKwh, null);
});

test('signed covered energy is preserved for negative net-metering purchase rates', () => {
  const summary = summarizeOfferSavingsBill(
    billResult([], [billMonth('2026-01', { importKwh: 4, billedImportKwh: 2, coveredKwh: 2,
      energyCostPln: -2, coveredEnergyPln: -2, fixedCostPln: 2 })]),
    'NET_METERING',
  );
  assert.equal(summary.totals.grossPurchaseEnergyCostPln, -4);
  assert.equal(summary.totals.averageEnergyPurchasePlnPerKwh, -1);
});

test('bill valuation separates physical import from net-billing rate basis and marks deposit export value', () => {
  const interval = billInterval({ importKwh: 5, exportKwh: 2, billedImportKwh: 3, billedExportKwh: 0,
    energyCostPln: 1.5, coveredEnergyPln: 1, depositUsedPln: 1, depositEarnedPln: 0,
    distributionCostPln: 0.9, cashDuePln: 2.4 });
  const adapted = adaptOfferWorkspaceProposedBillValuation(
    billResult([interval], [billMonth('2026-01', { importKwh: 5, exportKwh: 2, billedImportKwh: 3,
      energyCostPln: 1.5, coveredEnergyPln: 1, depositUsedPln: 1, distributionCostPln: 0.9, cashDuePln: 2.4 })]),
    'NET_BILLING', [],
  );
  assert.equal(adapted.totals.importKwh, 5);
  assert.equal(adapted.months[0].averageBuyPlnPerKwh, 1.133333);
  assert.equal(adapted.totals.averageBuyPlnPerKwh, 1.133333);
  assert.ok(adapted.issues.some(issue => issue.includes('Wartość depozytu za eksport')));
  assert.ok(adapted.issues.some(issue => issue.includes('fizyczny import')));
});

test('valuation aggregates by Europe/Warsaw month, date and profile hour', () => {
  const intervals = [
    billInterval({ startUtc: '2025-12-31T23:00:00.000Z', endUtc: '2026-01-01T00:00:00.000Z', month: '2026-01',
      importKwh: 2, billedImportKwh: 2, energyCostPln: 1, distributionCostPln: 0.4, fixedCostPln: 0.2, cashDuePln: 1.6 }),
    billInterval({ startUtc: '2026-01-01T00:00:00.000Z', endUtc: '2026-01-01T01:00:00.000Z', month: '2026-01',
      importKwh: 1, billedImportKwh: 1, energyCostPln: 0.5, distributionCostPln: 0.2, fixedCostPln: 0.1, cashDuePln: 0.8 }),
  ];
  const adapted = adaptOfferWorkspaceProposedBillValuation(
    billResult(intervals, [billMonth('2026-01', { importKwh: 3, billedImportKwh: 3, energyCostPln: 1.5,
      distributionCostPln: 0.6, fixedCostPln: 0.3, cashDuePln: 2.4 })]), 'NET_BILLING',
    [{ date: '2026-01-01', period: '2026-01', dayType: 'workday', hours: [
      { hour: 0, importKwh: 2, exportKwh: 0 }, { hour: 1, importKwh: 1, exportKwh: 0 },
    ] }],
  );
  assert.deepEqual(adapted.days[0].hours.map(row => row.hour), [0, 1]);
  assert.equal(adapted.days[0].hours[0].averageBuyPlnPerKwh, 0.7);
  assert.equal(adapted.months[0].importKwh, 3);
});

test('legacy and invalid projections return a reason instead of crashing the Savings screen', () => {
  const legacy = buildOfferWorkspaceSavingsPresentation({
    estimatedAnnualSavingsPln: [1, 2],
  } as OfferWorkspaceCalculation, null);
  assert.equal(legacy.projection, null);
  assert.match(legacy.projectionReason!, /niekompletna/);

  const partial = buildOfferWorkspaceSavingsPresentation({
    estimatedAnnualTargetCostPln: [1],
  } as OfferWorkspaceCalculation, null);
  assert.equal(partial.projection, null);
  assert.match(partial.projectionReason!, /niekompletna/);

  const mismatched = buildOfferWorkspaceSavingsPresentation({
    estimatedAnnualTargetCostPln: [1], estimatedAnnualTariffOnlyCostPln: [2, 3], estimatedAnnualSavingsPln: [1],
  } as OfferWorkspaceCalculation, null);
  assert.match(mismatched.projectionReason!, /różne długości/);

  const inconsistent = buildOfferWorkspaceSavingsPresentation({
    estimatedAnnualTargetCostPln: [1], estimatedAnnualTariffOnlyCostPln: [2], estimatedAnnualSavingsPln: [9],
  } as OfferWorkspaceCalculation, null);
  assert.match(inconsistent.projectionReason!, /nie zgadza się z różnicą/);
});

test('battery totals include discharge to building only by Warsaw month and local hour', () => {
  const flows: OfferForecastFlow[] = [
    { startUtc: '2025-12-31T22:30:00.000Z', endUtc: '2025-12-31T22:45:00.000Z',
      loadKwh: 0, pvKwh: 0, directKwh: 0, importKwh: 0, exportKwh: 0,
      batteryToLoadKwh: 1, gridToBatteryKwh: 0, pvToBatteryKwh: 0, batteryToGridKwh: 0.5, socKwh: 0 },
    { startUtc: '2025-12-31T23:00:00.000Z', endUtc: '2025-12-31T23:15:00.000Z',
      loadKwh: 0, pvKwh: 0, directKwh: 0, importKwh: 0, exportKwh: 0,
      batteryToLoadKwh: 0.25, gridToBatteryKwh: 0, pvToBatteryKwh: 0, batteryToGridKwh: 0.25, socKwh: 0 },
    { startUtc: '2025-12-31T23:15:00.000Z', endUtc: '2025-12-31T23:30:00.000Z',
      loadKwh: 0, pvKwh: 0, directKwh: 0, importKwh: 0, exportKwh: 0,
      batteryToLoadKwh: 0.5, gridToBatteryKwh: 0, pvToBatteryKwh: 0, batteryToGridKwh: 0, socKwh: 0 },
  ];
  assert.deepEqual(offerSavingsBatteryTotals(flows), {
    months: { '2025-12': 1, '2026-01': 0.75 },
    hours: { '2025-12-31T23': 1, '2026-01-01T00': 0.75 },
  });
});

