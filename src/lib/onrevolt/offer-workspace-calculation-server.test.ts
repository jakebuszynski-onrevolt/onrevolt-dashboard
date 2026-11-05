import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { OfferMarketDataError, offerHourlyMarketPrices, offerMarketIntervalStarts } from './offer-workspace-market';
import * as dependencies from './offer-workspace-calculation-dependencies';
import { completeHistoryForSummary } from './client-energy-cost-summary-server';

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
  templates?: Array<{ id: string; name: string; kind: string }>;
  candidates?: Array<{ id?: string; templateIds: string[]; totals: unknown; missingPrices: string[]; requiresReview?: boolean; reviewReasons?: string[] }>;
  billingCycleMonths?: number | null;
  scenario?: (input: any) => ReturnType<typeof calculation>;
} = {}) {
  const state = { marketQueries: [] as string[], scenarioInputs: [] as any[], targetCatalogCalls: 0,
    clientTariffRequests: [] as any[], completedHistories: [] as any[] };
  const energyDates = options.energyDates || ['2026-10-01'];
  const historyDates = [...new Set(energyDates.map(value => value.slice(0, 10)))];
  const baselineHistory = {
    strict: true, revision: 1,
    byDate: options.baselineByDate || Object.fromEntries(historyDates.map(date => [date, 'baseline'])),
    tariffs: { baseline: options.baselineTariff || { sell_method: options.baselineSellMethod || 'fixed' } },
    issues: options.baselineIssues || [],
  };
  const targetTariff = { id: 2, sell_method: options.targetSellMethod || 'fixed', catalogRevision: 3 };
  const workspace: any = {
    clientId: 'client-1', projectId: 'project-1', clientType: 'B2C',
    input: { reportDetails: { connectionPowerKw: 16, roofType: 'skośny' }, location: null },
    measurements: { months: Array.from({ length: 12 }, (_, index) => ({ period: `2026-${String(index + 1).padStart(2, '0')}` })), dayProfiles: [] },
    templates: options.templates || [],
  };
  const draft: any = {
    targetOperatorId: 1, targetTariffId: 2,
    currentSettlement: 'NET_METERING', targetSettlement: 'NET_METERING',
    existingPv: { powerKw: 0, tiltDegrees: null, azimuthDegrees: null, lossPercent: null },
    pvStrategy: 'KEEP_EXISTING', saleVatMode: 'REVIEW', selectedTemplateIds: [],
    financing: { considerGrant: false, considerTaxRelief: false },
    calculation: { billingCycleMonths: options.billingCycleMonths === undefined ? 1 : options.billingCycleMonths,
      initialCreditKwh: 0, initialDepositPln: 0,
      batteryReservePercent: 10, chargeEfficiencyPercent: 95, dischargeEfficiencyPercent: 95,
      addedPvTiltDegrees: null, addedPvAzimuthDegrees: null, taxRatePercent: null,
      taxRemainingLimitPln: null, taxEligibleCostPln: null, taxBasePln: null },
  };
  const energy = {
    issues: [], modelBelowExportKwh: 0,
    intervals: energyDates.map(value => {
      const startUtc = value.includes('T') ? value : `${value}T00:00:00.000Z`;
      return { startUtc, endUtc: new Date(Date.parse(startUtc) + 3600000).toISOString(),
        loadKwh: 1, pvKwh: 0, importKwh: 1, exportKwh: 0 };
    }),
  };
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
    './client-tariffs': { tariffToday: () => '2026-10-01' },
    './offer-workspace-energy-server': { calculateOfferWorkspaceEnergy: async () => energy },
    './offer-workspace-calculation': {
      blockedOfferCalculation: blocked,
      offerLocalTime: (value: string) => localTime.format(new Date(value)),
      calculateOfferWorkspaceScenario: async (input: any) => {
        state.scenarioInputs.push(input);
        return options.scenario ? options.scenario(input) : calculation('ready');
      },
    },
    './offer-workspace': { defaultOfferCalculationAssumptions: () => draft.calculation },
    './offer-workspace-market': { OfferMarketDataError, offerHourlyMarketPrices, offerMarketIntervalStarts },
    './offer-workspace-calculation-dependencies': dependencies,
    './re-stations': { rePrisma: () => ({ $queryRawUnsafe: async (query: string) => {
      state.marketQueries.push(query);
      return options.rdnRows || marketRows();
    } }) },
    './offer-pv-profile': { readOfferPvProfile: async () => ({ hours: [] }) },
    './configuration-templates': { configurationInvestmentScope: (kind: string) => kind === 'MAGAZYN'
      ? 'BATTERY' : kind.startsWith('PV_') ? 'PV' : null },
    './offer-candidates': { enumerateOfferCandidates: () => ({
      candidates: options.candidates || [], rejectedReasonList: [],
    }) },
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
    calculate: (mode: 'selected' | 'recommend' = 'selected') =>
      exports.calculateOfferWorkspaceOnServer(workspace, draft, null, mode),
    loadDependencyStamp: () => exports.loadOfferCalculationDependencyStamp(workspace, draft),
  };
}

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
  const f = fixture({
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
  const f = fixture({
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
  const f = fixture({
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
  const f = fixture({
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
  const f = fixture({
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
  const f = fixture({
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
