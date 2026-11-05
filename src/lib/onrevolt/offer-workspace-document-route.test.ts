import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const routePath = path.resolve(__dirname, '../../app/api/projects/[id]/offer-workspace/document/route.ts');
const routeCode = ts.transpileModule(readFileSync(routePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: routePath,
}).outputText;
const dependencyStamp = 'd'.repeat(64);

function fixture(options: {
  deniedPermission?: string; canReadEnergy?: boolean; conflict?: boolean; notFound?: boolean; modelError?: boolean;
  calculation?: unknown; dependencyStamps?: Array<string | null>; dependencyError?: boolean; labelError?: boolean;
} = {}) {
  const calls: Array<{ operation: string; value: any }> = [];
  let dependencyStampIndex = 0;
  class OfferWorkspaceNotFoundError extends Error {}
  class OfferWorkspaceConflictError extends Error {}
  class OfferWorkspacePermissionError extends Error {}
  const modules: Record<string, any> = {
    'lib/onrevolt/api': {
      badRequest: (message: string) => Response.json({ ok: false, error: message }, { status: 400 }),
      forbidden: (message: string) => Response.json({ ok: false, error: message }, { status: 403 }),
      jsonResponse: (value: unknown, init?: ResponseInit) => Response.json(value, init),
      notFound: (message: string) => Response.json({ ok: false, error: message }, { status: 404 }),
      serverError: (message: string, error: unknown) => Response.json({ ok: false, error: message, detail: String(error) }, { status: 500 }),
    },
    'lib/onrevolt/offer-workspace-server': {
      OfferWorkspaceNotFoundError, OfferWorkspaceConflictError, OfferWorkspacePermissionError,
      loadProjectOfferWorkspace: async (id: string, user: unknown) => {
        calls.push({ operation: 'load', value: { id, user } });
        if (options.notFound) throw new OfferWorkspaceNotFoundError('Nie znaleziono projektu');
        if (options.conflict) return { revision: 'c'.repeat(64) };
        return { revision: 'a'.repeat(64) };
      },
    },
    'lib/onrevolt/offer-workspace': {
      parseOfferWorkspaceDraft: (draft: unknown) => {
        calls.push({ operation: 'parse', value: draft });
        if (!draft || typeof draft !== 'object') throw new Error('Nieprawidłowy szkic');
        return draft;
      },
    },
    'lib/onrevolt/offer-workspace-document': {
      renderOfferWorkspaceDocument: (workspace: unknown, draft: unknown, options: unknown) => {
        calls.push({ operation: 'render', value: { workspace, draft, options } });
        return { pageCount: 10, limitations: [], pages: Array.from({ length: 10 }, (_, index) => ({ page: index + 1, svg: '<svg/> ' })) };
      },
    },
    'lib/onrevolt/offer-workspace-document-assets': {
      attachOfferWorkspaceDocumentMap: async (document: any) => {
        calls.push({ operation: 'map', value: document });
        document.pages[0].svg = '<svg data-map="embedded"/>';
      },
    },
    'lib/onrevolt/offer-workspace-document-context': {
      loadOfferDocumentTariffLabels: async () => {
        if (options.labelError) throw new Error('Private tariff loader detail');
        return { current: 'G11', proposed: 'G13active', currentOperator: 'ENEA' };
      },
    },
    'lib/onrevolt/offer-workspace-energy-server': {
      calculateOfferWorkspaceEnergy: async () => { if (options.modelError) throw new Error('Model niedostępny'); return { totals: { loadKwh: 5, pvKwh: 4, directKwh: 3 } }; },
    },
    'lib/onrevolt/offer-workspace-calculation-server': {
      loadOfferCalculationDependencyStamp: async (workspace: unknown, draft: unknown) => {
        calls.push({ operation: 'dependency-stamp', value: { workspace, draft } });
        if (options.dependencyError) throw new Error('private SQL failure');
        if (options.dependencyStamps && dependencyStampIndex < options.dependencyStamps.length) {
          return options.dependencyStamps[dependencyStampIndex++];
        }
        return dependencyStamp;
      },
    },
    'lib/onrevolt/client-tariffs': { tariffToday: () => '2026-10-29' },
    'lib/onrevolt/offer-workspace-calculation-jobs': {
      findCompletedOfferCalculationPersistent: async (input: unknown) => {
        calls.push({ operation: 'calculation', value: input });
        return (input as { sourceDependencyStamp: string | null }).sourceDependencyStamp == null
          ? null : options.calculation ?? null;
      },
    },
    'lib/onrevolt/offer-pdf': {
      generateSvgPagesPdf: async (pages: string[]) => {
        calls.push({ operation: 'pdf', value: pages.length, pages } as any);
        return Buffer.from('%PDF-1.7');
      },
    },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async (_req: unknown, permission: string) => {
        calls.push({ operation: 'authorize', value: permission });
        return options.deniedPermission === permission
          ? { ok: false, response: Response.json({ ok: false }, { status: 403 }) }
          : { ok: true, user: { id: 'seller', systemRole: 'USER' } };
      },
      hasStaffPermission: (_user: unknown, permission: string) => permission !== 'energy.manage' || options.canReadEnergy !== false,
    },
  };
  const exports: any = {};
  vm.runInNewContext(routeCode, {
    exports,
    TextDecoder,
    Response,
    Uint8Array,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected route import: ${name}`);
      return modules[name];
    },
  });
  const request = (body: unknown, raw = JSON.stringify(body)) => new Request('http://localhost/api', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: raw,
  });
  return { exports, calls, request };
}

test('POST requires project permissions and loads authoritative workspace before rendering', async () => {
  const state = fixture();
  const draft = { schemaVersion: 1, step: 'SUMMARY' };
  const response = await state.exports.POST(state.request({ draft }), {
    params: Promise.resolve({ id: 'project-1' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.document.pageCount, 10);
  assert.equal(state.calls[0].value, 'offers.manage');
  assert.equal(state.calls.some((call) => call.operation === 'load' && call.value.id === 'project-1'), true);
  assert.equal(state.calls.at(-1)?.operation, 'map');
  assert.equal(state.calls.find(call => call.operation === 'render')?.value.options.templateKey, 'REFORM_B2C/2026_10_V4');
  assert.equal(body.document.pages[0].svg, '<svg data-map="embedded"/>');
  assert.equal(state.calls.find(call => call.operation === 'render')?.value.options.tariffLabels.proposed, 'G13active');

  const denied = fixture({ deniedPermission: 'offers.manage' });
  assert.equal((await denied.exports.POST(denied.request({}), { params: Promise.resolve({ id: 'project-1' }) })).status, 403);
  assert.equal(denied.calls.some((call) => call.operation === 'load'), false);
  const restricted = fixture({ canReadEnergy: false });
  assert.equal((await restricted.exports.POST(restricted.request({}), { params: Promise.resolve({ id: 'project-1' }) })).status, 403);
  assert.equal(restricted.calls.some((call) => call.operation === 'load'), false);
});

test('unavailable tariff labels leave results intact and expose only a readable warning', async () => {
  const calculation = { status: 'ready', annualSavingsPln: 123 };
  const state = fixture({ calculation, labelError: true });
  const response = await state.exports.POST(state.request({ draft: {} }), { params: Promise.resolve({ id: 'project-1' }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.document.limitations.join(' '), /Nie udało się odczytać nazw taryf/);
  assert.doesNotMatch(JSON.stringify(body), /Private tariff/);
  assert.equal(state.calls.find(call => call.operation === 'render')?.value.workspace.calculation, calculation);
});

test('PDF is rendered from ten authoritative SVG pages, never browser-supplied pages', async () => {
  const state = fixture();
  const response = await state.exports.POST(state.request({ draft: {}, format: 'pdf-draft', sourceRevision: 'a'.repeat(64), pages: ['<script/>'] }), {
    params: Promise.resolve({ id: 'project-1' }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition')!, /oferta-robocza/);
  assert.equal(state.calls.find(call => call.operation === 'pdf')?.value, 10);
  assert.equal((state.calls.find(call => call.operation === 'pdf') as any)?.pages[0], '<svg data-map="embedded"/>');
});

test('document uses only completed server calculation scoped to actor, project and source revision', async () => {
  const calculation = { status: 'ready', annualSavingsPln: 123 };
  const state = fixture({ calculation });
  const draft = { schemaVersion: 1 };
  const response = await state.exports.POST(state.request({ draft, calculation: { annualSavingsPln: 999999 } }), {
    params: Promise.resolve({ id: 'project-1' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(state.calls.find(call => call.operation === 'calculation')!.value)), {
    actorId: 'seller', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft,
    pricesAsOf: '2026-10-29', sourceDependencyStamp: dependencyStamp,
  });
  assert.equal(state.calls.find(call => call.operation === 'render')!.value.workspace.calculation, calculation);
});

test('PDF refuses stale source and model failure instead of hiding missing calculations', async () => {
  const stale = fixture();
  assert.equal((await stale.exports.POST(stale.request({ draft: {}, format: 'pdf-draft', sourceRevision: 'old' }), { params: Promise.resolve({ id: 'p' }) })).status, 409);
  assert.equal(stale.calls.some(call => call.operation === 'pdf'), false);
  const failed = fixture({ modelError: true });
  assert.equal((await failed.exports.POST(failed.request({ draft: {}, format: 'pdf-draft', sourceRevision: 'a'.repeat(64) }), { params: Promise.resolve({ id: 'p' }) })).status, 422);
  assert.equal(failed.calls.some(call => call.operation === 'pdf'), false);
});

test('PDF rejects dependency changes during rendering and null stamps never restore persisted financials', async () => {
  const changed = fixture({ dependencyStamps: [dependencyStamp, 'e'.repeat(64)] });
  const changedResponse = await changed.exports.POST(changed.request({
    draft: {}, format: 'pdf-draft', sourceRevision: 'a'.repeat(64),
  }), { params: Promise.resolve({ id: 'project-1' }) });
  assert.equal(changedResponse.status, 409);
  assert.equal(changed.calls.some(call => call.operation === 'pdf'), false);

  const incomplete = fixture({ dependencyStamps: [null] , calculation: { status: 'ready', annualSavingsPln: 999 } });
  const incompleteResponse = await incomplete.exports.POST(incomplete.request({ draft: {} }), {
    params: Promise.resolve({ id: 'project-1' }),
  });
  assert.equal(incompleteResponse.status, 200);
  assert.equal(incomplete.calls.find(call => call.operation === 'calculation')?.value.sourceDependencyStamp, null);
  assert.equal(incomplete.calls.find(call => call.operation === 'render')?.value.workspace.calculation, undefined);
});

test('dependency database failures return an error instead of rendering without a calculation', async () => {
  const state = fixture({ dependencyError: true });
  const response = await state.exports.POST(state.request({ draft: {} }), {
    params: Promise.resolve({ id: 'project-1' }),
  });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.detail, 'Error: Nie udało się zweryfikować aktualności danych obliczenia.');
  assert.equal(JSON.stringify(body).includes('private SQL'), false);
});

test('POST accepts only the draft payload and rejects invalid JSON/drafts and oversized bodies', async () => {
  const invalid = fixture();
  assert.equal((await invalid.exports.POST(invalid.request({}, '{'), { params: Promise.resolve({ id: 'project-1' }) })).status, 400);
  assert.equal((await invalid.exports.POST(invalid.request({ draft: null }), { params: Promise.resolve({ id: 'project-1' }) })).status, 400);
  const longDescription = 'ą'.repeat(10_000);
  const longDraft = fixture();
  const accepted = await longDraft.exports.POST(longDraft.request({ draft: { description: { before: longDescription, after: longDescription } } }), {
    params: Promise.resolve({ id: 'project-1' }),
  });
  assert.equal(accepted.status, 200, 'two UTF-8 descriptions of 10,000 characters fit in the bounded request body');
  const largeBody = JSON.stringify({ draft: {}, extra: 'x'.repeat(129 * 1024) });
  const largeResponse = await invalid.exports.POST(invalid.request({}, largeBody), { params: Promise.resolve({ id: 'project-1' }) });
  assert.equal(largeResponse.status, 413);
});

test('POST returns 404 for inaccessible project and rejects missing draft', async () => {
  const absent = fixture({ notFound: true });
  const notFound = await absent.exports.POST(absent.request({ draft: {} }), {
    params: Promise.resolve({ id: 'project-1' }),
  });
  assert.equal(notFound.status, 404);
  const noDraft = fixture();
  const badDraft = await noDraft.exports.POST(noDraft.request({}), {
    params: Promise.resolve({ id: 'project-1' }),
  });
  assert.equal(badDraft.status, 400);
  assert.equal(noDraft.calls.some((call) => call.operation === 'render'), false);
});
