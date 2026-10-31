import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClientEnergyCostSummary, blockedClientEnergyCostSummary } from './client-energy-cost-summary';
import type { OfferWorkspaceGridPricingResult } from './offer-workspace-billing';

const basePricing: OfferWorkspaceGridPricingResult = {
  status: 'partial', vatBasis: 'GROSS', energyPln: 100, distributionPln: 30,
  fixedPln: 20, exportValuePln: null, pricedHours: 120, totalHours: 8760,
  tariffLabels: ['ENEA G11'], issues: ['Brak cen dla części okresu.'],
};

test('billing failure leaves the priced grid-cost estimate visible and unsettled', () => {
  const summary = buildClientEnergyCostSummary({
    pricing: basePricing,
    settlementResult: { status: 'blocked', reasons: ['Niepełne ceny historyczne.'] },
  });
  assert.equal(summary.status, 'partial');
  assert.equal(summary.totalPln, 150);
  assert.equal(summary.energyPln, 100);
  assert.equal(summary.settled, false);
  assert.equal(summary.settlementBenefitPln, null);
  assert.ok(summary.issues.includes('Niepełne ceny historyczne.'));
});

test('settled scenarios report settlement benefit separately from gross tariff components', () => {
  const summary = buildClientEnergyCostSummary({
    pricing: { ...basePricing, status: 'ready' },
    settlementResult: {
      status: 'ready', settlement: 'NET_METERING', vatBasis: 'GROSS',
      period: { startUtc: '2026-01-01T23:00:00.000Z', endUtc: '2026-01-02T23:00:00.000Z' },
      warnings: [],
      result: { totals: { cashDuePln: 110 } } as any,
    },
  });
  assert.equal(summary.totalPln, 110);
  assert.equal(summary.settlementBenefitPln, 40);
  assert.equal(summary.settled, true);
  assert.equal(summary.energyPln, 100);
});

test('blocked without source prices reports no invented cost value', () => {
  const summary = blockedClientEnergyCostSummary('NET', 8760, 'Brak historii taryfy.');
  assert.equal(summary.status, 'blocked');
  assert.equal(summary.totalPln, null);
  assert.equal(summary.energyPln, null);
  assert.equal(summary.settled, false);
});
