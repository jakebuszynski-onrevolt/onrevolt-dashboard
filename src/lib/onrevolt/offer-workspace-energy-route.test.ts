import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const file = path.resolve(__dirname, '../../app/api/projects/[id]/offer-workspace/energy/route.ts');
const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function fixture({ denied = false, noEnergy = false, missing = false } = {}) {
  class OfferWorkspaceNotFoundError extends Error {}
  let calculated = 0;
  const authoritative = { intervals: ['server-only'] };
  let calculatedDraft: any = null;
  const modules: Record<string, any> = {
    'lib/onrevolt/api': {
      jsonResponse: (body: unknown, init?: ResponseInit) => Response.json(body, init),
      badRequest: (error: string) => Response.json({ error }, { status: 400 }),
      forbidden: (error: string) => Response.json({ error }, { status: 403 }),
      notFound: (error: string) => Response.json({ error }, { status: 404 }),
    },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async () => denied ? { ok: false, response: new Response(null, { status: 403 }) } : { ok: true, user: { id: 'staff' } },
      hasStaffPermission: () => !noEnergy,
    },
    'lib/onrevolt/offer-workspace': {
      parseOfferWorkspaceDraft: (value: unknown) => { if (!value) throw new Error('invalid'); return value; },
      offerWorkspaceDraftWithBatteryPresence: (draft: any, presence: boolean | null) => ({ ...draft, existingBatteryPresent: presence }),
    },
    'lib/onrevolt/offer-workspace-server': {
      OfferWorkspaceNotFoundError,
      loadProjectOfferWorkspace: async (_id: string, user: any, _now: Date, collect: (value: unknown) => void) => {
        assert.equal(user.id, 'staff');
        if (missing) throw new OfferWorkspaceNotFoundError('missing');
        collect?.(authoritative);
        return { revision: 'revision-1', input: { existingBatteryPresent: true } };
      },
    },
    'lib/onrevolt/offer-workspace-energy-server': {
      calculateOfferWorkspaceEnergy: async (_workspace: unknown, draft: unknown, series: unknown) => {
        assert.equal(series, authoritative);
        calculatedDraft = draft;
        calculated++;
        return { quality: 'MODELLED' };
      },
    },
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, Buffer, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
  const post = (body: unknown, raw = JSON.stringify(body)) => exports.POST(new Request('http://localhost/api', { method: 'POST', body: raw }), { params: Promise.resolve({ id: 'p' }) });
  return { post, calculated: () => calculated, calculatedDraft: () => calculatedDraft };
}
test('energy requires both permissions and scoped project before calculation', async () => {
  for (const options of [{ denied: true }, { noEnergy: true }]) {
    const state = fixture(options);
    assert.equal((await state.post({ draft: {}, sourceRevision: 'revision-1' })).status, 403);
    assert.equal(state.calculated(), 0);
  }
  assert.equal((await fixture({ missing: true }).post({ draft: {}, sourceRevision: 'revision-1' })).status, 404);
});
test('energy rejects stale revision and ignores injected measurements', async () => {
  const state = fixture();
  assert.equal((await state.post({ draft: {}, sourceRevision: 'old' })).status, 409);
  assert.equal(state.calculated(), 0);
  const response = await state.post({ draft: {}, sourceRevision: 'revision-1', series: { intervals: ['injected'] } });
  assert.equal(response.status, 200);
  assert.equal(state.calculated(), 1);
  assert.equal(state.calculatedDraft().existingBatteryPresent, true, 'the server EnergyAudit status overrides the request draft');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('energy request is bounded and invalid JSON cannot invoke model', async () => {
  const state = fixture();
  assert.equal((await state.post({}, '{')).status, 400);
  assert.equal((await state.post({}, 'x'.repeat(129 * 1024))).status, 413);
  assert.equal(state.calculated(), 0);
});
