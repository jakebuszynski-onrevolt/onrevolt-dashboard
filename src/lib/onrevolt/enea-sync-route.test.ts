import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const routePath = path.resolve(__dirname, '../../app/api/integrations/enea/sync/route.ts');
const routeCode = ts.transpileModule(readFileSync(routePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  fileName: routePath,
}).outputText;
const kinds = ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'];
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

function fixture(options: {
  existing?: boolean;
  failDownload?: boolean;
  failWrite?: boolean;
  failPersist?: 'document' | 'measurement';
  concurrentFile?: boolean;
  reFailure?: 'result' | 'throw';
  noProject?: boolean;
} = {}) {
  const root = path.resolve('__virtual_enea_uploads__');
  const account = { id: 'account', clientId: 'client', projectId: options.noProject ? null : 'project',
    operator: 'ENEA', login: 'fixture', encryptedPassword: 'fixture', portalPpeId: 'ppe' };
  const state = {
    records: new Map<string, any>(), documents: new Map<string, any>(), files: new Map<string, Buffer>(),
    events: [] as string[], reCalls: [] as string[], accountUpdates: [] as any[], sequence: 0,
  };
  function addExisting(kind: string, prefix = 'old') {
    const document = { id: `${prefix}-${kind}`, storagePath: `${prefix}-${kind}.xlsx`, fileName: `${prefix}.xlsx` };
    state.documents.set(document.id, document);
    state.files.set(path.join(root, document.storagePath), Buffer.from(`${prefix} workbook ${kind}`));
    state.records.set(kind, { id: `measurement-${kind}`, accountId: account.id, kind,
      documentId: document.id, storagePath: document.storagePath, fileName: document.fileName,
      status: 'DOWNLOADED', error: '[RE] Nie potwierdzono wcześniejszego importu',
      downloadedAt: new Date('2026-08-01T00:00:00Z') });
  }
  if (options.existing) kinds.forEach(kind => addExisting(kind));
  const initial = () => ({ records: plain([...state.records]), documents: plain([...state.documents]) });
  const before = initial();
  const forbidden = () => { throw new Error('Unexpected database write outside transaction or deletion'); };
  const lookup = (args: any) => {
    const kind = args.where.accountId_kind_periodYear_periodMonth.kind;
    const record = state.records.get(kind);
    return record ? structuredClone(record) : null;
  };
  let transactionTail = Promise.resolve();
  const prisma = {
    energyPortalAccount: {
      findUnique: async () => account,
      findFirst: async () => account,
      update: async ({ data }: any) => { state.accountUpdates.push(plain(data)); return { ...account, ...data }; },
    },
    energyMeasurementFile: { findUnique: async (args: any) => lookup(args), upsert: forbidden, delete: forbidden, deleteMany: forbidden },
    document: { create: forbidden, delete: forbidden, deleteMany: forbidden },
    $transaction: async (callback: any) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const snapshot = { records: structuredClone(state.records), documents: structuredClone(state.documents) };
      let locked = false;
      state.events.push('begin');
      const tx = {
        $queryRaw: async (strings: TemplateStringsArray, ...values: any[]) => {
          assert.match(strings.join('?'), /SELECT id FROM EnergyPortalAccount WHERE id = \? FOR UPDATE/);
          assert.deepEqual(values, ['account']);
          state.events.push('lock:account'); locked = true;
          return [{ id: 'account' }];
        },
        energyMeasurementFile: {
          findUnique: async (args: any) => {
            assert.ok(locked); state.events.push('recheck'); return lookup(args);
          },
          upsert: async ({ where, create, update }: any) => {
            assert.ok(locked); state.events.push(`upsert:${create.status}`);
            if (options.failPersist === 'measurement' && create.status === 'DOWNLOADED') throw new Error('Measurement write failed');
            const kind = where.accountId_kind_periodYear_periodMonth.kind;
            const current = state.records.get(kind);
            const record = current ? { ...current, ...update } : { id: `measurement-${kind}`, ...create };
            state.records.set(kind, record); return structuredClone(record);
          },
          delete: forbidden, deleteMany: forbidden,
        },
        document: {
          create: async ({ data }: any) => {
            assert.ok(locked); state.events.push('document');
            if (options.failPersist === 'document') throw new Error('Document write failed');
            const document = { id: `new-${++state.sequence}`, ...data };
            state.documents.set(document.id, document); return document;
          },
          delete: forbidden, deleteMany: forbidden,
        },
      };
      try {
        const result = await callback(tx); state.events.push('commit'); return result;
      } catch (error) {
        state.records = snapshot.records; state.documents = snapshot.documents;
        state.events.push('rollback'); throw error;
      } finally { release(); }
    },
  };
  const modules: Record<string, unknown> = {
    crypto: { createHash, randomUUID: () => `file-${++state.sequence}` },
    path,
    'fs/promises': {
      mkdir: async () => undefined,
      writeFile: async (filename: string, bytes: Buffer) => {
        state.events.push('file');
        if (options.failWrite) throw new Error('File write failed');
        assert.equal(state.files.has(filename), false);
        state.files.set(filename, Buffer.from(bytes));
      },
      unlink: forbidden,
    },
    'lib/onrevolt/api': {
      readJsonObject: (req: Request) => req.json(),
      optionalString: (body: any, key: string) => body[key],
      jsonResponse: (body: any, init: ResponseInit) => Response.json(body, init),
      badRequest: (message: string) => Response.json({ message }, { status: 400 }),
      notFound: (message: string) => Response.json({ message }, { status: 404 }),
      serverError: (message: string) => Response.json({ message }, { status: 500 }),
    },
    'lib/onrevolt/credentials': { decryptCredential: () => 'fixture-password' },
    'lib/onrevolt/energy-measurement-document': { closedMeasurementPeriodKeys: () => new Set(['2026-08']) },
    'lib/onrevolt/enea-portal': {
      getClosedMonths: () => [{ year: 2026, month: 8, dateFrom: '2026-08-01', dateTo: '2026-08-31' }],
      eneaMeasurementLabel: (kind: string) => kind,
      loginEneaPortal: async () => ({}), listEneaPpes: async () => [{ id: 'ppe' }], selectEneaPpe: () => ({ id: 'ppe' }),
      downloadEneaMeasurementXlsx: async (_session: any, _ppe: any, _month: any, kind: string) => {
        state.events.push(`download:${kind}`);
        if (options.concurrentFile) addExisting(kind, 'concurrent');
        if (options.failDownload) throw new Error('Download failed');
        return { fileName: `${kind}.xlsx`, bytes: Buffer.from(`new workbook ${kind}`), mimeType: 'application/xlsx' };
      },
    },
    'lib/onrevolt/prisma': { prisma },
    'lib/onrevolt/re-consumption-sync': {
      syncEnergyMeasurementToRe: async (id: string) => {
        state.events.push('re'); state.reCalls.push(id);
        const record = [...state.records.values()].find(item => item.id === id);
        assert.ok(state.documents.has(record.documentId));
        if (options.reFailure === 'throw') throw new Error('Unexpected RE failure');
        return { status: options.reFailure ? 'failed' : 'synced', station: '41', message: options.reFailure ? 'RE unavailable' : 'OK' };
      },
    },
    'lib/onrevolt/staff-server': { authorizeStaffRequest: async () => ({ ok: true, user: { id: 'staff' } }) },
  };
  const exported: any = {};
  const context = vm.createContext({ exports: exported, Buffer, Date, Error,
    process: { env: { ONREVOLT_UPLOAD_DIR: root } },
    require: (name: string) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected route import: ${name}`); return modules[name];
    },
  });
  // Execute the actual route with every database, portal and filesystem side effect kept in memory.
  new vm.Script(routeCode, { filename: routePath }).runInContext(context, { timeout: 10000 });
  const run = async (force = true) => {
    const response: Response = await exported.POST(new Request('https://crm.example.test/api/integrations/enea/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: 'account', months: 1, force }),
    }));
    assert.equal(response.status, 200); return response.json();
  };
  function oldFilesIntact() {
    for (const kind of kinds) assert.equal(state.files.get(path.join(root, `old-${kind}.xlsx`))?.toString(), `old workbook ${kind}`);
  }
  return { state, before, initial, run, oldFilesIntact };
}

test('force atomically replaces active import/export links and retains every archived document and file', async () => {
  const f = fixture({ existing: true }); const result = await f.run();
  assert.equal(result.data.downloaded.length, 2); assert.equal(result.data.failed.length, 0);
  assert.equal(f.state.documents.size, 4); assert.equal(f.state.files.size, 4); f.oldFilesIntact();
  for (const kind of kinds) {
    assert.ok(f.state.documents.has(`old-${kind}`));
    assert.match(f.state.records.get(kind).documentId, /^new-/);
    assert.equal(f.state.records.get(kind).status, 'DOWNLOADED');
  }
  assert.deepEqual(f.state.events, kinds.flatMap(kind => [
    `download:${kind}`, 'begin', 'lock:account', 'recheck', 'file', 'document', 'upsert:DOWNLOADED', 'commit', 're',
  ]));
});

test('failed force download preserves DOWNLOADED, document, timestamp and pending RE error', async () => {
  const f = fixture({ existing: true, failDownload: true }); const result = await f.run();
  assert.deepEqual(f.initial(), f.before); f.oldFilesIntact();
  assert.equal(result.data.failed.length, 2); assert.equal(result.data.status, 'PARTIAL');
  assert.equal(f.state.reCalls.length, 0); assert.equal(f.state.events.includes('document'), false);
});

for (const failPersist of ['document', 'measurement'] as const) {
  test(`force ${failPersist} failure rolls back both database changes without touching the old archive`, async () => {
    const f = fixture({ existing: true, failPersist }); const result = await f.run();
    assert.deepEqual(f.initial(), f.before); f.oldFilesIntact();
    assert.equal(result.data.failed.length, 2); assert.equal(f.state.reCalls.length, 0);
    assert.equal(f.state.events.filter(event => event === 'rollback').length, 2);
  });
}

test('filesystem failure also leaves the old DOWNLOADED record and documents unchanged', async () => {
  const f = fixture({ existing: true, failWrite: true }); await f.run();
  assert.deepEqual(f.initial(), f.before); f.oldFilesIntact();
});

test('non-force rechecks a concurrent downloaded document under the account lock and skips replacement', async () => {
  const f = fixture({ concurrentFile: true }); const result = await f.run(false);
  assert.equal(result.data.skipped.length, 2); assert.equal(result.data.downloaded.length, 0);
  assert.equal(f.state.documents.size, 2); assert.equal(f.state.files.size, 2);
  assert.equal(f.state.events.includes('document'), false); assert.equal(f.state.events.includes('file'), false);
  for (const kind of kinds) assert.equal(f.state.records.get(kind).documentId, `concurrent-${kind}`);
  assert.deepEqual(f.state.events, kinds.flatMap(kind => [`download:${kind}`, 'begin', 'lock:account', 'recheck', 'commit', 're']));
});

test('catch rechecks concurrent successful download instead of downgrading it to FAILED', async () => {
  const f = fixture({ concurrentFile: true, failDownload: true }); const result = await f.run(false);
  assert.equal(result.data.failed.length, 2);
  for (const kind of kinds) {
    const record = f.state.records.get(kind);
    assert.equal(record.status, 'DOWNLOADED'); assert.equal(record.documentId, `concurrent-${kind}`);
    assert.equal(record.error, '[RE] Nie potwierdzono wcześniejszego importu'); assert.ok(record.downloadedAt);
  }
  assert.equal(f.state.events.includes('upsert:FAILED'), false);
});

test('download failure without a previous document still records FAILED visibly', async () => {
  const f = fixture({ failDownload: true }); const result = await f.run();
  assert.equal(result.data.failed.length, 2);
  for (const record of f.state.records.values()) {
    assert.equal(record.status, 'FAILED'); assert.equal(record.error, 'Download failed');
  }
  assert.equal(f.state.documents.size, 0);
});

for (const reFailure of ['result', 'throw'] as const) {
  test(`RE ${reFailure} failure retains both newly committed files and older archived documents`, async () => {
    const f = fixture({ existing: true, reFailure }); const result = await f.run();
    assert.equal(result.data.status, 'PARTIAL'); assert.equal(f.state.documents.size, 4); f.oldFilesIntact();
    for (const record of f.state.records.values()) {
      assert.equal(record.status, 'DOWNLOADED'); assert.match(record.documentId, /^new-/);
    }
  });
}

test('account lock applies also to ENEA accounts without a linked project', async () => {
  const f = fixture({ existing: true, noProject: true }); await f.run();
  assert.equal(f.state.events.filter(event => event === 'lock:account').length, 2); f.oldFilesIntact();
});
