import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const file = path.resolve(__dirname, '../../app/api/projects/[id]/reference-load-profile/route.ts');
const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const stamp = '2026-11-07T00:00:00.000Z';
function fixture(options: { authorized?: boolean; project?: boolean; source?: string; syncFailed?: boolean; commitFailed?: boolean; newerAnnual?: number; newerSource?: string; unrelatedAudit?: boolean } = {}) {
  const state = { selection: { key: null as string | null, contentHash: null as string | null, profileName: null as string | null, revision: 0 },
    audit: { annualConsumptionKwh: 6000, updatedAt: new Date(stamp), profileSource: options.source ?? 'ANNUAL_DECLARATION' },
    writes: 0, logs: [] as any[], syncs: [] as any[], permissions: [] as string[], locked: false, scopeChecks: 0, transactions: 0 };
  const db: any = {
    project: { findFirst: async (args: any) => { state.scopeChecks++; assert.equal(args.where.ownerScope, 'staff'); return options.project === false ? null : { id: 'project', clientId: 'client' }; } },
    energyAudit: {
      findUnique: async () => state.audit,
      upsert: async ({ update }: any) => { assert.ok(state.locked); state.writes++; state.audit = { ...state.audit, ...update, updatedAt: new Date('2026-11-07T00:01:00.000Z') }; return state.audit; },
    },
    $queryRaw: async () => { state.locked = true; return [{ id: 'project' }]; },
    $executeRaw: async (_sql: any, projectId: string, key: string | null, hash: string | null, name: string | null, revision: number) => {
      assert.equal(projectId, 'project'); assert.ok(state.locked); state.selection = { key, contentHash: hash, profileName: name, revision }; return 1;
    },
    auditLog: { create: async ({ data }: any) => { state.logs.push(data); } },
    $transaction: async (run: any) => {
      state.transactions++;
      if (state.transactions === 2) {
        if (options.newerAnnual) state.audit.annualConsumptionKwh = options.newerAnnual;
        if (options.newerSource) state.audit.profileSource = options.newerSource;
        if (options.unrelatedAudit) state.audit.updatedAt = new Date('2026-11-07T00:02:00.000Z');
      }
      try { const result = await run(db); if (options.commitFailed && state.transactions === 1) throw new Error('Commit failed'); return result; }
      finally { state.locked = false; }
    },
  };
  const modules: Record<string, any> = {
    'lib/onrevolt/api': { jsonResponse: (data: any, init?: any) => Response.json(data, init), badRequest: (error: string) => Response.json({ error }, { status: 400 }), notFound: (error: string) => Response.json({ error }, { status: 404 }) },
    'lib/onrevolt/prisma': { prisma: db },
    'lib/onrevolt/staff-server': { authorizeStaffRequest: async (_req: any, permission: string) => { state.permissions.push(permission); return options.authorized === false ? { ok: false, response: Response.json({}, { status: 403 }) } : { ok: true, user: { id: 'staff' } }; } },
    'lib/onrevolt/offer-workspace-server': { offerWorkspaceProjectWhere: (id: string, user: any) => ({ id, ownerScope: user.id }) },
    'lib/onrevolt/project-reference-profile': {
      readProjectReferenceProfileSelection: async () => ({ ...state.selection }),
      referenceProfileForKey: async (key: string) => { if (key === 'invalid') throw new Error('Profil poboru z sieci.'); return { profile: { key, name: 'Profil firmy' }, contentHash: 'a'.repeat(64) }; },
    },
    'lib/onrevolt/re-reference-profile': { syncProjectReferenceLoadProfile: async (input: any) => { assert.ok(state.locked); assert.equal(input.crmDb, db); state.syncs.push(input); return { status: options.syncFailed ? 'failed' : 'synced', message: 'RE sync', station: '1' }; } },
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (name: string) => { if (!(name in modules)) throw new Error(name); return modules[name]; }, console: { error: () => {} }, Date });
  const body = { profileKey: 'firm', annualKwh: 12000, expectedRevision: 0, expectedAuditUpdatedAt: stamp };
  const call = (method: string, input: any = body) => exports[method]({ json: async () => input }, { params: Promise.resolve({ id: 'project' }) });
  return { state, body, call };
}

test('selection endpoints enforce permission and project scope before reads or writes', async () => {
  for (const method of ['GET', 'PUT']) {
    const unauthorized = fixture({ authorized: false });
    assert.equal((await unauthorized.call(method)).status, 403);
    assert.equal(unauthorized.state.scopeChecks, 0);
    const inaccessible = fixture({ project: false });
    assert.equal((await inaccessible.call(method)).status, 404);
    assert.equal(inaccessible.state.writes, 0);
  }
});
test('selection GET reports current annual and revision with private cache policy', async () => {
  const f = fixture(); const response = await f.call('GET'); const body = await response.json();
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(body.data.selection.revision, 0); assert.equal(body.data.auditUpdatedAt, stamp); assert.equal(body.data.annualConsumptionKwh, 6000);
});
test('save persists one profile and annual under a lock then synchronizes the linked RE station', async () => {
  const f = fixture(); const response = await f.call('PUT'); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.data.selection.key, 'firm'); assert.equal(body.data.selection.revision, 1);
  assert.equal(body.data.annualConsumptionKwh, 12000); assert.equal(f.state.syncs[0].annualKwh, 12000);
  assert.equal(f.state.logs[0].before.selection.key, null); assert.equal(f.state.logs[0].after.selection.key, 'firm');
  assert.equal(f.state.scopeChecks, 2);
});
test('stale selection or annual revision cannot overwrite another save', async () => {
  for (const override of [{ expectedRevision: 2 }, { expectedAuditUpdatedAt: null }]) {
    const f = fixture(); assert.equal((await f.call('PUT', { ...f.body, ...override })).status, 409);
    assert.equal(f.state.writes, 0); assert.equal(f.state.syncs.length, 0);
  }
});
test('invalid annual, unsupported profile and incompatible source do not mutate data', async () => {
  for (const override of [{ annualKwh: 0 }, { annualKwh: 1.2345 }, { annualKwh: 1e12 }, { profileKey: 'invalid' }]) {
    const f = fixture(); assert.equal((await f.call('PUT', { ...f.body, ...override })).status, 400); assert.equal(f.state.writes, 0);
  }
  const f = fixture({ source: 'OPERATOR_HOURLY' }); assert.equal((await f.call('PUT')).status, 409); assert.equal(f.state.writes, 0);
});
test('explicit default resets selection without deleting its revision history', async () => {
  const f = fixture(); f.state.selection = { key: 'old', contentHash: 'b'.repeat(64), profileName: 'Stary', revision: 3 };
  const response = await f.call('PUT', { ...f.body, profileKey: null, expectedRevision: 3 });
  assert.equal(response.status, 200); assert.equal(f.state.selection.key, null); assert.equal(f.state.selection.revision, 4);
  assert.equal(f.state.syncs[0].referenceProfile, null);
});
test('RE failure is reported as partial save with current versions available for explicit retry', async () => {
  const f = fixture({ syncFailed: true }); const response = await f.call('PUT'); const body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.saved, true); assert.equal(body.ok, false);
  assert.equal(body.data.selection.revision, 1); assert.notEqual(body.data.auditUpdatedAt, stamp); assert.equal(body.reSync.status, 'failed');
});

test('failed CRM commit never publishes to RE; superseded annual never publishes an older value', async () => {
  const failed = fixture({ commitFailed: true }); assert.equal((await failed.call('PUT')).status, 500); assert.equal(failed.state.syncs.length, 0);
  const newer = fixture({ newerAnnual: 14000 }); const result = await (await newer.call('PUT')).json();
  assert.equal(result.reSync.status, 'skipped'); assert.equal(result.data.annualConsumptionKwh, 14000); assert.equal(newer.state.syncs.length, 0);
  const unrelated = fixture({ unrelatedAudit: true }); assert.equal((await unrelated.call('PUT')).status, 200); assert.equal(unrelated.state.syncs.length, 1);
  const changedSource = fixture({ newerSource: 'OPERATOR_HOURLY' }); const changed = await (await changedSource.call('PUT')).json();
  assert.equal(changed.reSync.status, 'skipped'); assert.equal(changed.data.profileSource, 'OPERATOR_HOURLY'); assert.equal(changedSource.state.syncs.length, 0);
});
