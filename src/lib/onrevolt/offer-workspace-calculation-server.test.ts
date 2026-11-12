import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { OfferMarketDataError, offerHourlyMarketPrices, offerMarketIntervalStarts } from './offer-workspace-market';
import * as dependencies from './offer-workspace-calculation-dependencies';
import * as recommendationSearch from './offer-workspace-recommendation-search';
import * as recommendationBounds from './offer-workspace-recommendation-bounds';
import { PME2_RULES } from './offer-financing-v2';
import { recommendationInputIssues } from './offer-workspace-recommendation-inputs';
import { completeHistoryForSummary } from './client-energy-cost-summary-server';
import type { InvoiceNetMeteringFactorResolution } from './invoice-net-metering-factor';
import { applyOfferWorkspaceConfigurationEdits, configurationEnergyQuantityFingerprint, hasRemovedCriticalConfigurationItem, validateOfferWorkspaceConfigurationEdits } from './offer-workspace-configuration-edits';

const filename = path.resolve(__dirname, 'offer-workspace-calculation-server.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: filename,
}).outputText;

const firstHour = '2026-10-01T00:00:00.000Z';
const nextHour = '2026-10-01T01:00:00.000Z';
const localTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

function marketRows(nullQuarter = -1) {
  return Array.from({ length: 4 }, (_, quarter) => ({
    stamp: new Date(Date.parse(firstHour) + (quarter + 1) * 900000).toISOString(),
    periodUtc: `${String(Math.floor(quarter * 15 / 60)).padStart(2, '0')}:${String(quarter * 15 % 60).padStart(2, '0')} - ${String(Math.floor((quarter + 1) * 15 / 60)).padStart(2, '0')}:${String((quarter + 1) * 15 % 60).padStart(2, '0')}`,
    price: quarter === nullQuarter ? null : 100,
  }));
}

function marketRowsForRange(startValue: unknown, endValue: unknown) {
  const utcTimestamp = (value: unknown) => {
    const normalized = String(value).replace(' ', 'T');
    return Date.parse(`${normalized.endsWith('Z') ? normalized : `${normalized}Z`}`);
  };
  const start = utcTimestamp(startValue), end = utcTimestamp(endValue);
  const clock = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  };
  return Array.from({ length: Math.max(0, Math.ceil((end - start) / 900000)) }, (_, index) => {
    const intervalStart = start + index * 900000;
    const intervalEnd = intervalStart + 900000;
    const crossesDay = new Date(intervalStart).getUTCDate() !== new Date(intervalEnd).getUTCDate();
    return {
      stamp: new Date(intervalEnd).toISOString(),
      periodUtc: `${clock(intervalStart)} - ${crossesDay ? '24:00' : clock(intervalEnd)}`,
      price: 100,
    };
  });
}

function fullYearRecommendationEnergy(loadKwhPerHour = 0.5, importKwhPerHour = 0.01) {
  const months = Array.from({ length: 12 }, (_, index) => ({ period: `2026-${String(index + 1).padStart(2, '0')}` }));
  const starts = dependencies.offerCalculationPeriodHours(months)!;
  return starts.map(startUtc => ({
    startUtc,
    endUtc: new Date(Date.parse(startUtc) + 3600000).toISOString(),
    loadKwh: loadKwhPerHour,
    pvKwh: 0,
    importKwh: importKwhPerHour,
    exportKwh: 0,
  }));
}

function calculation(status: 'ready' | 'blocked', reasons: string[] = []) {
  return {
    status, reasons, warnings: [], baselineAnnualCostPln: status === 'ready' ? 2000 : null,
    proposedAnnualCostPln: status === 'ready' ? 1900 : null,
    tariffOnlyAnnualCostPln: status === 'ready' ? 1980 : null,
    annualSavingsPln: status === 'ready' ? 100 : null, hardwareAnnualSavingsPln: status === 'ready' ? 80 : null,
    systemCostPln: status === 'ready' ? 1000 : null,
    costAfterFinancingPln: status === 'ready' ? 1000 : null, paybackYears: status === 'ready' ? 10 : null,
    estimatedPaybackYears: null, estimatedRecommendedTemplateIds: null,
    grantPln: 0, taxReliefPln: 0, rankings: [], recommendedTemplateIds: null,
    recommendationEligible: status === 'ready', recommendationReasons: [] as string[],
  };
}

function baselineCatalogTariff(id: number, energyNet: number) {
  const gross = energyNet * 1.23;
  return {
    osd_id: 4, tariff_id: id, code: 'G11', name: 'Baseline', segment: 'G', zone_model: 'all', use_monthly: false,
    sell_method: 'fixed',
    fixed: [{ component_key: 'subscription', label: 'Abonament', amount: 1.23 }],
    variable: [{ component_key: 'energy', label: 'Energia czynna', window_code: 'all', price: gross }],
    pricing: { tariffStorage: { priceBasis: 'net', vatRate: 0.23, validFrom: '2026-01-01',
      fixed: [{ component_key: 'subscription', label: 'Abonament', net: 1, gross: 1.23, vatRate: 0.23 }],
      variable: [{ component_key: 'energy', label: 'Energia czynna', net: energyNet, gross, vatRate: 0.23, window_code: 'all' }],
    } },
  };
}

function baselinePriceGapPeriod(validFrom: string, validUntil: string) {
  return { id: `period-${validFrom}`, validFrom, validUntil, osdId: 4, tariffId: 11,
    source: 'ENEA', overrides: {}, schedule: null, note: '' };
}

function fixture(options: {
  addedPvProductionFactor?: (powerKw: number) => number;
  baselineSellMethod?: string;
  targetSellMethod?: string;
  rdnRows?: Array<{ stamp: string; periodUtc: string; price: unknown }>;
  baselineIssues?: Array<{ date: string; message: string }>;
  baselineMissing?: boolean;
  baselineByDate?: Record<string, unknown>;
  baselineTariff?: any;
  currentBaselineTariff?: any;
  profilePeriods?: any[];
  energyDates?: string[];
  recommendationEnergyIntervals?: Array<{ startUtc: string; endUtc: string; loadKwh: number | null; importKwh?: number | null; exportKwh?: number | null }>;
  templates?: Array<{ id: string; name: string; kind: string; powerKw?: number | null }>;
  location?: { latitude: number; longitude: number } | null;
  pvSourceRevision?: string | null;
  pvSourceRevisionAfterProfile?: string;
  existingPvPowerKw?: number | null;
  ppeNumber?: string | null;
  invoiceFactor?: InvoiceNetMeteringFactorResolution;
  candidates?: Array<{ id?: string; templateIds: string[]; totals: unknown; missingPrices: string[]; requiresReview?: boolean; reviewReasons?: string[];
    totalPvKw?: number; existingPvKw?: number; addedPvKw?: number; batteryCapacityKwh?: number; batteryPowerKw?: number }>;
  billingCycleMonths?: number | null;
  scenario?: (input: any) => ReturnType<typeof calculation>;
  preflightScenario?: (input: any) => ReturnType<typeof calculation>;
} = {}) {
  let calculationMode: 'selected' | 'recommend' = 'selected';
  const state = { preflightInputs: [] as any[], progress: [] as number[][], addedProfileReads: 0, profileReads: [] as any[], energyCalls: 0, overlayCalls: 0, marketQueries: [] as string[], scenarioInputs: [] as any[], targetCatalogCalls: 0,
    clientTariffRequests: [] as any[], completedHistories: [] as any[], pvSourceRevision: options.pvSourceRevision ?? null,
    invoiceFactorReads: 0, invoiceFactorInputs: [] as any[] };
  const months = Array.from({ length: 12 }, (_, index) => ({ period: `2026-${String(index + 1).padStart(2, '0')}` }));
  const fullPeriodHours = dependencies.offerCalculationPeriodHours(months)!;
  const energyDates = options.energyDates || ['2026-10-01'];
  const recommendationIntervals = options.recommendationEnergyIntervals || fullYearRecommendationEnergy(10 / 24, 0.01);
  const historyDates = [...new Set([
    ...energyDates.map(value => localTime.format(new Date(value.includes('T') ? value : `${value}T00:00:00.000Z`)).slice(0, 10)),
    ...recommendationIntervals.map(value => localTime.format(new Date(value.startUtc)).slice(0, 10)),
  ])];
  const baselineHistory = {
    strict: true, revision: 1,
    byDate: options.baselineByDate || Object.fromEntries(historyDates.map(date => [date, 'baseline'])),
    tariffs: { baseline: options.baselineTariff || { sell_method: options.baselineSellMethod || 'fixed' } },
    issues: options.baselineIssues || [],
  };
  const targetTariff = { id: 2, sell_method: options.targetSellMethod || 'fixed', catalogRevision: 3 };
  const workspace: any = {
    clientId: 'client-1', projectId: 'project-1', clientType: 'B2C',
    ppeNumber: options.ppeNumber ?? null,
    period: {
      startMonth: '2026-01', endMonth: '2026-12', endDate: '2026-12-31',
      periodKeys: months.map(month => month.period), fromUtc: fullPeriodHours[0],
      untilUtc: new Date(Date.parse(fullPeriodHours.at(-1)!) + 3600000).toISOString(),
    },
    input: { reportDetails: { connectionPowerKw: 16, roofType: 'skośny' }, location: options.location ?? null },
    measurements: { months, dayProfiles: [] },
    templates: options.templates || [],
  };
  const draft: any = {
    targetOperatorId: 1, targetTariffId: 2,
    currentSettlement: 'NET_METERING', targetSettlement: 'NET_METERING',
    existingPv: {
      powerKw: options.existingPvPowerKw === undefined ? 0 : options.existingPvPowerKw,
      tiltDegrees: (options.existingPvPowerKw ?? 0) > 0 ? 30 : null,
      azimuthDegrees: (options.existingPvPowerKw ?? 0) > 0 ? 180 : null,
      lossPercent: (options.existingPvPowerKw ?? 0) > 0 ? 12 : null,
    },
    pvStrategy: 'KEEP_EXISTING', saleVatMode: 'REVIEW', selectedTemplateIds: [],
    financing: { considerGrant: false, considerTaxRelief: false },
    calculation: { billingCycleMonths: options.billingCycleMonths === undefined ? 1 : options.billingCycleMonths,
      initialCreditKwh: 0, initialDepositPln: 0,
      batteryReservePercent: 10, chargeEfficiencyPercent: 95, dischargeEfficiencyPercent: 95,
      addedPvTiltDegrees: null, addedPvAzimuthDegrees: null, taxRatePercent: null,
      taxRemainingLimitPln: null, taxEligibleCostPln: null, taxBasePln: null },
  };
  const energy: any = {
    issues: [], modelBelowExportKwh: 0,
    intervals: energyDates.map(value => {
      const startUtc = value.includes('T') ? value : `${value}T00:00:00.000Z`;
      return { startUtc, endUtc: new Date(Date.parse(startUtc) + 3600000).toISOString(),
        loadKwh: 10 / 24, pvKwh: 0, importKwh: 0.01, exportKwh: 0 };
    }),
  };
  const recommendationEnergy = { ...energy, intervals: recommendationIntervals };
  const blocked = (reasons: string[]) => calculation('blocked', reasons);
  const modules: Record<string, unknown> = {
    './client-tariffs-server': {
      clientTariffScope: async () => ({}),
      loadClientTariffHistory: async () => options.baselineMissing ? null : baselineHistory,
      readProjectGeneralTariffs: async () => ({ generalTariff: null }),
      callClientTariffs: async (request: any) => {
        state.clientTariffRequests.push(request);
        if (request.action === 'get') return { profile: { periods: options.profilePeriods || [] } };
        if (request.action === 'catalog' && request.osdId === 4) return options.currentBaselineTariff || targetTariff;
        if (request.action === 'catalog') state.targetCatalogCalls += 1;
        return targetTariff;
      },
    },
    './client-energy-cost-summary-server': {
      completeHistoryForSummary: async (input: any, helperDependencies: any) => {
        const result = await completeHistoryForSummary(input, helperDependencies);
        state.completedHistories.push(result.history);
        return result;
      },
    },
    './invoice-net-metering-factor': {
      invoiceNetMeteringFactorForPeriod: async (input: any) => {
        state.invoiceFactorReads++;
        state.invoiceFactorInputs.push(input);
        return options.invoiceFactor || { status: 'missing', factor: null, sourceRevision: 'd'.repeat(64), invoicePeriods: [] };
      },
    },
    './client-tariffs': { tariffToday: () => '2026-10-01' },
    './offer-workspace-energy-server': {
      calculateOfferWorkspaceEnergy: async () => { state.energyCalls++; return calculationMode === 'recommend' ? recommendationEnergy : energy; },
      getOfferWorkspaceEnergySourceRevision: () => state.pvSourceRevision,
    },
    './offer-workspace-energy': {
      overlayOfferWorkspaceMeasurements: (measurements: any, modelledEnergy: any) => {
        state.overlayCalls += 1;
        if (!modelledEnergy.modelledMeasurements) return measurements;
        return { ...measurements, months: modelledEnergy.modelledMeasurements.months,
          dayProfiles: modelledEnergy.modelledMeasurements.dayProfiles,
          totalsImportKwh: modelledEnergy.modelledMeasurements.totalsImportKwh,
          totalsExportKwh: modelledEnergy.modelledMeasurements.totalsExportKwh };
      },
    },
    './offer-workspace-calculation': {
      blockedOfferCalculation: blocked,
      offerLocalTime: (value: string) => localTime.format(new Date(value)),
      calculateOfferWorkspaceScenario: async (input: any) => {
        if (calculationMode === 'recommend' && input.draft.selectedTemplateIds.length === 0) {
          state.preflightInputs.push(input);
          return options.preflightScenario ? options.preflightScenario(input) : calculation('ready');
        }
        state.scenarioInputs.push(input);
        return options.scenario ? options.scenario(input) : calculation('ready');
      },
    },
    './offer-workspace': { defaultOfferCalculationAssumptions: () => draft.calculation },
    './offer-workspace-market': { OfferMarketDataError, offerHourlyMarketPrices, offerMarketIntervalStarts },
    './offer-workspace-calculation-dependencies': dependencies,
    './re-stations': { rePrisma: () => ({ $queryRawUnsafe: async (query: string, start: unknown, end: unknown) => {
      state.marketQueries.push(query);
      return options.rdnRows || marketRowsForRange(start, end);
    } }) },
    './offer-pv-profile': {
      OfferPvSourceRevisionError: class OfferPvSourceRevisionError extends Error {},
      readOfferPvProfile: async () => ({ hours: [] }),
      readOfferPvProfileWithSourceRevision: async (profileInput: any) => {
        state.addedProfileReads++;
        state.profileReads.push(profileInput);
        const sourceRevision = state.pvSourceRevision ?? options.pvSourceRevisionAfterProfile ?? null;
        if (options.pvSourceRevisionAfterProfile) state.pvSourceRevision = options.pvSourceRevisionAfterProfile;
        return { profile: { hours: recommendationIntervals.map(row => ({ startUtc: row.startUtc, pvKwh: (row.loadKwh ?? 0) * (options.addedPvProductionFactor?.(profileInput.powerKw) ?? 0.9) })) }, sourceRevision };
      },
    },
    './offer-pv-source-revision': { getOfferPvSourceRevision: () => state.pvSourceRevision },
    './configuration-templates': { configurationInvestmentScope: (kind: string) => kind === 'MAGAZYN'
      ? 'BATTERY' : kind.startsWith('PV_') ? 'PV' : null },
    './offer-workspace-configuration-edits': {
      applyOfferWorkspaceConfigurationEdits,
      hasRemovedCriticalConfigurationItem,
      validateOfferWorkspaceConfigurationEdits,
    },
    './offer-candidates': { enumerateOfferCandidates: () => ({
      candidates: (options.candidates || []).map(candidate => ({ ...candidate,
        batteryCapacityKwh: candidate.batteryCapacityKwh ?? 25,
        addedPvKw: candidate.addedPvKw ?? 0,
        totalPvKw: candidate.totalPvKw ?? 10,
        id: candidate.id || `offer-candidate:${candidate.templateIds.map(encodeURIComponent).join(':')}` })),
      rejectedReasonList: [],
    }) },
    './offer-workspace-recommendation-search': recommendationSearch,
    './offer-workspace-recommendation-bounds': recommendationBounds,
    './offer-financing-v2': { PME2_RULES },
    './offer-workspace-recommendation-inputs': { recommendationInputIssues },
  };
  const exports: any = {};
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected calculation-server import: ${name}`);
      return modules[name];
    },
  });
  return {
    state,
    workspace,
    draft,
    energy: recommendationEnergy,
    baseEnergy: energy,
    calculate: (mode: 'selected' | 'recommend' = 'selected', previousRecommendation?: any) => {
      calculationMode = mode;
      return exports.calculateOfferWorkspaceOnServer(workspace, draft, null, mode,
        (completed: number, total: number) => state.progress.push([completed, total]), previousRecommendation);
    },
    loadDependencyStamp: () => exports.loadOfferCalculationDependencyStamp(workspace, draft),
    requiresPvSource: (mode: 'selected' | 'recommend' = 'selected') =>
      exports.offerWorkspaceCalculationRequiresPvSource(workspace, draft, mode),
  };
}

function recommendationFixture(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture(options);
  f.draft.targetSettlement = 'NET_BILLING';
  f.draft.saleVatMode = 'STANDARD_23';
  if (options.existingPvPowerKw === undefined && options.pvSourceRevision === undefined && options.location === undefined) {
    f.draft.existingPv = { powerKw: 10, tiltDegrees: 30, azimuthDegrees: 180, lossPercent: 12 };
    f.workspace.input.location = { latitude: 52.23, longitude: 21.01 };
    f.state.pvSourceRevision = 'recommendation-fixture-pv-source';
  }
  return f;
}

test('PME2 filtruje rekomendację przy 10 kWh i dokładnie 2× PV; zakres 2–3× obowiązuje także bez dotacji', async () => {
  for (const considerGrant of [true, false]) {
    const capacities = [9.99, 10, 16.07, 19.99, 20, 20.01];
    const f = recommendationFixture({
      candidates: capacities.map(capacity => ({ templateIds: [`battery-${capacity}`], totals: {}, missingPrices: [],
        batteryCapacityKwh: capacity, totalPvKw: 10 })),
    });
    f.draft.financing.considerGrant = considerGrant;
    const result = await f.calculate('recommend');
    assert.equal(result.recommendationSearch?.totalCandidates, 2);
    assert.deepEqual(f.state.scenarioInputs.map(input => input.draft.selectedTemplateIds[0]).sort(),
      [20, 20.01].map(capacity => `battery-${capacity}`).sort());
  }
});

test('PME2 stosuje minimum 10 kWh także przy małej PV i wyjaśnia brak dopasowania', async () => {
  for (const capacity of [9.99, 10]) {
    const f = recommendationFixture({ candidates: [{ templateIds: ['battery'], totals: {}, missingPrices: [],
      batteryCapacityKwh: capacity, totalPvKw: 4 }] });
    f.draft.existingPv.powerKw = 4;
    f.draft.financing.considerGrant = true;
    const result = await f.calculate('recommend');
    if (capacity < 10) {
      assert.equal(result.status, 'blocked');
      assert.match(result.reasons.join(' '), /PME2: minimum 10 kWh.*2× łącznej mocy PV/);
      assert.equal(f.state.scenarioInputs.length, 0);
    } else assert.equal(result.recommendationSearch?.totalCandidates, 1);
  }
});

test('PME2 przy rozbudowie liczy istniejące 4 kWp + nowe 6 kWp, a nie samą nową PV', async () => {
  const f = recommendationFixture({
    recommendationEnergyIntervals: fullYearRecommendationEnergy(1),
    templates: [{ id: 'pv', name: 'PV 6 kWp', kind: 'PV_DACH_SKOSNY', powerKw: 6 }],
    candidates: [12, 20].map(capacity => ({ templateIds: [`battery-${capacity}`, 'pv'], totals: {}, missingPrices: [],
      batteryCapacityKwh: capacity, existingPvKw: 4, addedPvKw: 6, totalPvKw: 10 })),
  });
  f.draft.existingPv.powerKw = 4;
  f.draft.pvStrategy = 'ADD_TEMPLATE';
  f.draft.calculation.addedPvTiltDegrees = 30;
  f.draft.calculation.addedPvAzimuthDegrees = 180;
  f.draft.financing.considerGrant = true;
  const result = await f.calculate('recommend');
  assert.equal(result.recommendationSearch?.totalCandidates, 1);
  assert.deepEqual(f.state.scenarioInputs.map(input => input.draft.selectedTemplateIds), [['battery-20', 'pv']]);
});

test('common recommendation input issues stop before energy, financial sources and candidate progress', async () => {
  const f = fixture();
  f.draft.pvStrategy = 'ADD_TEMPLATE';
  const result = await f.calculate('recommend');
  assert.equal(result.status, 'blocked');
  assert.equal(result.reasons.length, 3);
  assert.match(result.reasons.join(' '), /VAT sprzedaży/u);
  assert.match(result.reasons.join(' '), /nachylenie dodatkowej PV/u);
  assert.match(result.reasons.join(' '), /net-metering/u);
  assert.equal(result.recommendationSearch, undefined);
  assert.equal(f.state.energyCalls, 0);
  assert.equal(f.state.scenarioInputs.length, 0);
  assert.equal(f.state.marketQueries.length, 0);
  assert.equal(f.state.clientTariffRequests.length, 0);
  await assert.rejects(f.calculate('recommend', { recommendationSearch: { hasMore: true } }), /Nie można kontynuować rekomendacji/u);
  assert.equal(f.state.scenarioInputs.length, 0);
  assert.equal(f.state.clientTariffRequests.length, 0);
});

test('annual-only energy overlays modelled months for calculation without mutating workspace input', async () => {
  const f = fixture();
  f.workspace.measurements.availability = 'NO_FILES';
  f.workspace.input.annualConsumptionKwh = 8760;
  f.workspace.measurements.months = f.workspace.measurements.months.map((month: any) => ({ ...month, importKwh: null, exportKwh: null }));
  f.workspace.measurements.totalsImportKwh = null;
  f.baseEnergy.modelledMeasurements = {
    provenance: { kind: 'annual-consumption', source: 'Roczne zużycie · profil godzinowy RE', annualConsumptionKwh: 8760 },
    months: f.workspace.period.periodKeys.map((period: string) => ({ period, importKwh: 730, exportKwh: 0 })),
    dayProfiles: [], totalsImportKwh: 8760, totalsExportKwh: 0, intervalCount: 8760,
  };
  const result = await f.calculate('selected');
  assert.equal(result.status, 'ready');
  assert.equal(f.state.overlayCalls, 1);
  assert.ok(f.state.scenarioInputs[0].workspace.measurements.months.every((month: any) => month.importKwh === 730));
  assert.ok(f.workspace.measurements.months.every((month: any) => month.importKwh === null), 'overlay is ephemeral');
});

test('a common target bill error stops recommendations before candidate counts and keeps the real cause', async () => {
  const failure = 'Brak aktualnej reguły opłaty mocowej dla 2025-06-01.';
  const f = recommendationFixture({
    templates: [{ id: 'battery-a', name: 'Magazyn', kind: 'MAGAZYN' }],
    candidates: [{ templateIds: ['battery-a'], totals: {}, missingPrices: [], reviewReasons: ['Potwierdź zgodność PV.'] }],
    preflightScenario: () => ({ ...calculation('blocked', [failure]), warnings: ['Jawne założenie rachunku.'] }),
  });
  const result = await f.calculate('recommend');
  assert.equal(result.status, 'blocked');
  assert.deepEqual(Array.from(result.reasons), [failure]);
  assert.equal(result.recommendationSearch, undefined);
  assert.ok(result.warnings.includes('Jawne założenie rachunku.'));
  assert.equal(f.state.preflightInputs.length, 1);
  assert.equal(f.state.scenarioInputs.length, 0);
  assert.equal(f.state.progress.length, 0);
  assert.match(result.sourceDependencyStamp, /^[a-f0-9]{64}$/u);
  await assert.rejects(f.calculate('recommend', { recommendationSearch: { hasMore: true } }), /Nie można kontynuować rekomendacji.*opłaty mocowej/u);
  assert.equal(f.state.scenarioInputs.length, 0);
});

test('common bill probe isolates financing and keeps all candidate draft assumptions intact', async () => {
  const f = recommendationFixture({
    templates: [{ id: 'battery-a', name: 'Magazyn', kind: 'MAGAZYN' }],
    candidates: [{ templateIds: ['battery-a'], totals: {}, missingPrices: [], batteryCapacityKwh: 20, totalPvKw: 10 }],
    preflightScenario: input => {
      assert.equal(input.draft.financing.considerGrant, false);
      assert.equal(input.draft.financing.considerTaxRelief, false);
      assert.equal(input.draft.pvStrategy, 'KEEP_EXISTING');
      assert.equal(input.draft.selectedTemplateIds.length, 0);
      assert.equal(input.addedPvHours.size, 0);
      return calculation('ready');
    },
  });
  f.draft.financing = { considerGrant: true, considerTaxRelief: true };
  f.draft.calculation.taxEligibleCostPln = 10000;
  const original = JSON.stringify(f.draft);
  const result = await f.calculate('recommend');
  assert.equal(result.status, 'ready');
  assert.equal(JSON.stringify(f.draft), original);
  assert.equal(f.state.scenarioInputs[0].draft.financing.considerGrant, true);
  assert.equal(f.state.scenarioInputs[0].draft.financing.considerTaxRelief, true);
  assert.equal(f.state.scenarioInputs[0].draft.calculation.taxEligibleCostPln, 10000);
});

test('cold added PV is not loaded when the common target bill is blocked', async () => {
  const f = recommendationFixture({
    templates: [{ id: 'pv', name: 'PV', kind: 'PV_DACH_SKOSNY', powerKw: 5 }],
    candidates: [{ templateIds: ['pv'], totals: {}, missingPrices: [] }],
    location: { latitude: 52.23, longitude: 21.01 },
    preflightScenario: () => calculation('blocked', ['Brak reguły taryfy.']),
  });
  f.draft.pvStrategy = 'ADD_TEMPLATE';
  f.draft.existingPv.lossPercent = 12;
  f.draft.calculation.addedPvTiltDegrees = 25;
  f.draft.calculation.addedPvAzimuthDegrees = 180;
  const result = await f.calculate('recommend');
  assert.deepEqual(Array.from(result.reasons), ['Brak reguły taryfy.']);
  assert.equal(f.state.addedProfileReads, 0);
  assert.equal(f.state.scenarioInputs.length, 0);
  assert.equal(result.recommendationSearch, undefined);
});

test('actual candidate failures precede technical review messages in a blocked comparison', async () => {
  const f = recommendationFixture({
    templates: [{ id: 'battery-a', name: 'Magazyn', kind: 'MAGAZYN' }],
    candidates: [{ templateIds: ['battery-a'], totals: {}, missingPrices: [], reviewReasons: Array.from({ length: 7 }, (_, i) => 'Ocena techniczna ' + i) }],
    scenario: () => calculation('blocked', ['Niepełny profil wariantu.']),
  });
  const result = await f.calculate('recommend');
  assert.equal(result.reasons[0], 'Niepełny profil wariantu.');
});

test('rekomendacja filtruje inclusive granice 2–3× PV przed planowaniem i symulacją', async () => {
  const candidates = [
    { id: 'minimum', templateIds: ['battery-minimum'], totals: {}, missingPrices: [], batteryCapacityKwh: 20 },
    { id: 'maximum', templateIds: ['battery-maximum'], totals: {}, missingPrices: [], batteryCapacityKwh: 30 },
    { id: 'below', templateIds: ['battery-below'], totals: {}, missingPrices: [], batteryCapacityKwh: 19.999 },
    { id: 'above', templateIds: ['battery-above'], totals: {}, missingPrices: [], batteryCapacityKwh: 30.001 },
  ];
  const f = recommendationFixture({
    templates: candidates.map(candidate => ({ id: candidate.templateIds[0], name: candidate.id, kind: 'MAGAZYN' })),
    candidates,
    recommendationEnergyIntervals: fullYearRecommendationEnergy(0.5, 10),
  });
  f.draft.pvStrategy = 'KEEP_EXISTING';
  f.draft.calculation.addedPvTiltDegrees = 30;
  f.draft.calculation.addedPvAzimuthDegrees = 180;

  const result = await f.calculate('recommend');

  const dailyBounds = result.recommendationBatteryBounds;
  assert.ok(dailyBounds?.basis === 'existing_pv');
  assert.equal(dailyBounds.existingPvPowerKw, 10);
  assert.equal(dailyBounds.minimumBatteryKwhPerPvKwp, 2);
  assert.equal(dailyBounds.minimumBatteryCapacityKwh, 20);
  assert.equal(dailyBounds.maximumBatteryCapacityKwh, 30);
  assert.equal(dailyBounds.totalCandidatesBeforeFilter, 4);
  assert.equal(dailyBounds.excludedCandidates, 2);
  assert.equal(result.recommendationSearch?.totalCandidates, 2);
  assert.equal(result.recommendationSearch?.evaluatedCandidates, 2);
  assert.deepEqual(f.state.scenarioInputs.map(input => input.draft.selectedTemplateIds[0]).sort(), [
    'battery-maximum', 'battery-minimum',
  ]);
  assert.ok(result.status === 'ready', 'candidates fit by total load even though each import interval is much larger');
});

test('brak dopasowania pokazuje konkretny zakres i nie rozszerza go automatycznie', async () => {
  const f = recommendationFixture({
    templates: [{ id: 'battery-large', name: 'Duży magazyn', kind: 'MAGAZYN' }],
    candidates: [{ id: 'large', templateIds: ['battery-large'], totals: {}, missingPrices: [], batteryCapacityKwh: 41, totalPvKw: 10 }],
  });
  f.draft.pvStrategy = 'ADD_TEMPLATE';
  f.draft.calculation.addedPvTiltDegrees = 30;
  f.draft.calculation.addedPvAzimuthDegrees = 180;
  const result = await f.calculate('recommend');

  assert.equal(result.status, 'blocked');
  assert.equal(result.recommendationSearch, undefined);
  assert.equal(result.recommendationBatteryBounds?.totalCandidatesBeforeFilter, 1);
  assert.equal(result.recommendationBatteryBounds?.excludedCandidates, 1);
  assert.equal(result.recommendationBatteryBounds?.basis, 'pv_production');
  assert.ok(Math.abs(result.recommendationBatteryBounds!.minimumBatteryCapacityKwh - 20) < 1e-9);
  assert.match(result.reasons.join(' '), /Brak gotowych konfiguracji.*2–3 kWh.*łącznej mocy PV/u);
  assert.equal(f.state.scenarioInputs.length, 0, 'the out-of-range candidate was not simulated');
  assert.equal(f.state.preflightInputs.length, 1);
});

test('limit PV 3 kWh/kWp przyjmuje 48 kWh przy 16 kWp łącznej istniejącej i dodanej PV', async () => {
  const candidates = [
    { id: 'combined-boundary', templateIds: ['battery-48', 'pv-9-3'], totals: {}, missingPrices: [],
      batteryCapacityKwh: 48, existingPvKw: 9.9, addedPvKw: 6.1, totalPvKw: 9.9 + 6.1 },
    { id: 'combined-below', templateIds: ['battery-below', 'pv-9-299'], totals: {}, missingPrices: [],
      batteryCapacityKwh: 48, existingPvKw: 9.9, addedPvKw: 6.099, totalPvKw: 15.999 },
    { id: 'too-small-for-consumption', templateIds: ['battery-small'], totals: {}, missingPrices: [],
      batteryCapacityKwh: 10, existingPvKw: 9.9, addedPvKw: 100, totalPvKw: 109.9 },
  ];
  const f = recommendationFixture({
    existingPvPowerKw: 9.9,
    pvSourceRevision: 'pv-source-a',
    location: { latitude: 52.23, longitude: 21.01 },
    templates: [
      { id: 'battery-48', name: 'Bateria 48', kind: 'MAGAZYN' },
      { id: 'pv-9-3', name: 'PV 9,3', kind: 'PV_DACH_SKOSNY', powerKw: 6.1 },
      { id: 'battery-below', name: 'Bateria 48 poniżej', kind: 'MAGAZYN' },
      { id: 'pv-9-299', name: 'PV 9,299', kind: 'PV_DACH_SKOSNY', powerKw: 6.099 },
      { id: 'battery-small', name: 'Bateria za mała', kind: 'MAGAZYN' },
    ],
    candidates,
    recommendationEnergyIntervals: fullYearRecommendationEnergy(1),
  });
  f.draft.pvStrategy = 'ADD_TEMPLATE';
  f.draft.calculation.addedPvTiltDegrees = 30;
  f.draft.calculation.addedPvAzimuthDegrees = 180;

  const result = await f.calculate('recommend');

  assert.ok(result.recommendationBatteryBounds?.basis === 'pv_production');
  assert.ok(Math.abs(result.recommendationBatteryBounds.totalConsumptionKwh - 8760) < 1e-6);
  assert.equal(result.recommendationBatteryBounds?.totalCandidatesBeforeFilter, 3);
  assert.equal(result.recommendationBatteryBounds?.excludedCandidates, 2);
  assert.equal(result.recommendationPvBounds?.maximumBatteryKwhPerPvKwp, 3);
  assert.equal(result.recommendationPvBounds?.totalCandidatesBeforeFilter, 1);
  assert.equal(result.recommendationPvBounds?.excludedCandidates, 0);
  assert.equal(result.recommendationSearch?.totalCandidates, 1);
  assert.deepEqual(f.state.scenarioInputs.map(input => input.draft.selectedTemplateIds), [['battery-48', 'pv-9-3']]);
  assert.equal(f.state.addedProfileReads, 1, 'the filtered-out PV pair is not loaded for annual simulation');
  assert.equal(candidates[0].existingPvKw! + candidates[0].addedPvKw!, candidates[0].totalPvKw);
});

test('ADD_TEMPLATE wyjaśnia brak dopasowania dla produkcji poniżej 80% zużycia', async () => {
  const f = recommendationFixture({
    existingPvPowerKw: 0,
    addedPvProductionFactor: () => 0.79,
    pvSourceRevision: 'added-pv-source',
    location: { latitude: 52.23, longitude: 21.01 },
    templates: [
      { id: 'battery-large', name: 'Magazyn', kind: 'MAGAZYN' },
      { id: 'pv-small', name: 'PV 5 kWp', kind: 'PV_DACH_SKOSNY', powerKw: 5 },
    ],
    candidates: [{ id: 'large', templateIds: ['battery-large', 'pv-small'], totals: {}, missingPrices: [], batteryCapacityKwh: 15,
      totalPvKw: 5, existingPvKw: 0, addedPvKw: 5 }],
    recommendationEnergyIntervals: fullYearRecommendationEnergy(0.5),
  });
  f.draft.pvStrategy = 'ADD_TEMPLATE';
  f.draft.existingPv.lossPercent = 12;
  f.draft.calculation.addedPvTiltDegrees = 30;
  f.draft.calculation.addedPvAzimuthDegrees = 180;
  const result = await f.calculate('recommend');

  assert.equal(result.status, 'blocked');
  assert.equal(result.recommendationBatteryBounds?.excludedCandidates, 0);
  assert.equal(result.recommendationPvBounds?.totalCandidatesBeforeFilter, 1);
  assert.equal(result.recommendationPvBounds?.excludedCandidates, 1);
  assert.match(result.reasons.join(' '), /Brak gotowych konfiguracji.*80–120% zużycia/u);
  assert.equal(f.state.scenarioInputs.length, 0, 'the PV-limited candidate was not simulated');
  assert.equal(f.state.preflightInputs.length, 1);
});

test('KEEP_EXISTING bez dodatniej PV ma czytelny blokujący powód bez automatycznego obejścia', async () => {
  const f = recommendationFixture({
    existingPvPowerKw: 0,
    templates: [{ id: 'battery', name: 'Magazyn', kind: 'MAGAZYN' }],
    candidates: [{ templateIds: ['battery'], totals: {}, missingPrices: [], batteryCapacityKwh: 10, totalPvKw: 0 }],
  });
  const result = await f.calculate('recommend');

  assert.equal(result.status, 'blocked');
  assert.match(result.reasons.join(' '), /Uzupełnij dodatnią moc istniejącej instalacji PV albo wybierz rozbudowę PV/u);
  assert.equal(result.recommendationBatteryBounds, undefined);
  assert.equal(result.recommendationPvBounds, undefined);
  assert.equal(f.state.energyCalls, 0);
  assert.equal(f.state.preflightInputs.length, 0);
  assert.equal(f.state.scenarioInputs.length, 0);
});

test('KEEP_EXISTING filtruje 19 konfiguracji wyłącznie do zakresu 2–3× istniejącej PV: zostają 3 magazyny 24 kWh', async () => {
  const candidates = Array.from({ length: 19 }, (_, index) => ({
    id: `keep-candidate-${index}`,
    templateIds: [`keep-battery-${index}`],
    totals: {},
    missingPrices: [],
    batteryCapacityKwh: index < 3 ? 24 : 50,
    totalPvKw: 9.9,
    existingPvKw: 9.9,
    addedPvKw: 0,
  }));
  const f = recommendationFixture({
    existingPvPowerKw: 9.9,
    pvSourceRevision: 'existing-pv-source',
    location: { latitude: 52.23, longitude: 21.01 },
    templates: candidates.map(candidate => ({ id: candidate.templateIds[0], name: candidate.id, kind: 'MAGAZYN' })),
    candidates,
    recommendationEnergyIntervals: fullYearRecommendationEnergy(51.5953774858 / 24),
  });

  const result = await f.calculate('recommend');

  const existingPvBounds = result.recommendationBatteryBounds;
  assert.ok(existingPvBounds?.basis === 'existing_pv');
  assert.equal(existingPvBounds.existingPvPowerKw, 9.9);
  assert.equal(existingPvBounds.minimumBatteryKwhPerPvKwp, 2);
  assert.equal(existingPvBounds.maximumBatteryKwhPerPvKwp, 3);
  assert.equal(existingPvBounds.minimumBatteryCapacityKwh, 19.8);
  assert.equal(existingPvBounds.maximumBatteryCapacityKwh, 3 * 9.9);
  assert.equal('averageDailyConsumptionKwh' in existingPvBounds, false,
    'complete consumption remains required by simulation but is not used to derive KEEP bounds');
  assert.equal(result.recommendationBatteryBounds?.totalCandidatesBeforeFilter, 19);
  assert.equal(result.recommendationBatteryBounds?.excludedCandidates, 16);
  assert.equal(result.recommendationPvBounds, undefined, 'KEEP uses one PV-based capacity range, not an additional PV ceiling');
  assert.equal(result.recommendationSearch?.totalCandidates, 3);
  assert.equal(result.recommendationSearch?.evaluatedCandidates, 3);
  assert.deepEqual(Array.from(result.rankings as Array<{ templateIds: string[] }>, row => row.templateIds[0]).sort(),
    ['keep-battery-0', 'keep-battery-1', 'keep-battery-2']);
  assert.equal(f.state.scenarioInputs.length, 3);
});

test('KEEP_EXISTING przy braku dopasowań pokazuje dokładny zakres istniejącej PV bez automatycznego rozszerzania', async () => {
  const f = recommendationFixture({
    existingPvPowerKw: 9.9,
    pvSourceRevision: 'existing-pv-source',
    location: { latitude: 52.23, longitude: 21.01 },
    templates: [{ id: 'battery-50', name: 'Magazyn 50 kWh', kind: 'MAGAZYN' }],
    candidates: [{ id: 'battery-outside', templateIds: ['battery-50'], totals: {}, missingPrices: [],
      batteryCapacityKwh: 50, totalPvKw: 9.9, existingPvKw: 9.9, addedPvKw: 0 }],
  });
  const result = await f.calculate('recommend');

  assert.equal(result.status, 'blocked');
  assert.equal(result.recommendationSearch, undefined);
  assert.equal(result.recommendationBatteryBounds?.totalCandidatesBeforeFilter, 1);
  assert.equal(result.recommendationBatteryBounds?.excludedCandidates, 1);
  assert.equal(result.recommendationPvBounds, undefined);
  assert.match(result.reasons.join(' '), /Brak gotowych konfiguracji.*2–3 kWh.*łącznej mocy PV/u);
  assert.equal(f.state.scenarioInputs.length, 0, 'the out-of-range configuration was not simulated');
});

test('KEEP_EXISTING przy 9,9 kWp zachowuje tylko 24 kWh spośród 16, 24, 48 i 48,12 kWh', async () => {
  const capacities = [16, 16, 16, 24, 48, 48.12, 48.12, ...Array.from({ length: 12 }, () => 50)];
  const candidates = capacities.map((batteryCapacityKwh, index) => ({
    id: `shape-candidate-${index}`,
    templateIds: [`shape-battery-${index}`],
    totals: {},
    missingPrices: [],
    batteryCapacityKwh,
    totalPvKw: 9.9,
    existingPvKw: 9.9,
    addedPvKw: 0,
  }));
  const f = recommendationFixture({
    existingPvPowerKw: 9.9,
    pvSourceRevision: 'existing-pv-source',
    location: { latitude: 52.23, longitude: 21.01 },
    templates: candidates.map(candidate => ({ id: candidate.templateIds[0], name: candidate.id, kind: 'MAGAZYN' })),
    candidates,
  });

  const result = await f.calculate('recommend');

  assert.equal(result.recommendationBatteryBounds?.basis, 'existing_pv');
  assert.equal(result.recommendationBatteryBounds?.minimumBatteryCapacityKwh, 19.8);
  assert.equal(result.recommendationBatteryBounds?.maximumBatteryCapacityKwh, 3 * 9.9);
  assert.equal(result.recommendationBatteryBounds?.totalCandidatesBeforeFilter, 19);
  assert.equal(result.recommendationBatteryBounds?.excludedCandidates, 18);
  assert.equal(result.recommendationPvBounds, undefined);
  assert.equal(result.recommendationSearch?.totalCandidates, 1);
  assert.equal(result.recommendationSearch?.evaluatedCandidates, 1);
  assert.equal(f.state.scenarioInputs.length, 1);
  assert.deepEqual(Array.from(result.rankings as Array<{ templateIds: string[] }>, row => row.templateIds[0]).sort(),
    ['shape-battery-3']);
});

test('ADD_TEMPLATE nadal filtruje 152→128 po magazynie i 128→36 po produkcji PV', async () => {
  const candidates = Array.from({ length: 152 }, (_, index) => {
    const inPvRange = index >= 24 && index < 60;
    const pvId = inPvRange || index < 24 ? 'added-pv-16' : 'added-pv-15';
    const addedPvKw = pvId === 'added-pv-16' ? 16 : 15;
    return {
      id: `add-candidate-${String(index).padStart(3, '0')}`,
      templateIds: [`add-battery-${index}`, pvId],
      totals: {},
      missingPrices: [],
      batteryCapacityKwh: index < 24 ? 20 : 40,
      totalPvKw: addedPvKw,
      existingPvKw: 0,
      addedPvKw,
    };
  });
  const f = recommendationFixture({
    existingPvPowerKw: 0,
    addedPvProductionFactor: power => power === 16 ? 1 : 1.6,
    pvSourceRevision: 'added-pv-source',
    location: { latitude: 52.23, longitude: 21.01 },
    templates: [
      ...candidates.map(candidate => ({ id: candidate.templateIds[0], name: candidate.id, kind: 'MAGAZYN' })),
      { id: 'added-pv-16', name: 'PV 16 kWp', kind: 'PV_DACH_SKOSNY', powerKw: 16 },
      { id: 'added-pv-15', name: 'PV 15 kWp', kind: 'PV_DACH_SKOSNY', powerKw: 15 },
    ],
    candidates,
    recommendationEnergyIntervals: fullYearRecommendationEnergy(51.5953774858 / 24),
  });
  f.draft.pvStrategy = 'ADD_TEMPLATE';
  f.draft.existingPv.lossPercent = 12;
  f.draft.calculation.addedPvTiltDegrees = 30;
  f.draft.calculation.addedPvAzimuthDegrees = 180;

  const result = await f.calculate('recommend');

  assert.ok(result.recommendationBatteryBounds?.basis === 'pv_production');
  assert.ok(result.recommendationBatteryBounds.minimumPvProductionKwh > 0);
  assert.equal(result.recommendationBatteryBounds?.totalCandidatesBeforeFilter, 152);
  assert.equal(result.recommendationBatteryBounds?.excludedCandidates, 24);
  assert.equal(result.recommendationPvBounds?.pvBasis, 'existing_plus_added');
  assert.equal(result.recommendationPvBounds?.totalCandidatesBeforeFilter, 128);
  assert.equal(result.recommendationPvBounds?.excludedCandidates, 92);
  assert.equal(result.recommendationSearch?.totalCandidates, 36);
  assert.equal(result.recommendationSearch?.evaluatedCandidates, 36);
  assert.equal(result.rankings.length, 36);
  assert.equal(f.state.scenarioInputs.length, 36);
  assert.equal(f.state.addedProfileReads, 2);
});

test('brak load lub niepełny workspace period blokuje tylko rekomendację i odrzuca kontynuację bez zmiany poprzedniego wyniku', async () => {
  const invalidLoad = fullYearRecommendationEnergy();
  invalidLoad[10].loadKwh = null;
  const blockedFixture = recommendationFixture({
    recommendationEnergyIntervals: invalidLoad,
    templates: [{ id: 'battery', name: 'Magazyn', kind: 'MAGAZYN' }],
    candidates: [{ templateIds: ['battery'], totals: {}, missingPrices: [], batteryCapacityKwh: 10 }],
  });
  const blocked = await blockedFixture.calculate('recommend');
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.reasons.join(' '), /Nie można wyznaczyć zakresu pojemności magazynu/u);
  assert.equal(blocked.recommendationBatteryBounds, undefined);
  assert.equal(blocked.recommendationSearch, undefined);
  assert.equal(blockedFixture.state.scenarioInputs.length, 0);

  const candidates = Array.from({ length: 64 }, (_, index) => ({
    id: `candidate-${index}`, templateIds: [`battery-${index}`], totals: {}, missingPrices: [], batteryCapacityKwh: 25,
  }));
  const continuationFixture = recommendationFixture({
    templates: candidates.map(candidate => ({ id: candidate.templateIds[0], name: candidate.id, kind: 'MAGAZYN' })),
    candidates,
  });
  const first = await continuationFixture.calculate('recommend');
  assert.equal(first.recommendationSearch?.hasMore, true);
  const beforeContinuation = JSON.stringify(first);
  continuationFixture.energy.intervals = continuationFixture.energy.intervals.slice(24);
  await assert.rejects(continuationFixture.calculate('recommend', first), /Nie można kontynuować rekomendacji:.*kompletnego okresu/u);
  assert.equal(JSON.stringify(first), beforeContinuation);
  assert.equal(continuationFixture.state.scenarioInputs.length, 50);
});

test('wybrany wariant pozostaje policzalny poza zakresem rekomendacji', async () => {
  const f = fixture({ templates: [{ id: 'battery-large', name: 'Duży magazyn', kind: 'MAGAZYN' }] });
  f.draft.selectedTemplateIds = ['battery-large'];
  const result = await f.calculate('selected');

  assert.equal(result.status, 'ready');
  assert.equal(result.recommendationBatteryBounds, undefined);
  assert.deepEqual(f.state.scenarioInputs.map(input => input.draft.selectedTemplateIds), [['battery-large']]);
});

test('null RDN market price stops selected calculation before scenario pricing', async () => {
  const f = fixture({ targetSellMethod: 'rdn', rdnRows: marketRows(2) });

  const result = await f.calculate();
  assert.equal(result.status, 'blocked');
  assert.ok(result.reasons.includes('Nieprawidłowy lub zduplikowany interwał ceny rynkowej.'));
  assert.equal(f.state.marketQueries.length, 1);
  assert.match(f.state.marketQueries[0], /powerplantRDN/);
  assert.equal(f.state.scenarioInputs.length, 0);
});

test('fixed-price tariffs do not fetch RDN market data', async () => {
  const f = fixture({ baselineSellMethod: 'fixed', targetSellMethod: 'fixed' });

  const result = await f.calculate();
  assert.equal(result.status, 'ready');
  assert.equal(f.state.marketQueries.length, 0);
  assert.equal(f.state.scenarioInputs.length, 1);
  assert.equal(f.state.scenarioInputs[0].rdnPricesNet.size, 0);
});

test('baseline history issues remain explicit while target tariff calculation and dependency stamp proceed', async () => {
  const issue = { date: '2026-10-01', message: 'Brak ceny obecnej taryfy.' };
  const f = fixture({ baselineIssues: [issue] });

  const result = await f.calculate();
  assert.equal(result.status, 'ready');
  assert.equal(f.state.targetCatalogCalls, 1);
  assert.equal(f.state.scenarioInputs.length, 1);
  const baseline = f.state.scenarioInputs[0].baselineHistory;
  assert.equal(baseline.strict, true);
  assert.equal(Object.keys(baseline.byDate).length, 0);
  assert.equal(baseline.issues[0].message, `${issue.date}: ${issue.message}`);
  assert.ok(result.warnings.includes(`${issue.date}: ${issue.message}`));
  assert.equal(f.state.scenarioInputs[0].targetHistory.tariffs.scenario.id, 2);
  assert.match(result.sourceDependencyStamp, /^[a-f0-9]{64}$/);
  assert.match(await f.loadDependencyStamp(), /^[a-f0-9]{64}$/);
});

test('added-PV source fingerprint is shared by calculation and dependency polling', async () => {
  const f = fixture({
    templates: [{ id: 'possible-pv', name: 'PV', kind: 'PV_DACH_SKOSNY', powerKw: 5 }],
    location: { latitude: 52.23, longitude: 21.01 }, pvSourceRevision: 'pv-source-a',
    energyDates: dependencies.offerCalculationPeriodHours(Array.from({ length: 12 }, (_, index) => ({
      period: `2026-${String(index + 1).padStart(2, '0')}`,
    })))!,
  });
  f.draft.selectedTemplateIds = ['possible-pv'];
  f.draft.existingPv.lossPercent = 12;
  f.draft.calculation.addedPvTiltDegrees = 30;
  f.draft.calculation.addedPvAzimuthDegrees = 180;
  const result = await f.calculate();
  const polledStamp = await f.loadDependencyStamp();
  assert.equal(result.sourceDependencyStamp, polledStamp);
  assert.match(polledStamp || '', /^[a-f0-9]{64}$/u);

  f.state.pvSourceRevision = 'pv-source-b';
  const changedStamp = await f.loadDependencyStamp();
  assert.notEqual(changedStamp, polledStamp);
});

test('existing PV contributes its source fingerprint without any PV templates', async () => {
  const location = { latitude: 52.23, longitude: 21.01 };
  const energyDates = dependencies.offerCalculationPeriodHours(Array.from({ length: 12 }, (_, index) => ({
    period: `2026-${String(index + 1).padStart(2, '0')}`,
  })))!;
  const existingPv = fixture({ location, pvSourceRevision: 'pv-source-a', existingPvPowerKw: 4.5, energyDates });
  const result = await existingPv.calculate();
  assert.equal(result.status, 'ready');
  assert.deepEqual(existingPv.state.scenarioInputs[0].workspace.templates, []);
  const existingPvPolledStamp = await existingPv.loadDependencyStamp();
  assert.equal(existingPvPolledStamp, result.sourceDependencyStamp,
    `the exact existing PV input must select the same source stamp used by polling; polled=${existingPvPolledStamp}, result=${result.sourceDependencyStamp}`);

  const noExistingPv = fixture({ location, pvSourceRevision: 'pv-source-a', existingPvPowerKw: 0, energyDates });
  const noPvResult = await noExistingPv.calculate();
  assert.notEqual(noPvResult.sourceDependencyStamp, result.sourceDependencyStamp,
    'without existing PV and without PV templates, the PV source is not a calculation dependency');
});

test('confirmed invoice factor is PPE/date scoped to the baseline and changes calculation dependency identity', async () => {
  const baseOptions = {
    existingPvPowerKw: 13,
    pvSourceRevision: 'pv-source-1',
    location: { latitude: 52.23, longitude: 21.01 },
    ppeNumber: 'PPE 1',
  };
  const f = fixture({ ...baseOptions, invoiceFactor: {
    status: 'selected', factor: 0.8, sourceRevision: 'a'.repeat(64), invoicePeriods: ['2025-04-01–2026-03-31'],
  } });
  f.draft.targetSettlement = 'NET_BILLING';
  const result = await f.calculate();

  assert.equal(f.state.invoiceFactorReads, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.invoiceFactorInputs[0])), {
    projectId: 'project-1', clientId: 'client-1', ppeNumber: 'PPE 1',
    period: { startMonth: '2026-01', endDate: '2026-12-31' },
  });
  assert.equal(f.state.scenarioInputs[0].baselineNetMeteringFactor.factor, 0.8);
  assert.equal(f.state.scenarioInputs[0].baselineNetMeteringFactorIssue, null);
  assert.match(result.sourceDependencyStamp, /^[a-f0-9]{64}$/);

  const unknownPower = fixture({
    existingPvPowerKw: null,
    ppeNumber: 'PPE 1',
    invoiceFactor: { status: 'selected', factor: 0.8, sourceRevision: 'c'.repeat(64), invoicePeriods: ['2025-04-01–2026-03-31'] },
  });
  await unknownPower.calculate();
  assert.equal(unknownPower.state.invoiceFactorReads, 1,
    'a confirmed invoice remains usable when existing PV kWp is unknown');
  assert.equal(unknownPower.state.scenarioInputs[0].baselineNetMeteringFactor.factor, 0.8);

  const changed = fixture({ ...baseOptions, invoiceFactor: {
    status: 'selected', factor: 0.7, sourceRevision: 'b'.repeat(64), invoicePeriods: ['2025-04-01–2026-03-31'],
  } });
  changed.draft.targetSettlement = 'NET_BILLING';
  assert.notEqual(await changed.loadDependencyStamp(), await f.loadDependencyStamp(),
    'invoice evidence changes force a fresh explicit calculation lookup');

  const netBillingBaseline = fixture({ ...baseOptions, invoiceFactor: {
    status: 'selected', factor: 0.8, sourceRevision: 'a'.repeat(64), invoicePeriods: ['2025-04-01–2026-03-31'],
  } });
  netBillingBaseline.draft.currentSettlement = 'NET_BILLING';
  netBillingBaseline.draft.targetSettlement = 'NET_BILLING';
  await netBillingBaseline.calculate();
  assert.equal(netBillingBaseline.state.invoiceFactorReads, 0,
    'a baseline that is already NET_BILLING does not read a net-metering factor');
  assert.equal(netBillingBaseline.state.scenarioInputs[0].baselineNetMeteringFactor, null);
});

test('added PV is a source dependency only when selected or present in recommendation candidates', () => {
  const f = fixture({
    location: { latitude: 52.23, longitude: 21.01 },
    templates: [{ id: 'pv-1', name: 'PV', kind: 'PV_DACH_SKOSNY', powerKw: 5 }],
    candidates: [{ templateIds: ['battery-1', 'pv-1'], totals: {}, missingPrices: [] }],
  });
  f.draft.pvStrategy = 'ADD_TEMPLATE';
  f.draft.existingPv = { powerKw: 0, tiltDegrees: null, azimuthDegrees: null, lossPercent: 12 };
  f.draft.calculation.addedPvTiltDegrees = 30;
  f.draft.calculation.addedPvAzimuthDegrees = 180;
  f.draft.selectedTemplateIds = ['pv-1'];

  assert.equal(f.requiresPvSource('selected'), true);
  f.draft.selectedTemplateIds = [];
  assert.equal(f.requiresPvSource('selected'), false, 'unselected workspace PV templates are not dependencies');
  assert.equal(f.requiresPvSource('recommend'), true);

  const noEligiblePv = fixture({
    location: { latitude: 52.23, longitude: 21.01 },
    templates: [{ id: 'pv-1', name: 'PV', kind: 'PV_DACH_SKOSNY', powerKw: 5 }],
  });
  noEligiblePv.draft.pvStrategy = 'ADD_TEMPLATE';
  noEligiblePv.draft.existingPv = { powerKw: 0, tiltDegrees: null, azimuthDegrees: null, lossPercent: 12 };
  noEligiblePv.draft.calculation.addedPvTiltDegrees = 30;
  noEligiblePv.draft.calculation.addedPvAzimuthDegrees = 180;
  assert.equal(noEligiblePv.requiresPvSource('recommend'), false, 'PV templates rejected by enumeration are not source dependencies');
});

test('selected calculation profiles the confirmed effective PV power; recommendation drops per-offer edits', async () => {
  const pvTemplate = {
    id: 'pv-add', name: 'PV', kind: 'PV_DACH_SKOSNY', powerKw: 2, capacityKwh: null,
    items: [{ id: 'panel', position: 1, description: 'Moduł PV', quantity: 1, role: 'MAIN_EQUIPMENT',
      supplyMode: 'ONREVOLT_SUPPLIED', pricingMode: 'INDIVIDUAL', operatingCostBasis: 'PER_UNIT',
      unitPurchaseNet: 1000, purchaseVatRate: 0.23, operatingCostNet: 0, marginRate: 0.2, saleVatRate: 0.23,
      isOptional: false, requiresReview: false, productId: null, product: null }],
  };
  const confirmedTemplate = { ...pvTemplate, items: [{ ...pvTemplate.items[0], quantity: 2 }] };
  const configurationEdits = [{ templateId: 'pv-add', items: [{ itemId: 'panel', quantity: 2 }], technical: {
    powerKw: 3, capacityKwh: null, quantityFingerprint: configurationEnergyQuantityFingerprint(confirmedTemplate),
  } }];
  const selected = fixture({ templates: [pvTemplate], location: { latitude: 52.23, longitude: 21.01 }, pvSourceRevision: 'pv-source-stable' });
  selected.draft.selectedTemplateIds = ['pv-add'];
  selected.draft.pvStrategy = 'ADD_TEMPLATE';
  selected.draft.existingPv.lossPercent = 12;
  selected.draft.calculation.addedPvTiltDegrees = 30;
  selected.draft.calculation.addedPvAzimuthDegrees = 180;
  selected.draft.configurationEdits = configurationEdits;
  await selected.calculate('selected');
  assert.equal(selected.state.profileReads[0]?.powerKw, 3);
  assert.equal(selected.state.scenarioInputs[0]?.draft.configurationEdits[0]?.technical.powerKw, 3);

  const recommendation = fixture({ templates: [pvTemplate], candidates: [], location: { latitude: 52.23, longitude: 21.01 },
    pvSourceRevision: 'pv-source-stable', existingPvPowerKw: 5 });
  recommendation.draft.pvStrategy = 'ADD_TEMPLATE';
  recommendation.draft.targetSettlement = 'NET_BILLING';
  recommendation.draft.calculation.addedPvTiltDegrees = 30;
  recommendation.draft.calculation.addedPvAzimuthDegrees = 180;
  recommendation.draft.configurationEdits = configurationEdits;
  await recommendation.calculate('recommend');
  assert.equal(recommendation.state.preflightInputs[0]?.draft.configurationEdits, undefined);
  assert.equal(recommendation.state.profileReads.length, 0);
});

test('PV source changing after a candidate profile is read aborts the calculation', async () => {
  const f = fixture({
    templates: [{ id: 'pv-1', name: 'PV', kind: 'PV_DACH_SKOSNY', powerKw: 5 }],
    location: { latitude: 52.23, longitude: 21.01 },
    pvSourceRevision: 'pv-source-a', pvSourceRevisionAfterProfile: 'pv-source-b',
  });
  f.draft.selectedTemplateIds = ['pv-1'];
  f.draft.existingPv.lossPercent = 12;
  f.draft.calculation.addedPvTiltDegrees = 30;
  f.draft.calculation.addedPvAzimuthDegrees = 180;

  await assert.rejects(f.calculate(), /Źródło PV zmieniło się podczas obliczania/);
  assert.equal(f.state.scenarioInputs.length, 0, 'a result is not calculated from a changed source revision');
});

test('missing project baseline general tariff does not substitute a tariff or block target calculation', async () => {
  const f = fixture({ baselineMissing: true });

  const result = await f.calculate();
  assert.equal(result.status, 'ready');
  assert.equal(f.state.targetCatalogCalls, 1);
  assert.equal(f.state.scenarioInputs.length, 1);
  const baseline = f.state.scenarioInputs[0].baselineHistory;
  assert.equal(baseline.strict, true);
  assert.equal(Object.keys(baseline.byDate).length, 0);
  assert.ok(baseline.issues[0].message.includes('Nie wybrano obecnej taryfy projektu'));
  assert.ok(result.warnings.some(warning => warning.includes('Nie wybrano obecnej taryfy projektu')));
  assert.equal(f.state.scenarioInputs[0].targetHistory.tariffs.scenario.id, 2);
  assert.match(result.sourceDependencyStamp, /^[a-f0-9]{64}$/);
  assert.match(await f.loadDependencyStamp(), /^[a-f0-9]{64}$/);
});

test('same-tariff estimate fills only a confirmed historical price gap and enters the dependency identity', async () => {
  const gapDate = '2026-10-02';
  const baseline = baselineCatalogTariff(11, 0.5);
  const months = Array.from({ length: 12 }, (_, index) => ({ period: `2026-${String(index + 1).padStart(2, '0')}` }));
  const fullYearHours = dependencies.offerCalculationPeriodHours(months)!;
  const allDates = [...new Set(fullYearHours.map(hour => localTime.format(new Date(hour)).slice(0, 10)))];
  assert.ok(allDates.includes(gapDate), `The Warsaw calculation period must include ${gapDate}.`);
  const createFixture = (currentPrice: number) => fixture({
    energyDates: fullYearHours,
    baselineByDate: Object.fromEntries(allDates.filter(date => date !== gapDate).map(date => [date, 'baseline'])),
    baselineTariff: baseline,
    baselineIssues: [{ date: gapDate, message: `Wymaga uzupełnienia: brak jednoznacznych cen dla ${gapDate}` }],
    profilePeriods: [baselinePriceGapPeriod(gapDate, '2026-10-03')],
    currentBaselineTariff: baselineCatalogTariff(11, currentPrice),
    scenario: () => calculation('ready'),
  });
  const first = createFixture(0.8);
  const result = await first.calculate();
  const resolvedHistory = first.state.completedHistories[0];
  const resolvedTariff = resolvedHistory.byDate[gapDate];

  assert.ok(resolvedTariff, JSON.stringify({ gapDate, issues: resolvedHistory.issues,
    octoberDates: Object.keys(resolvedHistory.byDate).filter(date => date.startsWith('2026-10')) }));
  assert.equal(resolvedTariff.tariff_id, 11);
  assert.equal(resolvedTariff.pricing.tariffStorage.variable[0].net, 0.8);
  assert.deepEqual(resolvedHistory.issues.map((issue: { date: string }) => issue.date), [gapDate],
    'the shared helper leaves original history issues intact');
  assert.equal(first.state.scenarioInputs[0].baselineHistory.byDate[gapDate]?.tariff_id, 11,
    JSON.stringify({ warnings: result.warnings, history: first.state.scenarioInputs[0].baselineHistory }));
  assert.deepEqual(first.state.scenarioInputs[0].baselineHistory.issues, [],
    'only the recovered issue is cleared from the effective history');
  assert.ok(result.warnings.some(warning => warning.includes('użyto bieżącego cennika dokładnie tej samej taryfy')));
  assert.deepEqual(first.state.clientTariffRequests.filter(request => request.action === 'catalog' && request.osdId === 4)
    .map(request => [request.osdId, request.tariffId]), [[4, 11]]);
  assert.equal(result.pricesAsOf, '2026-10-01');
  assert.match(result.sourceDependencyStamp, /^[a-f0-9]{64}$/);
  assert.equal(await first.loadDependencyStamp(), result.sourceDependencyStamp,
    'the completed calculation and freshness loader must hash the same effective history');

  const changedCatalog = createFixture(0.81);
  const changedResult = await changedCatalog.calculate();
  assert.notEqual(changedResult.sourceDependencyStamp, result.sourceDependencyStamp,
    'the dependency hash must include the effective recovered tariff history');
});

test('partial completion preserves tariff conflicts while clearing only recovered missing-price issues', async () => {
  const gapDate = '2026-10-02', conflictDate = '2026-10-03', unknownDate = '2026-10-04';
  const f = fixture({
    energyDates: ['2026-10-01', gapDate, conflictDate, unknownDate],
    baselineByDate: { '2026-10-01': 'baseline' },
    baselineTariff: baselineCatalogTariff(11, 0.5),
    baselineIssues: [
      { date: gapDate, message: `Wymaga uzupełnienia: brak jednoznacznych cen dla ${gapDate}` },
      { date: conflictDate, message: `Konflikt ENEA dla ${conflictDate}` },
      { date: unknownDate, message: `Wymaga uzupełnienia: brak jednoznacznych cen dla ${unknownDate}` },
    ],
    profilePeriods: [baselinePriceGapPeriod(gapDate, conflictDate)],
    currentBaselineTariff: baselineCatalogTariff(11, 0.8),
    scenario: () => calculation('ready'),
  });

  const result = await f.calculate();
  const resolvedHistory = f.state.completedHistories[0];
  assert.equal(resolvedHistory.byDate[gapDate].tariff_id, 11);
  assert.equal(resolvedHistory.byDate[conflictDate], undefined);
  assert.equal(resolvedHistory.byDate[unknownDate], undefined);
  assert.deepEqual(resolvedHistory.issues.map((issue: { date: string }) => issue.date), [gapDate, conflictDate, unknownDate],
    'the shared helper preserves all original issues');
  assert.ok(!result.warnings.some(warning => warning.startsWith(`${gapDate}: Wymaga uzupełnienia`)));
  assert.ok(result.warnings.some(warning => warning.includes('Konflikt ENEA')));
  assert.ok(result.warnings.some(warning => warning.includes('nie zastosowano ceny szacunkowej')));
  assert.ok(result.warnings.some(warning => warning.includes('brak jednoznacznej datowanej tożsamości')));
  assert.deepEqual(f.state.clientTariffRequests.filter(request => request.action === 'catalog' && request.osdId === 4)
    .map(request => [request.osdId, request.tariffId]), [[4, 11]], 'conflicting dates must not trigger a tariff lookup');
  assert.equal(result.pricesAsOf, '2026-10-01');
  assert.match(result.sourceDependencyStamp, /^[a-f0-9]{64}$/);
});

test('a failed candidate does not erase a recommendation from successfully computed candidates', async () => {
  const f = recommendationFixture({
    templates: [
      { id: 'battery-a', name: 'Magazyn A', kind: 'MAGAZYN' },
      { id: 'battery-b', name: 'Magazyn B', kind: 'MAGAZYN' },
    ],
    candidates: [
      { templateIds: ['battery-a'], totals: {}, missingPrices: [] },
      { templateIds: ['battery-b'], totals: {}, missingPrices: [] },
    ],
    scenario: input => input.draft.selectedTemplateIds[0] === 'battery-a'
      ? calculation('ready') : calculation('blocked', ['Brak kompletnego profilu dla Magazynu B.']),
  });

  const result = await f.calculate('recommend');
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.recommendedTemplateIds, ['battery-a']);
  assert.equal(result.rankings.length, 1);
  assert.equal(result.rankings[0].annualSavingsPln, 80);
  assert.equal(result.rankings[0].recommendationEligible, true);
  assert.ok(result.warnings.some(warning => warning.includes('Porównanie niepełne')));
  assert.ok(result.warnings.includes('Brak kompletnego profilu dla Magazynu B.'));
});

test('blocked recommendation aggregate retains source identity and the candidate profile reason', async () => {
  const candidates = Array.from({ length: 18 }, (_, index) => ({
    id: `candidate-${index}`,
    templateIds: [`battery-${index}`],
    totals: {},
    missingPrices: [],
  }));
  const f = recommendationFixture({
    templates: candidates.map(({ id }, index) => ({ id: id!, name: `Magazyn ${index}`, kind: 'MAGAZYN' })),
    candidates,
    scenario: () => calculation('blocked', ['Brak pełnego godzinowego profilu energii do symulacji.']),
  });

  const result = await f.calculate('recommend');
  assert.equal(result.status, 'blocked');
  assert.equal(f.state.scenarioInputs.length, 18);
  assert.ok(result.reasons.includes('Brak pełnego godzinowego profilu energii do symulacji.'));
  assert.equal(result.pricesAsOf, '2026-10-01');
  assert.match(result.sourceDependencyStamp, /^[a-f0-9]{64}$/);
});

test('missing billing cycle is delegated to partial scenario calculation instead of short-circuiting the server', async () => {
  const f = fixture({ billingCycleMonths: null, scenario: () => calculation('blocked', ['Brak jawnego cyklu rozliczeniowego.']) });

  const result = await f.calculate();
  assert.equal(result.status, 'blocked');
  assert.ok(result.reasons.includes('Brak jawnego cyklu rozliczeniowego.'));
  assert.equal(f.state.scenarioInputs.length, 1);
});

test('diagnostic storage output is not promoted to an economic recommendation', async () => {
  const f = recommendationFixture({
    templates: [{ id: 'battery', name: 'Magazyn', kind: 'MAGAZYN' }],
    candidates: [{ templateIds: ['battery'], totals: {}, missingPrices: [] }],
    scenario: () => ({ ...calculation('ready'), recommendationEligible: false,
      recommendationReasons: ['Wymagana walidacja symulacji.'] }),
  });
  const result = await f.calculate('recommend');
  assert.equal(result.status, 'ready');
  assert.equal(result.recommendedTemplateIds, null);
  assert.equal(result.rankings.length, 1);
  assert.equal(result.rankings[0].annualSavingsPln, 80);
  assert.equal(result.rankings[0].recommendationEligible, false);
  assert.equal(result.rankings[0].reasons[0], 'Wymagana walidacja symulacji.');
  assert.ok(result.warnings.includes('Wymagana walidacja symulacji.'));
  assert.ok(result.warnings.includes('Wyniki wariantu są diagnostyczne; rekomendacja i czas zwrotu pozostają wyłączone.'));
});

test('a candidate with unresolved catalog price remains in the diagnostic comparison without a recommendation', async () => {
  const f = recommendationFixture({
    templates: [{ id: 'battery', name: 'Magazyn', kind: 'MAGAZYN' }],
    candidates: [{ templateIds: ['battery'], totals: null, missingPrices: ['Magazyn / BOM: Tryb VAT wymaga przeglądu'],
      requiresReview: true, reviewReasons: ['Pozycja wymaga przeglądu VAT.'] }],
    scenario: () => calculation('ready'),
  });

  const result = await f.calculate('recommend');
  assert.equal(result.status, 'ready');
  assert.equal(result.rankings.length, 1);
  assert.equal(result.rankings[0].annualSavingsPln, 80);
  assert.equal(result.rankings[0].recommendationEligible, false);
  assert.ok(result.rankings[0].reasons.some(reason => reason.includes('przeglądu VAT')));
  assert.equal(result.recommendedTemplateIds, null);
  assert.equal(result.recommendationEligible, false);
  assert.ok(result.recommendationReasons?.some(reason => reason.includes('przeglądu VAT')));
});

test('estimated ranking selects the shortest finite forecast with cost and id tie-breaks without promoting eligibility', async () => {
  const ids = ['estimate-c', 'estimate-b', 'estimate-same-payback-cheaper', 'estimate-fast-missing-price', 'estimate-fast-no-totals', 'estimate-slower-cheap', 'diagnostic'];
  const f = recommendationFixture({
    templates: ids.map(id => ({ id, name: id, kind: 'MAGAZYN' })),
    candidates: [
      { id: 'candidate-id-a', templateIds: ['estimate-c'], totals: {}, missingPrices: [], requiresReview: true, reviewReasons: ['Nieznana kompatybilność istniejącego falownika.'] },
      { id: 'candidate-id-z', templateIds: ['estimate-b'], totals: {}, missingPrices: [], requiresReview: true, reviewReasons: ['Nieznana kompatybilność istniejącego falownika.'] },
      { id: 'candidate-id-zz', templateIds: ['estimate-same-payback-cheaper'], totals: {}, missingPrices: [], requiresReview: true, reviewReasons: ['Nieznana kompatybilność istniejącego falownika.'] },
      { id: 'candidate-missing-price', templateIds: ['estimate-fast-missing-price'], totals: {}, missingPrices: ['Brak ceny katalogowej.'], requiresReview: true },
      { id: 'candidate-no-totals', templateIds: ['estimate-fast-no-totals'], totals: null, missingPrices: [], requiresReview: true },
      { id: 'candidate-slower', templateIds: ['estimate-slower-cheap'], totals: {}, missingPrices: [], requiresReview: true },
      { id: 'candidate-diagnostic', templateIds: ['diagnostic'], totals: {}, missingPrices: [] },
    ],
    scenario: input => {
      const id = input.draft.selectedTemplateIds[0];
      const settings: Record<string, { cost: number; payback: number | null; savings: number }> = {
        'estimate-c': { cost: 70, payback: 3.5, savings: 80 },
        'estimate-b': { cost: 70, payback: 3.5, savings: 80 },
        'estimate-same-payback-cheaper': { cost: 60, payback: 3.5, savings: 80 },
        'estimate-fast-missing-price': { cost: 1, payback: 0.1, savings: 900 },
        'estimate-fast-no-totals': { cost: 2, payback: 0.2, savings: 700 },
        'estimate-slower-cheap': { cost: 5, payback: 4, savings: 80 },
        diagnostic: { cost: 500, payback: null, savings: 500 },
      };
      const selected = settings[id];
      return {
        ...calculation('ready'),
        recommendationEligible: false,
        paybackYears: null,
        estimatedPaybackYears: selected.payback,
        costAfterFinancingPln: selected.cost,
        hardwareAnnualSavingsPln: selected.savings,
        recommendationReasons: id === 'estimate-same-payback-cheaper'
          ? ['Symulacja diagnostyczna: rekomendacja i czas zwrotu pozostają wyłączone.'] : [],
      };
    },
  });

  const result = await f.calculate('recommend');
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.estimatedRecommendedTemplateIds, ['estimate-same-payback-cheaper']);
  assert.equal(result.recommendedTemplateIds, null);
  assert.equal(result.recommendationEligible, false);
  assert.equal(result.paybackYears, null);
  assert.equal(result.estimatedPaybackYears, 3.5);
  assert.equal(result.costAfterFinancingPln, 60);
  assert.deepEqual(Array.from(result.rankings as Array<{ templateIds: string[] }>).slice(0, 4).map(row => row.templateIds[0]), [
    'estimate-same-payback-cheaper', 'estimate-c', 'estimate-b', 'estimate-slower-cheap',
  ]);
  assert.equal(result.rankings.find(row => row.templateIds[0] === 'estimate-same-payback-cheaper')?.costAfterFinancingPln, 60);
  assert.ok(result.rankings.find(row => row.templateIds[0] === 'estimate-same-payback-cheaper')?.reasons?.includes('Nieznana kompatybilność istniejącego falownika.'));
  assert.equal(result.rankings.find(row => row.templateIds[0] === 'estimate-fast-missing-price')?.estimatedPaybackYears, null);
  assert.equal(result.rankings.find(row => row.templateIds[0] === 'estimate-fast-no-totals')?.estimatedPaybackYears, null);
  assert.ok(result.rankings.find(row => row.templateIds[0] === 'estimate-slower-cheap')?.reasons?.some(reason => reason.includes('wyłącznie szacunkowy')));
  assert.ok(result.warnings.some(warning => warning.includes('wymaga weryfikacji')));
  assert.ok(!result.warnings.some(warning => /bez czasu zwrotu|czas zwrotu pozostają wyłączone/iu.test(warning)));
  assert.ok(!result.rankings.find(row => row.templateIds[0] === 'estimate-same-payback-cheaper')?.reasons?.some(reason => /bez czasu zwrotu|czas zwrotu pozostają wyłączone/iu.test(reason)));
});

test('strict recommendation ranks ahead of a faster estimate and remains the selected result', async () => {
  const f = recommendationFixture({
    templates: [
      { id: 'strict', name: 'Strict', kind: 'MAGAZYN' },
      { id: 'estimate', name: 'Estimate', kind: 'MAGAZYN' },
      { id: 'diagnostic', name: 'Diagnostic', kind: 'MAGAZYN' },
    ],
    candidates: [
      { templateIds: ['estimate'], totals: {}, missingPrices: [], requiresReview: true, reviewReasons: ['Nieznana kompatybilność.'] },
      { templateIds: ['diagnostic'], totals: {}, missingPrices: [] },
      { templateIds: ['strict'], totals: {}, missingPrices: [] },
    ],
    scenario: input => {
      const id = input.draft.selectedTemplateIds[0];
      if (id === 'strict') return { ...calculation('ready'), paybackYears: 6, estimatedPaybackYears: 8 };
      if (id === 'estimate') return { ...calculation('ready'), recommendationEligible: false, paybackYears: null, estimatedPaybackYears: 1.5 };
      return { ...calculation('ready'), recommendationEligible: false, paybackYears: null, estimatedPaybackYears: null, hardwareAnnualSavingsPln: 999 };
    },
  });

  const result = await f.calculate('recommend');
  assert.deepEqual(Array.from(result.rankings as Array<{ templateIds: string[] }>, row => row.templateIds[0]), ['strict', 'estimate', 'diagnostic']);
  assert.deepEqual(result.recommendedTemplateIds, ['strict']);
  assert.equal(result.estimatedRecommendedTemplateIds, null);
  assert.equal(result.recommendationEligible, true);
});

test('more than fifty candidates return the best partial result and continue without repeats or regression', async () => {
  const allCandidates = Array.from({ length: 64 }, (_, index) => ({
    id: `candidate-${String(index).padStart(2, '0')}`,
    templateIds: [`battery-${index}`],
    totals: {},
    missingPrices: [],
    totalPvKw: 10,
    addedPvKw: 0,
    batteryCapacityKwh: 20 + Math.floor(index / 8),
    batteryPowerKw: 2 + index % 3,
  }));
  const f = recommendationFixture({
    templates: allCandidates.map(candidate => ({ id: candidate.templateIds[0], name: candidate.id, kind: 'MAGAZYN' })),
    candidates: allCandidates,
    scenario: input => {
      const index = Number(input.draft.selectedTemplateIds[0].slice('battery-'.length));
      const value = calculation('ready');
      value.paybackYears = index === 61 ? 0.25 : index === 40 ? 1.5 : 2 + index % 12;
      value.estimatedPaybackYears = 1 + index % 5;
      value.costAfterFinancingPln = 1000 + index;
      return value;
    },
  });

  const first = await f.calculate('recommend');
  assert.equal(first.status, 'ready');
  assert.ok(first.recommendationSearch);
  assert.equal(first.recommendationSearch.totalCandidates, 64);
  assert.equal(first.recommendationBatteryBounds?.totalCandidatesBeforeFilter, 64);
  assert.equal(first.recommendationBatteryBounds?.excludedCandidates, 0);
  assert.equal(first.recommendationBatteryBounds?.basis, 'existing_pv');
  assert.equal(first.recommendationPvBounds, undefined);
  assert.equal(first.recommendationSearch.evaluatedCandidates, 50);
  assert.equal(first.recommendationSearch.batchEvaluated, 50);
  assert.equal(first.recommendationSearch.batchNumber, 1);
  assert.equal(first.recommendationSearch.hasMore, true);
  assert.equal(first.recommendationSearch.phase, 'refine');
  assert.ok(first.recommendedTemplateIds, 'a partial run retains the best eligible candidate found');
  assert.ok(!first.recommendationSearch.evaluatedCandidateIds.includes('candidate-61'), 'the constructed late optimum is outside the first batch');
  assert.equal(f.state.scenarioInputs.length, 50);

  const firstJson = JSON.stringify(first);
  const second = await f.calculate('recommend', first);
  assert.equal(JSON.stringify(first), firstJson, 'continuation must not mutate its previous snapshot');
  assert.equal(second.status, 'ready');
  assert.equal(second.recommendationSearch?.evaluatedCandidates, 64);
  assert.equal(second.recommendationBatteryBounds?.totalCandidatesBeforeFilter, 64);
  assert.equal(second.recommendationPvBounds, undefined);
  assert.equal(second.recommendationSearch?.batchEvaluated, 14);
  assert.equal(second.recommendationSearch?.batchNumber, 2);
  assert.equal(second.recommendationSearch?.hasMore, false);
  assert.equal(second.recommendationSearch?.phase, 'complete');
  assert.deepEqual(second.recommendedTemplateIds, ['battery-61'], 'the later non-unimodal optimum replaces the partial winner');
  assert.equal(second.paybackYears, 0.25);
  const firstVisited = new Set(first.recommendationSearch.evaluatedCandidateIds);
  assert.ok(second.recommendationSearch?.evaluatedCandidateIds.slice(firstVisited.size).every(id => !firstVisited.has(id)));
  assert.ok((second.paybackYears ?? Infinity) <= (first.paybackYears ?? Infinity), 'the selected payback cannot get worse');
  assert.equal(f.state.scenarioInputs.length, 64);
});

test('recommendation continuation rejects a changed tariff or prices-as-of identity', async () => {
  const candidate = { id: 'candidate-one', templateIds: ['battery-one'], totals: {}, missingPrices: [],
    totalPvKw: 5, addedPvKw: 0, batteryCapacityKwh: 10, batteryPowerKw: 5 };
  const many = Array.from({ length: 64 }, (_, index) => ({ ...candidate,
    id: `candidate-${String(index).padStart(2, '0')}`, templateIds: [`battery-${index}`] }));
  const original = recommendationFixture({ templates: many.map(item => ({ id: item.templateIds[0], name: item.id, kind: 'MAGAZYN' })), candidates: many });
  const first = await original.calculate('recommend');
  const changed = recommendationFixture({
    baselineTariff: { sell_method: 'fixed', revision: 'changed tariff' },
    templates: many.map(item => ({ id: item.templateIds[0], name: item.id, kind: 'MAGAZYN' })), candidates: many,
  });
  await assert.rejects(changed.calculate('recommend', first), /Źródła taryfy, PV lub katalogu zmieniły się/u);
  assert.equal(changed.state.scenarioInputs.length, 0, 'stale parent results must not be merged into a new source set');
});

test('continuation rejects a changed PV battery bound even when the filtered candidate count is unchanged', async () => {
  const candidates = Array.from({ length: 64 }, (_, index) => ({
    id: `candidate-${String(index).padStart(2, '0')}`,
    templateIds: [`battery-${index}`], totals: {}, missingPrices: [],
    totalPvKw: 10, batteryCapacityKwh: 25, batteryPowerKw: 5,
  }));
  const f = recommendationFixture({
    templates: candidates.map(candidate => ({ id: candidate.templateIds[0], name: candidate.id, kind: 'MAGAZYN' })),
    candidates,
  });
  const first = await f.calculate('recommend');
  assert.equal(first.recommendationSearch?.hasMore, true);
  const firstJson = JSON.stringify(first);
  f.draft.existingPv.powerKw = 9;

  await assert.rejects(f.calculate('recommend', first), /Źródła taryfy, PV lub katalogu zmieniły się/u);
  assert.equal(JSON.stringify(first), firstJson);
  assert.equal(f.state.scenarioInputs.length, 50);
});

test('cold added-PV source identity warms on the first profile and remains resumable after UI-only draft edits', async () => {
  const allCandidates = Array.from({ length: 64 }, (_, index) => ({
    id: `candidate-${String(index).padStart(2, '0')}`,
    templateIds: [`battery-${index}`, 'pv-template'],
    totals: {}, missingPrices: [], totalPvKw: 5, addedPvKw: 5,
    batteryCapacityKwh: 10 + index % 6, batteryPowerKw: 3 + index % 2,
  }));
  const f = recommendationFixture({
    templates: [
      ...allCandidates.map(candidate => ({ id: candidate.templateIds[0], name: candidate.templateIds[0], kind: 'MAGAZYN' })),
      { id: 'pv-template', name: 'PV', kind: 'PV_DACH_SKOSNY', powerKw: 5 },
    ],
    candidates: allCandidates,
    location: { latitude: 52.23, longitude: 21.01 },
    pvSourceRevision: null,
    pvSourceRevisionAfterProfile: 'warmed-pv-source',
  });
  f.draft.pvStrategy = 'ADD_TEMPLATE';
  f.draft.existingPv.lossPercent = 12;
  f.draft.calculation.addedPvTiltDegrees = 30;
  f.draft.calculation.addedPvAzimuthDegrees = 180;

  const first = await f.calculate('recommend');
  assert.equal(first.recommendationSearch?.evaluatedCandidates, 50);
  assert.equal(first.sourceDependencyStamp?.length, 64);
  f.draft.step = 'FINANCING';
  f.draft.description = 'Zmieniony opis widoku';
  const second = await f.calculate('recommend', first);
  assert.equal(second.recommendationSearch?.evaluatedCandidates, 64);
  assert.equal(second.recommendationSearch?.hasMore, false);
  assert.equal(f.state.scenarioInputs.length, 64);
});

test('continuation retains per-candidate errors and rebuilds one cumulative incomplete warning', async () => {
  const allCandidates = Array.from({ length: 64 }, (_, index) => ({
    id: `candidate-${String(index).padStart(2, '0')}`,
    templateIds: [`battery-${index}`], totals: {}, missingPrices: [], totalPvKw: 10, addedPvKw: 0,
    batteryCapacityKwh: 20 + Math.floor(index / 8), batteryPowerKw: 2 + index % 3,
  }));
  const failure = 'Awaria obliczenia wariantu 0.';
  const f = recommendationFixture({
    templates: allCandidates.map(candidate => ({ id: candidate.templateIds[0], name: candidate.id, kind: 'MAGAZYN' })),
    candidates: allCandidates,
    scenario: input => input.draft.selectedTemplateIds[0] === 'battery-0'
      ? calculation('blocked', [failure]) : calculation('ready'),
  });

  const first = await f.calculate('recommend');
  assert.ok(first.warnings.includes(failure));
  const second = await f.calculate('recommend', first);
  assert.ok(second.warnings.includes(failure));
  assert.equal(second.warnings.filter(warning => warning.startsWith('Porównanie niepełne:')).length, 1);
  assert.ok(second.warnings.some(warning => warning.includes('1 z 64 ocenionych kandydatów')));
});
