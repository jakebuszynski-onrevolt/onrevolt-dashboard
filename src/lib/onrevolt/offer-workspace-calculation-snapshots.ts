import { Buffer } from 'node:buffer';
import type { OfferWorkspaceDraft } from './offer-workspace';
import type { OfferWorkspaceCalculation } from './offer-workspace-calculation-types';
import { prisma } from './prisma';

export const OFFER_WORKSPACE_CALCULATION_ALGORITHM_VERSION = 'offer-workspace-calculation-v2-estimates';
export const MAX_OFFER_WORKSPACE_CALCULATION_RESULT_BYTES = 32 * 1024 * 1024;

export type OfferWorkspaceCalculationSnapshotMode = 'selected' | 'recommend';

export interface OfferWorkspaceCalculationDependencyContext {
  targetOperatorId: OfferWorkspaceDraft['targetOperatorId'];
  targetTariffId: OfferWorkspaceDraft['targetTariffId'];
  currentSettlement: OfferWorkspaceDraft['currentSettlement'];
  targetSettlement: OfferWorkspaceDraft['targetSettlement'];
}

export interface OfferWorkspaceCalculationSnapshotInput {
  jobId: string;
  actorId: string;
  projectId: string;
  sourceRevision: string;
  draftHash: string;
  algorithmVersion: string;
  pricesAsOf: string | null;
  sourceDependencyStamp: string | null;
  dependencyContext: OfferWorkspaceCalculationDependencyContext;
  deadlineAt: Date;
  mode: OfferWorkspaceCalculationSnapshotMode;
  completed: number;
  total: number;
  result: OfferWorkspaceCalculation;
}

export interface OfferWorkspaceCalculationSnapshotQuery {
  actorId: string;
  projectId: string;
  sourceRevision: string;
  draftHashes: string[];
  algorithmVersion: string;
  pricesAsOf: string;
  sourceDependencyStamp: string;
}

export interface StoredOfferWorkspaceCalculationSnapshot {
  jobId: string;
  actorId: string;
  projectId: string;
  sourceRevision: string;
  draftHash: string;
  algorithmVersion: string;
  pricesAsOf: string | null;
  sourceDependencyStamp: string | null;
  dependencyContext: OfferWorkspaceCalculationDependencyContext;
  deadlineAt: Date;
  createdAt: Date;
  admittedAt: Date;
  mode: OfferWorkspaceCalculationSnapshotMode;
  completed: number;
  total: number;
  result: OfferWorkspaceCalculation;
}

export interface OfferWorkspaceCalculationSnapshotRepository {
  savePending(input: OfferWorkspaceCalculationSnapshotInput): Promise<void>;
  admitCompleted(input: {
    jobId: string;
    actorId: string;
    projectId: string;
    algorithmVersion: string;
    deadlineAt: Date;
  }): Promise<void>;
  findCompletedByJob(input: {
    jobId: string;
    actorId: string;
    projectId: string;
    algorithmVersion: string;
  }): Promise<StoredOfferWorkspaceCalculationSnapshot | null>;
  findCompletedForDrafts(input: OfferWorkspaceCalculationSnapshotQuery): Promise<StoredOfferWorkspaceCalculationSnapshot[]>;
}

export class OfferWorkspaceCalculationSnapshotSizeError extends Error {
  constructor() {
    super('Wynik obliczeń przekracza limit trwałego zapisu 32 MiB.');
    this.name = 'OfferWorkspaceCalculationSnapshotSizeError';
  }
}

export class OfferWorkspaceCalculationSnapshotIdentityError extends Error {
  constructor() {
    super('Tożsamość danych zapisanego obliczenia jest nieprawidłowa.');
    this.name = 'OfferWorkspaceCalculationSnapshotIdentityError';
  }
}

interface CalculationSnapshotModel {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  findFirst(args: Record<string, unknown>): Promise<unknown>;
  findMany(args: Record<string, unknown>): Promise<unknown[]>;
}

interface CalculationSnapshotAdmissionModel {
  create(args: { data: { jobId: string } }): Promise<unknown>;
}

interface CalculationSnapshotDatabase {
  offerWorkspaceCalculationSnapshot: CalculationSnapshotModel;
  offerWorkspaceCalculationSnapshotAdmission: CalculationSnapshotAdmissionModel;
}

function isCalculation(value: unknown): value is OfferWorkspaceCalculation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (row.status === 'ready' || row.status === 'blocked')
    && Array.isArray(row.reasons)
    && Array.isArray(row.warnings);
}

function timestamp(value: unknown): number {
  const dateLike = value && typeof value === 'object' ? value as { getTime?: unknown } : null;
  const parsed = dateLike && typeof dateLike.getTime === 'function'
    ? Number(dateLike.getTime.call(value))
    : Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isSettlement(value: unknown): value is OfferWorkspaceDraft['currentSettlement'] {
  return value === null || value === 'NET_METERING' || value === 'NET_BILLING';
}

function parseSnapshot(value: unknown): StoredOfferWorkspaceCalculationSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const admission = row.admission && typeof row.admission === 'object' && !Array.isArray(row.admission)
    ? row.admission as Record<string, unknown> : null;
  if (typeof row.jobId !== 'string' || typeof row.actorId !== 'string' || typeof row.projectId !== 'string'
    || typeof row.sourceRevision !== 'string' || typeof row.draftHash !== 'string'
    || typeof row.algorithmVersion !== 'string'
    || (row.targetOperatorId !== null && (!Number.isSafeInteger(row.targetOperatorId) || Number(row.targetOperatorId) < 1))
    || (row.targetTariffId !== null && (!Number.isSafeInteger(row.targetTariffId) || Number(row.targetTariffId) < 1))
    || !isSettlement(row.currentSettlement) || !isSettlement(row.targetSettlement)
    || !admission || !Number.isFinite(timestamp(admission.admittedAt))
    || !Number.isFinite(timestamp(row.createdAt)) || !Number.isFinite(timestamp(row.deadlineAt))
    || timestamp(row.createdAt) > timestamp(row.deadlineAt) || timestamp(admission.admittedAt) > timestamp(row.deadlineAt)
    || (row.pricesAsOf !== null && (typeof row.pricesAsOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.pricesAsOf)))
    || (row.sourceDependencyStamp !== null && (typeof row.sourceDependencyStamp !== 'string' || !/^[a-f0-9]{64}$/.test(row.sourceDependencyStamp)))
    || (row.mode !== 'selected' && row.mode !== 'recommend')
    || !Number.isSafeInteger(row.completed) || !Number.isSafeInteger(row.total) || !isCalculation(row.result)) return null;
  const result = row.result as OfferWorkspaceCalculation & { sourceDependencyStamp?: unknown };
  const resultPricesAsOf = typeof result.pricesAsOf === 'string' ? result.pricesAsOf : null;
  const resultDependencyStamp = typeof result.sourceDependencyStamp === 'string' ? result.sourceDependencyStamp : null;
  if (resultPricesAsOf !== row.pricesAsOf || resultDependencyStamp !== row.sourceDependencyStamp) return null;
  return {
    jobId: row.jobId as string,
    actorId: row.actorId as string,
    projectId: row.projectId as string,
    sourceRevision: row.sourceRevision as string,
    draftHash: row.draftHash as string,
    algorithmVersion: row.algorithmVersion as string,
    pricesAsOf: row.pricesAsOf as string | null,
    sourceDependencyStamp: row.sourceDependencyStamp as string | null,
    dependencyContext: {
      targetOperatorId: row.targetOperatorId as number | null,
      targetTariffId: row.targetTariffId as number | null,
      currentSettlement: row.currentSettlement as OfferWorkspaceDraft['currentSettlement'],
      targetSettlement: row.targetSettlement as OfferWorkspaceDraft['targetSettlement'],
    },
    deadlineAt: row.deadlineAt as Date,
    createdAt: row.createdAt as Date,
    admittedAt: admission.admittedAt as Date,
    mode: row.mode as OfferWorkspaceCalculationSnapshotMode,
    completed: row.completed as number,
    total: row.total as number,
    result: row.result as OfferWorkspaceCalculation,
  };
}

export class PrismaOfferWorkspaceCalculationSnapshotRepository implements OfferWorkspaceCalculationSnapshotRepository {
  constructor(private readonly database: CalculationSnapshotDatabase) {}

  async savePending(input: OfferWorkspaceCalculationSnapshotInput): Promise<void> {
    if (!Number.isFinite(timestamp(input.deadlineAt)) || Date.now() >= timestamp(input.deadlineAt)) {
      throw new OfferWorkspaceCalculationSnapshotIdentityError();
    }
    const result = input.result as OfferWorkspaceCalculation & { sourceDependencyStamp?: unknown };
    const resultPricesAsOf = typeof result.pricesAsOf === 'string' ? result.pricesAsOf : null;
    const resultDependencyStamp = typeof result.sourceDependencyStamp === 'string' ? result.sourceDependencyStamp : null;
    if (input.pricesAsOf !== resultPricesAsOf || input.sourceDependencyStamp !== resultDependencyStamp
      || (input.pricesAsOf !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.pricesAsOf))
      || (input.sourceDependencyStamp !== null && !/^[a-f0-9]{64}$/.test(input.sourceDependencyStamp))
      || (input.result.status === 'ready' && (input.pricesAsOf === null || input.sourceDependencyStamp === null))) {
      throw new OfferWorkspaceCalculationSnapshotIdentityError();
    }
    const serialized = JSON.stringify(input.result);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_OFFER_WORKSPACE_CALCULATION_RESULT_BYTES) {
      throw new OfferWorkspaceCalculationSnapshotSizeError();
    }
    const { dependencyContext, ...snapshot } = input;
    await this.database.offerWorkspaceCalculationSnapshot.create({
      data: {
        ...snapshot,
        ...dependencyContext,
        result: JSON.parse(serialized) as OfferWorkspaceCalculation,
      },
    });
  }

  async admitCompleted(input: {
    jobId: string;
    actorId: string;
    projectId: string;
    algorithmVersion: string;
    deadlineAt: Date;
  }): Promise<void> {
    const deadline = timestamp(input.deadlineAt);
    if (!Number.isFinite(deadline) || Date.now() >= deadline) throw new OfferWorkspaceCalculationSnapshotIdentityError();
    const pending = await this.database.offerWorkspaceCalculationSnapshot.findFirst({
      where: {
        jobId: input.jobId,
        actorId: input.actorId,
        projectId: input.projectId,
        algorithmVersion: input.algorithmVersion,
        deadlineAt: { gt: new Date() },
      },
    }) as Record<string, unknown> | null;
    if (!pending || timestamp(pending.deadlineAt) !== deadline || Date.now() >= deadline) {
      throw new OfferWorkspaceCalculationSnapshotIdentityError();
    }
    await this.database.offerWorkspaceCalculationSnapshotAdmission.create({ data: { jobId: input.jobId } });
  }

  async findCompletedByJob(input: {
    jobId: string;
    actorId: string;
    projectId: string;
    algorithmVersion: string;
  }): Promise<StoredOfferWorkspaceCalculationSnapshot | null> {
    const row = await this.database.offerWorkspaceCalculationSnapshot.findFirst({
      where: { ...input, admission: { isNot: null } },
      include: { admission: true },
    });
    const snapshot = parseSnapshot(row);
    if (!snapshot || snapshot.jobId !== input.jobId || snapshot.actorId !== input.actorId
      || snapshot.projectId !== input.projectId || snapshot.algorithmVersion !== input.algorithmVersion) return null;
    return snapshot;
  }

  async findCompletedForDrafts(input: OfferWorkspaceCalculationSnapshotQuery): Promise<StoredOfferWorkspaceCalculationSnapshot[]> {
    if (!input.draftHashes.length) return [];
    const rows = await this.database.offerWorkspaceCalculationSnapshot.findMany({
      where: {
        actorId: input.actorId,
        projectId: input.projectId,
        sourceRevision: input.sourceRevision,
        algorithmVersion: input.algorithmVersion,
        pricesAsOf: input.pricesAsOf,
        sourceDependencyStamp: input.sourceDependencyStamp,
        draftHash: { in: input.draftHashes },
        admission: { isNot: null },
      },
      include: { admission: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
    });
    return rows.map(parseSnapshot).filter((row): row is StoredOfferWorkspaceCalculationSnapshot => row !== null
      && row.actorId === input.actorId && row.projectId === input.projectId && row.sourceRevision === input.sourceRevision
      && row.algorithmVersion === input.algorithmVersion && row.pricesAsOf === input.pricesAsOf
      && row.sourceDependencyStamp === input.sourceDependencyStamp && input.draftHashes.includes(row.draftHash));
  }
}

export const offerWorkspaceCalculationSnapshots: OfferWorkspaceCalculationSnapshotRepository =
  new PrismaOfferWorkspaceCalculationSnapshotRepository(prisma as unknown as CalculationSnapshotDatabase);
