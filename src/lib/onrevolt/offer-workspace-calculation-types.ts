import type { OfferWorkspaceEnergy } from './offer-workspace-energy';
import type { OfferWorkspaceMeasurements } from './offer-workspace-server';
import type { OfferBillingScenarioResult } from './offer-workspace-billing';
import type { OfferWorkspaceRecommendationBatteryBounds } from './offer-workspace-recommendation-bounds';

export type OfferWorkspaceRanking = {
  templateIds: string[];
  name: string;
  /** Incremental hardware savings against the same target tariff without the candidate. */
  annualSavingsPln: number | null;
  targetAnnualCostPln?: number | null;
  tariffOnlyAnnualCostPln?: number | null;
  costAfterFinancingPln: number | null;
  paybackYears: number | null;
  estimatedPaybackYears?: number | null;
  recommendationEligible?: boolean;
  reasons?: string[];
};

export type OfferWorkspaceRecommendationSearch = {
  version: 1;
  candidateSignature: string;
  evaluatedCandidateIds: string[];
  totalCandidates: number;
  evaluatedCandidates: number;
  batchNumber: number;
  batchEvaluated: number;
  hasMore: boolean;
  phase: 'coarse' | 'refine' | 'complete';
};

export type OfferForecastFlow = {
  startUtc: string; endUtc: string;
  loadKwh: number; pvKwh: number; directKwh: number;
  importKwh: number; exportKwh: number;
  batteryToLoadKwh: number; gridToBatteryKwh: number;
  pvToBatteryKwh: number; batteryToGridKwh: number; socKwh: number;
};

export type OfferWorkspaceCalculation = {
  evaluatedTemplateIds?: string[];
  recommendationSearch?: OfferWorkspaceRecommendationSearch;
  recommendationBatteryBounds?: OfferWorkspaceRecommendationBatteryBounds & {
    totalCandidatesBeforeFilter: number;
    excludedCandidates: number;
  };
  recommendationPvBounds?: {
    maximumBatteryKwhPerPvKwp: number;
    pvBasis: 'existing_plus_added';
    totalCandidatesBeforeFilter: number;
    excludedCandidates: number;
  };
  status: 'ready' | 'blocked';
  reasons: string[];
  warnings: string[];
  baselineAnnualCostPln: number | null;
  proposedAnnualCostPln: number | null;
  annualSavingsPln: number | null;
  tariffOnlyAnnualCostPln?: number | null;
  tariffOnlyAnnualSavingsPln?: number | null;
  hardwareAnnualSavingsPln?: number | null;
  paybackBasis?: 'HARDWARE_INCREMENTAL';
  recommendationEligible?: boolean;
  recommendationReasons?: string[];
  systemCostPln: number | null;
  costAfterFinancingPln: number | null;
  paybackYears: number | null;
  estimatedPaybackYears?: number | null;
  estimatedRecommendedTemplateIds?: string[] | null;
  estimatedAnnualSavingsPln?: number[];
  estimatedAnnualTargetCostPln?: number[];
  estimatedAnnualTariffOnlyCostPln?: number[];
  estimatedAnnualPriceGrowthRate?: number;
  estimatedAnnualExportPriceGrowthRate?: number;
  estimatedMonthlyTargetCostPln?: number[];
  estimatedMonthlyTariffOnlyCostPln?: number[];
  estimateHorizonYears?: number;
  grantPln: number | null;
  taxReliefPln: number | null;
  rankings: OfferWorkspaceRanking[];
  recommendedTemplateIds: string[] | null;
  forecastEnergy?: OfferWorkspaceEnergy;
  forecastMeasurements?: OfferWorkspaceMeasurements;
  baselineBill?: OfferBillingScenarioResult;
  proposedBill?: OfferBillingScenarioResult;
  tariffOnlyBill?: OfferBillingScenarioResult;
  pricesAsOf?: string;
  sourceDependencyStamp?: string;
  forecastFlows?: OfferForecastFlow[];
};
