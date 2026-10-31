import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as projectPvSettings from './project-pv-settings';
import { optionalNullableEnergyNumber } from './energy-audit-values';

const routePath = path.resolve(__dirname, '../../app/api/energy-audits/route.ts');
const routeCode = ts.transpileModule(readFileSync(routePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: routePath,
}).outputText;

function fixture(options: { workspace?: any; audit?: any; syncFailure?: boolean } = {}) {
  const state = {
    workspace: options.workspace ?? null,
    audit: options.audit === undefined ? {
      id: 'audit', projectId: 'project', clientId: 'client', status: 'DRAFT', profileSource: 'ANNUAL_DECLARATION',
      annualConsumptionKwh: 1200, settlementSystem: 'NET_BILLING', existingPvKw: 6,
      roofTiltDeg: 30, roofOrientation: 'S', scenarios: [],
    } : options.audit,
    projectFindFirst: 0,
    projectFindUnique: 0,
    auditUpdates: 0,
    auditCreates: 0,
    workspaceCreates: 0,
    workspaceUpdates: 0,
    transactionLogs: [] as any[],
    externalLogs: [] as any[],
    tariffScopeReads: 0,
  };
  const prisma: any = {
    $transaction: async (callback: (tx: any) => unknown) => callback(prisma),
    $queryRaw: async () => [{ id: 'project' }],
    project: {
      findFirst: async (args: any) => {
        state.projectFindFirst++;
        assert.deepEqual(args.where, { id: 'project', visibleTo: 'staff' });
        return { id: 'project', clientId: 'client' };
      },
      findUniqueOrThrow: async () => {
        state.projectFindUnique++;
        return { clientId: 'client' };
      },
    },
    energyAudit: {
      findUnique: async () => state.audit ? { ...state.audit } : null,
      update: async ({ data }: any) => {
        state.auditUpdates++;
        state.audit = { ...state.audit, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) };
        return { ...state.audit, scenarios: [] };
      },
      create: async ({ data }: any) => {
        state.auditCreates++;
        state.audit = { id: 'audit-new', status: 'DRAFT', profileSource: 'ANNUAL_DECLARATION', scenarios: [],
          ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) };
        return { ...state.audit };
      },
    },
    offerWorkspace: {
      findUnique: async () => state.workspace,
      findUniqueOrThrow: async () => state.workspace,
      updateMany: async ({ where, data }: any) => {
        if (!state.workspace || state.workspace.revision !== where.revision) return { count: 0 };
        state.workspace = { ...state.workspace, revision: state.workspace.revision + data.revision.increment,
          schemaVersion: data.schemaVersion, input: data.input, updatedById: data.updatedById };
        state.workspaceUpdates++;
        return { count: 1 };
      },
      create: async ({ data }: any) => {
        state.workspaceCreates++;
        state.workspace = { ...data };
        return state.workspace;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        state.transactionLogs.push(data);
        return data;
      },
    },
  };

  const modules: Record<string, unknown> = {
    '@prisma/client': {
      EnergyAuditStatus: { DRAFT: 'DRAFT', APPROVED: 'APPROVED' },
      EnergyProfileSource: { ANNUAL_DECLARATION: 'ANNUAL_DECLARATION', OPERATOR_HOURLY: 'OPERATOR_HOURLY' },
      Prisma: { JsonNull: null },
    },
    'lib/onrevolt/api': {
      badRequest: (message: string) => Response.json({ ok: false, error: message }, { status: 400 }),
      jsonResponse: (value: unknown, init?: ResponseInit) => Response.json(value, init),
      notFound: (message: string) => Response.json({ ok: false, error: message }, { status: 404 }),
      optionalString: (body: Record<string, any>, key: string) => {
        const value = body[key];
        if (value == null || value === '') return undefined;
        if (typeof value !== 'string') throw new Error(`Pole ${key} musi być tekstem`);
        return value.trim();
      },
      readJsonObject: async (req: any) => req.json(),
      requireString: (body: Record<string, any>, key: string) => {
        if (typeof body[key] !== 'string' || !body[key].trim()) throw new Error(`Brak wymaganego pola ${key}`);
        return body[key].trim();
      },
      serverError: (context: string) => Response.json({ ok: false, error: context }, { status: 500 }),
    },
    'lib/onrevolt/audit': {
      writeAuditLog: async (data: any) => { state.externalLogs.push(data); },
    },
    'lib/onrevolt/prisma': { prisma },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async () => ({ ok: true, user: { id: 'staff', systemRole: 'ADMIN' } }),
    },
    'lib/onrevolt/re-consumption-declaration': {
      shouldSyncReConsumptionDeclaration: () => options.syncFailure === true,
      syncProjectReConsumptionDeclaration: async () => options.syncFailure
        ? ({ status: 'failed', station: null, retryAllowed: true, message: 'RE unavailable' })
        : ({ status: 'skipped', station: null, retryAllowed: false, message: '' }),
    },
    'lib/onrevolt/client-tariffs-server': {
      clientTariffScope: async () => { state.tariffScopeReads++; return {}; },
      readProjectGeneralTariffs: async () => ({ targetTariff: { osdId: 7, tariffId: 42 } }),
      syncClientTariffContext: async () => ({ status: 'skipped', station: null, retryAllowed: false, message: '' }),
    },
    'lib/onrevolt/energy-audit-values': { optionalNullableEnergyNumber },
    'lib/onrevolt/offer-workspace': { OFFER_WORKSPACE_SCHEMA_VERSION: 1 },
    'lib/onrevolt/offer-workspace-server': {
      OfferWorkspaceNotFoundError: class OfferWorkspaceNotFoundError extends Error {},
      loadProjectOfferWorkspace: async () => ({ revision: 'source-revision', clientId: 'client' }),
      offerWorkspaceProjectWhere: (id: string) => ({ id, visibleTo: 'staff' }),
    },
    'lib/onrevolt/project-pv-settings': projectPvSettings,
  };
  const exports: any = {};
  vm.runInNewContext(routeCode, {
    exports,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected route import: ${name}`);
      return modules[name];
    },
    Response,
  });
  const request = (body: unknown) => ({ json: async () => body });
  return { exports, request, state };
}

test('zapis audytu bez pvSettings zachowuje dotychczasowe zapytania i log poza transakcją', async () => {
  const state = fixture();
  const response = await state.exports.POST(state.request({ id: 'audit', projectId: 'project' }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.pvRevision, undefined);
  assert.equal(state.state.projectFindUnique, 1);
  assert.equal(state.state.projectFindFirst, 0);
  assert.equal(state.state.transactionLogs.length, 0);
  assert.equal(state.state.externalLogs.length, 1);
});

test('zapis audytu nadal dopuszcza jawne nulle i odrzuca phaseCount poza 1 lub 3', async () => {
  const invalid = fixture();
  const invalidResponse = await invalid.exports.POST(invalid.request({ id: 'audit', projectId: 'project', phaseCount: 2 }));
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalid.state.auditUpdates, 0);

  const valid = fixture();
  const validResponse = await valid.exports.POST(valid.request({ id: 'audit', projectId: 'project',
    existingPvKw: null, existingBatteryKwh: null, phaseCount: null }));
  assert.equal(validResponse.status, 200);
  assert.equal(valid.state.audit.existingPvKw, null);
  assert.equal(valid.state.audit.existingBatteryKwh, null);
  assert.equal(valid.state.audit.phaseCount, null);
});

test('stara rewizja PV daje 409 przed zapisem audytu i historii', async () => {
  const state = fixture({ workspace: {
    projectId: 'project', revision: 4, sourceRevision: 'source', input: { existingPv: { powerKw: 6 } },
  } });
  const response = await state.exports.POST(state.request({ id: 'audit', projectId: 'project', existingPvKw: 8,
    pvSettings: { tiltDegrees: 30, azimuthDegrees: 180, lossPercent: 14, expectedRevision: 3 } }));

  assert.equal(response.status, 409);
  assert.equal(state.state.auditUpdates, 0);
  assert.equal(state.state.workspaceUpdates, 0);
  assert.equal(state.state.workspace.revision, 4);
  assert.equal(state.state.transactionLogs.length, 0);
});

test('zapis PV podbija rewizję i zachowuje pozostałe pola istniejącego szkicu', async () => {
  const originalInput = {
    currentSettlement: 'NET_BILLING', targetSettlement: 'NET_METERING',
    targetOperatorId: 9, targetTariffId: 19, description: { before: 'zachowaj', after: 'bez zmian' },
    existingPv: { powerKw: 6, tiltDegrees: 25, azimuthDegrees: 90, lossPercent: 12 },
  };
  const state = fixture({ workspace: {
    projectId: 'project', revision: 4, sourceRevision: 'source', input: originalInput,
  } });
  const response = await state.exports.POST(state.request({ id: 'audit', projectId: 'project', existingPvKw: 0,
    pvSettings: { tiltDegrees: null, azimuthDegrees: 180, lossPercent: null, expectedRevision: 4 } }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.pvRevision, 5);
  assert.deepEqual(state.state.workspace.input, {
    ...originalInput,
    existingPv: { powerKw: 0, tiltDegrees: null, azimuthDegrees: 180, lossPercent: null },
  });
  assert.deepEqual(state.state.transactionLogs.map((entry: any) => entry.entityType), ['OfferWorkspaceDraft', 'EnergyAudit']);
  assert.equal(state.state.externalLogs.length, 0);
});

test('odpowiedź częściowego błędu synchronizacji nadal zwraca zatwierdzone pvRevision', async () => {
  const state = fixture({ syncFailure: true, workspace: {
    projectId: 'project', revision: 4, sourceRevision: 'source', input: {
      existingPv: { powerKw: 6, tiltDegrees: 25, azimuthDegrees: 90, lossPercent: 12 },
      currentSettlement: 'NET_BILLING', targetSettlement: 'NET_BILLING', targetOperatorId: null, targetTariffId: null,
    },
  } });
  const response = await state.exports.POST(state.request({ id: 'audit', projectId: 'project', existingPvKw: 6,
    pvSettings: { tiltDegrees: 30, azimuthDegrees: 180, lossPercent: 14, expectedRevision: 4 } }));
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.auditSaved, true);
  assert.equal(body.pvRevision, 5);
});

test('pierwszy zapis PV tworzy szkic z taryfą docelową i dopuszcza jawne nulle', async () => {
  const state = fixture({ workspace: null, audit: null });
  const response = await state.exports.POST(state.request({ projectId: 'project', settlementSystem: 'NET_BILLING', existingPvKw: null,
    pvSettings: { tiltDegrees: null, azimuthDegrees: null, lossPercent: null, expectedRevision: 0 } }));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.pvRevision, 1);
  assert.equal(state.state.tariffScopeReads, 1);
  assert.equal(state.state.workspace.input.targetOperatorId, 7);
  assert.equal(state.state.workspace.input.targetTariffId, 42);
  assert.equal(state.state.workspace.input.currentSettlement, 'NET_BILLING');
  assert.equal(state.state.workspace.input.existingPv.powerKw, null);
  assert.deepEqual(state.state.transactionLogs.map((entry: any) => entry.entityType), ['OfferWorkspaceDraft', 'EnergyAudit']);
});

test('seed nowego szkicu używa nowych pól audytu z tego samego żądania', async () => {
  const state = fixture({ workspace: null });
  const response = await state.exports.POST(state.request({ id: 'audit', projectId: 'project', settlementSystem: 'NET_METERING',
    existingPvKw: 8, pvSettings: { tiltDegrees: 35, azimuthDegrees: 180, lossPercent: 12, expectedRevision: 0 } }));

  assert.equal(response.status, 200);
  assert.equal(state.state.workspace.input.currentSettlement, 'NET_METERING');
  assert.equal(state.state.workspace.input.targetSettlement, 'NET_METERING');
  assert.equal(state.state.workspace.input.existingPv.powerKw, 8);
  assert.equal(state.state.workspace.input.existingPv.tiltDegrees, 35);
});
