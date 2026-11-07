import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as dependencies from './offer-workspace-calculation-dependencies';
import * as annualProfile from './offer-workspace-annual-profile';
import * as energyModel from './offer-workspace-energy';
import { resolveProjectAnalysisPeriod } from './project-analysis-period';
import type { CatalogProfile } from './reference-profile-comparison';

const catalog = JSON.parse(readFileSync(path.join(process.cwd(), 'output', 'profile-catalog-20261106', 'catalog.json'), 'utf8')) as { profiles: CatalogProfile[] };
const bdewH25 = catalog.profiles.find(profile => profile.key === 'bdew-2025-h25')!;

const filename = path.resolve(__dirname, 'offer-workspace-valuation-server.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  fileName: filename,
}).outputText;

function fixture() {
  let calculationCalls = 0;
  let historyReads = 0;
  let valuationInput: any = null;
  let historyIssues: Array<{ date: string; message: string }> = [];
  const annualProfileInputs: any[] = [];
  let referenceProfileBundle: any = null;
  let referenceProfileResolutions = 0;
  const resolveReferenceProfile = async (selection: any) => {
    referenceProfileResolutions += 1;
    return selection?.key ? referenceProfileBundle : null;
  };
  const buildAnnualProfile = (input: any) => {
    annualProfileInputs.push(input);
    return annualProfile.buildAnnualOfferConsumptionProfile(input);
  };
  const annualProfileModule = { ...annualProfile, buildAnnualOfferConsumptionProfile: buildAnnualProfile };
  const artifacts = new Map<string, { identity: unknown; json: string }>();
  const exports: any = {};
  const modules: Record<string, unknown> = {
    './offer-workspace-annual-profile': annualProfileModule,
    './offer-workspace-energy': energyModel,
    './offer-workspace-energy-server': { calculateOfferWorkspaceEnergy: async (workspace: any) =>
      energyModel.buildAnnualProfileOfferWorkspaceEnergy({ noPv: true, pvHours: [],
        profile: buildAnnualProfile({ period: workspace.period, annualConsumptionKwh: workspace.input.annualConsumptionKwh,
          referenceProfile: await resolveReferenceProfile(workspace.input.referenceProfile) || undefined }) }) },
    './project-reference-profile': { resolveSelectedReferenceProfile: resolveReferenceProfile },
    './client-tariffs-server': {
      clientTariffScope: async () => ({ clientId: 'client-1', projectId: 'project-1' }),
      loadClientTariffHistory: async (_clientId: string, _projectId: string, from: string) => {
        historyReads += 1;
        return {
          strict: true,
          revision: 1,
          byDate: { [from]: 'baseline' },
          tariffs: { baseline: { sell_method: 'fixed' } },
          issues: historyIssues,
        };
      },
      readProjectGeneralTariffs: async () => ({ generalTariff: null }),
      callClientTariffs: async () => ({ id: 2, sell_method: 'fixed', catalogRevision: 3 }),
    },
    './client-tariffs': { tariffToday: () => '2026-11-05' },
    './offer-workspace-market': {
      offerHourlyMarketPrices: () => new Map(),
      offerMarketIntervalStarts: (rows: unknown[]) => rows,
    },
    './re-stations': { rePrisma: () => ({ $queryRawUnsafe: async () => [] }) },
    './offer-workspace-artifacts': {
      getOfferWorkspaceArtifact: async (identity: unknown) => {
        const stored = artifacts.get(JSON.stringify(identity));
        return stored ? JSON.parse(stored.json) : null;
      },
      putOfferWorkspaceArtifact: async (identity: unknown, value: unknown) => {
        const json = JSON.stringify(value);
        if (json === undefined) throw new TypeError('Valuation artifact is not valid JSON');
        // Model the actual durable JSON round trip so cache hits are checked
        // against the representation persisted by the artifact store.
        JSON.parse(json);
        artifacts.set(JSON.stringify(identity), { identity, json });
      },
    },
    './offer-workspace-calculation-dependencies': dependencies,
    './offer-workspace-valuation': {
      calculateOfferWorkspaceValuation: (input: any) => {
        calculationCalls += 1;
        valuationInput = input;
        return {
          current: { issues: [] }, target: { issues: [] },
          status: 'ready',
          baselineAnnualCostPln: input.connectionPowerKw * 100,
          proposedAnnualCostPln: input.connectionPowerKw * 90,
          annualSavingsPln: input.connectionPowerKw * 10,
        };
      },
    },
  };
  vm.runInNewContext(code, { exports, require: (id: string) => {
    if (!(id in modules)) throw new Error(`Unexpected import ${id}`);
    return modules[id];
  } });

  const workspace: any = {
    clientId: 'client-1',
    projectId: 'project-1',
    revision: 7,
    clientType: 'B2C',
    input: { reportDetails: { connectionPowerKw: 16 } },
    measurements: { months: [{ period: '2026-10' }], dayProfiles: [] },
  };
  const draft: any = {
    currentSettlement: 'NET_METERING',
    targetSettlement: 'NET_METERING',
    targetOperatorId: 1,
    targetTariffId: 2,
  };
  const series: any = { intervals: [{
    localStart: '2026-10-01T02:00:00',
    startUtc: '2026-10-01T00:00:00.000Z',
    import: { valueKwh: 1 },
    export: null,
  }] };

  return {
    exports,
    workspace,
    draft,
    series,
    artifacts,
    get calculationCalls() { return calculationCalls; },
    get historyReads() { return historyReads; },
    get valuationInput() { return valuationInput; },
    setHistoryIssues: (issues: Array<{ date: string; message: string }>) => { historyIssues = issues; },
    annualProfileInputs,
    setReferenceProfile: (bundle: any) => { referenceProfileBundle = bundle; },
    get referenceProfileResolutions() { return referenceProfileResolutions; },
  };
}

test('valuation artifact is valid JSON, hits on identical input, and invalidates when an input changes', async () => {
  const state = fixture();
  const calculate = () => state.exports.calculateOfferWorkspaceValuationOnServer(state.workspace, state.draft, state.series);

  const first = await calculate();
  assert.equal(first.baselineAnnualCostPln, 1600);
  assert.equal(state.calculationCalls, 1);
  assert.equal(state.artifacts.size, 1);
  const firstEntry = Array.from(state.artifacts.values())[0];
  assert.deepEqual(JSON.parse(firstEntry.json), first);
  assert.doesNotThrow(() => JSON.parse(firstEntry.json));

  const hit = await calculate();
  assert.deepEqual(hit, first);
  assert.equal(state.calculationCalls, 1, 'the valid persisted artifact is reused');

  state.workspace.input.reportDetails.connectionPowerKw = 20;
  const changed = await calculate();
  assert.equal(changed.baselineAnnualCostPln, 2000);
  assert.equal(state.calculationCalls, 2, 'changed valuation inputs recalculate');
  assert.equal(state.artifacts.size, 2);
  const identities = Array.from(state.artifacts.values(), row => row.identity as any);
  assert.notEqual(identities[0].key.inputs, identities[1].key.inputs);

  await calculate();
  assert.equal(state.calculationCalls, 2, 'the changed input has its own persistent cache entry');
});

test('annual-only valuation uses estimated RE intervals and labels costs as modeled without changing the workspace', async () => {
  const state = fixture();
  state.workspace.period = resolveProjectAnalysisPeriod('2024-01', new Date('2025-02-15T12:00:00Z'));
  state.workspace.input.annualConsumptionKwh = 8760;
  state.workspace.input.energyProfileSource = 'ANNUAL_DECLARATION';
  state.workspace.measurements = { availability: 'NO_FILES', months: [], dayProfiles: [], issues: [] };
  const before = structuredClone(state.workspace);
  const result = await state.exports.calculateOfferWorkspaceValuationOnServer(state.workspace, state.draft, null);
  assert.equal(state.valuationInput.intervals.length, 8784);
  assert.ok(state.valuationInput.intervals.every((row: any) => row.import.source === 'estimated' && row.import.fileIds.length === 0));
  const total = state.valuationInput.intervals.reduce((sum: number, row: any) => sum + row.import.valueKwh, 0);
  assert.ok(Math.abs(total - 8760) < 1e-8);
  assert.equal(state.valuationInput.measurements.months.length, 12);
  assert.ok(result.current.issues.some((text: string) => text.includes('Wycena szacunkowa')));
  assert.deepEqual(state.workspace, before);
});

test('annual-only valuation resolves the selected profile for both annual builders and retains its provenance', async () => {
  const state = fixture();
  const contentHash = 'd'.repeat(64);
  const bundle = { profile: bdewH25, contentHash };
  state.setReferenceProfile(bundle);
  state.workspace.period = resolveProjectAnalysisPeriod('2024-01', new Date('2025-02-15T12:00:00Z'));
  state.workspace.input.annualConsumptionKwh = 8760;
  state.workspace.input.energyProfileSource = 'ANNUAL_DECLARATION';
  state.workspace.input.referenceProfile = { key: bdewH25.key, revision: 2, contentHash, profileName: bdewH25.name };
  state.workspace.measurements = { availability: 'NO_FILES', months: [], dayProfiles: [], issues: [] };

  const result = await state.exports.calculateOfferWorkspaceValuationOnServer(state.workspace, state.draft, null);
  assert.equal(state.referenceProfileResolutions, 2, 'energy and valuation each resolve the workspace selection');
  assert.equal(state.annualProfileInputs.length, 2);
  for (const input of state.annualProfileInputs) {
    assert.equal(input.referenceProfile.profile.key, bdewH25.key);
    assert.equal(input.referenceProfile.contentHash, contentHash);
  }
  assert.ok(result.current.issues.some((text: string) => text.includes(`profilem referencyjnym ${bdewH25.name}`)));
});

test('valuation affected by external history issues is not cached and retries the source', async () => {
  const state = fixture();
  state.setHistoryIssues([{ date: '2026-10-01', message: 'Brak pełnej historii taryfy.' }]);

  await state.exports.calculateOfferWorkspaceValuationOnServer(state.workspace, state.draft, state.series);
  assert.equal(state.artifacts.size, 0);
  assert.equal(state.historyReads, 1);

  await state.exports.calculateOfferWorkspaceValuationOnServer(state.workspace, state.draft, state.series);
  assert.equal(state.artifacts.size, 0);
  assert.equal(state.historyReads, 2, 'a result with a source issue does not suppress the next history read');

  state.setHistoryIssues([]);
  await state.exports.calculateOfferWorkspaceValuationOnServer(state.workspace, state.draft, state.series);
  assert.equal(state.artifacts.size, 1);
  assert.equal(state.historyReads, 3);
  await state.exports.calculateOfferWorkspaceValuationOnServer(state.workspace, state.draft, state.series);
  assert.equal(state.historyReads, 4, 'the current source history is read before the cache key can be checked');
});
