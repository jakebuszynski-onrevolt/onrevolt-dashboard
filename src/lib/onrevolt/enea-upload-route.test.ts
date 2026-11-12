import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const routePath = path.resolve(__dirname, '../../app/api/integrations/enea/upload/route.ts');
const code = ts.transpileModule(readFileSync(routePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

function fixture(options: { linked?: boolean; invalidLink?: boolean; ppeMismatch?: boolean; existingMonth?: boolean; reMonth?: boolean; outsidePeriod?: boolean } = {}) {
  const state = { files: [] as string[], documents: [] as any[], measurements: [] as any[], audits: [] as any[], preflights: 0, syncs: 0 };
  const account = { id: 'account', ppeNumber: options.ppeMismatch ? 'other' : 'ppe' };
  const existing = options.existingMonth ? { documentId: 'old' } : null;
  class ReStationRequiredError extends Error {}
  const tx = {
    energyAudit: { upsert: async (args: any) => { state.audits.push(args); return args; } },
    $queryRaw: async () => [{ id: 'account' }],
    document: { create: async ({ data }: any) => { const value = { id: 'document', ...data }; state.documents.push(value); return value; } },
    energyMeasurementFile: {
      findUnique: async () => existing,
      upsert: async ({ create }: any) => { state.measurements.push(create); return { id: 'measurement', ...create }; },
    },
  };
  const modules: Record<string, any> = {
    crypto: { createHash, randomUUID: () => 'unique' }, path,
    'fs/promises': { mkdir: async () => {}, writeFile: async (file: string) => { state.files.push(file); }, unlink: async () => { throw Error('Unexpected cleanup'); } },
    'lib/onrevolt/api': {
      jsonResponse: Response.json, badRequest: (message: string) => Response.json({ message }, { status: 400 }),
      notFound: (message: string) => Response.json({ message }, { status: 404 }),
      serverError: (message: string) => Response.json({ message }, { status: 500 }),
    },
    'lib/onrevolt/audit': { writeAuditLog: async () => {} },
    'lib/onrevolt/staff-server': { authorizeStaffRequest: async () => ({ ok: true, user: { id: 'staff' } }) },
    'lib/onrevolt/prisma': { prisma: {
      client: { findUnique: async () => ({ id: 'client' }) },
      project: { findFirst: async () => ({ id: 'project' }) },
      energyPortalAccount: { findFirst: async () => account },
      document: { findFirst: async () => null },
      energyMeasurementFile: { findUnique: async () => existing },
      $transaction: async (callback: any) => callback(tx),
    } },
    'lib/onrevolt/energy-measurement-document': {
      EnergyMeasurementIncompleteError: class extends Error {},
      closedMeasurementPeriodKeys: () => new Set(['2026-08']),
      inspectEnergyMeasurementWorkbook: () => ({ kind: 'ACTIVE_IMPORT', ppeNumber: 'ppe', periodYear: 2026, periodMonth: 8,
        periodFrom: '2026-08-01', periodTo: '2026-08-31', aggregation: '60 min', totalKwh: 123 }),
    },
    'lib/onrevolt/project-analysis-period-server': { readProjectAnalysisPeriod: async () => ({ period: { periodKeys: options.outsidePeriod ? ['2026-07'] : ['2026-08'] } }) },
    'lib/onrevolt/re-consumption-sync': {
      ReStationRequiredError,
      requireProjectReStation: async () => {
        if (options.invalidLink) throw Error('Invalid link');
        if (!options.linked) throw new ReStationRequiredError();
        return { station: '41' };
      },
      preflightProjectReConsumption: async () => { state.preflights++; return { status: options.reMonth ? 'existing' : 'ready' }; },
      syncEnergyMeasurementToRe: async () => { state.syncs++; assert.equal(state.measurements.length, 1); return { status: 'synced', station: '41' }; },
    },
  };
  const exported: any = {};
  new vm.Script(code, { filename: routePath }).runInNewContext({ exports: exported, Buffer, File, Date, Error,
    process: { env: { ONREVOLT_UPLOAD_DIR: path.resolve('__virtual_uploads__') } },
    require: (name: string) => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; },
  });
  const run = async () => {
    const form = new FormData();
    form.set('file', new File(['fixture workbook'], 'pomiar.xlsx')); form.set('clientId', 'client'); form.set('projectId', 'project');
    const response = await exported.POST({ formData: async () => form });
    return { status: response.status, body: await response.json() };
  };
  return { state, run };
}

test('ręczny XLSX zapisuje dokument i pomiar w CRM bez stacji oraz bez wywołań RE', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.status, 201); assert.equal(result.body.ok, true);
  assert.equal(result.body.data.reSync.status, 'not_linked');
  assert.equal(f.state.documents[0].projectId, 'project');
  assert.equal(f.state.measurements[0].status, 'DOWNLOADED');
  assert.equal(f.state.files.length, 1); assert.equal(f.state.preflights, 0); assert.equal(f.state.syncs, 0);
  assert.equal(f.state.audits[0].where.projectId, 'project');
  assert.deepEqual(f.state.audits[0].update.hasOperatorData, true);
  assert.equal(f.state.audits[0].update.profileSource, 'OPERATOR_HOURLY');
});

test('powiązana stacja zachowuje kontrolę konfliktów i synchronizację po zapisie CRM', async () => {
  const f = fixture({ linked: true }); const result = await f.run();
  assert.equal(result.status, 201); assert.equal(result.body.data.reSync.status, 'synced');
  assert.equal(f.state.preflights, 1); assert.equal(f.state.syncs, 1);
  const conflict = fixture({ linked: true, reMonth: true });
  assert.equal((await conflict.run()).body.code, 'ENERGY_RE_MONTH_EXISTS');
  assert.equal(conflict.state.files.length, 0);
});

test('brak RE nie omija walidacji PPE, miesiąca ani istniejącego dokumentu', async () => {
  for (const [options, status, code] of [
    [{ ppeMismatch: true }, 409, 'ENERGY_PPE_MISMATCH'],
    [{ existingMonth: true }, 409, 'ENERGY_MONTH_EXISTS'],
    [{ outsidePeriod: true }, 400, undefined],
    [{ invalidLink: true }, 500, undefined],
  ] as const) {
    const f = fixture(options); const result = await f.run();
    assert.equal(result.status, status); assert.equal(result.body.code, code);
    assert.equal(f.state.files.length, 0); assert.equal(f.state.syncs, 0);
    assert.equal(f.state.audits.length, 0);
  }
});
