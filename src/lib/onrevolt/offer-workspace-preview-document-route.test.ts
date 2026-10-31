import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const routePath = path.resolve(__dirname, '../../app/offer-workspace-preview/document/route.ts');
const routeCode = ts.transpileModule(readFileSync(routePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: routePath,
}).outputText;

function fixture() {
  const calls: Array<{ operation: string; value: unknown }> = [];
  const workspace = {
    projectId: 'fixture-project', clientId: 'fixture-client', projectName: 'Fixture', clientName: 'Klient testowy',
    clientType: 'B2C', ppeNumber: null, revision: 'a'.repeat(64),
    input: { existingPv: null, location: null, settlementMode: null, annualConsumptionKwh: null, issues: [], reportDetails: null },
    measurements: { periods: [], months: [{ period: '2025-01', importKwh: 123, exportKwh: 12 }], dayProfiles: [],
      totalsImportKwh: 123, totalsExportKwh: 12, intervalCount: null, missingDirections: [], issues: [] },
    templates: [],
  };
  const modules: Record<string, any> = {
    'next/server': {
      NextResponse: class extends Response {
        static json(value: unknown, init?: ResponseInit) {
          return Response.json(value, init);
        }
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
      renderOfferWorkspaceDocument: (actualWorkspace: unknown, draft: unknown) => {
        calls.push({ operation: 'render', value: { workspace: actualWorkspace, draft } });
        return { pageCount: 10, pages: Array.from({ length: 10 }, (_, index) => ({ page: index + 1, svg: '<svg/>' })) };
      },
    },
  };
  const exports: any = {};
  const process = { env: { NODE_ENV: 'development' } };
  vm.runInNewContext(routeCode, {
    exports,
    process,
    Response,
    TextDecoder,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected route import: ${name}`);
      return modules[name];
    },
  });
  const request = (body: unknown, raw = JSON.stringify(body)) => new Request('http://localhost/offer-workspace-preview/document', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: raw,
  });
  return { exports, calls, workspace, process, request };
}

test('development POST accepts { workspace, draft } and returns { ok, document }', async () => {
  const state = fixture();
  const draft = { schemaVersion: 1, step: 'SUMMARY' };
  const response = await state.exports.POST(state.request({ workspace: state.workspace, draft }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.document.pageCount, 10);
  assert.equal(JSON.stringify(state.calls.at(-1)), JSON.stringify({ operation: 'render', value: { workspace: state.workspace, draft } }));
});

test('development POST is unavailable outside development and validates bounded fixture requests', async () => {
  const state = fixture();
  state.process.env.NODE_ENV = 'production';
  assert.equal((await state.exports.POST(state.request({}))).status, 404);
  state.process.env.NODE_ENV = 'development';
  assert.equal((await state.exports.POST(state.request({ draft: {} }))).status, 400);
  assert.equal((await state.exports.POST(state.request({}, '{'))).status, 400);
  const tooLarge = JSON.stringify({ workspace: state.workspace, draft: {}, extra: 'x'.repeat(257 * 1024) });
  assert.equal((await state.exports.POST(state.request({}, tooLarge))).status, 413);
});
