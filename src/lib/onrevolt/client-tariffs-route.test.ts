import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const filename = path.resolve(__dirname, '../../app/api/crm/projects/tariffs/route.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function fixture(options: { denied?: boolean; scopeError?: boolean; stale?: boolean; generalTariff?: { operator: string; code: string } | null } = {}) {
  const calls: any[] = [], permissions: string[] = [];
  class ClientTariffError extends Error { constructor(message: string, public status = 400) { super(message); } }
  const modules: Record<string, unknown> = {
    'lib/onrevolt/api': { jsonResponse: (value: unknown, init?: { status: number }) => ({ status: init?.status || 200, value }), readJsonObject: async (req: any) => req.body },
    'lib/onrevolt/staff-server': { authorizeStaffRequest: async (_req: unknown, permission: string) => {
      permissions.push(permission); return options.denied ? { ok: false, response: { status: 403 } } : { ok: true, user: { id: 'staff' } };
    }, hasStaffPermission: () => true },
    'lib/onrevolt/client-tariffs-server': { ClientTariffError, clientTariffScope: async (clientId: string, projectId: string) => {
      if (options.scopeError) throw new ClientTariffError('Projekt nie należy do klienta.', 404);
      return { clientId, projectId, station: null, ppe: 'verified-ppe', generalTariff: options.generalTariff ?? null };
    }, readProjectGeneralTariffs: async (scope: any) => ({ generalTariff: scope.generalTariff, generalTariffSource: 'CRM', targetTariff: null }),
    callClientTariffs: async (input: unknown) => { calls.push(input); if (options.stale) throw new ClientTariffError('Odśwież taryfy.', 409); return { profile: null }; } },
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (key: string) => { if (!modules[key]) throw new Error(key); return modules[key]; }, console });
  const req = (body: unknown) => ({ body, nextUrl: new URL('http://localhost/api/crm/projects/tariffs?clientId=client&projectId=project') });
  return { exports, calls, permissions, req };
}
const body = { action: 'preview', operation: 'change', clientId: 'client', projectId: 'project', revision: 0, period: {} };
test('tariff mutation requires energy.manage before reading project or calling RE', async () => {
  const f = fixture({ denied: true });
  assert.equal((await f.exports.POST(f.req(body))).status, 403);
  assert.deepEqual(f.permissions, ['energy.manage']); assert.equal(f.calls.length, 0);
});
test('tariff API verifies project scope and ignores supplied station, actor and arbitrary periods', async () => {
  const f = fixture();
  assert.equal((await f.exports.POST(f.req({ ...body, actorId: 'fake', scope: { station: '999' }, periods: [] }))).status, 200);
  assert.equal(f.calls[0].actorId, 'staff'); assert.equal(f.calls[0].scope.station, null); assert.equal(f.calls[0].periods, undefined);
  const invalid = fixture({ scopeError: true });
  assert.equal((await invalid.exports.POST(invalid.req(body))).status, 404); assert.equal(invalid.calls.length, 0);
});
test('tariff API rejects stale revisions and unsupported writes', async () => {
  const f = fixture({ stale: true }); assert.equal((await f.exports.POST(f.req(body))).status, 409);
  const invalid = fixture();
  for (const patch of [{ revision: -1 }, { revision: '0' }, { action: 'import' }, { operation: 'replace' }, { operation: 'confirm' }]) {
    assert.equal((await invalid.exports.POST(invalid.req({ ...body, ...patch }))).status, 400);
  }
  assert.equal(invalid.calls.length, 0);
});
test('tariff read uses crm.read and reports edit permission separately', async () => {
  const f = fixture(); const result = await f.exports.GET(f.req(null));
  assert.equal(result.status, 200); assert.equal(result.value.data.canEdit, true); assert.deepEqual(f.permissions, ['crm.read']);
});
test('tariff read exposes the saved project tariff and an explicit missing selection', async () => {
  const f = fixture({ generalTariff: { operator: 'ENEA', code: 'C11' } });
  const result = await f.exports.GET(f.req(null));
  assert.equal(result.value.data.generalTariff.operator, 'ENEA');
  assert.equal(result.value.data.generalTariff.code, 'C11');
  const empty = fixture();
  assert.equal((await empty.exports.GET(empty.req(null))).value.data.generalTariff, null);
});
test('station binding cannot carry a tariff edit or evidence confirmation', async () => {
  const f = fixture();
  const result = await f.exports.POST(f.req({ ...body, action: 'bind', operation: 'confirm', evidenceId: 'evidence', period: { tariffId: 99 } }));
  assert.equal(result.status, 200);
  assert.equal(f.calls[0].operation, undefined);
  assert.equal(f.calls[0].period, undefined);
  assert.equal(f.calls[0].evidenceId, undefined);
});
