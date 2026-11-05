import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOfferWorkspaceScenario, offerLocalTime, type OfferCalculationInput } from './offer-workspace-calculation';
import { defaultOfferCalculationAssumptions, emptyOfferWorkspaceDraft } from './offer-workspace';
import type { ClientTariffHistory, ClientTariffPayload } from './client-tariffs';
import type { OfferWorkspace } from './offer-workspace-server';

function tariff(price: number): ClientTariffPayload {
  return { osd_id: 1, tariff_id: 1, code: 'G11', name: 'Test', segment: 'G', zone_model: 'all', use_monthly: false,
    fixed: [{ component_key: 'fixed', label: 'Abonament', amount: 31 * 1.23 }],
    variable: [{ component_key: 'energy', label: 'Energia czynna', window_code: 'all', price: price * 1.23 }, { component_key: 'distribution', label: 'Dystrybucja', window_code: 'all', price: 0.123 }],
    pricing: { tariffStorage: { priceBasis: 'net', vatRate: 0.23, validFrom: '2026-01-01',
      fixed: [{ component_key: 'fixed', label: 'Abonament', net: 31, gross: 31 * 1.23, vatRate: 0.23 }],
      variable: [{ component_key: 'energy', label: 'Energia czynna', net: price, gross: price * 1.23, vatRate: 0.23 },
        { component_key: 'distribution', label: 'Dystrybucja', net: 0.1, gross: 0.123, vatRate: 0.23 }] } } };
}

function fixture(): OfferCalculationInput {
  const start = Date.parse('2025-12-31T23:00:00Z');
  const intervals = Array.from({ length: 8760 }, (_, index) => ({ startUtc: new Date(start + index * 3600000).toISOString(),
    endUtc: new Date(start + (index + 1) * 3600000).toISOString(), loadKwh: 1, pvKwh: 0, directKwh: 0, importKwh: 1, exportKwh: 0 }));
  const months = Array.from({ length: 12 }, (_, index) => { const period = `2026-${String(index + 1).padStart(2, '0')}`;
    return { period, importKwh: intervals.filter(row => offerLocalTime(row.startUtc).startsWith(period)).length, exportKwh: 0 }; });
  const workspace: OfferWorkspace = { projectId: 'project', clientId: 'client', projectName: 'Test', clientName: 'Test', clientType: 'B2C',
    period: { startMonth: '2026-01', endMonth: '2026-12', endDate: '2026-12-31', periodKeys: months.map(({ period }) => period),
      fromUtc: '2025-12-31T23:00:00.000Z', untilUtc: '2026-12-31T23:00:00.000Z' },
    ppeNumber: null, revision: 'r1', draft: null, templates: [],
    input: { existingPv: null, location: null, settlementMode: 'NET_BILLING', annualConsumptionKwh: 8760, issues: [],
      reportDetails: { email: null, phone: null, terrain: null, buildingType: null, roofType: null, connectionType: null, connectionPowerKw: 16, heatingSource: null, heatingDetails: null, supplier: null } },
    measurements: { periods: [], months, totalsImportKwh: 8760, totalsExportKwh: 0, intervalCount: 8760, missingDirections: [], issues: [], dayProfiles: [] } };
  const history = (price: number): ClientTariffHistory => ({ strict: true, revision: 1, issues: [], tariffs: { test: tariff(price) },
    byDate: Object.fromEntries(intervals.map(row => [offerLocalTime(row.startUtc).slice(0, 10), 'test'])) });
  return { workspace, draft: { ...emptyOfferWorkspaceDraft(), existingPv: { powerKw: 0, tiltDegrees: null, azimuthDegrees: null, lossPercent: 12 }, existingBatteryPresent: false,
    currentSettlement: 'NET_BILLING', targetSettlement: 'NET_BILLING', calculation: { ...defaultOfferCalculationAssumptions(), billingCycleMonths: 1, initialCreditKwh: 0, initialDepositPln: 0 } },
    energy: { quality: 'MEASURED_IMPORT', source: 'Test', model: 'Test', issues: [], modelBelowExportKwh: 0, intervals,
      months: months.map(month => ({ period: month.period, loadKwh: month.importKwh, pvKwh: 0, directKwh: 0 })), dayProfiles: [], totals: { loadKwh: 8760, pvKwh: 0, directKwh: 0 } },
    baselineHistory: history(0.5), targetHistory: history(0.25), rdnPricesNet: new Map(), exportPrices: new Map(intervals.map(row => [row.startUtc, 0])), addedPvHours: new Map(), pricesAsOf: '2026-10-29' };
}

test('tariff-only comparison preserves measured energy and all twelve fixed charges', async () => {
  const input = fixture();
  const result = await calculateOfferWorkspaceScenario(input, async () => { throw new Error('Battery worker must not run'); });
  assert.equal(result.status, 'ready', result.reasons.join('; '));
  assert.ok(Math.abs(result.baselineAnnualCostPln! - (8760 * 0.6 + 372) * 1.23) < 0.01);
  assert.ok(Math.abs(result.proposedAnnualCostPln! - (8760 * 0.35 + 372) * 1.23) < 0.01);
  assert.equal(result.forecastMeasurements?.totalsImportKwh, 8760);
  assert.equal(result.forecastMeasurements?.totalsExportKwh, 0);
  assert.equal(result.forecastMeasurements?.months.length, 12);
  assert.equal(result.systemCostPln, 0);
  assert.equal(result.tariffOnlyAnnualCostPln, result.proposedAnnualCostPln);
  assert.equal(result.tariffOnlyAnnualSavingsPln, result.annualSavingsPln);
  assert.equal(result.hardwareAnnualSavingsPln, 0);
  assert.equal(result.paybackYears, null);
  assert.equal(result.recommendationEligible, false);
});

function addPvTemplate(input: OfferCalculationInput) {
  input.workspace.templates = [{ id: 'pv', familyKey: 'pv', name: 'PV', version: 1, kind: 'PV_DACH_SKOSNY', clientType: 'B2C', roofType: null, goal: null,
    powerKw: 1, capacityKwh: null, sortOrder: 0, requiresExistingPv: false, requiresExistingInverter: false, notes: null,
    items: [{ id: 'panel', position: 1, description: 'Panel', quantity: 1, role: 'PV_MODULE', supplyMode: 'ONREVOLT_SUPPLIED',
      unitPurchaseNet: 1000, purchaseVatRate: 0.23, operatingCostNet: 0, marginRate: 0, saleVatRate: 0.23,
      isOptional: false, requiresReview: false, product: null }] }];
  input.draft.selectedTemplateIds = ['pv'];
  input.draft.saleVatMode = 'STANDARD_23';
  input.draft.pvStrategy = 'ADD_TEMPLATE';
  input.addedPvHours = new Map(input.energy.intervals!.map(row => [row.startUtc, 0.25]));
}

test('hardware payback excludes tariff savings and does not depend on the old price', async () => {
  const input = fixture();
  addPvTemplate(input);
  const result = await calculateOfferWorkspaceScenario(input);
  assert.equal(result.status, 'ready', result.reasons.join('; '));
  const hardwareSavings = 8760 * 0.25 * 0.35 * 1.23;
  assert.ok(Math.abs(result.hardwareAnnualSavingsPln! - hardwareSavings) < 0.01);
  assert.ok(Math.abs(result.annualSavingsPln! - result.tariffOnlyAnnualSavingsPln! - hardwareSavings) < 0.01);
  assert.ok(Math.abs(result.paybackYears! - 1230 / hardwareSavings) < 0.0001);
  assert.equal(result.paybackBasis, 'HARDWARE_INCREMENTAL');

  input.baselineHistory.tariffs!.test = tariff(1.5);
  const expensiveHistory = await calculateOfferWorkspaceScenario(input);
  assert.ok(expensiveHistory.annualSavingsPln! > result.annualSavingsPln!);
  assert.equal(expensiveHistory.hardwareAnnualSavingsPln, result.hardwareAnnualSavingsPln);
  assert.equal(expensiveHistory.paybackYears, result.paybackYears);
});

test('a system without incremental benefit has no payback even when tariff savings are positive', async () => {
  const input = fixture();
  addPvTemplate(input);
  input.addedPvHours = new Map(input.energy.intervals!.map(row => [row.startUtc, 0]));
  const result = await calculateOfferWorkspaceScenario(input);
  assert.equal(result.status, 'ready', result.reasons.join('; '));
  assert.ok(result.annualSavingsPln! > 0);
  assert.equal(result.hardwareAnnualSavingsPln, 0);
  assert.equal(result.paybackYears, null);
});

test('two PV sets cannot be billed together while only one is simulated', async () => {
  const input = fixture();
  addPvTemplate(input);
  input.workspace.templates.push({ ...input.workspace.templates[0], id: 'pv-2' });
  input.draft.selectedTemplateIds.push('pv-2');
  const result = await calculateOfferWorkspaceScenario(input);
  assert.equal(result.status, 'blocked');
  assert.ok(result.reasons.some(reason => reason.includes('najwyżej jeden zestaw PV')));
});

test('unknown opening balance is estimated at zero without changing the saved draft', async () => {
  const input = fixture();
  input.draft.calculation!.initialDepositPln = null;
  const missingBalance = await calculateOfferWorkspaceScenario(input);
  assert.equal(missingBalance.status, 'ready');
  assert.ok(missingBalance.warnings.some(reason => reason.includes('przyjęto 0 zł')));
  assert.notEqual(missingBalance.baselineAnnualCostPln, null);
  assert.notEqual(missingBalance.tariffOnlyAnnualCostPln, null);
  assert.equal(input.draft.calculation!.initialDepositPln, null);
  input.draft.calculation!.initialDepositPln = 0;
  delete input.baselineHistory.byDate['2026-03-29'];
  const missingPrice = await calculateOfferWorkspaceScenario(input);
  assert.equal(missingPrice.status, 'ready', missingPrice.reasons.join('; '));
  assert.equal(missingPrice.baselineAnnualCostPln, null);
  assert.ok(missingPrice.warnings.some(reason => reason.includes('Obecna taryfa')));
  assert.notEqual(missingPrice.tariffOnlyAnnualCostPln, null);
  assert.notEqual(missingPrice.proposedAnnualCostPln, null);
  assert.equal(missingPrice.annualSavingsPln, null);
});

test('unknown current net-metering balance estimates the baseline and preserves target comparison', async () => {
  const input = fixture();
  input.draft.currentSettlement = 'NET_METERING';
  input.draft.targetSettlement = 'NET_BILLING';
  input.draft.calculation!.initialCreditKwh = null;
  input.draft.calculation!.initialDepositPln = 0;
  const result = await calculateOfferWorkspaceScenario(input);
  assert.equal(result.status, 'ready', result.reasons.join('; '));
  assert.notEqual(result.baselineAnnualCostPln, null);
  assert.ok(result.baselineBill);
  assert.notEqual(result.tariffOnlyAnnualCostPln, null);
  assert.notEqual(result.proposedAnnualCostPln, null);
  assert.notEqual(result.annualSavingsPln, null);
  assert.notEqual(result.tariffOnlyAnnualSavingsPln, null);
  assert.equal(result.hardwareAnnualSavingsPln, 0);
  assert.ok(result.warnings.some(reason => reason.includes('przyjęto 0 kWh')));
  assert.ok(!result.warnings.some(reason => reason.includes('cyklu rozliczeniowego; przyjęto 2 miesiące')));
  assert.equal(input.draft.calculation!.initialCreditKwh, null);
});

test('missing balance with existing lots is never silently replaced by zero', async () => {
  const input = fixture();
  input.draft.calculation!.initialDepositPln = null;
  input.draft.calculation!.initialDepositLots = [{ amountPln: 100, creditedMonth: '2025-12', expiresMonth: '2026-12', refundCapPln: 0 }];
  const result = await calculateOfferWorkspaceScenario(input);
  assert.equal(result.status, 'blocked');
  assert.ok(!result.warnings.some(reason => reason.includes('przyjęto 0 zł')));
  assert.equal(input.draft.calculation!.initialDepositLots.length, 1);
});

test('missing billing assumptions estimate a two-month cycle without mutating the draft', async () => {
  const input = fixture();
  addPvTemplate(input);
  input.draft.calculation!.billingCycleMonths = null;
  input.draft.calculation!.billingCycleStartMonth = null;
  input.draft.calculation!.initialDepositPln = null;
  const result = await calculateOfferWorkspaceScenario(input);
  assert.equal(result.status, 'ready', result.reasons.join('; '));
  assert.equal(result.systemCostPln, 1230);
  assert.notEqual(result.baselineAnnualCostPln, null);
  assert.notEqual(result.tariffOnlyAnnualCostPln, null);
  assert.notEqual(result.proposedAnnualCostPln, null);
  assert.ok(result.warnings.some(reason => reason.includes('cyklu rozliczeniowego; przyjęto 2 miesiące')));
  assert.ok(result.warnings.some(reason => reason.includes('pierwszy miesiąc danych (2026-01) jako kotwicę')));
  assert.ok(result.warnings.some(reason => reason.includes('przyjęto 0 zł')));
  assert.ok(result.recommendationReasons?.some(reason => reason.includes('przyjęto 2 miesiące')));
  assert.equal(input.draft.calculation!.billingCycleMonths, null);
  assert.equal(input.draft.calculation!.billingCycleStartMonth, null);
});

test('VAT review keeps target-tariff and hardware estimates but does not invent sale price or payback', async () => {
  const input = fixture();
  addPvTemplate(input);
  input.draft.saleVatMode = 'REVIEW';
  const result = await calculateOfferWorkspaceScenario(input);
  assert.equal(result.status, 'ready', result.reasons.join('; '));
  assert.equal(result.systemCostPln, null);
  assert.equal(result.costAfterFinancingPln, null);
  assert.notEqual(result.tariffOnlyAnnualCostPln, null);
  assert.notEqual(result.proposedAnnualCostPln, null);
  assert.notEqual(result.hardwareAnnualSavingsPln, null);
  assert.equal(result.recommendationEligible, false);
  assert.equal(result.paybackYears, null);
  assert.ok(result.recommendationReasons?.some(reason => reason.includes('Tryb VAT wymaga przeglądu')));
});

test('dated opening deposit is used once in both comparable scenarios', async () => {
  const input = fixture();
  const empty = await calculateOfferWorkspaceScenario(input);
  input.draft.calculation!.initialDepositPln = 100;
  input.draft.calculation!.initialDepositLots = [{ amountPln: 100, creditedMonth: '2025-12', expiresMonth: '2026-12', refundCapPln: 0 }];
  const funded = await calculateOfferWorkspaceScenario(input);
  assert.equal(funded.status, 'ready', funded.reasons.join('; '));
  assert.ok(Math.abs(empty.baselineAnnualCostPln! - funded.baselineAnnualCostPln! - 100) < 0.01);
  assert.ok(Math.abs(empty.proposedAnnualCostPln! - funded.proposedAnnualCostPln! - 100) < 0.01);
  assert.equal(funded.hardwareAnnualSavingsPln, 0);
});

test('opening balances cannot be imported from a later month or already expired', async () => {
  const input = fixture();
  input.draft.calculation!.initialDepositPln = 100;
  input.draft.calculation!.initialDepositLots = [{ amountPln: 100, creditedMonth: '2026-02', expiresMonth: '2027-02', refundCapPln: 0 }];
  const future = await calculateOfferWorkspaceScenario(input);
  assert.equal(future.status, 'blocked');
  assert.ok(future.reasons.some(reason => reason.includes('na początku danych (2026-01)')));
  input.draft.calculation!.initialDepositLots = [{ amountPln: 100, creditedMonth: '2025-01', expiresMonth: '2026-01', refundCapPln: 0 }];
  const expired = await calculateOfferWorkspaceScenario(input);
  assert.equal(expired.status, 'blocked');
  assert.ok(expired.reasons.some(reason => reason.includes('wygasłą')));
  input.draft.calculation!.initialDepositLots = [{ amountPln: 100, creditedMonth: '2024-01', expiresMonth: '2027-01', refundCapPln: 0 }];
  const extended = await calculateOfferWorkspaceScenario(input);
  assert.equal(extended.status, 'blocked');
  assert.ok(extended.reasons.some(reason => reason.includes('12 miesięcy ważności depozytu')));
});

test('net-metering accepts dated credit and an explicit multi-month cycle anchor', async () => {
  const input = fixture();
  input.draft.currentSettlement = 'NET_METERING';
  input.draft.targetSettlement = 'NET_METERING';
  input.draft.calculation!.billingCycleMonths = 6;
  input.draft.calculation!.billingCycleStartMonth = '2026-01';
  input.draft.calculation!.initialCreditKwh = 100;
  input.draft.calculation!.initialCreditLots = [{ kwh: 100, creditedMonth: '2025-12', expiresMonth: '2026-12' }];
  const result = await calculateOfferWorkspaceScenario(input);
  assert.equal(result.status, 'ready', result.reasons.join('; '));
  assert.equal(result.baselineBill?.totals.creditUsedKwh, 100);
  assert.equal(result.tariffOnlyBill?.totals.creditUsedKwh, 100);
  assert.equal(result.proposedBill?.totals.creditUsedKwh, 100);
  assert.ok(!result.warnings.some(reason => reason.includes('Szacunek rachunku:')));
});

test('unknown net-metering cycle assumes two months and anchors to the first Warsaw energy month', async () => {
  const input = fixture();
  input.draft.currentSettlement = 'NET_METERING';
  input.draft.targetSettlement = 'NET_METERING';
  input.draft.calculation!.billingCycleMonths = null;
  input.draft.calculation!.billingCycleStartMonth = null;
  input.draft.calculation!.initialCreditKwh = 0;

  const result = await calculateOfferWorkspaceScenario(input);
  assert.equal(result.status, 'ready', result.reasons.join('; '));
  assert.ok(result.warnings.some(reason => reason.includes('cyklu rozliczeniowego; przyjęto 2 miesiące')));
  assert.ok(result.warnings.some(reason => reason.includes('pierwszy miesiąc danych (2026-01) jako kotwicę')));
  assert.ok(result.recommendationReasons?.some(reason => reason.includes('jako kotwicę')));
  assert.equal(input.draft.calculation!.billingCycleMonths, null);
  assert.equal(input.draft.calculation!.billingCycleStartMonth, null);
});

test('net-metering battery is explicitly blocked, not silently simulated as net-billing', async () => {
  const input = fixture();
  input.workspace.templates = [{ id: 'bank', familyKey: 'bank', name: 'Bank', version: 1, kind: 'MAGAZYN', clientType: 'B2C', roofType: null, goal: null,
    powerKw: 4, capacityKwh: 16, sortOrder: 0, requiresExistingPv: false, requiresExistingInverter: false, notes: null, items: [] }];
  input.draft.selectedTemplateIds = ['bank'];
  input.draft.targetSettlement = 'NET_METERING';
  const result = await calculateOfferWorkspaceScenario(input);
  assert.equal(result.status, 'blocked');
  assert.ok(result.reasons.some(reason => reason.includes('net-meteringu')));
});

test('model deficit remains a visible provisional estimate and cannot become a recommendation', async () => {
  const input = fixture();
  input.energy.modelBelowExportKwh = 969.052;
  addPvTemplate(input);
  const result = await calculateOfferWorkspaceScenario(input);
  assert.equal(result.status, 'ready', result.reasons.join('; '));
  assert.ok(result.warnings.some(reason => reason.includes('Model PV')));
  assert.notEqual(result.annualSavingsPln, null);
  assert.equal(result.recommendationEligible, false);
  assert.equal(result.paybackYears, null);
  assert.equal(result.estimatedPaybackYears, undefined);
});

test('accepted tax estimate uses 12 percent after grant and is not certified economics', async () => {
  const input = fixture();
  addPvTemplate(input);
  input.draft.financing = { considerGrant: false, considerTaxRelief: true };
  input.draft.calculation!.taxEstimateAccepted = true;
  const result = await calculateOfferWorkspaceScenario(input);
  assert.equal(result.systemCostPln, 1230);
  assert.equal(result.grantPln, 0);
  assert.equal(result.taxReliefPln, 147.6);
  assert.equal(result.costAfterFinancingPln, 1082.4);
  assert.equal(result.recommendationEligible, false);
  assert.equal(result.paybackYears, null);
  assert.ok(result.estimatedPaybackYears! > 0);
  assert.equal(result.estimatedAnnualSavingsPln?.length, 20);
  assert.equal(result.estimatedAnnualTargetCostPln?.length, 20);
  assert.equal(result.estimatedAnnualTariffOnlyCostPln?.length, 20);
  assert.deepEqual(result.estimatedAnnualSavingsPln,
    result.estimatedAnnualTariffOnlyCostPln!.map((cost, index) => cost - result.estimatedAnnualTargetCostPln![index]));
  assert.ok(result.warnings.some(warning => warning.includes('wystarczający dochód')));
});

test('tax estimate caps deduction at 53000 and cannot be applied without acceptance', async () => {
  const input = fixture();
  addPvTemplate(input);
  input.workspace.templates[0].items[0].unitPurchaseNet = 100000;
  input.draft.financing = { considerGrant: false, considerTaxRelief: true };
  const unaccepted = await calculateOfferWorkspaceScenario(input);
  assert.equal(unaccepted.taxReliefPln, null);
  assert.equal(unaccepted.costAfterFinancingPln, null);
  assert.equal(unaccepted.estimatedPaybackYears, undefined);
  input.draft.calculation!.taxEstimateAccepted = true;
  const accepted = await calculateOfferWorkspaceScenario(input);
  assert.equal(accepted.taxReliefPln, 6360);
  assert.equal(accepted.costAfterFinancingPln, 116640);
  assert.equal(accepted.estimatedPaybackYears, null);
});

test('accepted reconstructed PV allows a separate estimate without promoting strict eligibility', async () => {
  const input = fixture();
  addPvTemplate(input);
  input.energy.modelBelowExportKwh = 969.052;
  input.draft.calculation!.pvReconstructionAccepted = true;
  const result = await calculateOfferWorkspaceScenario(input);
  assert.ok(result.estimatedPaybackYears! > 0);
  assert.equal(result.recommendationEligible, false);
  assert.equal(result.paybackYears, null);
});
