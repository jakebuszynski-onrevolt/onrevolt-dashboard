import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const filename = path.resolve(__dirname, 'offer-workspace-calculation-snapshots.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: filename,
}).outputText;
const maxResultBytes = 32 * 1024 * 1024;

const result = {
  status: 'ready', reasons: [], warnings: [], annualSavingsPln: 120,
  pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64),
};
const dependencyContext = {
  targetOperatorId: 11,
  targetTariffId: 22,
  currentSettlement: 'NET_BILLING',
  targetSettlement: 'NET_BILLING',
};
const deadlineAt = new Date(Date.now() + 60 * 60_000);
const snapshotInput = {
  jobId: 'job-1', actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64),
  draftHash: 'b'.repeat(64), algorithmVersion: 'offer-workspace-calculation-v1', pricesAsOf: '2026-10-29',
  sourceDependencyStamp: 'c'.repeat(64),
  dependencyContext, deadlineAt, mode: 'selected', completed: 1, total: 1, result,
};
const row = {
  ...snapshotInput,
  ...dependencyContext,
  createdAt: new Date(),
  admission: { admittedAt: new Date() },
};

function fixture(options: { rows?: unknown[]; findFirst?: unknown; failCreate?: boolean } = {}) {
  const calls: Array<{ operation: string; value: any }> = [];
  const database = {
    offerWorkspaceCalculationSnapshot: {
      create: async (args: unknown) => {
        calls.push({ operation: 'create', value: args });
        if (options.failCreate) throw new Error('private SQL details');
        return args;
      },
      findFirst: async (args: unknown) => {
        calls.push({ operation: 'findFirst', value: args });
        return options.findFirst ?? row;
      },
      findMany: async (args: unknown) => {
        calls.push({ operation: 'findMany', value: args });
        return options.rows ?? [row];
      },
    },
    offerWorkspaceCalculationSnapshotAdmission: {
      create: async (args: unknown) => {
        calls.push({ operation: 'admit', value: args });
        return args;
      },
    },
  };
  const modules = { 'node:buffer': { Buffer }, './prisma': { prisma: database } };
  const exports: any = {};
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected snapshot import: ${name}`);
      return modules[name as keyof typeof modules];
    },
  });
  return { exports, calls };
}

test('pending snapshots write only the immutable result and freshness identity', async () => {
  const f = fixture();
  const repository = new f.exports.PrismaOfferWorkspaceCalculationSnapshotRepository({
    offerWorkspaceCalculationSnapshot: {
      create: async (args: unknown) => { f.calls.push({ operation: 'create', value: args }); return args; },
      findFirst: async () => null,
      findMany: async () => [],
    },
  });

  await repository.savePending(snapshotInput);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].value)), JSON.parse(JSON.stringify({
    data: {
      jobId: snapshotInput.jobId, actorId: snapshotInput.actorId, projectId: snapshotInput.projectId,
      sourceRevision: snapshotInput.sourceRevision, draftHash: snapshotInput.draftHash,
      algorithmVersion: snapshotInput.algorithmVersion, pricesAsOf: snapshotInput.pricesAsOf,
      sourceDependencyStamp: snapshotInput.sourceDependencyStamp, deadlineAt,
      mode: snapshotInput.mode, completed: snapshotInput.completed, total: snapshotInput.total,
      ...dependencyContext, result,
    },
  })));
  assert.equal('update' in repository, false);
  assert.equal('delete' in repository, false);
});

test('admission requires a matching persisted job and creates a separate marker', async () => {
  const f = fixture();
  const repository = new f.exports.PrismaOfferWorkspaceCalculationSnapshotRepository({
    offerWorkspaceCalculationSnapshot: {
      create: async () => undefined,
      findFirst: async (args: unknown) => { f.calls.push({ operation: 'findFirst', value: args }); return row; },
      findMany: async () => [],
    },
    offerWorkspaceCalculationSnapshotAdmission: {
      create: async (args: unknown) => { f.calls.push({ operation: 'admit', value: args }); return args; },
    },
  });

  await repository.admitCompleted({
    jobId: row.jobId, actorId: row.actorId, projectId: row.projectId,
    algorithmVersion: row.algorithmVersion, deadlineAt: row.deadlineAt,
  });
  const admissionQuery = f.calls[0].value.where;
  assert.equal(admissionQuery.jobId, row.jobId);
  assert.equal(admissionQuery.actorId, row.actorId);
  assert.equal(admissionQuery.projectId, row.projectId);
  assert.equal(admissionQuery.algorithmVersion, row.algorithmVersion);
  assert.ok(admissionQuery.deadlineAt.gt.getTime() <= Date.now());
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[1].value)), { data: { jobId: row.jobId } });
});

test('job lookup always scopes actor, project, and algorithm version', async () => {
  const f = fixture();
  const repository = new f.exports.PrismaOfferWorkspaceCalculationSnapshotRepository({
    offerWorkspaceCalculationSnapshot: {
      create: async () => undefined,
      findFirst: async (args: unknown) => {
        f.calls.push({ operation: 'findFirst', value: args });
        return row;
      },
      findMany: async () => [],
    },
  });

  const found = await repository.findCompletedByJob({
    jobId: 'job-1', actorId: 'staff-1', projectId: 'project-1', algorithmVersion: 'offer-workspace-calculation-v1',
  });
  assert.equal(found?.result.annualSavingsPln, 120);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].value)), {
    where: {
      jobId: 'job-1', actorId: 'staff-1', projectId: 'project-1', algorithmVersion: 'offer-workspace-calculation-v1',
      admission: { isNot: null },
    },
    include: { admission: true },
  });
});

test('PDF lookup query requires current source, draft, algorithm, and prices-as-of identities', async () => {
  const f = fixture();
  const repository = new f.exports.PrismaOfferWorkspaceCalculationSnapshotRepository({
    offerWorkspaceCalculationSnapshot: {
      create: async () => undefined,
      findFirst: async () => null,
      findMany: async (args: unknown) => {
        f.calls.push({ operation: 'findMany', value: args });
        return [row];
      },
    },
  });

  const matches = await repository.findCompletedForDrafts({
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64),
    draftHashes: ['b'.repeat(64), 'c'.repeat(64)],
    algorithmVersion: 'offer-workspace-calculation-v1', pricesAsOf: '2026-10-29', sourceDependencyStamp: 'c'.repeat(64),
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].pricesAsOf, '2026-10-29');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].value)), {
    where: {
      actorId: 'staff-1', projectId: 'project-1', sourceRevision: 'a'.repeat(64),
      algorithmVersion: 'offer-workspace-calculation-v1', pricesAsOf: '2026-10-29',
      sourceDependencyStamp: 'c'.repeat(64),
      draftHash: { in: ['b'.repeat(64), 'c'.repeat(64)] },
      admission: { isNot: null },
    },
    include: { admission: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 10,
  });
});

test('malformed persisted results are never exposed as completed calculations', async () => {
  const f = fixture({ rows: [{ ...row, result: { status: 'running' } }] });
  const repository = new f.exports.PrismaOfferWorkspaceCalculationSnapshotRepository({
    offerWorkspaceCalculationSnapshot: {
      create: async () => undefined,
      findFirst: async () => ({ ...row, result: { status: 'running' } }),
      findMany: async (args: unknown) => {
        f.calls.push({ operation: 'findMany', value: args });
        return [{ ...row, result: { status: 'running' } }];
      },
    },
  });

  assert.equal(await repository.findCompletedByJob({ jobId: 'job-1', actorId: 'staff-1', projectId: 'project-1', algorithmVersion: row.algorithmVersion }), null);
  assert.deepEqual(await repository.findCompletedForDrafts({
    actorId: 'staff-1', projectId: 'project-1', sourceRevision: row.sourceRevision,
    draftHashes: [row.draftHash], algorithmVersion: row.algorithmVersion, pricesAsOf: '2026-10-29',
    sourceDependencyStamp: row.sourceDependencyStamp,
  }), []);
});

test('oversized calculation result fails before any database write', async () => {
  const f = fixture();
  let createCalls = 0;
  const repository = new f.exports.PrismaOfferWorkspaceCalculationSnapshotRepository({
    offerWorkspaceCalculationSnapshot: {
      create: async () => { createCalls += 1; },
      findFirst: async () => null,
      findMany: async () => [],
    },
  });
  const oversized = { ...snapshotInput, result: { ...result, payload: 'x'.repeat(maxResultBytes) } };

  await assert.rejects(repository.savePending(oversized), /limit trwałego zapisu 32 MiB/);
  assert.equal(createCalls, 0);
});

test('an admission timestamp 900ms after a 100ms deadline in the same second is rejected', async () => {
  const lateRow = {
    ...row,
    deadlineAt: new Date('2026-10-29T10:00:00.100Z'),
    createdAt: new Date('2026-10-29T10:00:00.050Z'),
    admission: { admittedAt: new Date('2026-10-29T10:00:00.900Z') },
  };
  const f = fixture({ rows: [lateRow], findFirst: lateRow });
  let createCalls = 0;
  const repository = new f.exports.PrismaOfferWorkspaceCalculationSnapshotRepository({
    offerWorkspaceCalculationSnapshot: {
      create: async () => { createCalls += 1; },
      findFirst: async () => lateRow,
      findMany: async () => [lateRow],
    },
    offerWorkspaceCalculationSnapshotAdmission: { create: async () => undefined },
  });

  await assert.rejects(repository.savePending({ ...snapshotInput, deadlineAt: new Date(Date.now() - 1) }));
  assert.equal(await repository.findCompletedByJob({
    jobId: row.jobId, actorId: row.actorId, projectId: row.projectId, algorithmVersion: row.algorithmVersion,
  }), null);
  assert.deepEqual(await repository.findCompletedForDrafts({
    actorId: row.actorId, projectId: row.projectId, sourceRevision: row.sourceRevision,
    draftHashes: [row.draftHash], algorithmVersion: row.algorithmVersion,
    pricesAsOf: '2026-10-29', sourceDependencyStamp: row.sourceDependencyStamp,
  }), []);
  assert.equal(createCalls, 0);
});
