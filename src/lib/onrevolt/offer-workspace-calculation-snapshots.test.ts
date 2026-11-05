import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { gunzipSync, gzipSync } from 'node:zlib';

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
  const modules = { 'node:buffer': { Buffer }, 'node:crypto': { createHash }, 'node:zlib': { gzipSync, gunzipSync }, './prisma': { prisma: database } };
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

function compressedResult(value: unknown, overrides: Record<string, unknown> = {}) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  return {
    __offerWorkspaceCalculationResult: {
      encoding: 'gzip-base64', version: 1, byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      data: gzipSync(bytes).toString('base64'), ...overrides,
    },
  };
}

function readerForResult(storedResult: unknown) {
  const f = fixture();
  return new f.exports.PrismaOfferWorkspaceCalculationSnapshotRepository({
    offerWorkspaceCalculationSnapshot: {
      create: async () => undefined,
      findFirst: async () => ({ ...row, result: storedResult }),
      findMany: async () => [],
    },
    offerWorkspaceCalculationSnapshotAdmission: { create: async () => undefined },
  });
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

test('compressed large results round trip losslessly and legacy plain JSON remains readable', async () => {
  const forecastPayload = Array.from({ length: 22_000 }, (_, index) => ({
    hour: index,
    startUtc: new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString(),
    loadKwh: ((index * 37) % 10001) / 1000,
    pvKwh: ((index * 101) % 5003) / 1000,
    importKwh: ((index * 53) % 8009) / 1000,
    exportKwh: ((index * 67) % 3001) / 1000,
    note: `interval-${index.toString(36)}-${((index * 104729) % 99991).toString(36)}`,
  }));
  const largeResult = { ...result, forecastPayload };
  let storedResult: unknown;
  const writerFixture = fixture();
  const writer = new writerFixture.exports.PrismaOfferWorkspaceCalculationSnapshotRepository({
    offerWorkspaceCalculationSnapshot: {
      create: async (args: any) => { storedResult = args.data.result; },
      findFirst: async () => null,
      findMany: async () => [],
    },
    offerWorkspaceCalculationSnapshotAdmission: { create: async () => undefined },
  });
  await writer.savePending({ ...snapshotInput, result: largeResult });

  const envelope = (storedResult as any).__offerWorkspaceCalculationResult;
  assert.equal(envelope.encoding, 'gzip-base64');
  assert.equal(envelope.version, 1);
  assert.ok(envelope.data.length < Buffer.byteLength(JSON.stringify(largeResult), 'utf8') / 2);
  const decoded = await readerForResult(storedResult).findCompletedByJob({
    jobId: row.jobId, actorId: row.actorId, projectId: row.projectId, algorithmVersion: row.algorithmVersion,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(decoded?.result)), largeResult);

  const legacy = await readerForResult(result).findCompletedByJob({
    jobId: row.jobId, actorId: row.actorId, projectId: row.projectId, algorithmVersion: row.algorithmVersion,
  });
  assert.equal(legacy?.result.annualSavingsPln, 120);
});

test('invalid and truncated compressed snapshot envelopes are rejected', async () => {
  const bytes = Buffer.from(JSON.stringify(result), 'utf8');
  const valid = compressedResult(result) as any;
  const compressed = Buffer.from(valid.__offerWorkspaceCalculationResult.data, 'base64');
  const invalidEnvelopes = [
    compressedResult(result, { data: Buffer.from('not gzip data').toString('base64') }),
    compressedResult(result, { data: compressed.subarray(0, compressed.length - 4).toString('base64') }),
    compressedResult(result, { version: 2 }),
    compressedResult(result, { sha256: '0'.repeat(64) }),
    compressedResult(result, { data: 'A'.repeat(4 * Math.ceil((bytes.byteLength + 64 * 1024) / 3) + 4) }),
  ];
  assert.ok(bytes.length > 0);
  for (const envelope of invalidEnvelopes) {
    assert.equal(await readerForResult(envelope).findCompletedByJob({
      jobId: row.jobId, actorId: row.actorId, projectId: row.projectId, algorithmVersion: row.algorithmVersion,
    }), null);
  }
});

test('oversized compressed payloads are rejected before parsing', async () => {
  const tooLargeEnvelope = compressedResult(result, { byteLength: maxResultBytes + 1 });
  assert.equal(await readerForResult(tooLargeEnvelope).findCompletedByJob({
    jobId: row.jobId, actorId: row.actorId, projectId: row.projectId, algorithmVersion: row.algorithmVersion,
  }), null);

  const bombBytes = Buffer.from(JSON.stringify({ ...result, payload: 'x'.repeat(maxResultBytes) }), 'utf8');
  const bomb = compressedResult(result, {
    byteLength: maxResultBytes,
    sha256: createHash('sha256').update(bombBytes).digest('hex'),
    data: gzipSync(bombBytes).toString('base64'),
  });
  assert.equal(await readerForResult(bomb).findCompletedByJob({
    jobId: row.jobId, actorId: row.actorId, projectId: row.projectId, algorithmVersion: row.algorithmVersion,
  }), null);
});

test('compressed results still undergo persisted identity validation', async () => {
  const mismatched = compressedResult({ ...result, pricesAsOf: '2026-10-28' });
  assert.equal(await readerForResult(mismatched).findCompletedByJob({
    jobId: row.jobId, actorId: row.actorId, projectId: row.projectId, algorithmVersion: row.algorithmVersion,
  }), null);
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
