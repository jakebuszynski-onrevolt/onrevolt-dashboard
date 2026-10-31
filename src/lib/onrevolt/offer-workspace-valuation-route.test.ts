import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const routeFile = path.resolve(__dirname, '../../app/api/projects/[id]/offer-workspace/valuation/route.ts');
const code = ts.transpileModule(readFileSync(routeFile, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(options: { denied?: boolean; noEnergy?: boolean; missing?: boolean; changeRevision?: boolean } = {}) {
  class OfferWorkspaceNotFoundError extends Error {}
  let calculations = 0;
  let loads = 0;
  const authoritativeSeries = { intervals: ['server-measurements'] };
  const expectedData = { vatBasis: 'GROSS', current: {}, target: {} };
  const modules: Record<string, any> = {
    'lib/onrevolt/api': {
      jsonResponse: (body: unknown, init?: ResponseInit) => Response.json(body, init),
      badRequest: (error: string) => Response.json({ error }, { status: 400 }),
      forbidden: (error: string) => Response.json({ error }, { status: 403 }),
      notFound: (error: string) => Response.json({ error }, { status: 404 }),
    },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async () => options.denied
        ? { ok: false, response: new Response(null, { status: 403 }) }
        : { ok: true, user: { id: 'staff' } },
      hasStaffPermission: () => !options.noEnergy,
    },
    'lib/onrevolt/offer-workspace': { parseOfferWorkspaceDraft: (draft: unknown) => draft },
    'lib/onrevolt/offer-workspace-server': {
      OfferWorkspaceNotFoundError,
      loadProjectOfferWorkspace: async (_id: string, _user: unknown, _now: Date, collect?: (series: unknown) => void) => {
        loads += 1;
        if (options.missing) throw new OfferWorkspaceNotFoundError('missing');
        collect?.(authoritativeSeries);
        return { revision: options.changeRevision && loads > 1 ? 'revision-2' : 'revision-1' };
      },
    },
    'lib/onrevolt/offer-workspace-valuation-server': {
      calculateOfferWorkspaceValuationOnServer: async (_workspace: unknown, draft: any, series: unknown) => {
        assert.equal(series, authoritativeSeries);
        assert.equal(draft.currentSettlement, 'NET_METERING');
        calculations += 1;
        return expectedData;
      },
    },
  };
  const exports: any = {};
  vm.runInNewContext(code, {
    exports, Buffer,
    require: (name: string) => {
      assert.ok(name in modules, name);
      return modules[name];
    },
  });
  const post = (body: unknown, raw = JSON.stringify(body)) => exports.POST(
    new Request('http://localhost/api/projects/p/offer-workspace/valuation', { method: 'POST', body: raw }),
    { params: Promise.resolve({ id: 'p' }) },
  );
  return { post, calculations: () => calculations };
}

const draft = { currentSettlement: 'NET_METERING', targetSettlement: 'NET_METERING', targetOperatorId: 27, targetTariffId: 27 };

test('valuation requires both permissions and an authorized project before calculation', async () => {
  for (const options of [{ denied: true }, { noEnergy: true }]) {
    const state = fixture(options);
    assert.equal((await state.post({ draft, sourceRevision: 'revision-1' })).status, 403);
    assert.equal(state.calculations(), 0);
  }
  assert.equal((await fixture({ missing: true }).post({ draft, sourceRevision: 'revision-1' })).status, 404);
});

test('valuation checks source revision, ignores client measurements, and returns typed data without caching', async () => {
  const state = fixture();
  assert.equal((await state.post({ draft, sourceRevision: 'stale' })).status, 409);
  assert.equal(state.calculations(), 0);
  const response = await state.post({ draft, sourceRevision: 'revision-1', intervals: ['injected'] });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { vatBasis: 'GROSS', current: {}, target: {} });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(state.calculations(), 1);
});

test('valuation rejects oversized and invalid JSON and rechecks revision after pricing', async () => {
  const state = fixture();
  assert.equal((await state.post({}, '{')).status, 400);
  assert.equal((await state.post({}, 'x'.repeat(129 * 1024))).status, 413);
  assert.equal(state.calculations(), 0);
  const changed = fixture({ changeRevision: true });
  assert.equal((await changed.post({ draft, sourceRevision: 'revision-1' })).status, 409);
  assert.equal(changed.calculations(), 1);
});
