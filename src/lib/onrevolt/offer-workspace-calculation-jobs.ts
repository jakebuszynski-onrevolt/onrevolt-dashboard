import { createHash, randomUUID } from 'node:crypto';
import { defaultOfferCalculationAssumptions, type OfferWorkspaceDraft } from './offer-workspace';
import type { OfferMeasurementSeries } from './offer-measurements';
import type { OfferWorkspace } from './offer-workspace-server';
import type { OfferWorkspaceCalculation } from './offer-workspace-calculation-types';
import {
  OFFER_WORKSPACE_CALCULATION_ALGORITHM_VERSION,
  offerWorkspaceCalculationSnapshots,
  type OfferWorkspaceCalculationDependencyContext,
  type OfferWorkspaceCalculationSnapshotRepository,
} from './offer-workspace-calculation-snapshots';

export type OfferWorkspaceCalculationMode = 'selected' | 'recommend';
export type OfferWorkspaceCalculationJobStatus = 'running' | 'completed' | 'failed';

export interface OfferWorkspaceCalculationJobView {
  id: string;
  status: OfferWorkspaceCalculationJobStatus;
  completed: number;
  total: number;
  data?: OfferWorkspaceCalculation;
  error?: string;
  sourceRevision: string;
}

export interface OfferWorkspaceCalculationJobRequest {
  actorId: string;
  projectId: string;
  sourceRevision: string;
  workspace: OfferWorkspace;
  draft: OfferWorkspaceDraft;
  series: OfferMeasurementSeries | null;
  mode: OfferWorkspaceCalculationMode;
}

export type OfferWorkspaceCalculationJobRunner = (
  workspace: OfferWorkspace,
  draft: OfferWorkspaceDraft,
  series: OfferMeasurementSeries | null,
  mode: OfferWorkspaceCalculationMode,
  onProgress: (done: number, total: number) => void,
) => Promise<OfferWorkspaceCalculation>;

export interface CompletedOfferCalculationLookup {
  actorId: string;
  projectId: string;
  sourceRevision: string;
  draft: OfferWorkspaceDraft;
}

export class OfferWorkspaceCalculationCapacityError extends Error {
  constructor() {
    super('Obliczenia są chwilowo zajęte. Spróbuj ponownie za chwilę.');
    this.name = 'OfferWorkspaceCalculationCapacityError';
  }
}

export class OfferWorkspaceCalculationConflictError extends Error {
  constructor() {
    super('Inny zestaw danych jest już obliczany dla tego projektu. Poczekaj na jego zakończenie.');
    this.name = 'OfferWorkspaceCalculationConflictError';
  }
}

interface StoredJob extends OfferWorkspaceCalculationJobView {
  actorId: string;
  projectId: string;
  mode: OfferWorkspaceCalculationMode;
  draftHash: string;
  algorithmVersion: string;
  createdAt: number;
  executionActive: boolean;
  dependencyContext: OfferWorkspaceCalculationDependencyContext;
  deadlineAt: Date;
  request?: OfferWorkspaceCalculationJobRequest;
}

export interface OfferWorkspaceCalculationFreshnessCheck {
  sourceRevision: string;
  dependencyContext: OfferWorkspaceCalculationDependencyContext;
  pricesAsOf: string;
  sourceDependencyStamp: string | null;
}

export type OfferWorkspaceCalculationFreshnessLoader =
  (job: OfferWorkspaceCalculationJobView, dependencyContext: OfferWorkspaceCalculationDependencyContext) => Promise<OfferWorkspaceCalculationFreshnessCheck | null>;

export interface OfferWorkspaceCalculationJobStoreOptions {
  maxRunning?: number;
  maxJobs?: number;
  ttlMs?: number;
  timeBudgetMs?: number;
  now?: () => number;
  createId?: () => string;
  snapshotRepository?: OfferWorkspaceCalculationSnapshotRepository;
}

const DEFAULT_MAX_RUNNING = 2;
const DEFAULT_MAX_JOBS = 8;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TIME_BUDGET_MS = 15 * 60 * 1000;

function sortedIds(ids: string[]): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function calculationDraftIdentity(draft: OfferWorkspaceDraft, mode: OfferWorkspaceCalculationMode) {
  return {
    schemaVersion: draft.schemaVersion,
    objective: draft.objective,
    existingBatteryPresent: draft.existingBatteryPresent ?? null,
    existingPv: {
      powerKw: draft.existingPv.powerKw,
      tiltDegrees: draft.existingPv.tiltDegrees,
      azimuthDegrees: draft.existingPv.azimuthDegrees,
      lossPercent: draft.existingPv.lossPercent,
    },
    pvStrategy: draft.pvStrategy,
    currentSettlement: draft.currentSettlement,
    targetSettlement: draft.targetSettlement,
    targetOperatorId: draft.targetOperatorId,
    targetTariffId: draft.targetTariffId,
    saleVatMode: draft.saleVatMode,
    selectedTemplateIds: mode === 'selected' ? sortedIds(draft.selectedTemplateIds) : undefined,
    financing: draft.financing,
    calculation: draft.calculation ?? defaultOfferCalculationAssumptions(),
  };
}

export function offerWorkspaceCalculationDraftHash(
  draft: OfferWorkspaceDraft,
  mode: OfferWorkspaceCalculationMode,
): string {
  return createHash('sha256').update(JSON.stringify(calculationDraftIdentity(draft, mode))).digest('hex');
}

function sameIds(left: string[] | null | undefined, right: string[]): boolean {
  return Array.isArray(left) && JSON.stringify(sortedIds(left)) === JSON.stringify(sortedIds(right));
}

function dependencyContext(draft: OfferWorkspaceDraft): OfferWorkspaceCalculationDependencyContext {
  return {
    targetOperatorId: draft.targetOperatorId,
    targetTariffId: draft.targetTariffId,
    currentSettlement: draft.currentSettlement,
    targetSettlement: draft.targetSettlement,
  };
}

function sameDependencyContext(
  left: OfferWorkspaceCalculationDependencyContext,
  right: OfferWorkspaceCalculationDependencyContext,
): boolean {
  return left.targetOperatorId === right.targetOperatorId && left.targetTariffId === right.targetTariffId
    && left.currentSettlement === right.currentSettlement && left.targetSettlement === right.targetSettlement;
}

function publicView(job: StoredJob): OfferWorkspaceCalculationJobView {
  return {
    id: job.id,
    status: job.status,
    completed: job.completed,
    total: job.total,
    ...(job.data ? { data: job.data } : {}),
    ...(job.error ? { error: job.error } : {}),
    sourceRevision: job.sourceRevision,
  };
}

export class OfferWorkspaceCalculationJobStore {
  private readonly jobs = new Map<string, StoredJob>();
  private readonly maxRunning: number;
  private readonly maxJobs: number;
  private readonly ttlMs: number;
  private readonly timeBudgetMs: number;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly snapshots: OfferWorkspaceCalculationSnapshotRepository;

  constructor(options: OfferWorkspaceCalculationJobStoreOptions = {}) {
    this.maxRunning = options.maxRunning ?? DEFAULT_MAX_RUNNING;
    this.maxJobs = options.maxJobs ?? DEFAULT_MAX_JOBS;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.snapshots = options.snapshotRepository ?? offerWorkspaceCalculationSnapshots;
    if (!Number.isSafeInteger(this.maxRunning) || this.maxRunning < 1
      || !Number.isSafeInteger(this.maxJobs) || this.maxJobs < this.maxRunning
      || !Number.isFinite(this.ttlMs) || this.ttlMs <= 0
      || !Number.isFinite(this.timeBudgetMs) || this.timeBudgetMs <= 0) {
      throw new RangeError('Nieprawidłowe limity zadań obliczeniowych.');
    }
  }

  enqueue(request: OfferWorkspaceCalculationJobRequest, runner: OfferWorkspaceCalculationJobRunner): {
    job: OfferWorkspaceCalculationJobView;
    reused: boolean;
    stale: boolean;
  } {
    this.prune();
    const draftHash = offerWorkspaceCalculationDraftHash(request.draft, request.mode);
    const reuseKey = this.reuseKey(request, draftHash);
    const existing = [...this.jobs.values()].find((job) => job.projectId === request.projectId && job.executionActive);
    if (existing) {
      if (existing.actorId !== request.actorId) throw new OfferWorkspaceCalculationCapacityError();
      const sameRequest = existing.request !== undefined
        && this.reuseKey(existing.request, existing.draftHash) === reuseKey;
      if (!sameRequest) throw new OfferWorkspaceCalculationConflictError();
      return { job: publicView(existing), reused: true, stale: false };
    }

    const activeCount = [...this.jobs.values()].filter((job) => job.executionActive).length;
    if (activeCount >= this.maxRunning) throw new OfferWorkspaceCalculationCapacityError();
    this.makeRoom();

    const createdAt = this.now();
    const job: StoredJob = {
      id: this.createId(),
      status: 'running',
      completed: 0,
      total: 0,
      sourceRevision: request.sourceRevision,
      actorId: request.actorId,
      projectId: request.projectId,
      mode: request.mode,
      draftHash,
      algorithmVersion: OFFER_WORKSPACE_CALCULATION_ALGORITHM_VERSION,
      createdAt,
      executionActive: true,
      dependencyContext: dependencyContext(request.draft),
      deadlineAt: new Date(createdAt + this.timeBudgetMs),
      request,
    };
    this.jobs.set(job.id, job);
    void this.execute(job, runner);
    return { job: publicView(job), reused: false, stale: false };
  }

  getForActorProject(jobId: string, actorId: string, projectId: string): OfferWorkspaceCalculationJobView | null {
    this.prune();
    const job = this.jobs.get(jobId);
    if (!job || job.actorId !== actorId || job.projectId !== projectId) return null;
    return publicView(job);
  }

  async getForActorProjectPersistent(
    jobId: string,
    actorId: string,
    projectId: string,
    freshness?: OfferWorkspaceCalculationFreshnessCheck | OfferWorkspaceCalculationFreshnessLoader,
  ): Promise<(OfferWorkspaceCalculationJobView & { freshnessUnverified?: true }) | null> {
    this.prune();
    const inMemory = this.jobs.get(jobId);
    if (inMemory && inMemory.actorId === actorId && inMemory.projectId === projectId) {
      const view = publicView(inMemory);
      if (inMemory.status !== 'completed') return view;
      const check = typeof freshness === 'function' ? await freshness(view, inMemory.dependencyContext) : freshness;
      return {
        ...view,
        ...(!this.matchesFreshness(inMemory, inMemory.data!, check) ? { freshnessUnverified: true as const } : {}),
      };
    }
    const snapshot = await this.snapshots.findCompletedByJob({
      jobId, actorId, projectId, algorithmVersion: OFFER_WORKSPACE_CALCULATION_ALGORITHM_VERSION,
    });
    if (!snapshot || snapshot.jobId !== jobId || snapshot.actorId !== actorId || snapshot.projectId !== projectId
      || snapshot.algorithmVersion !== OFFER_WORKSPACE_CALCULATION_ALGORITHM_VERSION) return null;
    const view: OfferWorkspaceCalculationJobView = {
      id: snapshot.jobId,
      status: 'completed',
      completed: snapshot.completed,
      total: snapshot.total,
      data: snapshot.result,
      sourceRevision: snapshot.sourceRevision,
    };
    const check = typeof freshness === 'function' ? await freshness(view, snapshot.dependencyContext) : freshness;
    return {
      ...view,
      ...(!this.matchesFreshness(snapshot, snapshot.result, check) ? { freshnessUnverified: true as const } : {}),
    };
  }

  private matchesFreshness(
    identity: {
      sourceRevision: string;
      draftHash: string;
      mode: OfferWorkspaceCalculationMode;
      algorithmVersion: string;
      dependencyContext: OfferWorkspaceCalculationDependencyContext;
    },
    data: OfferWorkspaceCalculation,
    freshness?: OfferWorkspaceCalculationFreshnessCheck,
  ): boolean {
    if (!freshness || !freshness.sourceDependencyStamp
      || identity.algorithmVersion !== OFFER_WORKSPACE_CALCULATION_ALGORITHM_VERSION
      || identity.sourceRevision !== freshness.sourceRevision
      || !sameDependencyContext(identity.dependencyContext, freshness.dependencyContext)
      || data.pricesAsOf !== freshness.pricesAsOf
      || (data as OfferWorkspaceCalculation & { sourceDependencyStamp?: unknown }).sourceDependencyStamp !== freshness.sourceDependencyStamp) return false;
    return true;
  }

  findCompletedOfferCalculation(
    input: CompletedOfferCalculationLookup,
    pricesAsOf?: string,
    sourceDependencyStamp?: string,
  ): OfferWorkspaceCalculation | null {
    this.prune();
    const selectedHash = offerWorkspaceCalculationDraftHash(input.draft, 'selected');
    const recommendHash = offerWorkspaceCalculationDraftHash(input.draft, 'recommend');
    const matches = [...this.jobs.values()]
      .filter((job) => job.status === 'completed' && job.algorithmVersion === OFFER_WORKSPACE_CALCULATION_ALGORITHM_VERSION && job.data !== undefined
        && (pricesAsOf === undefined || job.data.pricesAsOf === pricesAsOf)
        && job.actorId === input.actorId
        && job.projectId === input.projectId
        && job.sourceRevision === input.sourceRevision)
        .filter((job) => sourceDependencyStamp === undefined || job.data?.sourceDependencyStamp === sourceDependencyStamp)
      .sort((left, right) => right.createdAt - left.createdAt);

    for (const job of matches) {
      if (job.mode === 'selected' && job.draftHash === selectedHash) return job.data!;
      if (job.mode === 'recommend' && job.draftHash === recommendHash
        && (sameIds(job.data!.recommendedTemplateIds, input.draft.selectedTemplateIds)
          || (sameIds(job.data!.estimatedRecommendedTemplateIds, input.draft.selectedTemplateIds)
            && sameIds(job.data!.evaluatedTemplateIds, input.draft.selectedTemplateIds)))) {
        return job.data!;
      }
    }
    return null;
  }

  async findCompletedOfferCalculationPersistent(input: CompletedOfferCalculationLookup & {
    pricesAsOf: string;
    sourceDependencyStamp: string | null;
  }): Promise<OfferWorkspaceCalculation | null> {
    if (typeof input.sourceDependencyStamp !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceDependencyStamp)) return null;
    const inMemory = this.findCompletedOfferCalculation(input, input.pricesAsOf, input.sourceDependencyStamp);
    if (inMemory) return inMemory;
    const selectedHash = offerWorkspaceCalculationDraftHash(input.draft, 'selected');
    const recommendHash = offerWorkspaceCalculationDraftHash(input.draft, 'recommend');
    let snapshots;
    try {
      snapshots = await this.snapshots.findCompletedForDrafts({
        actorId: input.actorId,
        projectId: input.projectId,
        sourceRevision: input.sourceRevision,
        draftHashes: [selectedHash, recommendHash],
        algorithmVersion: OFFER_WORKSPACE_CALCULATION_ALGORITHM_VERSION,
        pricesAsOf: input.pricesAsOf,
        sourceDependencyStamp: input.sourceDependencyStamp,
      });
    } catch {
      throw new Error('Nie udało się odczytać zapisanych obliczeń.');
    }
    for (const snapshot of snapshots) {
      if (snapshot.actorId !== input.actorId || snapshot.projectId !== input.projectId
        || snapshot.sourceRevision !== input.sourceRevision
        || snapshot.algorithmVersion !== OFFER_WORKSPACE_CALCULATION_ALGORITHM_VERSION
        || snapshot.pricesAsOf !== input.pricesAsOf
        || snapshot.sourceDependencyStamp !== input.sourceDependencyStamp) continue;
      if (snapshot.mode === 'selected' && snapshot.draftHash === selectedHash) return snapshot.result;
      if (snapshot.mode === 'recommend' && snapshot.draftHash === recommendHash
        && (sameIds(snapshot.result.recommendedTemplateIds, input.draft.selectedTemplateIds)
          || (sameIds(snapshot.result.estimatedRecommendedTemplateIds, input.draft.selectedTemplateIds)
            && sameIds(snapshot.result.evaluatedTemplateIds, input.draft.selectedTemplateIds)))) return snapshot.result;
    }
    return null;
  }

  private reuseKey(request: OfferWorkspaceCalculationJobRequest, draftHash: string): string {
    return [request.actorId, request.projectId, request.sourceRevision, request.mode, draftHash].join('\u0000');
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, job] of this.jobs) {
      if (!job.executionActive && job.createdAt <= cutoff) this.jobs.delete(id);
    }
  }

  private makeRoom(): void {
    while (this.jobs.size >= this.maxJobs) {
      const oldestFinished = [...this.jobs.values()]
        .filter((job) => !job.executionActive)
        .sort((left, right) => left.createdAt - right.createdAt)[0];
      if (!oldestFinished) throw new OfferWorkspaceCalculationCapacityError();
      this.jobs.delete(oldestFinished.id);
    }
  }

  private async execute(job: StoredJob, runner: OfferWorkspaceCalculationJobRunner): Promise<void> {
    const request = job.request;
    if (!request) {
      job.executionActive = false;
      job.status = 'failed';
      job.error = 'Obliczenie nie powiodło się.';
      return;
    }
    let signalDeadlineElapsed!: () => void;
    const deadlineElapsed = new Promise<void>((resolve) => { signalDeadlineElapsed = resolve; });
    const expire = () => {
      if (job.status === 'running') {
        job.status = 'failed';
        job.error = 'Obliczenie przekroczyło limit czasu 15 minut.';
      }
      signalDeadlineElapsed();
    };
    const markTimedOutIfExpired = () => {
      if (job.status === 'running' && this.now() >= job.deadlineAt.getTime()) expire();
    };
    const timeout = setTimeout(expire, this.timeBudgetMs);
    timeout.unref?.();

    try {
      const data = await runner(
        request.workspace,
        request.draft,
        request.series,
        request.mode,
        (completed, total) => {
          if (job.status !== 'running') return;
          if (Number.isFinite(completed) && Number.isFinite(total)) {
            job.completed = Math.max(0, Math.floor(completed));
            job.total = Math.max(0, Math.floor(total));
          }
        },
      );
      markTimedOutIfExpired();
      if (job.status !== 'running') return;
      const pricesAsOf = typeof data.pricesAsOf === 'string' ? data.pricesAsOf : null;
      const sourceDependencyStamp = (data as OfferWorkspaceCalculation & { sourceDependencyStamp?: unknown }).sourceDependencyStamp;
      if ((data.status === 'ready' && (!pricesAsOf || !/^\d{4}-\d{2}-\d{2}$/.test(pricesAsOf)
        || typeof sourceDependencyStamp !== 'string' || !/^[a-f0-9]{64}$/.test(sourceDependencyStamp)))
        || (sourceDependencyStamp != null && (typeof sourceDependencyStamp !== 'string' || !/^[a-f0-9]{64}$/.test(sourceDependencyStamp)))) {
        throw new Error('Brak prawidłowej tożsamości danych obliczenia.');
      }
      const persistence = this.snapshots.savePending({
        jobId: job.id,
        actorId: job.actorId,
        projectId: job.projectId,
        sourceRevision: job.sourceRevision,
        draftHash: job.draftHash,
        algorithmVersion: job.algorithmVersion,
        pricesAsOf,
        sourceDependencyStamp: typeof sourceDependencyStamp === 'string' ? sourceDependencyStamp : null,
        dependencyContext: job.dependencyContext,
        deadlineAt: job.deadlineAt,
        mode: job.mode,
        completed: job.total > 0 ? job.total : job.completed,
        total: job.total,
        result: data,
      });
      const persistedInTime = await Promise.race([
        persistence.then(() => true),
        deadlineElapsed.then(() => false),
      ]);
      if (!persistedInTime) return;
      markTimedOutIfExpired();
      if (job.status !== 'running') return;
      const admission = this.snapshots.admitCompleted({
        jobId: job.id,
        actorId: job.actorId,
        projectId: job.projectId,
        algorithmVersion: job.algorithmVersion,
        deadlineAt: job.deadlineAt,
      });
      const admittedInTime = await Promise.race([
        admission.then(() => true),
        deadlineElapsed.then(() => false),
      ]);
      if (!admittedInTime) return;
      markTimedOutIfExpired();
      if (job.status !== 'running') return;
      job.status = 'completed';
      job.data = data;
      if (job.total > 0) job.completed = job.total;
      delete job.error;
    } catch {
      if (job.status === 'running') {
        job.status = 'failed';
        job.error = 'Obliczenie nie powiodło się.';
      }
    } finally {
      clearTimeout(timeout);
      job.executionActive = false;
      delete job.request;
      if (job.status === 'running') {
        job.status = 'failed';
        job.error = 'Obliczenie nie powiodło się.';
      }
      this.prune();
    }
  }
}

const globalStore = globalThis as typeof globalThis & {
  __onRevoltOfferWorkspaceCalculationJobStore?: OfferWorkspaceCalculationJobStore;
};

export const offerWorkspaceCalculationJobs = globalStore.__onRevoltOfferWorkspaceCalculationJobStore
  ?? (globalStore.__onRevoltOfferWorkspaceCalculationJobStore = new OfferWorkspaceCalculationJobStore());

export function findCompletedOfferCalculation(
  input: CompletedOfferCalculationLookup,
): OfferWorkspaceCalculation | null {
  return offerWorkspaceCalculationJobs.findCompletedOfferCalculation(input);
}

export function findCompletedOfferCalculationPersistent(
  input: CompletedOfferCalculationLookup & { pricesAsOf: string; sourceDependencyStamp: string | null },
): Promise<OfferWorkspaceCalculation | null> {
  return offerWorkspaceCalculationJobs.findCompletedOfferCalculationPersistent(input);
}
