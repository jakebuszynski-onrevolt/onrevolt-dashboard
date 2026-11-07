import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
  canReadPricing?: boolean;
  calculation?: unknown; dependencyStamps?: Array<string | null>; dependencyError?: boolean; labelError?: boolean;
  energyPvRevision?: string; currentPvRevision?: string;
} = {}) {
  const calls: Array<{ operation: string; value: any }> = [];
  const artifacts = new Map<string, unknown>();
  let dependencyStampIndex = 0;
  class OfferWorkspaceNotFoundError extends Error {}
  class OfferWorkspaceConflictError extends Error {}
  class OfferWorkspacePermissionError extends Error {}
  const modules: Record<string, any> = {
    'lib/onrevolt/offer-workspace-artifacts': {
      getOfferWorkspaceArtifact: async (key: unknown) => {
        calls.push({ operation: 'cache-get', value: key });
        const value = artifacts.get(JSON.stringify(key));
        return value ? JSON.parse(JSON.stringify(value)) : null;
      },
      putOfferWorkspaceArtifact: async (key: unknown, value: unknown) => {
        calls.push({ operation: 'cache-put', value: key });
        artifacts.set(JSON.stringify(key), JSON.parse(JSON.stringify(value)));
      },
    },
    'lib/onrevolt/offer-workspace-document-cache': {
      offerDocumentRenderingRevision: async () => 'renderer-v1', offerDocumentPdfRevision: async () => 'pdf-v1',
    },
    'lib/onrevolt/offer-workspace-calculation-dependencies': { offerCalculationDependencyHash: (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex') },
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
        return { revision: 'a'.repeat(64), input: { location: { latitude: 52, longitude: 17 }, existingBatteryPresent: true, existingBatteryKwh: 8.5 } };
      },
    },
    'lib/onrevolt/offer-workspace': {
      parseOfferWorkspaceDraft: (draft: unknown) => {
        calls.push({ operation: 'parse', value: draft });
        if (!draft || typeof draft !== 'object') throw new Error('Nieprawidłowy szkic');
        return draft;
      },
      offerWorkspaceDraftWithBatteryPresence: (draft: any, presence: boolean | null) => ({ ...draft, existingBatteryPresent: presence }),
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
      calculateOfferWorkspaceEnergy: async (_workspace: unknown, draft: any) => {
        calls.push({ operation: 'energy-draft', value: draft });
        if (options.modelError) throw new Error('Model niedostępny');
        return { totals: { loadKwh: 5, pvKwh: 4, directKwh: 3 }, ...(options.energyPvRevision ? { intervals: [{}] } : {}) };
      },
      getOfferWorkspaceEnergySourceRevision: () => options.energyPvRevision,
    },
    'lib/onrevolt/offer-workspace-energy': {
      overlayOfferWorkspaceMeasurements: (measurements: unknown, energy: any) => energy?.modelledMeasurements ?? measurements,
    },
    'lib/onrevolt/offer-pv-source-revision': { getOfferPvSourceRevision: () => options.currentPvRevision },
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
      hasStaffPermission: (_user: unknown, permission: string) => permission === 'energy.manage'
        ? options.canReadEnergy !== false : permission === 'pricing.read' ? options.canReadPricing !== false : true,
    },
    'lib/onrevolt/offer-workspace-configuration-edits': {
      configurationEditsContainPricing: (edits: any[] | undefined) => Boolean(edits?.some(edit => edit.items?.some((item: any) => item.pricing !== undefined) || edit.addedItems?.length)),
      validateOfferWorkspaceConfigurationEdits: (_templates: unknown[], draft: any) => {
        if (draft.configurationEdits?.some((edit: any) => edit.templateId === 'unknown')) throw new Error('Nieznany wybrany zestaw.');
      },
    },
  };
  const exports: any = {};
  vm.runInNewContext(routeCode, {
    exports,
    TextDecoder,
    Response,
    Uint8Array,
    Buffer,
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
  const draft = { schemaVersion: 1, step: 'SUMMARY', existingBatteryPresent: false };
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
  assert.equal(state.calls.find(call => call.operation === 'energy-draft')?.value.existingBatteryPresent, true);
  assert.equal(state.calls.find(call => call.operation === 'render')?.value.draft.existingBatteryPresent, true,
    'the rendered 10-page document uses the canonical EnergyAudit battery status');

  const denied = fixture({ deniedPermission: 'offers.manage' });
  assert.equal((await denied.exports.POST(denied.request({}), { params: Promise.resolve({ id: 'project-1' }) })).status, 403);
  assert.equal(denied.calls.some((call) => call.operation === 'load'), false);
  const restricted = fixture({ canReadEnergy: false });
  assert.equal((await restricted.exports.POST(restricted.request({}), { params: Promise.resolve({ id: 'project-1' }) })).status, 403);
  assert.equal(restricted.calls.some((call) => call.operation === 'load'), false);
});

test('unchanged pages reuse persistent rendering, confirm browser cache and ignore navigation step', async () => {
  const state = fixture();
  const context = { params: Promise.resolve({ id: 'project-1' }) };
  const first = await (await state.exports.POST(state.request({ draft: { step: 'SUMMARY', description: 'Opis' } }), context)).json();
  const second = await (await state.exports.POST(state.request({
    draft: { step: 'CONFIGURATION', description: 'Opis' }, knownDocumentKey: first.documentKey,
  }), context)).json();
  assert.deepEqual(second, { ok: true, notModified: true, documentKey: first.documentKey });
  assert.equal(state.calls.filter(call => call.operation === 'render').length, 1);
  assert.equal(state.calls.filter(call => call.operation === 'authorize').length, 2);
  assert.equal(state.calls.filter(call => call.operation === 'map').length, 2);
  await state.exports.POST(state.request({ draft: { step: 'SUMMARY', description: 'Zmieniony opis' } }), context);
  assert.equal(state.calls.filter(call => call.operation === 'render').length, 2);
});

test('private price edits require pricing.read and unknown edited template IDs return 400 before rendering', async () => {
  const privateData = fixture({ canReadPricing: false });
  const priceEdit = { draft: { configurationEdits: [{ templateId: 'battery', items: [{ itemId: 'line', pricing: { marginRate: 0.2 } }] }] } };
  const denied = await privateData.exports.POST(privateData.request(priceEdit), { params: Promise.resolve({ id: 'project-1' }) });
  assert.equal(denied.status, 403);
  assert.equal(privateData.calls.some(call => call.operation === 'load' || call.operation === 'cache-get'), false);

  const invalid = fixture();
  const response = await invalid.exports.POST(invalid.request({ draft: {
    configurationEdits: [{ templateId: 'unknown', items: [{ itemId: 'line', description: 'Pozycja' }] }],
  } }), { params: Promise.resolve({ id: 'project-1' }) });
  assert.equal(response.status, 400);
  assert.equal(invalid.calls.some(call => call.operation === 'energy-draft' || call.operation === 'cache-get' || call.operation === 'render'), false);
});

test('document cache identity changes when an effective configuration edit changes', async () => {
  const state = fixture();
  const context = { params: Promise.resolve({ id: 'project-1' }) };
  await state.exports.POST(state.request({ draft: { configurationEdits: [{ templateId: 'battery', items: [{ itemId: 'line', description: 'Akumulator A' }] }] } }), context);
  await state.exports.POST(state.request({ draft: { configurationEdits: [{ templateId: 'battery', items: [{ itemId: 'line', description: 'Akumulator B' }] }] } }), context);
  const cacheKeys = state.calls.filter(call => call.operation === 'cache-get').map(call => call.value.key.input);
  assert.equal(cacheKeys.length, 2);
  assert.notEqual(cacheKeys[0], cacheKeys[1]);
  assert.equal(state.calls.filter(call => call.operation === 'render').length, 2);
});

test('PDF cache avoids Chromium while preserving authoritative revalidation', async () => {
  const state = fixture();
  const context = { params: Promise.resolve({ id: 'project-1' }) };
  const body = { draft: {}, format: 'pdf-draft', sourceRevision: 'a'.repeat(64) };
  const first = await state.exports.POST(state.request(body), context);
  const second = await state.exports.POST(state.request(body), context);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(await second.text(), await first.text());
  assert.equal(state.calls.filter(call => call.operation === 'pdf').length, 1);
  assert.equal(state.calls.filter(call => call.operation === 'load').length, 4);
  assert.equal(state.calls.filter(call => call.operation === 'dependency-stamp').length, 4);
});

test('document never joins existing energy from PV revision A with a refreshed calculation from B', async () => {
  const state = fixture({ energyPvRevision: 'a'.repeat(64), currentPvRevision: 'b'.repeat(64) });
  const response = await state.exports.POST(state.request({ draft: { existingPv: { powerKw: 9.99 } } }),
    { params: Promise.resolve({ id: 'project-1' }) });
  assert.equal(response.status, 409);
  assert.equal(state.calls.some(call => call.operation === 'render' || call.operation === 'cache-put'), false);
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
    actorId: 'seller', projectId: 'project-1', sourceRevision: 'a'.repeat(64), draft: { ...draft, existingBatteryPresent: true },
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
