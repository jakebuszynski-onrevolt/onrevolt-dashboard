import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import { OfferSavingsScreen } from './OfferWorkspaceScreens';
import { emptyOfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import type { WorkspaceData } from './OfferWorkspacePanel';
import type { OfferWorkspaceCalculation } from 'lib/onrevolt/offer-workspace-calculation-types';
import type { OfferBillingScenarioResult } from 'lib/onrevolt/offer-workspace-billing';

const fields = {
  importKwh: 100, exportKwh: 20, billedImportKwh: 100, billedExportKwh: 20,
  energyCostPln: 40, distributionCostPln: 25, fixedCostPln: 10, totalCostPln: 75,
  coveredKwh: 0, coveredEnergyPln: 10, coveredDistributionPln: 0,
  exportValuePln: 8, depositEarnedPln: 8, depositUsedPln: 10,
  depositExpiredPln: 0, depositRefundedPln: 0, depositBalancePln: 5, pendingDepositPln: 8,
  creditAddedKwh: 0, creditUsedKwh: 0, creditExpiredKwh: 0, creditBalanceKwh: null, cashDuePln: 75,
};
const bill = {
  totals: fields,
  months: [{ month: '2026-01', ...fields }],
  intervals: [{ startUtc: '2026-01-01T00:00:00Z', endUtc: '2026-01-01T01:00:00Z', month: '2026-01', ...fields }],
} as OfferBillingScenarioResult;
const calc = {
  status: 'ready', evaluatedTemplateIds: ['storage'], reasons: [], warnings: ['Założenie modelu PV'],
  baselineAnnualCostPln: 75, proposedAnnualCostPln: 75, annualSavingsPln: 0,
  baselineBill: bill, proposedBill: bill, systemCostPln: 100, grantPln: 20, taxReliefPln: 10,
  costAfterFinancingPln: 70, recommendationEligible: false, recommendationReasons: ['Szacunek'],
  paybackYears: null, estimatedPaybackYears: 4.7, estimatedAnnualSavingsPln: [20, 25],
  estimatedAnnualTargetCostPln: [75, 70], estimatedAnnualTariffOnlyCostPln: [95, 95],
  estimateHorizonYears: 2, rankings: [], recommendedTemplateIds: null,
} as OfferWorkspaceCalculation;
function render(calculation: OfferWorkspaceCalculation | null = calc, type = 'B2C') {
  const draft = { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['storage'], currentSettlement: 'NET_BILLING' as const, targetSettlement: 'NET_BILLING' as const };
  const workspace = { clientType: type, measurements: { months: [], dayProfiles: [], totalsImportKwh: 100 } } as unknown as WorkspaceData;
  const globals = globalThis as typeof globalThis & { React?: typeof React };
  const previous = globals.React;
  globals.React = React;
  try {
    return renderToStaticMarkup(React.createElement(ChakraProvider, null, React.createElement(OfferSavingsScreen, {
      workspace, draft, calculation, currentTariffLabel: 'ENEA · G11', targetTariffLabel: 'ENEA · G13active',
      currentTariffRates: { status: 'unavailable', message: 'Brak cennika' }, targetTariffRates: { status: 'unavailable', message: 'Brak cennika' }, onCalculate: () => undefined,
    })));
  } finally { globals.React = previous; }
}

test('oszczędność wyświetla średnie przed depozytem, finansowanie i jawny szacunek zwrotu', () => {
  const html = render();
  assert.doesNotMatch(html, /Nie udało się odczytać wyniku|Przelicz wariant ponownie/);
  assert.match(html, /0,5 zł/);
  assert.match(html, /0,25 zł/);
  assert.match(html, /0,75 zł/);
  assert.match(html, /Szacunkowy zwrot z dodatkowego sprzętu/);
  assert.match(html, /4 lat/);
  assert.match(html, /Koszt systemu po dofinansowaniach/);
  assert.match(html, /70 zł/);
  assert.match(html, /190 zł/);
  assert.match(html, /145 zł/);
  assert.match(html, /45 zł/);
  assert.match(html, /-25 zł/);
  assert.match(html, /Taryfa docelowa bez inwestycji/);
  const warning = html.match(/<details[^>]*>[\s\S]*?Uwagi i założenia do wyniku/);
  assert.ok(warning);
  assert.doesNotMatch(warning[0], / open(?:=|\s|>)/);
});

test('wynik innego zestawu i brak kalkulacji nie podszywają się pod wybrany wariant', () => {
  for (const calculation of [null, { ...calc, evaluatedTemplateIds: ['other'] }, { ...calc, status: 'blocked' as const }]) {
    const html = render(calculation);
    assert.match(html, /Oblicz wybraną konfigurację/);
    assert.doesNotMatch(html, /190 zł|145 zł|4 lat/);
  }
});

test('B2B ma netto, a stary cache bez dwóch serii nie powoduje awarii', () => {
  const html = render({ ...calc, estimatedAnnualTargetCostPln: undefined, estimatedAnnualTariffOnlyCostPln: undefined }, 'B2B');
  assert.match(html, /PLN netto/);
  assert.match(html, /Prognoza wieloletnia niedostępna/);
  assert.doesNotMatch(html, /Przelicz wariant ponownie/);
});
