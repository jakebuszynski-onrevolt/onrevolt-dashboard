import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { emptyOfferWorkspaceDraft, parseOfferWorkspaceDraft } from './offer-workspace';

const routePath = path.resolve(__dirname, '../../app/api/projects/[id]/offer-workspace/route.ts');
const routeCode = ts.transpileModule(readFileSync(routePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: routePath,
}).outputText;

function fixture(options: { deniedPermission?: string; notFound?: boolean; conflict?: boolean; canReadEnergy?: boolean; populatedDraft?: boolean } = {}) {
  const calls: Array<{ operation: string; value: any }> = [];
  class OfferWorkspaceNotFoundError extends Error {}
  class OfferWorkspaceConflictError extends Error {}
  const workspace = {
    projectId: 'project-1', clientId: 'client-1', projectName: 'Projekt', clientName: 'Klient', clientType: 'B2C',
    ppeNumber: null, revision: 'a'.repeat(64), input: {},
    measurements: {
      periods: [],
      months: Array.from({ length: 12 }, (_, index) => {
        const period = new Date(Date.UTC(2025, 9 + index, 1)).toISOString().slice(0, 7);
        return { period, importKwh: null, exportKwh: null };
      }),
      totalsImportKwh: null, totalsExportKwh: null, intervalCount: null, missingDirections: [], issues: [],
    },
    templates: [], draft: options.populatedDraft ? {
      revision: 4,
      sourceRevision: 'b'.repeat(64),
      updatedAt: '2026-10-29T10:00:00.000Z',
      input: {
        existingPv: { powerKw: 9.9, tiltDegrees: 40, azimuthDegrees: 170, lossPercent: 12 },
        targetOperatorId: 7, targetTariffId: 42,
        description: { before: 'Opis poufnego szkicu', after: 'Założenie poufne' },
      },
    } : null,
  };
  const modules: Record<string, unknown> = {
    'lib/onrevolt/api': {
      badRequest: (message: string) => ({ status: 400, value: { ok: false, error: message } }),
      forbidden: (message: string) => ({ status: 403, value: { ok: false, error: message } }),
      jsonResponse: (value: unknown, init?: { status?: number }) => ({ status: init?.status || 200, value }),
      notFound: (message: string) => ({ status: 404, value: { ok: false, error: message } }),
      readJsonObject: async (req: any) => req.body,
      serverError: (message: string) => ({ status: 500, value: { ok: false, error: message } }),
    },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async (_req: unknown, permission: string) => {
        calls.push({ operation: 'authorize', value: permission });
        return options.deniedPermission === permission ? { ok: false, response: { status: 403 } } : {
          ok: true, user: { id: 'seller', systemRole: 'USER' },
        };
      },
      hasStaffPermission: (_user: unknown, permission: string) => permission !== 'energy.manage' || options.canReadEnergy !== false,
    },
    'lib/onrevolt/offer-workspace': {
      parseOfferWorkspaceDraft,
    },
    'lib/onrevolt/offer-workspace-server': {
      OfferWorkspaceNotFoundError,
      OfferWorkspaceConflictError,
      OfferWorkspacePermissionError: class OfferWorkspacePermissionError extends Error {},
      loadProjectOfferWorkspace: async (id: string, user: unknown, now: Date) => {
        calls.push({ operation: 'load', value: { id, user, now } });
        if (options.notFound) throw new OfferWorkspaceNotFoundError('Nie znaleziono projektu');
        return workspace;
      },
      saveProjectOfferWorkspaceDraft: async (value: unknown) => {
        calls.push({ operation: 'save', value });
        if (options.conflict) throw new OfferWorkspaceConflictError('Nieaktualna rewizja');
        return { revision: 1, sourceRevision: 'a'.repeat(64), updatedAt: '2026-10-29T10:00:00.000Z', input: emptyOfferWorkspaceDraft() };
      },
    },
  };
  const exports: any = {};
  vm.runInNewContext(routeCode, {
    exports,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected route import: ${name}`);
      return modules[name];
    },
  });
  const req = (body: unknown = null) => ({ body });
  const context = { params: Promise.resolve({ id: 'project-1' }) };
  return { exports, calls, req, context };
}

test('GET wymaga offers.manage i energy.manage oraz zwraca miesięczne podsumowanie bez interwałów', async () => {
  const state = fixture();
  const result = await state.exports.GET(state.req(), state.context);
  assert.equal(result.status, 200);
  assert.deepEqual(state.calls[0], { operation: 'authorize', value: 'offers.manage' });
  assert.equal(state.calls[1].operation, 'load');
  assert.equal(state.calls[1].value.id, 'project-1');
  assert.equal('intervals' in result.value.data.measurements, false);
  assert.equal(result.value.data.measurements.months.length, 12);
  assert.equal(result.value.data.measurements.months[0].period, '2025-10');
  assert.equal(result.value.data.measurements.months[11].period, '2026-09');
});

test('GET respektuje odmowę autoryzacji i ukrywa projekt poza zakresem jako 404', async () => {
  const denied = fixture({ deniedPermission: 'offers.manage' });
  assert.equal((await denied.exports.GET(denied.req(), denied.context)).status, 403);
  assert.equal(denied.calls.some(({ operation }) => operation === 'load'), false);
  const missing = fixture({ notFound: true });
  assert.equal((await missing.exports.GET(missing.req(), missing.context)).status, 404);
});

test('księgowość z offers.manage, ale bez energy.manage, nie pobiera ani nie ujawnia wypełnionego draftu', async () => {
  const state = fixture({ canReadEnergy: false, populatedDraft: true });
  const result = await state.exports.GET(state.req(), state.context);
  assert.equal(result.status, 403);
  assert.equal(JSON.stringify(result.value).includes('Opis poufnego szkicu'), false);
  assert.equal(state.calls.some(({ operation }) => operation === 'load'), false);

  const body = { expectedRevision: 4, sourceRevision: 'b'.repeat(64), input: emptyOfferWorkspaceDraft() };
  const save = await state.exports.PUT(state.req(body), state.context);
  assert.equal(save.status, 403);
  assert.equal(state.calls.some(({ operation }) => operation === 'save'), false);
});

test('PUT wymaga offers.manage, waliduje rewizję i zwraca 409 dla konfliktu', async () => {
  const body = { expectedRevision: 0, sourceRevision: 'a'.repeat(64), input: emptyOfferWorkspaceDraft() };
  const denied = fixture({ deniedPermission: 'offers.manage' });
  assert.equal((await denied.exports.PUT(denied.req(body), denied.context)).status, 403);
  assert.equal(denied.calls.some(({ operation }) => operation === 'save'), false);

  const stale = fixture({ conflict: true });
  assert.equal((await stale.exports.PUT(stale.req(body), stale.context)).status, 409);
  const invalid = fixture();
  assert.equal((await invalid.exports.PUT(invalid.req({ ...body, expectedRevision: -1 }), invalid.context)).status, 400);
  assert.equal((await invalid.exports.PUT(invalid.req({ ...body, sourceRevision: 'stale' }), invalid.context)).status, 400);
  assert.equal((await invalid.exports.PUT(invalid.req({ ...body, acceptedPricingRevision: 'stale' }), invalid.context)).status, 400);
  assert.equal(typeof invalid.exports.POST, 'undefined');
});

test('PUT deleguje kompletny szkic i aktualną rewizję do zapisu', async () => {
  const state = fixture();
  const input = emptyOfferWorkspaceDraft();
  input.description.before = 'Stan obecny';
  const result = await state.exports.PUT(state.req({
    expectedRevision: 3,
    sourceRevision: 'a'.repeat(64),
    acceptedPricingRevision: `pricing-v1-${'c'.repeat(16)}`,
    input: { ...input, _pricingSnapshot: { revision: 'forged' } },
  }), state.context);
  assert.equal(result.status, 200);
  assert.equal(state.calls[0].value, 'offers.manage');
  assert.equal(state.calls[1].operation, 'save');
  assert.equal(state.calls[1].value.projectId, 'project-1');
  assert.equal(state.calls[1].value.expectedRevision, 3);
  assert.equal(state.calls[1].value.sourceRevision, 'a'.repeat(64));
  assert.equal(state.calls[1].value.acceptedPricingRevision, `pricing-v1-${'c'.repeat(16)}`);
  assert.equal(state.calls[1].value.input.description.before, 'Stan obecny');
  assert.equal('_pricingSnapshot' in state.calls[1].value.input, false);
});
