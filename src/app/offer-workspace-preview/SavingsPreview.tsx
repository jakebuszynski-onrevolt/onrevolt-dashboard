'use client';

import { OfferSavingsScreen } from 'components/onrevolt/OfferWorkspaceScreens';
import type { WorkspaceData } from 'components/onrevolt/OfferWorkspacePanel';
import { emptyOfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import type { OfferWorkspaceCalculation } from 'lib/onrevolt/offer-workspace-calculation-types';
import type { OfferBillingScenarioResult } from 'lib/onrevolt/offer-workspace-billing';
import { Alert } from '@chakra-ui/react';

const periods = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
const intervals = periods.flatMap((period, i) => Array.from({ length: 24 }, (_, hour) => ({
  startUtc: new Date(Date.UTC(2026, i, 5, hour - (i >= 3 && i <= 9 ? 2 : 1))).toISOString(), endUtc: new Date(Date.UTC(2026, i, 5, hour + 1 - (i >= 3 && i <= 9 ? 2 : 1))).toISOString(), month: period,
  importKwh: 20, exportKwh: 2, billedImportKwh: 20, billedExportKwh: 2,
  energyCostPln: 5, distributionCostPln: 4, fixedCostPln: 2, totalCostPln: 11,
  coveredKwh: 0, coveredEnergyPln: 3, coveredDistributionPln: 0,
  exportValuePln: 1, depositEarnedPln: 1, depositUsedPln: 3,
  depositExpiredPln: 0, depositRefundedPln: 0, depositBalancePln: 0, pendingDepositPln: 0,
  creditAddedKwh: 0, creditUsedKwh: 0, creditExpiredKwh: 0, creditBalanceKwh: null, cashDuePln: 11,
})));
function sum(rows: typeof intervals) {
  return Object.fromEntries(Object.entries(rows[0]).filter(([, v]) => typeof v === 'number').map(([key]) => [key, rows.reduce((a, row) => a + Number(row[key as keyof typeof row]), 0)]));
}
const bill = { intervals, months: periods.map(month => ({ month, ...sum(intervals.filter(row => row.month === month)) })), totals: sum(intervals) } as OfferBillingScenarioResult;
const measurements = { months: periods.map(period => ({ period, importKwh: 480, exportKwh: 48 })), totalsImportKwh: 5760, totalsExportKwh: 576, issues: [],
  dayProfiles: periods.map(period => ({ period, date: `${period}-05`, dayType: 'workday' as const, hours: Array.from({ length: 24 }, (_, hour) => ({ hour, importKwh: 20, exportKwh: 2 })) })) };
const energy = { source: 'QA', quality: 'MODELLED', issues: [], totals: { loadKwh: 7992, pvKwh: 4500, directKwh: 2232 },
  months: periods.map(period => ({ period, loadKwh: 666, pvKwh: 375, directKwh: 186 })),
  dayProfiles: measurements.dayProfiles.map(day => ({ date: day.date, hours: day.hours.map(hour => ({ hour: hour.hour, loadKwh: 28, pvKwh: 15, directKwh: 8 })) })) };
const calculation = { status: 'ready', evaluatedTemplateIds: ['qa-storage'], reasons: [], warnings: ['Przykładowe dane testowe.', 'Depozyt przenoszony pomiędzy latami.'],
  baselineAnnualCostPln: 3168, proposedAnnualCostPln: 3168, annualSavingsPln: 0,
  baselineBill: bill, proposedBill: bill, systemCostPln: 40000, grantPln: 6000, taxReliefPln: 4080, costAfterFinancingPln: 29920,
  paybackYears: null, estimatedPaybackYears: 4.7, recommendationEligible: false, rankings: [], recommendedTemplateIds: null,
  estimatedAnnualTargetCostPln: Array.from({ length: 20 }, (_, i) => i ? 2900 : 3168),
  estimatedAnnualTariffOnlyCostPln: Array.from({ length: 20 }, () => 10000),
  estimatedAnnualSavingsPln: Array.from({ length: 20 }, (_, i) => i ? 7100 : 6832), estimateHorizonYears: 20,
  forecastEnergy: energy, forecastMeasurements: measurements,
  forecastFlows: intervals.map(interval => ({ startUtc: interval.startUtc, endUtc: interval.endUtc, batteryToLoadKwh: 3, batteryToGridKwh: 0, loadKwh: 28, pvKwh: 15, directKwh: 8, importKwh: 20, exportKwh: 2, gridToBatteryKwh: 3, pvToBatteryKwh: 2, socKwh: 8 })),
} as unknown as OfferWorkspaceCalculation;
const draft = { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['qa-storage'], currentSettlement: 'NET_BILLING' as const, targetSettlement: 'NET_BILLING' as const };

export default function SavingsPreview() {
  return <><Alert status="info" mb="16px">Test układu Oszczędności · dane syntetyczne · bez zapisu</Alert><OfferSavingsScreen
    workspace={{ clientType: 'B2C', measurements, energy } as unknown as WorkspaceData}
    draft={draft} calculation={calculation} currentTariffLabel="ENEA · G11" targetTariffLabel="ENEA · G13active"
    currentTariffRates={{ status: 'unavailable', message: 'Cennik nie jest częścią testu układu.' }} targetTariffRates={{ status: 'unavailable', message: 'Cennik nie jest częścią testu układu.' }}
    onCalculate={() => undefined} calculationDisabled
  /></>;
}
