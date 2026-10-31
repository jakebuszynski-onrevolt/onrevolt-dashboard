import assert from 'node:assert/strict';
import test from 'node:test';
import type { NetBillingPolicy, OfferBillingMonthResult, OfferBillingScenarioResult } from './offer-workspace-billing';
import { estimateOfferWorkspacePayback } from './offer-workspace-payback';

const months = Array.from({ length: 12 }, (_, index) => {
  const date = new Date(Date.UTC(2026, index, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
});

function profileMonth(
  month: string,
  preDepositEnergyPln: number,
  options: { distributionCostPln?: number; fixedCostPln?: number; depositEarnedPln?: number; depositUsedPln?: number } = {},
): OfferBillingMonthResult {
  const depositUsedPln = options.depositUsedPln ?? 0;
  const energyCostPln = preDepositEnergyPln - depositUsedPln;
  const distributionCostPln = options.distributionCostPln ?? 0;
  const fixedCostPln = options.fixedCostPln ?? 0;
  return {
    month,
    importKwh: 0, exportKwh: 0, billedImportKwh: 0, billedExportKwh: 0,
    energyCostPln, distributionCostPln, fixedCostPln,
    totalCostPln: energyCostPln + distributionCostPln + fixedCostPln,
    coveredKwh: 0, coveredEnergyPln: depositUsedPln, coveredDistributionPln: 0,
    exportValuePln: options.depositEarnedPln ?? 0,
    depositEarnedPln: options.depositEarnedPln ?? 0,
    depositUsedPln, depositExpiredPln: 0, depositRefundedPln: 0,
    depositBalancePln: 0, pendingDepositPln: 0,
    creditAddedKwh: 0, creditUsedKwh: 0, creditExpiredKwh: 0, creditBalanceKwh: null,
    cashDuePln: energyCostPln + distributionCostPln + fixedCostPln,
  };
}

function scenario(rows: OfferBillingMonthResult[], intervalEnergyCosts: number[] = []): OfferBillingScenarioResult {
  return {
    intervals: intervalEnergyCosts.map(energyCostPln => ({ energyCostPln }) as OfferBillingScenarioResult['intervals'][number]),
    months: rows,
    totals: {} as OfferBillingScenarioResult['totals'],
  };
}

function policy(overrides: Partial<NetBillingPolicy> = {}): NetBillingPolicy {
  return {
    mode: 'NET_BILLING',
    initialDeposit: [],
    exportUnitPrices: [],
    exportPriceMethod: 'RCE',
    creditingDelayMonths: 1,
    depositExpiryMonths: 12,
    expiredRefundRate: 0,
    depositCoverage: 'ENERGY_ONLY',
    fixedChargeTreatment: 'ALWAYS_BILLED',
    ...overrides,
  };
}

function estimate(
  tariffOnly: OfferBillingMonthResult[],
  proposed: OfferBillingMonthResult[],
  costAfterFinancingPln = 100,
  options: {
    settlement?: Partial<NetBillingPolicy>;
    horizonYears?: number;
    intervalEnergyCosts?: { tariffOnly?: number[]; proposed?: number[] };
  } = {},
) {
  return estimateOfferWorkspacePayback({
    tariffOnly: scenario(tariffOnly, options.intervalEnergyCosts?.tariffOnly),
    proposed: scenario(proposed, options.intervalEnergyCosts?.proposed),
    policy: policy(options.settlement),
    costAfterFinancingPln,
    ...(options.horizonYears === undefined ? {} : { horizonYears: options.horizonYears }),
  });
}

test('reconciles year one and fractionally interpolates monthly payback', () => {
  const tariffOnly = months.map((month) => profileMonth(month, 100));
  const proposed = months.map((month) => profileMonth(month, 90));
  const result = estimate(tariffOnly, proposed, 25, { horizonYears: 2 });

  assert.deepEqual(result.annualTariffOnlyCostPln, [1200, 1200]);
  assert.deepEqual(result.annualTargetCostPln, [1080, 1080]);
  assert.deepEqual(result.annualSavingsPln, [120, 120]);
  assert.equal(result.estimatedPaybackYears, 25 / 10 / 12);
  assert.equal(result.horizonYears, 2);
});

test('carries pending credit into the next year and expires dated opening credit', () => {
  let tariffOnlyOpeningBalance = 150;
  const tariffOnly = months.map((month) => {
    const depositUsedPln = Math.min(tariffOnlyOpeningBalance, 20);
    tariffOnlyOpeningBalance -= depositUsedPln;
    return profileMonth(month, 20, { depositUsedPln });
  });
  const proposed = months.map((month, index) => profileMonth(month, 10, {
    depositUsedPln: 10,
    depositEarnedPln: index === 11 ? 60 : 0,
  }));
  const result = estimate(tariffOnly, proposed, 1, {
    settlement: {
      initialDeposit: [{ amountPln: 150, creditedMonth: '2026-01', expiresMonth: '2027-01', refundCapPln: 0 }],
    },
    horizonYears: 2,
  });

  assert.deepEqual(result.annualTargetCostPln, [0, 60]);
  assert.deepEqual(result.annualTariffOnlyCostPln, [90, 240]);
  assert.deepEqual(result.annualSavingsPln, [90, 180]);
});

test('zero cost still requires positive cumulative economic benefit', () => {
  const equal = months.map((month) => profileMonth(month, 25));
  const costlyProposal = months.map((month) => profileMonth(month, 30));
  const tariffOnly = months.map((month) => profileMonth(month, 25));
  const beneficialProposal = months.map((month) => profileMonth(month, 20));
  const lateYearLossBaseline = months.map((month, index) => profileMonth(month, index === 0 ? 10 : 0));
  const lateYearLossProposal = months.map((month, index) => profileMonth(month, index === 0 ? 0 : 10));

  assert.equal(estimate(equal, equal, 100, { horizonYears: 1 }).estimatedPaybackYears, null);
  const negative = estimate(tariffOnly, costlyProposal, 100, { horizonYears: 1 });
  assert.ok(negative.annualSavingsPln[0] < 0);
  assert.equal(negative.estimatedPaybackYears, null);
  assert.equal(estimate(equal, equal, 0, { horizonYears: 1 }).estimatedPaybackYears, null);
  assert.equal(estimate(tariffOnly, costlyProposal, 0, { horizonYears: 1 }).estimatedPaybackYears, null);
  assert.equal(estimate(tariffOnly, beneficialProposal, 0, { horizonYears: 1 }).estimatedPaybackYears, 0);
  const negativeYear = estimate(lateYearLossBaseline, lateYearLossProposal, 0, { horizonYears: 1 });
  assert.equal(negativeYear.annualSavingsPln[0], -100);
  assert.equal(negativeYear.estimatedPaybackYears, null);
});

test('returns unavailable when monthly RDN energy is negative', () => {
  const tariffOnly = months.map((month) => profileMonth(month, 2));
  const proposed = months.map((month) => profileMonth(month, -1));
  const result = estimate(tariffOnly, proposed, 0, { horizonYears: 1 });

  assert.equal(result.estimatedPaybackYears, null);
  assert.deepEqual(result.annualSavingsPln, []);
  assert.deepEqual(result.annualTargetCostPln, []);
  assert.deepEqual(result.annualTariffOnlyCostPln, []);
});

test('returns unavailable when negative interval energy is hidden by a positive monthly total', () => {
  const tariffOnly = months.map((month) => profileMonth(month, 20));
  const proposed = months.map((month, index) => profileMonth(month, index === 0 ? 120 : 10, {
    depositUsedPln: index === 0 ? 80 : 0,
  }));
  const result = estimate(tariffOnly, proposed, 100, {
    intervalEnergyCosts: { proposed: [-50, 20, 70] },
    horizonYears: 2,
  });

  assert.equal(proposed[0].energyCostPln, 40);
  assert.equal(result.estimatedPaybackYears, null);
  assert.deepEqual(result.annualSavingsPln, []);
  assert.deepEqual(result.annualTargetCostPln, []);
  assert.deepEqual(result.annualTariffOnlyCostPln, []);
});

test('returns unavailable instead of throwing when negative monthly energy overlaps used deposits', () => {
  const tariffOnly = months.map((month) => profileMonth(month, 10));
  const proposed = months.map((month, index) => index === 0
    ? profileMonth(month, 5, { depositUsedPln: 10 })
    : profileMonth(month, 10));
  const result = estimate(tariffOnly, proposed, 100, {
    settlement: {
      initialDeposit: [{ amountPln: 10, creditedMonth: '2026-01', expiresMonth: '2027-01', refundCapPln: 0 }],
    },
    horizonYears: 2,
  });

  assert.equal(result.estimatedPaybackYears, null);
  assert.deepEqual(result.annualSavingsPln, []);
  assert.deepEqual(result.annualTargetCostPln, []);
  assert.deepEqual(result.annualTariffOnlyCostPln, []);
  assert.equal(result.horizonYears, 2);
});

test('zero-cost estimate requires positive first-year and total-horizon savings', () => {
  const tariffOnly = months.map((month, index) => profileMonth(month, 10, {
    depositEarnedPln: index === 11 ? 120 : 0,
  }));
  const proposed = months.map((month) => profileMonth(month, 9));
  const result = estimate(tariffOnly, proposed, 0);

  assert.ok(result.annualSavingsPln[0] > 0);
  assert.ok(result.annualSavingsPln.reduce((sum, savings) => sum + savings, 0) < 0);
  assert.equal(result.estimatedPaybackYears, null);
});

test('defaults to a 20-year profile repeat', () => {
  const tariffOnly = months.map((month) => profileMonth(month, 10));
  const proposed = months.map((month) => profileMonth(month, 9));
  const result = estimate(tariffOnly, proposed);

  assert.equal(result.horizonYears, 20);
  assert.equal(result.annualSavingsPln.length, 20);
});

test('rejects a year-one cash reconciliation mismatch', () => {
  const tariffOnly = months.map((month) => profileMonth(month, 10));
  const proposed = months.map((month) => profileMonth(month, 9));
  proposed[0].cashDuePln += 0.02;

  assert.throws(() => estimate(tariffOnly, proposed), /rok[u]? 1|roku 1|rok 1|proposed/u);
});

test('rejects nonzero expired refunds and incomplete monthly profiles', () => {
  const profile = months.map((month) => profileMonth(month, 10));
  assert.throws(() => estimate(profile, profile, 10, { settlement: { expiredRefundRate: 0.2 } }), /expiredRefundRate/u);
  assert.throws(() => estimate(profile.slice(1), profile.slice(1)), /12 kolejnych miesięcy/u);
});
