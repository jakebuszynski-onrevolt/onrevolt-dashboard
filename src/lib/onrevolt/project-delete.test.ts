import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as lifecycle from './project-delete';

const route = path.resolve(__dirname, '../../app/api/projects/[id]/route.ts');
const code = ts.transpileModule(readFileSync(route, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(options: { role?: string; anonymous?: boolean; project?: any; tariff?: boolean; tariffError?: boolean; auditError?: boolean } = {}) {
  const project = options.project === undefined ? {
    id: 'p1', clientId: 'c1', title: 'Nowy projekt', updatedAt: new Date('2026-11-03T10:00:00.000Z'), _count: {},
  } : options.project;
  const calls: string[] = [];
  const tx = {
    $queryRaw: async (_strings: unknown, id: string, clientId: string) => {
      assert.equal(id, 'p1'); assert.equal(clientId, 'c1'); calls.push('lock'); return [];
    },
    project: {
      findFirst: async ({ where }: any) => { calls.push('read'); return project?.clientId === where.clientId
        ? { energyAudits: [], energyPortalAccounts: [], ...project } : null; },
      delete: async ({ where }: any) => { assert.equal(where.id, 'p1'); calls.push('delete'); },
    },
    energyPortalAccount: {
      update: async ({ where, data }: any) => { assert.equal(where.id, 'account'); assert.equal(data.projectId, 'original'); calls.push('reassign-account'); },
      delete: async ({ where }: any) => { assert.equal(where.id, 'account'); calls.push('delete-empty-account'); },
    },
    auditLog: { create: async ({ data }: any) => {
      calls.push('audit');
      if (data.entityType === 'Project') { assert.equal(data.action, 'DELETE'); assert.equal(data.before.title, project.title); }
      assert.equal(data.clientId, 'c1');
      if (options.auditError) throw new Error('audit failed');
    } },
  };
  const modules = {
    'lib/onrevolt/api': {
      badRequest: (error: string) => Response.json({ ok: false, error }, { status: 400 }),
      forbidden: (error: string) => Response.json({ ok: false, error }, { status: 403 }),
      notFound: (error: string) => Response.json({ ok: false, error }, { status: 404 }),
      jsonResponse: (data: unknown, init: any) => Response.json(data, init),
      readJsonObject: (req: Request) => req.json(),
      serverError: (error: string) => Response.json({ ok: false, error }, { status: 500 }),
    },
    'lib/onrevolt/prisma': { prisma: { $transaction: async (fn: any, config: any) => {
      assert.equal(config.isolationLevel, 'Serializable'); calls.push('transaction'); return fn(tx);
    } } },
    'lib/onrevolt/re-stations': { rePrisma: () => ({ $queryRawUnsafe: async (sql: string, id: string) => {
      assert.match(sql, /WHERE project_id = \?/); assert.equal(id, 'p1'); calls.push('tariff');
      if (options.tariffError) throw new Error('RE unavailable');
      return options.tariff ? [{ id: 'tariff-profile' }] : [];
    } }) },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async (_req: any, permission: string) => {
        assert.equal(permission, 'crm.write');
        return options.anonymous ? { ok: false, response: Response.json({}, { status: 401 }) }
          : { ok: true, user: { id: 'admin1', systemRole: options.role || 'ADMIN' } };
      },
      isAdminUser: (user: any) => user.systemRole === 'ADMIN',
    },
    'lib/onrevolt/project-delete': lifecycle,
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  } });
  return { calls, run: (body: any = {}) => exports.DELETE(new Request('https://example.test/api/projects/p1', {
    method: 'DELETE', body: JSON.stringify({ clientId: 'c1', expectedTitle: 'Nowy projekt', expectedUpdatedAt: '2026-11-03T10:00:00.000Z', confirm: true, ...body }),
  }), { params: Promise.resolve({ id: 'p1' }) }) };
}

test('only ADMIN can delete projects, even when other staff have crm.write', async () => {
  for (const role of ['USER', 'MODERATOR']) {
    const f = fixture({ role }); assert.equal((await f.run()).status, 403); assert.deepEqual(f.calls, []);
  }
  const f = fixture({ anonymous: true }); assert.equal((await f.run()).status, 401); assert.deepEqual(f.calls, []);
});

test('requires explicit confirmation, client and concurrency token', async () => {
  for (const body of [{ confirm: false }, { clientId: '' }, { expectedTitle: '' }, { expectedUpdatedAt: '' }]) {
    const f = fixture(); assert.equal((await f.run(body)).status, 400); assert.deepEqual(f.calls, []);
  }
});

test('deletes only selected empty project with lock and transactional audit', async () => {
  const f = fixture(); const response = await f.run();
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).data, { id: 'p1', clientId: 'c1' });
  assert.deepEqual(f.calls, ['transaction', 'lock', 'read', 'tariff', 'audit', 'delete']);
});

test('missing or another client project cannot be deleted', async () => {
  for (const project of [null, { id: 'p1', clientId: 'other' }]) {
    const f = fixture({ project }); assert.equal((await f.run()).status, 404); assert.ok(!f.calls.includes('delete'));
  }
});

test('changed project or title requires reconfirmation', async () => {
  for (const body of [{ expectedTitle: 'Old title' }, { expectedUpdatedAt: '2026-11-02T10:00:00.000Z' }]) {
    const f = fixture(); assert.equal((await f.run(body)).status, 409); assert.ok(!f.calls.includes('delete'));
  }
});

test('all dependent collections, singleton records and external links block deletion', async () => {
  const base = { id: 'p1', clientId: 'c1', title: 'Nowy projekt', updatedAt: new Date('2026-11-03T10:00:00.000Z'), _count: {} };
  const variants = [
    ...Object.keys(lifecycle.projectDeleteRelationLabels).map(key => ({ ...base, _count: { [key]: 1 } })),
    ...['offerWorkspace', 'odsCase', 'dashboardStation', 'dashboardStationNumber', 'weatherStationNumber', 'pipedriveDealId'].map(key => ({ ...base, [key]: 'linked' })),
  ];
  for (const project of variants) {
    const f = fixture({ project }); const res = await f.run();
    assert.equal(res.status, 409); assert.ok((await res.json()).blockers.length); assert.ok(!f.calls.includes('delete'));
  }
  const f = fixture({ tariff: true }); assert.equal((await f.run()).status, 409); assert.ok(!f.calls.includes('delete'));
});

test('RE check or audit failure cannot result in deletion', async () => {
  for (const options of [{ tariffError: true }, { auditError: true }]) {
    const f = fixture(options); assert.equal((await f.run()).status, 500); assert.ok(!f.calls.includes('delete'));
  }
});

test('schema collections remain covered by deletion checks', () => {
  const schema = readFileSync(path.resolve(__dirname, '../../../prisma/schema.prisma'), 'utf8');
  const model = schema.split('model Project {')[1].split('\n}')[0];
  const collections = [...model.matchAll(/^\s+(\w+)\s+\w+\[\]/gm)].map(match => match[1]).sort();
  assert.deepEqual(collections, [...Object.keys(lifecycle.projectDeleteRelationLabels), ...lifecycle.projectDeleteCacheRelations].sort());
  const cacheModel = schema.split('model OfferWorkspaceArtifact {')[1].split('\n}')[0];
  assert.match(cacheModel, /project\s+Project\s+@relation\([^\n]*onDelete: Cascade/);
});

test('UI exposes project deletion only to admin and preserves confirmation', () => {
  const profile = readFileSync(path.resolve(__dirname, '../../components/onrevolt/ClientProfile.tsx'), 'utf8');
  assert.match(profile, /isAdmin && project\.id \? <DeleteProjectButton/);
  const button = readFileSync(path.resolve(__dirname, '../../components/onrevolt/DeleteProjectButton.tsx'), 'utf8');
  assert.match(button, /leastDestructiveRef=\{cancelRef\}/);
  assert.match(button, /expectedUpdatedAt: project\.updatedAt, confirm: true/);
  assert.match(button, /await onDeleted\(\)/);
});

const emptyAudit = { id: 'audit', status: 'DRAFT', profileSource: 'ANNUAL_DECLARATION', phaseCount: 3,
  roofOrientation: 'S', roofType: 'UNKNOWN', annualConsumptionKwh: null, _count: { scenarios: 0 } };
const emptyAccount = { id: 'account', clientId: 'c1', projectId: 'p1', operator: 'ENEA', measurementFiles: [] };
const emptyProject = { id: 'p1', clientId: 'c1', title: 'Nowy projekt', updatedAt: new Date('2026-11-03T10:00:00.000Z'),
  _count: { energyAudits: 1, energyPortalAccounts: 1 }, energyAudits: [emptyAudit], energyPortalAccounts: [emptyAccount] };

test('empty form defaults and empty operator account do not block deletion', async () => {
  const f = fixture({ project: emptyProject });
  assert.equal((await f.run()).status, 200);
  assert.ok(f.calls.includes('delete-empty-account'));
  assert.equal(f.calls.at(-1), 'delete');
});

test('meaningful energy values and scenarios still block deletion', async () => {
  for (const change of [{ annualConsumptionKwh: '3000' }, { existingPvKw: '9.9' }, { notes: 'Notatka' },
    { phaseCount: 1 }, { roofOrientation: 'E' }, { status: 'COMPLETED' }, { hasOperatorData: true },
    { _count: { scenarios: 1 } }, { futureField: 'populated' }]) {
    const f = fixture({ project: { ...emptyProject, energyAudits: [{ ...emptyAudit, ...change }] } });
    assert.equal((await f.run()).status, 409); assert.ok(!f.calls.includes('delete'));
  }
});

test('preserves credentials and measurements by returning account to their actual project', async () => {
  const account = { ...emptyAccount, encryptedPassword: 'secret', tariff: 'G11',
    measurementFiles: [{ projectId: 'original', clientId: 'c1', project: { clientId: 'c1' } }] };
  const f = fixture({ project: { ...emptyProject, energyPortalAccounts: [account] } });
  assert.equal((await f.run()).status, 200);
  assert.ok(f.calls.includes('reassign-account')); assert.ok(!f.calls.includes('delete-empty-account'));
});

test('ambiguous accounts, own measurements and credentials without foreign measurements remain protected', async () => {
  for (const change of [{ login: 'user' }, { tariff: 'C11' }, { encryptedPassword: 'secret' },
    { measurementFiles: [{ projectId: 'p1', clientId: 'c1', project: { clientId: 'c1' } }] },
    { measurementFiles: [{ projectId: null, clientId: 'c1', project: null }] },
    { measurementFiles: [{ projectId: 'original', clientId: 'c1', project: { clientId: 'other' } }] },
    { measurementFiles: ['a', 'b'].map(projectId => ({ projectId, clientId: 'c1', project: { clientId: 'c1' } })) }]) {
    const f = fixture({ project: { ...emptyProject, energyPortalAccounts: [{ ...emptyAccount, ...change }] } });
    assert.equal((await f.run()).status, 409); assert.ok(!f.calls.includes('delete-empty-account'));
    assert.ok(!f.calls.includes('reassign-account')); assert.ok(!f.calls.includes('delete'));
  }
});
