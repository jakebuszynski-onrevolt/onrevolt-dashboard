import type { OfferWorkspaceScenarioResult, OfferWorkspaceGridPricingResult } from './offer-workspace-billing';

export type ClientEnergyCostSummary = {
  source?: 'MODELLED';
  status: 'ready' | 'partial' | 'blocked';
  vatBasis: 'NET' | 'GROSS';
  totalPln: number | null;
  energyPln: number | null;
  distributionPln: number | null;
  fixedPln: number | null;
  exportValuePln: number | null;
  settlementBenefitPln: number | null;
  settled: boolean;
  pricedHours: number;
  totalHours: number;
  tariffLabels: string[];
  issues: string[];
  assumptions: string[];
};

export function buildClientEnergyCostSummary(input: {
  pricing: OfferWorkspaceGridPricingResult;
  settlementResult?: OfferWorkspaceScenarioResult | { status: 'blocked'; reasons: string[] } | null;
  settlementIssue?: string | null;
  assumptions?: string[];
  source?: 'MODELLED';
}): ClientEnergyCostSummary {
  const { pricing } = input;
  const settlement = input.settlementResult?.status === 'ready' ? input.settlementResult : null;
  const baseTotal = [pricing.energyPln, pricing.distributionPln, pricing.fixedPln]
    .some(value => value !== null)
    ? (pricing.energyPln || 0) + (pricing.distributionPln || 0) + (pricing.fixedPln || 0)
    : null;
  const issues = [...pricing.issues];
  if (input.settlementIssue) issues.push(input.settlementIssue);
  if (input.settlementResult && input.settlementResult.status === 'blocked') {
    issues.push(...input.settlementResult.reasons);
  }
  return {
    ...(input.source ? { source: input.source } : {}),
    status: pricing.status === 'ready' && (input.assumptions?.length || input.settlementIssue
      || (input.settlementResult?.status === 'blocked')) ? 'partial' : pricing.status,
    vatBasis: pricing.vatBasis,
    totalPln: settlement ? settlement.result.totals.cashDuePln : baseTotal,
    energyPln: pricing.energyPln,
    distributionPln: pricing.distributionPln,
    fixedPln: pricing.fixedPln,
    exportValuePln: pricing.exportValuePln,
    settlementBenefitPln: settlement && baseTotal !== null
      ? baseTotal - settlement.result.totals.cashDuePln : null,
    settled: settlement !== null,
    pricedHours: pricing.pricedHours,
    totalHours: pricing.totalHours,
    tariffLabels: pricing.tariffLabels,
    issues: [...new Set(issues)],
    assumptions: [...new Set(input.assumptions || [])],
  };
}

export function blockedClientEnergyCostSummary(
  vatBasis: 'NET' | 'GROSS',
  totalHours: number,
  issue: string,
): ClientEnergyCostSummary {
  return {
    status: 'blocked', vatBasis, totalPln: null, energyPln: null, distributionPln: null,
    fixedPln: null, exportValuePln: null, settlementBenefitPln: null, settled: false,
    pricedHours: 0, totalHours, tariffLabels: [], issues: [issue], assumptions: [],
  };
}
