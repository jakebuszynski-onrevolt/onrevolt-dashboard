import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { recommendationInputIssues } from './offer-workspace-recommendation-inputs';

const routePath = path.resolve(__dirname, '../../app/api/projects/[id]/offer-workspace/calculate/route.ts');
const routeCode = ts.transpileModule(readFileSync(routePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: routePath,
}).outputText;

const sourceRevision = 'a'.repeat(64);
const draft = {
  schemaVersion: 1,
  step: 'SUMMARY',
  objective: 'SHORTEST_PAYBACK',
  existingPv: { powerKw: 5, tiltDegrees: 30, azimuthDegrees: 180, lossPercent: 12 },
  pvStrategy: 'KEEP_EXISTING',
  currentSettlement: 'NET_BILLING',
  targetSettlement: 'NET_BILLING',
  targetOperatorId: 11,
  targetTariffId: 22,
  saleVatMode: 'STANDARD_23',
  selectedTemplateIds: ['battery-1'],
  financing: { considerGrant: false, considerTaxRelief: false },
  description: { before: '', after: '' },
};
const calculation = {
  status: 'ready', reasons: [], warnings: [], baselineAnnualCostPln: 100,
  proposedAnnualCostPln: 80, annualSavingsPln: 20, systemCostPln: 1000,
  costAfterFinancingPln: 1000, paybackYears: 50, grantPln: 0, taxReliefPln: 0,
  rankings: [], recommendedTemplateIds: null, pricesAsOf: '2026-10-29', sourceDependencyStamp: 'd'.repeat(64),
};
const previousRecommendation = {
  ...calculation,
  recommendationSearch: {
    version: 1, candidateSignature: 'f'.repeat(64), evaluatedCandidateIds: ['candidate-1'],
    totalCandidates: 3, evaluatedCandidates: 1, batchNumber: 1, batchEvaluated: 1,
    hasMore: true, phase: 'coarse',
  },
};

function fixture(options: {
  denied?: boolean;
  noEnergy?: boolean;
  noPricing?: boolean;
  missing?: boolean;
  currentRevision?: string;
  jobRevision?: string;
  jobStatus?: 'running' | 'completed' | 'failed';
  jobPricesAsOf?: string;
  jobResult?: Record<string, unknown>;
  freshnessUnverified?: boolean;
  jobOwner?: string;
  jobProject?: string;
  persistedDraft?: unknown;
  jobExistingPvPowerKw?: number | null;
  jobRequiresPvSource?: boolean;
  enqueueConflict?: boolean;
  cached?: boolean;
  cachedRecommendation?: boolean;
  continuationSource?: boolean;
} = {}) {
  const calls: Array<{ operation: string; value: any }> = [];
  class OfferWorkspaceNotFoundError extends Error {}
  class OfferWorkspacePermissionError extends Error {}
  class OfferWorkspaceCalculationCapacityError extends Error {}
  class OfferWorkspaceCalculationConflictError extends Error {
    constructor() { super('Inny zestaw danych jest już obliczany dla tego projektu. Poczekaj na jego zakończenie.'); }
  }
  const authoritativeSeries = { intervals: ['server-loaded'] };
  let parsed = 0;
  const job = {
    id: 'job-1', status: options.jobStatus ?? 'running', completed: 4, total: 10,
    sourceRevision: options.jobRevision ?? sourceRevision,
  };
  const modules: Record<string, any> = {
    'lib/onrevolt/offer-workspace-recommendation-inputs': { recommendationInputIssues },
    'lib/onrevolt/api': {
      badRequest: (error: string) => Response.json({ ok: false, error }, { status: 400 }),
      forbidden: (error: string) => Response.json({ ok: false, error }, { status: 403 }),
      jsonResponse: (body: unknown, init?: ResponseInit) => Response.json(body, init),
      notFound: (error: string) => Response.json({ ok: false, error }, { status: 404 }),
    },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async (_req: unknown, permission: string) => {
        calls.push({ operation: 'authorize', value: permission });
        return options.denied ? { ok: false, response: new Response(null, { status: 403 }) }
          : { ok: true, user: { id: 'staff', systemRole: 'USER' } };
      },
      hasStaffPermission: (_user: unknown, permission: string) => permission === 'energy.manage'
        ? !options.noEnergy : permission === 'pricing.read' ? !options.noPricing : true,
    },
    'lib/onrevolt/offer-workspace': {
      emptyOfferWorkspaceDraft: () => ({ ...draft }),
      parseOfferWorkspaceDraft: (value: unknown) => { parsed += 1; if (!value) throw new Error('Nieprawidłowy szkic.'); return value; },
      offerWorkspaceDraftWithBatteryPresence: (value: any, presence: boolean | null) => ({ ...value, existingBatteryPresent: presence }),
    },
    'lib/onrevolt/offer-workspace-server': {
      OfferWorkspaceNotFoundError,
      OfferWorkspacePermissionError,
      loadProjectOfferWorkspace: async (projectId: string, user: any, _now: Date, collect?: (value: unknown) => void) => {
        calls.push({ operation: 'load', value: { projectId, actorId: user.id, withSeries: !!collect } });
        if (options.missing) throw new OfferWorkspaceNotFoundError('missing');
        collect?.(authoritativeSeries);
        return { revision: options.currentRevision ?? sourceRevision, input: { existingBatteryPresent: true }, templates: [], draft: { input: options.persistedDraft ?? draft } };
      },
    },
    'lib/onrevolt/offer-workspace-calculation-server': {
      calculateOfferWorkspaceOnServer: async (_workspace: unknown, _draft: unknown, _series: unknown, _mode: string, _onProgress?: unknown) => calculation,
      offerWorkspaceCalculationRequiresPvSource: (_workspace: unknown, usedDraft: any) => (usedDraft.existingPv?.powerKw ?? 0) > 0,
      loadOfferCalculationDependencyStamp: async (_workspace: unknown, usedDraft: unknown, options: unknown) => {
        calls.push({ operation: 'dependency-stamp', value: { draft: usedDraft, options } });
        return calculation.sourceDependencyStamp;
      },
    },
    'lib/onrevolt/offer-workspace-configuration-edits': {
      configurationEditsContainPricing: (edits: any[] | undefined) => Boolean(edits?.some(edit => edit.items?.some((item: any) => item.pricing !== undefined) || edit.addedItems?.length)),
      validateOfferWorkspaceConfigurationEdits: (_templates: unknown[], usedDraft: any) => {
        if (usedDraft.configurationEdits?.some((edit: any) => edit.templateId === 'unknown')) throw new Error('Nieznany wybrany zestaw.');
      },
    },
    'lib/onrevolt/client-tariffs': { tariffToday: () => '2026-10-29' },
    'lib/onrevolt/offer-workspace-calculation-jobs': {
      OfferWorkspaceCalculationCapacityError,
      OfferWorkspaceCalculationConflictError,
      offerWorkspaceCalculationJobs: {
        findRecommendationContinuationForDraft: async (input: any) => {
          calls.push({ operation: 'continuation-lookup', value: input });
          return options.continuationSource ? { jobId: 'job-parent', result: previousRecommendation } : null;
        },
        findCompletedJobForDraft: async (input: any) => {
          calls.push({ operation: 'draft-lookup', value: input });
          return options.cached ? { ...job, status: 'completed', data: options.cachedRecommendation ? previousRecommendation : calculation } : null;
        },
        enqueue: (request: any, runner: unknown) => {
          calls.push({ operation: 'enqueue', value: request });
          assert.equal(request.series, authoritativeSeries);
          assert.equal(typeof runner, 'function');
          if (options.enqueueConflict) throw new OfferWorkspaceCalculationConflictError();
          return { job, reused: false };
        },
        getForActorProjectPersistent: async (id: string, actorId: string, projectId: string, freshness?: any) => {
          calls.push({ operation: 'lookup-persistent', value: { id, actorId, projectId } });
          if (id !== job.id || actorId !== (options.jobOwner ?? 'staff') || projectId !== (options.jobProject ?? 'project-1')) return null;
          const result = options.jobResult ?? calculation;
          const view = { ...job, data: job.status === 'completed'
            ? { ...result, pricesAsOf: options.jobPricesAsOf ?? result.pricesAsOf ?? calculation.pricesAsOf } : undefined,
            dependencyContext: {
              targetOperatorId: draft.targetOperatorId, targetTariffId: draft.targetTariffId,
              currentSettlement: draft.currentSettlement, targetSettlement: draft.targetSettlement,
              existingPvPowerKw: options.jobExistingPvPowerKw === undefined ? draft.existingPv.powerKw : options.jobExistingPvPowerKw,
              requiresPvSource: options.jobRequiresPvSource === undefined
                ? (options.jobExistingPvPowerKw === undefined ? draft.existingPv.powerKw : options.jobExistingPvPowerKw) > 0
                : options.jobRequiresPvSource,
            } };
          const checked = job.status === 'completed' && typeof freshness === 'function'
            ? await freshness(view, view.dependencyContext) : freshness;
          const freshnessUnverified = options.freshnessUnverified || (job.status === 'completed'
            && (!checked || checked.sourceRevision !== job.sourceRevision || checked.pricesAsOf !== calculation.pricesAsOf
              || checked.sourceDependencyStamp !== calculation.sourceDependencyStamp
              || checked.dependencyContext?.targetOperatorId !== draft.targetOperatorId
              || checked.dependencyContext?.targetTariffId !== draft.targetTariffId
              || checked.dependencyContext?.existingPvPowerKw !== (options.jobExistingPvPowerKw === undefined ? draft.existingPv.powerKw : options.jobExistingPvPowerKw)
              || checked.dependencyContext?.requiresPvSource !== (options.jobRequiresPvSource === undefined
                ? (options.jobExistingPvPowerKw === undefined ? draft.existingPv.powerKw : options.jobExistingPvPowerKw) > 0
                : options.jobRequiresPvSource)));
          return { ...view,
          ...(freshnessUnverified ? { freshnessUnverified: true } : {}) };
        },
      },
    },
  };
  const exports: any = {};
  vm.runInNewContext(routeCode, {
    exports,
    Buffer,
    URL,
    Request,
    Response,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected route import: ${name}`);
      return modules[name];
    },
  });
  const request = (method: string, body?: string, search = '') => new Request(`http://localhost/api/projects/project-1/offer-workspace/calculate${search}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body }),
  });
  const context = { params: Promise.resolve({ id: 'project-1' }) };
  return { exports, calls, request, context, parsed: () => parsed };
}

test('POST authorizes both permissions, loads scoped measurements, and returns a 202 job', async () => {
  const state = fixture();
  const response = await state.exports.POST(state.request('POST', JSON.stringify({
    draft, mode: 'recommend', sourceRevision, series: { intervals: ['client-injected'] },
  })), state.context);
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(body, { ok: true, job: { id: 'job-1', status: 'running', completed: 4, total: 10 } });
  assert.equal(state.calls[0].operation, 'authorize');
  assert.equal(state.calls[0].value, 'offers.manage');
  assert.equal(state.calls.find((call) => call.operation === 'load')?.value.withSeries, true);
  const queued = state.calls.find((call) => call.operation === 'enqueue')?.value;
  assert.equal(queued.actorId, 'staff');
  assert.equal(queued.projectId, 'project-1');
  assert.equal(queued.mode, 'recommend');
  assert.equal(queued.sourceRevision, sourceRevision);
  assert.equal(queued.draft.existingBatteryPresent, true, 'queued calculations use the workspace battery status, not the request draft');
});

test('POST rejects denied permissions, missing projects, stale revisions, malformed JSON and oversized bodies before enqueue', async () => {
  const denied = fixture({ denied: true });
  assert.equal((await denied.exports.POST(denied.request('POST', '{}'), denied.context)).status, 403);
  assert.equal(denied.parsed(), 0);
  assert.equal(denied.calls.some((call) => call.operation === 'load' || call.operation === 'enqueue'), false);

  const noEnergy = fixture({ noEnergy: true });
  assert.equal((await noEnergy.exports.POST(noEnergy.request('POST', '{}'), noEnergy.context)).status, 403);
  assert.equal(noEnergy.calls.some((call) => call.operation === 'load'), false);

  const missing = fixture({ missing: true });
  assert.equal((await missing.exports.POST(missing.request('POST', JSON.stringify({ draft, mode: 'selected', sourceRevision })), missing.context)).status, 404);

  const stale = fixture();
  const staleResponse = await stale.exports.POST(stale.request('POST', JSON.stringify({ draft, mode: 'selected', sourceRevision: 'b'.repeat(64) })), stale.context);
  assert.equal(staleResponse.status, 409);
  assert.equal(stale.calls.some((call) => call.operation === 'enqueue'), false);

  const invalidJson = fixture();
  assert.equal((await invalidJson.exports.POST(invalidJson.request('POST', '{'), invalidJson.context)).status, 400);
  const tooLarge = fixture();
  assert.equal((await tooLarge.exports.POST(tooLarge.request('POST', 'x'.repeat(129 * 1024)), tooLarge.context)).status, 413);
  assert.equal(tooLarge.calls.some((call) => call.operation === 'enqueue'), false);
});

test('POST denies private price edits without pricing.read and clears them from recommendations', async () => {
  const denied = fixture({ noPricing: true });
  const privateEdit = { ...draft, configurationEdits: [{ templateId: 'battery-1', items: [
    { itemId: 'battery-line', pricing: { unitPurchaseNet: 1 } },
  ] }] };
  const deniedResponse = await denied.exports.POST(denied.request('POST', JSON.stringify({
    draft: privateEdit, mode: 'selected', sourceRevision,
  })), denied.context);
  assert.equal(deniedResponse.status, 403);
  assert.equal(denied.calls.some(call => call.operation === 'load'), false);

  const recommendation = fixture({ noPricing: true });
  const response = await recommendation.exports.POST(recommendation.request('POST', JSON.stringify({
    draft: privateEdit, mode: 'recommend', sourceRevision,
  })), recommendation.context);
  assert.equal(response.status, 202);
  const queued = recommendation.calls.find(call => call.operation === 'enqueue')?.value;
  assert.equal(queued.draft.configurationEdits, undefined);
});

test('POST maps unknown configuration edits to 400 before cache lookup or enqueue', async () => {
  const state = fixture();
  const response = await state.exports.POST(state.request('POST', JSON.stringify({ draft: {
    ...draft, configurationEdits: [{ templateId: 'unknown', items: [{ itemId: 'missing', description: 'Test' }] }],
  }, mode: 'selected', sourceRevision })), state.context);
  assert.equal(response.status, 400);
  assert.equal(state.calls.some(call => call.operation === 'draft-lookup' || call.operation === 'enqueue'), false);
});

test('POST returns 409 without exposing a running job when its active draft differs', async () => {
  const state = fixture({ enqueueConflict: true });
  const response = await state.exports.POST(state.request('POST', JSON.stringify({ draft, mode: 'selected', sourceRevision })), state.context);
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.ok, false);
  assert.equal(typeof body.error, 'string');
  assert.equal('job' in body, false);
});

test('recommendation rejects shared missing inputs before cache, continuation, market sources or enqueue', async () => {
  const incompleteDraft = { ...draft, saleVatMode: 'REVIEW', pvStrategy: 'ADD_TEMPLATE', targetSettlement: 'NET_METERING' };
  for (const requestOptions of [{}, { cacheOnly: true }, { continueFromJobId: 'job-parent' }]) {
    const state = fixture({ cached: true, continuationSource: true });
    const response = await state.exports.POST(state.request('POST', JSON.stringify({
      draft: incompleteDraft, mode: 'recommend', sourceRevision, ...requestOptions,
    })), state.context);
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.equal(body.ok, false);
    assert.equal(body.issues.length, 3);
    assert.equal(body.job, undefined, 'no fake 50-attempt job is created');
    assert.equal(state.calls.some(call => ['dependency-stamp', 'draft-lookup', 'continuation-lookup', 'enqueue'].includes(call.operation)), false);
  }
});

test('selected lookup rejects an invalid historical ranking but preserves ordinary diagnostic cache and execution', async () => {
  const incompleteDraft = { ...draft, saleVatMode: 'REVIEW' };
  for (const cachedRecommendation of [true, false]) {
    const state = fixture({ cached: true, cachedRecommendation });
    const response = await state.exports.POST(state.request('POST', JSON.stringify({
      draft: incompleteDraft, mode: 'selected', sourceRevision, cacheOnly: true,
    })), state.context);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.cached, !cachedRecommendation);
    assert.equal(body.job === null, cachedRecommendation);
    assert.equal(state.calls.some(call => call.operation === 'enqueue'), false);
  }
  const state = fixture({ cached: true, cachedRecommendation: true });
  const response = await state.exports.POST(state.request('POST', JSON.stringify({
    draft: incompleteDraft, mode: 'selected', sourceRevision,
  })), state.context);
  assert.equal(response.status, 202);
  assert.equal(state.calls.some(call => call.operation === 'enqueue'), true);
});

test('recommendation input checks do not replace selected-variant diagnostics', async () => {
  const state = fixture();
  const response = await state.exports.POST(state.request('POST', JSON.stringify({
    draft: { ...draft, saleVatMode: 'REVIEW', pvStrategy: 'ADD_TEMPLATE', targetSettlement: 'NET_METERING' },
    mode: 'selected', sourceRevision,
  })), state.context);
  assert.equal(response.status, 202);
  assert.equal(state.calls.some(call => call.operation === 'enqueue'), true);
});

test('GET preserves authorized job status on source conflict but withholds stale results', async () => {
  const state = fixture({ jobRevision: 'b'.repeat(64), jobStatus: 'running' });
  const response = await state.exports.GET(state.request('GET', undefined, '?jobId=job-1'), state.context);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.job.status, 'running');
  assert.equal(body.job.stale, true);
  assert.equal(body.job.data, undefined);
  assert.equal(state.calls.find((call) => call.operation === 'load')?.value.withSeries, false);
  assert.equal(state.calls.some((call) => call.operation === 'dependency-stamp'), false, 'running poll must not load annual market data');

  const completedStale = fixture({ jobRevision: 'b'.repeat(64), jobStatus: 'completed' });
  const completedResponse = await completedStale.exports.GET(completedStale.request('GET', undefined, '?jobId=job-1'), completedStale.context);
  const completedBody = await completedResponse.json();
  assert.equal(completedResponse.status, 200);
  assert.equal(completedBody.job.status, 'completed');
  assert.equal(completedBody.job.stale, true);
  assert.equal(completedBody.job.data, undefined);

  const blockedResult = {
    ...calculation,
    status: 'blocked',
    reasons: ['Brak pełnego godzinowego profilu energii do symulacji.'],
  };
  const currentBlocked = fixture({ jobStatus: 'completed', jobResult: blockedResult });
  const currentBlockedResponse = await currentBlocked.exports.GET(currentBlocked.request('GET', undefined, '?jobId=job-1'), currentBlocked.context);
  const currentBlockedBody = await currentBlockedResponse.json();
  assert.equal(currentBlockedBody.job.stale, undefined);
  assert.equal(currentBlockedBody.job.data.status, 'blocked');
  assert.deepEqual(currentBlockedBody.job.data.reasons, blockedResult.reasons);

  const staleBlocked = fixture({ jobStatus: 'completed', jobResult: blockedResult, freshnessUnverified: true });
  const staleBlockedResponse = await staleBlocked.exports.GET(staleBlocked.request('GET', undefined, '?jobId=job-1'), staleBlocked.context);
  const staleBlockedBody = await staleBlockedResponse.json();
  assert.equal(staleBlockedBody.job.stale, true);
  assert.equal(staleBlockedBody.job.data, undefined);
  assert.deepEqual(staleBlockedBody.job.blockedReasons, blockedResult.reasons);

  const completed = fixture({ jobStatus: 'completed', jobExistingPvPowerKw: 5, jobRequiresPvSource: true,
    persistedDraft: { ...draft, existingPv: { ...draft.existingPv, powerKw: 0 }, targetOperatorId: 99, targetTariffId: 100 } });
  const status = await completed.exports.GET(completed.request('GET', undefined, '?jobId=job-1'), completed.context);
  assert.equal(status.status, 200);
  assert.equal(status.headers.get('cache-control'), 'private, no-store');
  assert.equal(completed.calls.some((call) => call.operation === 'dependency-stamp'), true);
  const checkedStamp = completed.calls.find((call) => call.operation === 'dependency-stamp')?.value;
  const checkedDraft = checkedStamp.draft as typeof draft;
  assert.equal(checkedDraft.targetOperatorId, draft.targetOperatorId, 'freshness follows the POST job draft, not the saved draft');
  assert.equal(checkedDraft.targetTariffId, draft.targetTariffId);
  assert.equal(checkedDraft.existingPv.powerKw, 5, 'PV freshness restores exact POST job context, not saved draft defaults');
  assert.equal(checkedStamp.options.requiresPvSource, true, 'GET uses the source participation stored with this job');
  assert.equal(completed.calls.some((call) => call.operation === 'lookup-persistent'), true);

  const oldPrices = fixture({ jobStatus: 'completed', jobPricesAsOf: '2026-10-28' });
  const oldPricesResponse = await oldPrices.exports.GET(oldPrices.request('GET', undefined, '?jobId=job-1'), oldPrices.context);
  const oldPricesBody = await oldPricesResponse.json();
  assert.equal(oldPricesBody.job.stale, true);
  assert.equal(oldPricesBody.job.data, undefined);
  assert.equal(oldPricesBody.job.blockedReasons, undefined, 'freshness failure must not expose a usable result');

  const restarted = fixture({ jobStatus: 'completed', freshnessUnverified: true });
  const restartedResponse = await restarted.exports.GET(restarted.request('GET', undefined, '?jobId=job-1'), restarted.context);
  const restartedBody = await restartedResponse.json();
  assert.equal(restartedBody.job.status, 'completed');
  assert.equal(restartedBody.job.stale, true);
  assert.equal(restartedBody.job.data, undefined);
  assert.equal(restartedBody.job.blockedReasons, undefined);
});

test('POST reuses a persisted result without enqueueing and cache-only misses do not start calculations', async () => {
  for (const cacheOnly of [true, false]) {
    const state = fixture({ cached: true });
    const response = await state.exports.POST(state.request('POST', JSON.stringify({ draft, mode: 'selected', sourceRevision, cacheOnly })), state.context);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.cached, true);
    assert.equal(body.job.status, 'completed');
    assert.deepEqual(body.job.data, calculation);
    assert.equal(state.calls.some(call => call.operation === 'enqueue'), false);
    assert.equal(state.calls.find(call => call.operation === 'draft-lookup')?.value.sourceDependencyStamp, calculation.sourceDependencyStamp);
  }
  const missing = fixture();
  const response = await missing.exports.POST(missing.request('POST', JSON.stringify({ draft, mode: 'selected', sourceRevision, cacheOnly: true })), missing.context);
  assert.deepEqual(await response.json(), { ok: true, job: null, cached: false });
  assert.equal(missing.calls.some(call => call.operation === 'enqueue'), false);
});

test('POST continuation bypasses cache, supplies only the server-loaded parent result, and rejects stale parents', async () => {
  const state = fixture({ cached: true, continuationSource: true });
  const response = await state.exports.POST(state.request('POST', JSON.stringify({
    draft, mode: 'recommend', sourceRevision, continueFromJobId: 'job-parent',
  })), state.context);
  assert.equal(response.status, 202);
  const queued = state.calls.find((call) => call.operation === 'enqueue')?.value;
  assert.deepEqual(queued.continuation, { jobId: 'job-parent', result: previousRecommendation });
  assert.equal(state.calls.some((call) => call.operation === 'draft-lookup'), false,
    'a continuation request does not fall through to the ordinary cached recommendation');
  assert.equal(state.calls.find((call) => call.operation === 'continuation-lookup')?.value.jobId, 'job-parent');

  const stale = fixture({ continuationSource: false });
  const staleResponse = await stale.exports.POST(stale.request('POST', JSON.stringify({
    draft, mode: 'recommend', sourceRevision, continueFromJobId: 'old-parent',
  })), stale.context);
  assert.equal(staleResponse.status, 409);
  assert.equal(stale.calls.some((call) => call.operation === 'enqueue'), false);
  assert.equal(stale.calls.some((call) => call.operation === 'draft-lookup'), false);

  for (const invalid of [
    { mode: 'selected', continueFromJobId: 'job-parent' },
    { mode: 'recommend', continueFromJobId: 'job-parent', cacheOnly: true },
  ]) {
    const invalidState = fixture({ continuationSource: true });
    const invalidResponse = await invalidState.exports.POST(invalidState.request('POST', JSON.stringify({
      draft, sourceRevision, ...invalid,
    })), invalidState.context);
    assert.equal(invalidResponse.status, 400);
    assert.equal(invalidState.calls.some((call) => call.operation === 'enqueue'), false);
  }
});

test('GET returns the same not-found response for unknown jobs and jobs owned by another actor or project', async () => {
  const missingProject = fixture({ missing: true });
  const missingResponse = await missingProject.exports.GET(missingProject.request('GET', undefined, '?jobId=job-1'), missingProject.context);
  assert.equal(missingResponse.status, 404);

  const foreignActor = fixture({ jobOwner: 'other-staff' });
  const actorResponse = await foreignActor.exports.GET(foreignActor.request('GET', undefined, '?jobId=job-1'), foreignActor.context);
  assert.equal(actorResponse.status, 404);

  const foreignProject = fixture({ jobProject: 'other-project' });
  const projectResponse = await foreignProject.exports.GET(foreignProject.request('GET', undefined, '?jobId=job-1'), foreignProject.context);
  assert.equal(projectResponse.status, 404);
});
