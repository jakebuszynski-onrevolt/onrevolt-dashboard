import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyOfferWorkspaceDraft } from './offer-workspace';
import {
  OfferWorkspaceCalculationCapacityError,
  OfferWorkspaceCalculationConflictError,
  OfferWorkspaceCalculationJobStore,
  offerWorkspaceCalculationDraftHash,
  type OfferWorkspaceCalculationJobStoreOptions,
  type OfferWorkspaceCalculationJobRequest,
} from './offer-workspace-calculation-jobs';
import {
  OFFER_WORKSPACE_CALCULATION_ALGORITHM_VERSION,
  PrismaOfferWorkspaceCalculationSnapshotRepository,
} from './offer-workspace-calculation-snapshots';
import type { OfferWorkspaceCalculation } from './offer-workspace-calculation-types';
import type { OfferWorkspace } from './offer-workspace-server';

function result(overrides: Partial<OfferWorkspaceCalculation> = {}): OfferWorkspaceCalculation {
  return Object.assign({
    status: 'ready', reasons: [], warnings: [], baselineAnnualCostPln: 100,
    proposedAnnualCostPln: 80, annualSavingsPln: 20, systemCostPln: 1000,
    costAfterFinancingPln: 1000, paybackYears: 50, grantPln: 0, taxReliefPln: 0,
    rankings: [], recommendedTemplateIds: null,
    ...overrides,
  }, { pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64) }) as OfferWorkspaceCalculation;
}

function partialRecommendation(overrides: Partial<OfferWorkspaceCalculation> = {}, options: {
  jobNumber?: number;
  hasMore?: boolean;
  status?: 'ready' | 'blocked';
} = {}): OfferWorkspaceCalculation {
  const jobNumber = options.jobNumber ?? 1;
  return result({
    status: options.status ?? 'ready',
    recommendationSearch: {
      version: 1, candidateSignature: 'f'.repeat(64),
      evaluatedCandidateIds: Array.from({ length: jobNumber }, (_, index) => `candidate-${index + 1}`),
      totalCandidates: 4, evaluatedCandidates: jobNumber, batchNumber: jobNumber,
      batchEvaluated: 1, hasMore: options.hasMore ?? true,
      phase: 'coarse',
    },
    ...overrides,
  } as Partial<OfferWorkspaceCalculation>);
}

function request(overrides: Partial<OfferWorkspaceCalculationJobRequest> = {}): OfferWorkspaceCalculationJobRequest {
  const draft = overrides.draft ?? emptyOfferWorkspaceDraft();
  return {
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64),
    workspace: { revision: 'a'.repeat(64) } as OfferWorkspace,
    draft, series: null, mode: 'selected', requiresPvSource: (draft.existingPv.powerKw ?? 0) > 0,
    ...overrides,
  };
}

test('commercial row grouping invalidates selected results but not configuration search', () => {
  const plain = emptyOfferWorkspaceDraft();
  plain.selectedTemplateIds = ['bank'];
  const grouped = { ...plain, commercialPricing: { schemaVersion: 1 as const, batteryInstallationScopeConfirmed: true as const,
    allocations: [{ templateId: 'bank', itemId: 'battery', group: 'STORAGE_INSTALLATION' as const }] } };
  assert.notEqual(offerWorkspaceCalculationDraftHash(plain, 'selected'), offerWorkspaceCalculationDraftHash(grouped, 'selected'));
  assert.equal(offerWorkspaceCalculationDraftHash(plain, 'recommend'), offerWorkspaceCalculationDraftHash(grouped, 'recommend'));
});

test('persisted draft lookup survives restart and rejects changed sources, actor, date, mode and input', async () => {
  const repository = snapshotRepository();
  const original = request();
  const running = createStore({ snapshotRepository: repository, createId: () => 'stored-draft' });
  running.enqueue(original, async () => result());
  await settle();
  const restarted = createStore({ snapshotRepository: repository });
  const lookup = { ...original, pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64) };
  const cached = await restarted.findCompletedJobForDraft(lookup);
  assert.equal(cached?.id, 'stored-draft');
  assert.equal(cached?.status, 'completed');
  assert.deepEqual(cached?.data, result());
  for (const change of [
    { actorId: 'someone-else' }, { projectId: 'other-project' }, { sourceRevision: 'b'.repeat(64) },
    { pricesAsOf: '2026-10-30' }, { sourceDependencyStamp: 'd'.repeat(64) }, { sourceDependencyStamp: null },
    { mode: 'recommend' as const }, { draft: { ...original.draft, existingPv: { ...original.draft.existingPv, powerKw: 12 } } },
  ]) assert.equal(await restarted.findCompletedJobForDraft({ ...lookup, ...change }), null);
  assert.ok(await restarted.findCompletedJobForDraft({ ...lookup, draft: { ...original.draft, step: 'SUMMARY', description: { before: 'Tekst', after: 'Inny tekst' } } }));
});

test('blocked partial recommendations persist, restore after restart, and reject stale or superseded parents', async () => {
  const repository = snapshotRepository();
  const draft = emptyOfferWorkspaceDraft();
  const requestBase = request({ mode: 'recommend', draft, requiresPvSource: false });
  const firstStore = createStore({ snapshotRepository: repository, createId: () => 'recommend-parent-1' });
  firstStore.enqueue(requestBase, async () => partialRecommendation({}, { status: 'blocked' }));
  await settle();

  const lookup = {
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft,
    pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64), requiresPvSource: false,
  };
  const restarted = createStore({ snapshotRepository: repository });
  const restored = await restarted.findCompletedJobForDraft({ ...lookup, mode: 'recommend' });
  assert.equal(restored?.id, 'recommend-parent-1');
  assert.equal(restored?.data?.status, 'blocked');
  assert.equal(restored?.data?.recommendationSearch?.hasMore, true);
  assert.deepEqual(await restarted.findRecommendationContinuationForDraft({ ...lookup, jobId: 'recommend-parent-1' }), {
    jobId: 'recommend-parent-1', result: partialRecommendation({}, { status: 'blocked' }),
  });

  for (const change of [
    { actorId: 'other-staff' },
    { draft: { ...draft, calculation: { ...draft.calculation, chargeEfficiencyPercent: 91 } } },
    { sourceRevision: 'b'.repeat(64) },
    { pricesAsOf: '2026-10-30' },
    { sourceDependencyStamp: 'd'.repeat(64) },
    { requiresPvSource: true },
  ]) {
    assert.equal(await restarted.findRecommendationContinuationForDraft({ ...lookup, ...change, jobId: 'recommend-parent-1' }), null);
  }

  const childRequest = request({ ...requestBase, continuation: { jobId: 'recommend-parent-1', result: restored!.data! } });
  restarted.enqueue(childRequest, async () => partialRecommendation({}, { jobNumber: 2, hasMore: false }));
  await settle();
  assert.equal(await restarted.findRecommendationContinuationForDraft({ ...lookup, jobId: 'recommend-parent-1' }), null,
    'a completed later stage supersedes its older parent');
});

test('selected cache restoration prefers the saved selection over a newer different recommendation winner', async () => {
  const repository = snapshotRepository();
  const draft = { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['battery-b'] };
  const store = createStore({ snapshotRepository: repository });
  const selected = result({ proposedAnnualCostPln: 61, recommendedTemplateIds: null });
  store.enqueue(request({ draft, mode: 'selected' }), async () => selected);
  await settle();
  store.enqueue(request({ draft, mode: 'recommend' }), async () => partialRecommendation({
    recommendedTemplateIds: ['battery-a'],
  }, { hasMore: true }));
  await settle();

  const cached = await store.findCompletedJobForDraft({
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft,
    mode: 'selected', pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64),
  });
  assert.equal(cached?.data?.proposedAnnualCostPln, 61);
  assert.equal(cached?.data?.recommendedTemplateIds, null);
});

test('selected cache identity includes configuration edits while recommendation identity ignores them', () => {
  const original = { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['battery'], configurationEdits: [
    { templateId: 'battery', items: [{ itemId: 'storage', quantity: 1 }] },
  ] };
  const changed = { ...original, configurationEdits: [
    { templateId: 'battery', items: [{ itemId: 'storage', quantity: 2 }] },
  ] };
  assert.notEqual(offerWorkspaceCalculationDraftHash(original, 'selected'), offerWorkspaceCalculationDraftHash(changed, 'selected'));
  assert.equal(offerWorkspaceCalculationDraftHash(original, 'recommend'), offerWorkspaceCalculationDraftHash(changed, 'recommend'));
});

test('a recommendation result cannot be reused as selected calculation after a configuration edit', async () => {
  const repository = snapshotRepository();
  const recommendationDraft = { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['battery'] };
  const recommendation = result({ recommendedTemplateIds: ['battery'] });
  const store = createStore({ snapshotRepository: repository, createId: () => 'recommendation-for-default-configuration' });
  store.enqueue(request({ mode: 'recommend', draft: recommendationDraft }), async () => recommendation);
  await settle();

  const editedDraft = { ...recommendationDraft, configurationEdits: [
    { templateId: 'battery', items: [{ itemId: 'storage', quantity: 2 }] },
  ] };
  const lookup = { actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft: editedDraft,
    pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64), requiresPvSource: false };
  assert.equal(store.findCompletedOfferCalculation(lookup, lookup.pricesAsOf, lookup.sourceDependencyStamp), null);
  assert.equal(await store.findCompletedOfferCalculationPersistent(lookup), null);
  assert.equal(await store.findCompletedJobForDraft({ ...lookup, mode: 'selected' }), null);
});

test('selected restore pages old recommendation stages to find the selected B after latest winner changed to A', async () => {
  const repository = snapshotRepository();
  const draft = { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['battery-b'] };
  const store = createStore({ snapshotRepository: repository, createId: (() => { let id = 0; return () => `phase-${++id}`; })() });
  store.enqueue(request({ draft, mode: 'recommend' }), async () => partialRecommendation({ recommendedTemplateIds: ['battery-b'] }));
  await settle();
  store.enqueue(request({ draft, mode: 'recommend' }), async () => partialRecommendation({ recommendedTemplateIds: ['battery-a'] }, { jobNumber: 2 }));
  await settle();

  const cached = await store.findCompletedJobForDraft({
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft,
    mode: 'selected', pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64),
  });
  assert.equal(cached?.id, 'phase-1');
  assert.deepEqual(repository.queries.slice(-3).map(query => query.offset), [0, 0, 1]);
});

test('continuation passes only the trusted previous result, deduplicates by parent, and permits retry after failure', async () => {
  const repository = snapshotRepository();
  const draft = emptyOfferWorkspaceDraft();
  const parent = partialRecommendation();
  const store = createStore({ snapshotRepository: repository, createId: (() => { let id = 0; return () => `continue-${++id}`; })() });
  store.enqueue(request({ mode: 'recommend', draft }), async () => parent);
  await settle();
  const continuation = { jobId: 'continue-1', result: parent };
  const continuationRequest = request({ mode: 'recommend', draft, continuation });
  const gate = deferred<OfferWorkspaceCalculation>();
  let previousSeen: OfferWorkspaceCalculation | undefined;
  const child = store.enqueue(continuationRequest, async (_workspace, _draft, _series, _mode, _progress, previous) => {
    previousSeen = previous;
    return gate.promise;
  });
  const repeated = store.enqueue(continuationRequest, async () => result());
  assert.equal(repeated.job.id, child.job.id);
  assert.equal(repeated.reused, true);
  assert.equal(previousSeen, parent);
  gate.resolve(partialRecommendation({}, { jobNumber: 2 }));
  await settle();
  const afterCompletion = store.enqueue(continuationRequest, async () => result());
  assert.equal(afterCompletion.job.id, child.job.id);
  assert.equal(afterCompletion.reused, true);
  assert.equal(afterCompletion.job.status, 'completed');
  assert.equal(store.getForActorProject('continue-1', 'staff-1', 'project-1'), null,
    'the consumed parent result is released from the in-memory job cache after its child is saved');
  assert.ok(await store.findRecommendationContinuationForDraft({
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft,
    jobId: 'continue-2', pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64), requiresPvSource: false,
  }));

  const retryStore = createStore({ snapshotRepository: repository, createId: () => 'continue-failed' });
  retryStore.enqueue(request({ mode: 'recommend', draft }), async () => partialRecommendation({}, { jobNumber: 3 }));
  await settle();
  const retryParent = await retryStore.findRecommendationContinuationForDraft({
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft,
    jobId: 'continue-failed', pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64), requiresPvSource: false,
  });
  assert.ok(retryParent);
  retryStore.enqueue(request({ mode: 'recommend', draft, continuation: retryParent! }), async () => { throw new Error('failure'); });
  await settle();
  assert.equal((await retryStore.findRecommendationContinuationForDraft({
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft,
    jobId: 'continue-failed', pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64), requiresPvSource: false,
  }))?.jobId, 'continue-failed', 'a failed child leaves its persisted parent available for retry');
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function snapshotRepository(options: {
  failSave?: boolean;
  saveGate?: Promise<void>;
  enforceDeadline?: boolean;
  now?: () => number;
} = {}) {
  const rows: any[] = [];
  const saveCalls: any[] = [];
  const queries: any[] = [];
  return {
    rows, saveCalls, queries,
    savePending: async (input: any) => {
      saveCalls.push(input);
      if (options.saveGate) await options.saveGate;
      if (options.enforceDeadline && (options.now?.() ?? Date.now()) > input.deadlineAt.getTime()) throw new Error('deadline exceeded');
      if (options.failSave) throw new Error('private SQL failure');
      rows.unshift({ ...input, admittedAt: null });
    },
    admitCompleted: async (input: any) => {
      const row = rows.find((item) => item.jobId === input.jobId && item.actorId === input.actorId
        && item.projectId === input.projectId && item.algorithmVersion === input.algorithmVersion);
      if (!row || (options.now?.() ?? Date.now()) >= input.deadlineAt.getTime()) throw new Error('deadline exceeded');
      row.admittedAt = new Date(options.now?.() ?? Date.now());
    },
    findCompletedByJob: async (query: any) => {
      queries.push(query);
      return rows.find((row) => row.admittedAt && row.jobId === query.jobId && row.actorId === query.actorId
        && row.projectId === query.projectId && row.algorithmVersion === query.algorithmVersion) || null;
    },
    findSavedForDrafts: async (query: any) => rows.filter(row => row.admittedAt
      && row.actorId === query.actorId && row.projectId === query.projectId && query.draftHashes.includes(row.draftHash))
      .slice(query.offset ?? 0, (query.offset ?? 0) + 1),
    findCompletedForDrafts: async (query: any) => {
      queries.push(query);
      return rows.filter((row) => row.admittedAt && row.actorId === query.actorId && row.projectId === query.projectId
        && row.sourceRevision === query.sourceRevision && row.algorithmVersion === query.algorithmVersion
        && row.pricesAsOf === query.pricesAsOf && row.sourceDependencyStamp === query.sourceDependencyStamp
        && query.draftHashes.includes(row.draftHash))
        .slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 10));
    },
  };
}

function prismaSnapshotRepository(options: {
  createGate?: Promise<void>;
  createdAt?: (data: any) => Date;
} = {}) {
  const rows = new Map<string, any>();
  const admissions = new Map<string, { admittedAt: Date }>();
  const createStarted = deferred<void>();
  const matches = (row: any, where: any) => Object.entries(where as Record<string, any>).every(([key, value]) => {
    if (key === 'admission') return value?.isNot === null ? admissions.has(row.jobId) : true;
    if (key === 'deadlineAt') return row.deadlineAt.getTime() > value.gt.getTime();
    if (key === 'draftHash' && value && typeof value === 'object' && 'in' in value) return value.in.includes(row.draftHash);
    return row[key] === value;
  });
  const database = {
    offerWorkspaceCalculationSnapshot: {
      create: async ({ data }: any) => {
        createStarted.resolve();
        if (options.createGate) await options.createGate;
        const row = {
          ...data,
          id: `snapshot-${data.jobId}`,
          createdAt: options.createdAt?.(data) ?? new Date(),
        };
        rows.set(data.jobId, row);
        return row;
      },
      findFirst: async ({ where }: any) => {
        const row = rows.get(where.jobId);
        return row && matches(row, where) ? { ...row, admission: admissions.get(row.jobId) ?? null } : null;
      },
      findMany: async ({ where, take, skip }: any) => [...rows.values()]
        .filter((row) => matches(row, where))
        .slice(skip ?? 0, (skip ?? 0) + take)
        .map((row) => ({ ...row, admission: admissions.get(row.jobId) ?? null })),
    },
    offerWorkspaceCalculationSnapshotAdmission: {
      create: async ({ data }: any) => {
        if (!rows.has(data.jobId)) throw new Error('missing snapshot');
        const admission = { admittedAt: new Date() };
        admissions.set(data.jobId, admission);
        return admission;
      },
    },
  };
  return {
    repository: new PrismaOfferWorkspaceCalculationSnapshotRepository(database as any),
    rows,
    admissions,
    createStarted: createStarted.promise,
  };
}

function createStore(options: OfferWorkspaceCalculationJobStoreOptions = {}) {
  return new OfferWorkspaceCalculationJobStore({ ...options, snapshotRepository: options.snapshotRepository || snapshotRepository() });
}

test('saved offer A survives visiting B, restart, a new date and an engine/source update without recalculation', async () => {
  const repository = snapshotRepository();
  let runs = 0;
  const a = request({ draft: { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['battery-a'] } });
  const b = request({ projectId: 'project-b', draft: { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['battery-b'] } });
  const store = createStore({ snapshotRepository: repository });
  store.enqueue(a, async () => { runs++; return result({ annualSavingsPln: 1234, grantPln: 16000 }); });
  await settle();
  store.enqueue(b, async () => { runs++; return result({ annualSavingsPln: 999 }); });
  await settle();
  for (const row of repository.rows) row.algorithmVersion = 'previous-engine';
  const restarted = createStore({ snapshotRepository: repository });
  const lookupA = { ...a, sourceRevision: 'new-source', pricesAsOf: '2030-01-01', sourceDependencyStamp: 'e'.repeat(64) };
  assert.equal(await restarted.findCompletedJobForDraft(lookupA), null, 'new calculations still require fresh inputs');
  for (const input of [lookupA, b, lookupA]) {
    const saved = await restarted.findSavedJobForDraft(input);
    assert.equal(saved?.data?.annualSavingsPln, input.projectId === a.projectId ? 1234 : 999);
    assert.ok(saved?.savedAt);
  }
  assert.equal((await restarted.findSavedJobForDraft(lookupA))?.data?.grantPln, 16000);
  for (const change of [{ actorId: 'other' }, { projectId: 'other' },
    { draft: { ...a.draft, selectedTemplateIds: ['different'] } },
    { draft: { ...a.draft, financing: { ...a.draft.financing, considerGrant: !a.draft.financing.considerGrant } } },
  ]) assert.equal(await restarted.findSavedJobForDraft({ ...lookupA, ...change }), null);
  assert.equal(runs, 2, 'restoring offers never invokes calculation');
});

test('saved catalogue recommendation cannot replace a manually priced offer', async () => {
  const repository = snapshotRepository();
  const draft = { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['battery-a'] };
  const store = createStore({ snapshotRepository: repository });
  store.enqueue(request({ draft, mode: 'recommend' }), async () => result({ recommendedTemplateIds: ['battery-a'] }));
  await settle();
  assert.ok(await store.findSavedJobForDraft(request({ draft })));
  const manual = { ...draft, commercialPricing: { schemaVersion: 1 as const, batteryInstallationScopeConfirmed: true as const, allocations: [] } };
  assert.equal(await store.findSavedJobForDraft(request({ draft: manual })), null);
});

test('deduplicates identical running work and limits concurrent executions globally per store', () => {
  const store = createStore({ maxRunning: 2, createId: (() => { let id = 0; return () => `job-${++id}`; })() });
  const firstGate = deferred<OfferWorkspaceCalculation>();
  const secondGate = deferred<OfferWorkspaceCalculation>();
  let runs = 0;
  const runner = async () => { runs += 1; return firstGate.promise; };
  const first = store.enqueue(request(), runner);
  const reused = store.enqueue(request(), async () => { runs += 1; return result(); });
  const second = store.enqueue(request({ projectId: 'project-2' }), async () => secondGate.promise);

  assert.equal(first.job.id, reused.job.id);
  assert.equal(reused.reused, true);
  assert.equal(second.reused, false);
  assert.equal(runs, 1);
  assert.throws(() => store.enqueue(request({ projectId: 'project-3' }), async () => result()), OfferWorkspaceCalculationCapacityError);

  firstGate.resolve(result());
  secondGate.resolve(result());
});

test('different active requests for one project conflict without exposing the job, across revisions or actors', () => {
  const store = createStore({ createId: (() => { let id = 0; return () => `project-job-${++id}`; })() });
  const gate = deferred<OfferWorkspaceCalculation>();
  let runs = 0;
  const first = store.enqueue(request(), async () => { runs += 1; return gate.promise; });
  assert.throws(() => store.enqueue(request({ sourceRevision: 'b'.repeat(64), mode: 'recommend' }), async () => {
    runs += 1;
    return result();
  }), OfferWorkspaceCalculationConflictError);
  assert.throws(() => store.enqueue(request({ actorId: 'staff-2', projectId: 'project-1' }), async () => result()), OfferWorkspaceCalculationCapacityError);
  assert.equal(runs, 1);
  assert.equal(store.getForActorProject(first.job.id, 'staff-1', 'project-1')?.status, 'running');

  gate.resolve(result());
});

test('same project with another target tariff conflicts while an identical request still deduplicates', () => {
  const store = createStore({ createId: () => 'tariff-job' });
  const submitted = emptyOfferWorkspaceDraft();
  submitted.targetOperatorId = 7;
  submitted.targetTariffId = 22;
  const gate = deferred<OfferWorkspaceCalculation>();
  const first = store.enqueue(request({ draft: submitted }), async () => gate.promise);
  const identical = store.enqueue(request({ draft: { ...submitted } }), async () => result());
  assert.equal(identical.job.id, first.job.id);
  assert.equal(identical.reused, true);
  assert.equal(identical.stale, false);

  const changed = { ...submitted, targetTariffId: 44 };
  assert.throws(() => store.enqueue(request({ draft: changed }), async () => result()), OfferWorkspaceCalculationConflictError);
  assert.equal(store.getForActorProject(first.job.id, 'staff-1', 'project-1')?.id, 'tariff-job');
  gate.resolve(result());
});

test('progress and completed data are scoped to the creating actor and project', async () => {
  const store = createStore({ createId: () => 'job-progress' });
  const gate = deferred<OfferWorkspaceCalculation>();
  const queued = store.enqueue(request(), async (_workspace, _draft, _series, _mode, onProgress) => {
    onProgress?.(3, 9);
    return gate.promise;
  });
  assert.deepEqual(store.getForActorProject(queued.job.id, 'staff-1', 'project-1'), {
    id: 'job-progress', status: 'running', completed: 3, total: 9, sourceRevision: 'a'.repeat(64),
  });
  assert.equal(store.getForActorProject(queued.job.id, 'staff-2', 'project-1'), null);
  assert.equal(store.getForActorProject(queued.job.id, 'staff-1', 'project-2'), null);

  const completed = result();
  gate.resolve(completed);
  await settle();
  assert.deepEqual(store.getForActorProject(queued.job.id, 'staff-1', 'project-1'), {
    id: 'job-progress', status: 'completed', completed: 9, total: 9,
    data: completed, sourceRevision: 'a'.repeat(64),
  });
});

test('worker failures expose only a generic error and never retain internal details', async () => {
  const store = createStore({ createId: () => 'job-fail' });
  const queued = store.enqueue(request(), async () => { throw new Error('secret stack and vendor details'); });
  await settle();
  const view = store.getForActorProject(queued.job.id, 'staff-1', 'project-1');
  assert.equal(view?.status, 'failed');
  assert.equal(view?.error, 'Obliczenie nie powiodło się.');
  assert.equal(JSON.stringify(view).includes('secret stack'), false);
});

test('15-minute timeout reports failure but keeps the concurrency slot until the worker really settles', async () => {
  const store = createStore({ maxRunning: 1, timeBudgetMs: 10, createId: (() => { let id = 0; return () => `timeout-${++id}`; })() });
  const gate = deferred<OfferWorkspaceCalculation>();
  const queued = store.enqueue(request(), async () => gate.promise);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const timedOut = store.getForActorProject(queued.job.id, 'staff-1', 'project-1');
  assert.equal(timedOut?.status, 'failed');
  assert.match(timedOut?.error ?? '', /15 minut/);
  assert.throws(() => store.enqueue(request({ projectId: 'project-2' }), async () => result()), OfferWorkspaceCalculationCapacityError);

  gate.resolve(result());
  await settle();
  const next = store.enqueue(request({ projectId: 'project-2' }), async () => result());
  assert.equal(next.job.status, 'running');
});

test('runner completion after the wall-clock deadline is rejected even before the timeout callback runs', async () => {
  let now = 1_000;
  const repository = snapshotRepository();
  const store = createStore({ now: () => now, timeBudgetMs: 100, snapshotRepository: repository, createId: () => 'late-runner' });
  const gate = deferred<OfferWorkspaceCalculation>();
  const queued = store.enqueue(request(), async () => gate.promise);

  now += 101;
  gate.resolve(result());
  await settle();

  const view = store.getForActorProject(queued.job.id, 'staff-1', 'project-1');
  assert.equal(view?.status, 'failed');
  assert.equal(view?.data, undefined);
  assert.match(view?.error ?? '', /15 minut/);
  assert.equal(repository.saveCalls.length, 0);
});

test('finished history is capped and expires after the configured TTL', async () => {
  let now = 1_000;
  let id = 0;
  const repository = snapshotRepository({ now: () => now });
  const store = createStore({ maxRunning: 1, maxJobs: 2, ttlMs: 50, now: () => now, createId: () => `job-${++id}`, snapshotRepository: repository });
  const runner = async () => result();

  const first = store.enqueue(request({ projectId: 'project-1' }), runner);
  await settle();
  const second = store.enqueue(request({ projectId: 'project-2' }), runner);
  await settle();
  const third = store.enqueue(request({ projectId: 'project-3' }), runner);
  assert.equal(store.getForActorProject(first.job.id, 'staff-1', 'project-1'), null);
  assert.equal(store.getForActorProject(second.job.id, 'staff-1', 'project-2')?.status, 'completed');
  await settle();
  assert.equal(store.getForActorProject(third.job.id, 'staff-1', 'project-3')?.status, 'completed');

  now += 51;
  assert.equal(store.getForActorProject(second.job.id, 'staff-1', 'project-2'), null);
  assert.equal(store.getForActorProject(third.job.id, 'staff-1', 'project-3'), null);
});

test('completed-result lookup ignores UI step and description but scopes actor, project, and source revision', async () => {
  const store = createStore({ createId: () => 'job-selected' });
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['battery-1'];
  const queued = store.enqueue(request({ draft }), async () => result());
  await settle();

  const matchingDraft = { ...draft, step: 'SUMMARY' as const, description: { before: 'different', after: 'text' } };
  assert.deepEqual(store.findCompletedOfferCalculation({
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft: matchingDraft,
  }), result());
  assert.equal(store.findCompletedOfferCalculation({
    actorId: 'staff-2', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft: matchingDraft,
  }), null);
  assert.equal(store.findCompletedOfferCalculation({
    actorId: 'staff-1', projectId: 'project-2', sourceRevision: 'a'.repeat(64), draft: matchingDraft,
  }), null);
  assert.equal(store.findCompletedOfferCalculation({
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'b'.repeat(64), draft: matchingDraft,
  }), null);
  assert.equal(store.getForActorProject(queued.job.id, 'staff-1', 'project-1')?.status, 'completed');
});

test('recommend results match only when their winners exactly equal the requested draft selection', async () => {
  const store = createStore({ createId: () => 'job-recommend' });
  const recommendationDraft = emptyOfferWorkspaceDraft();
  recommendationDraft.selectedTemplateIds = [];
  const winners = ['battery-1', 'pv-2'];
  store.enqueue(request({ draft: recommendationDraft, mode: 'recommend' }), async () => result({ recommendedTemplateIds: winners }));
  await settle();

  const winningDraft = { ...recommendationDraft, selectedTemplateIds: ['pv-2', 'battery-1'] };
  assert.equal(store.findCompletedOfferCalculation({
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft: winningDraft,
  })?.recommendedTemplateIds, winners);
  const otherDraft = { ...recommendationDraft, selectedTemplateIds: ['battery-1'] };
  assert.equal(store.findCompletedOfferCalculation({
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft: otherDraft,
  }), null);
});

test('estimated recommendation can feed the selected draft only for its actually evaluated templates', async () => {
  const repository = snapshotRepository();
  const draft = emptyOfferWorkspaceDraft();
  const value = result({ recommendedTemplateIds: null, estimatedRecommendedTemplateIds: ['battery-1'],
    evaluatedTemplateIds: ['battery-1'], estimatedPaybackYears: 8.1 });
  const store = createStore({ snapshotRepository: repository, createId: () => 'estimated-job' });
  store.enqueue(request({ draft, mode: 'recommend' }), async () => value);
  await settle();
  const lookup = { actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64),
    draft: { ...draft, selectedTemplateIds: ['battery-1'] } };
  assert.deepEqual(store.findCompletedOfferCalculation(lookup), value);
  assert.equal(store.findCompletedOfferCalculation({ ...lookup, draft: { ...draft, selectedTemplateIds: ['battery-2'] } }), null);
  const restarted = createStore({ snapshotRepository: repository });
  assert.deepEqual(await restarted.findCompletedOfferCalculationPersistent({ ...lookup,
    pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64) }), value);
});

test('job stays running without data until its immutable result snapshot is persisted', async () => {
  const gate = deferred<void>();
  const repository = snapshotRepository({ saveGate: gate.promise });
  const store = createStore({ snapshotRepository: repository, createId: () => 'persist-before-complete' });
  const jobRequest = request();
  const queued = store.enqueue(jobRequest, async (_workspace, _draft, _series, _mode, onProgress) => {
    onProgress(2, 9);
    return result();
  });

  await settle();
  assert.equal(store.getForActorProject(queued.job.id, 'staff-1', 'project-1')?.status, 'running');
  assert.equal(store.getForActorProject(queued.job.id, 'staff-1', 'project-1')?.data, undefined);
  assert.deepEqual({
    actorId: repository.saveCalls[0].actorId,
    projectId: repository.saveCalls[0].projectId,
    sourceRevision: repository.saveCalls[0].sourceRevision,
    draftHash: repository.saveCalls[0].draftHash,
    algorithmVersion: repository.saveCalls[0].algorithmVersion,
    pricesAsOf: repository.saveCalls[0].pricesAsOf,
    sourceDependencyStamp: repository.saveCalls[0].sourceDependencyStamp,
  }, {
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64),
    draftHash: offerWorkspaceCalculationDraftHash(jobRequest.draft, 'selected'),
    algorithmVersion: OFFER_WORKSPACE_CALCULATION_ALGORITHM_VERSION,
    pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64),
  });

  gate.resolve();
  await settle();
  assert.equal(store.getForActorProject(queued.job.id, 'staff-1', 'project-1')?.status, 'completed');
  assert.equal(repository.rows.length, 1);
});

test('snapshot write failure fails the job and never exposes a completed result', async () => {
  const store = createStore({ snapshotRepository: snapshotRepository({ failSave: true }), createId: () => 'persist-failure' });
  const queued = store.enqueue(request(), async () => result());
  await settle();

  const view = store.getForActorProject(queued.job.id, 'staff-1', 'project-1');
  assert.equal(view?.status, 'failed');
  assert.equal(view?.data, undefined);
  assert.equal(view?.error, 'Obliczenie nie powiodło się.');
  assert.equal(JSON.stringify(view).includes('private SQL'), false);
});

test('timed-out snapshot writes release capacity and a late save cannot publish completed', async () => {
  const gate = deferred<void>();
  const repository = snapshotRepository({ saveGate: gate.promise, enforceDeadline: true });
  let id = 0;
  const store = createStore({ maxRunning: 1, timeBudgetMs: 20, snapshotRepository: repository, createId: () => `save-timeout-${++id}` });
  const queued = store.enqueue(request(), async () => result());

  await settle();
  assert.equal(repository.saveCalls.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 35));
  const timedOut = store.getForActorProject(queued.job.id, 'staff-1', 'project-1');
  assert.equal(timedOut?.status, 'failed');
  assert.equal(timedOut?.data, undefined);
  assert.match(timedOut?.error ?? '', /15 minut/);
  const next = store.enqueue(request({ projectId: 'project-2' }), async () => { throw new Error('runner failed'); });
  assert.equal(next.job.status, 'running');
  await settle();
  assert.equal(store.getForActorProject(next.job.id, 'staff-1', 'project-2')?.status, 'failed');

  gate.resolve();
  await settle();
  const afterLateSave = store.getForActorProject(queued.job.id, 'staff-1', 'project-1');
  assert.equal(afterLateSave?.status, 'failed');
  assert.equal(afterLateSave?.data, undefined);
  assert.equal(repository.rows.length, 0);
});

test('real Prisma repository cannot resurrect a timed-out late orphan even with a pre-deadline createdAt', async () => {
  const insertGate = deferred<void>();
  const database = prismaSnapshotRepository({
    createGate: insertGate.promise,
    createdAt: (data) => new Date(data.deadlineAt.getTime() - 1),
  });
  let id = 0;
  const store = createStore({
    maxRunning: 1,
    timeBudgetMs: 60,
    snapshotRepository: database.repository,
    createId: () => `late-orphan-job-${++id}`,
  });
  const jobRequest = request();
  const queued = store.enqueue(jobRequest, async () => result());
  await database.createStarted;
  await new Promise((resolve) => setTimeout(resolve, 90));

  assert.equal(store.getForActorProject(queued.job.id, 'staff-1', 'project-1')?.status, 'failed');
  assert.equal(database.admissions.has(queued.job.id), false);
  assert.doesNotThrow(() => store.enqueue(request({ projectId: 'project-2' }), async () => { throw new Error('runner failed'); }));

  insertGate.resolve();
  await settle();
  const orphan = database.rows.get(queued.job.id);
  assert.ok(orphan);
  assert.ok(orphan.createdAt.getTime() < orphan.deadlineAt.getTime());
  const restarted = createStore({ snapshotRepository: database.repository });
  assert.equal(await restarted.getForActorProjectPersistent(queued.job.id, 'staff-1', 'project-1'), null);
  assert.equal(await restarted.findCompletedOfferCalculationPersistent({
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: jobRequest.sourceRevision,
    draft: jobRequest.draft, pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64),
  }), null);
});

test('real Prisma repository restores an admitted result after a store restart', async () => {
  const database = prismaSnapshotRepository();
  const jobRequest = request();
  const firstStore = createStore({ snapshotRepository: database.repository, createId: () => 'admitted-job' });
  firstStore.enqueue(jobRequest, async () => result());
  await settle();
  assert.equal(database.admissions.has('admitted-job'), true);

  const restarted = createStore({ snapshotRepository: database.repository });
  const restored = await restarted.getForActorProjectPersistent('admitted-job', 'staff-1', 'project-1');
  assert.equal(restored?.status, 'completed');
  assert.deepEqual(restored?.data, result());
  assert.deepEqual(await restarted.findCompletedOfferCalculationPersistent({
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: jobRequest.sourceRevision,
    draft: jobRequest.draft, pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64),
  }), result());
});

test('durable completed lookup after cache loss requires actor, project, revision, draft, algorithm, as-of, and dependency stamp', async () => {
  const repository = snapshotRepository();
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['battery-1'];
  const firstStore = createStore({ snapshotRepository: repository, createId: () => 'durable-job' });
  firstStore.enqueue(request({ draft }), async () => result());
  await settle();

  const afterRestart = createStore({ snapshotRepository: repository });
  const restored = await afterRestart.getForActorProjectPersistent('durable-job', 'staff-1', 'project-1');
  assert.equal(restored?.status, 'completed');
  assert.deepEqual(restored?.data, result());
  const freshStatus = await afterRestart.getForActorProjectPersistent('durable-job', 'staff-1', 'project-1', {
    sourceRevision: 'a'.repeat(64), dependencyContext: {
      targetOperatorId: draft.targetOperatorId, targetTariffId: draft.targetTariffId,
      currentSettlement: draft.currentSettlement, targetSettlement: draft.targetSettlement,
      existingPvPowerKw: draft.existingPv.powerKw,
      requiresPvSource: false,
    }, pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64),
  });
  assert.equal(freshStatus?.freshnessUnverified, undefined);
  const changedDependency = {
    targetOperatorId: draft.targetOperatorId, targetTariffId: 45,
    currentSettlement: draft.currentSettlement, targetSettlement: draft.targetSettlement,
    existingPvPowerKw: draft.existingPv.powerKw,
    requiresPvSource: false,
  };
  const staleStatus = await afterRestart.getForActorProjectPersistent('durable-job', 'staff-1', 'project-1', {
    sourceRevision: 'a'.repeat(64), dependencyContext: changedDependency,
    pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64),
  });
  assert.equal(staleStatus?.freshnessUnverified, true);
  const changedPvContext = await afterRestart.getForActorProjectPersistent('durable-job', 'staff-1', 'project-1', {
    sourceRevision: 'a'.repeat(64), dependencyContext: {
      ...changedDependency,
      targetTariffId: draft.targetTariffId,
      existingPvPowerKw: 5,
      requiresPvSource: true,
    }, pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64),
  });
  assert.equal(changedPvContext?.freshnessUnverified, true,
    'freshness also compares the persisted PV power and source participation');

  const lookup = { actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft };
  assert.deepEqual(await afterRestart.findCompletedOfferCalculationPersistent({
    ...lookup, pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64),
  }), result());
  assert.equal(await afterRestart.findCompletedOfferCalculationPersistent({
    ...lookup, pricesAsOf: '2026-10-28', sourceDependencyStamp: 'c'.repeat(64),
  }), null);
  assert.equal(await afterRestart.findCompletedOfferCalculationPersistent({
    ...lookup, pricesAsOf: '2026-10-29', sourceDependencyStamp: 'd'.repeat(64),
  }), null);
  assert.equal(await afterRestart.findCompletedOfferCalculationPersistent({
    ...lookup, actorId: 'staff-2', pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64),
  }), null);
  assert.equal(await afterRestart.findCompletedOfferCalculationPersistent({
    ...lookup, projectId: 'project-2', pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64),
  }), null);
  assert.ok(repository.queries.every((query) => query.algorithmVersion === OFFER_WORKSPACE_CALCULATION_ALGORITHM_VERSION));
});
