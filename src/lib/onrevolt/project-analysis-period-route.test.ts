import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { resolveProjectAnalysisPeriod } from './project-analysis-period';

const routePath = path.resolve(__dirname, '../../app/api/projects/[id]/analysis-period/route.ts');
const routeCode = ts.transpileModule(readFileSync(routePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: routePath,
}).outputText;

function fixture(options: { storedStartMonth?: string | null; visible?: boolean; denied?: string; systemRole?: string } = {}) {
  const state = {
    storedStartMonth: options.storedStartMonth ?? null,
    visible: options.visible !== false,
    permission: '',
    updateCount: 0,
    updateSql: '',
    updateValues: [] as unknown[],
    auditLogs: [] as any[],
  };
  const project = {
    findFirst: async ({ where }: any) => {
      assert.deepEqual(where, options.systemRole === 'ADMIN' || options.systemRole === 'MODERATOR'
        ? { id: 'project' }
        : { id: 'project', ownerId: 'staff' });
      return state.visible ? { id: 'project', clientId: 'client' } : null;
    },
  };
  const prisma = {
    project,
    auditLog: {
      create: async ({ data }: any) => {
        state.auditLogs.push(data);
        return data;
      },
    },
    $transaction: async (callback: (tx: any) => unknown) => callback(prisma),
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.updateSql = strings.join('?');
      state.updateValues = values;
      const expected = values[options.systemRole === 'ADMIN' || options.systemRole === 'MODERATOR' ? 2 : 3];
      if (!state.visible || state.storedStartMonth !== expected) return 0;
      state.storedStartMonth = values[0] as string | null;
      state.updateCount++;
      return 1;
    },
  };
  const modules: Record<string, unknown> = {
    'lib/onrevolt/api': {
      badRequest: (message: string) => Response.json({ ok: false, error: message }, { status: 400 }),
      jsonResponse: (value: unknown, init?: ResponseInit) => Response.json(value, init),
      notFound: (message: string) => Response.json({ ok: false, error: message }, { status: 404 }),
      readJsonObject: async (req: any) => {
        const value = await req.json();
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Oczekiwano obiektu JSON');
        return value;
      },
      serverError: (message: string) => Response.json({ ok: false, error: message }, { status: 500 }),
    },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async (_req: unknown, permission: string) => {
        state.permission = permission;
        return options.denied === permission
          ? { ok: false, response: Response.json({ ok: false }, { status: 403 }) }
          : { ok: true, user: { id: 'staff', systemRole: options.systemRole || 'USER' } };
      },
    },
    'lib/onrevolt/prisma': { prisma },
    'lib/onrevolt/offer-workspace-server': {
      offerWorkspaceProjectWhere: (id: string, user: { id: string; systemRole: string }) => ({
        id,
        ...(user.systemRole === 'ADMIN' || user.systemRole === 'MODERATOR' ? {} : { ownerId: user.id }),
      }),
    },
    'lib/onrevolt/project-analysis-period-server': {
      readProjectAnalysisPeriod: async (projectId: string) => ({
        projectId,
        storedStartMonth: state.storedStartMonth,
        period: resolveProjectAnalysisPeriod(state.storedStartMonth),
      }),
    },
    'lib/onrevolt/project-analysis-period': { resolveProjectAnalysisPeriod },
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
  const request = (body?: unknown) => ({ json: async () => body });
  const context = { params: Promise.resolve({ id: 'project' }) };
  return { exports, request, context, state };
}

test('GET requires crm.read, scopes the project, and returns the agreed envelope', async () => {
  const state = fixture();
  const response = await state.exports.GET(state.request(), state.context);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.state.permission, 'crm.read');
  assert.deepEqual(body, {
    ok: true,
    data: {
      projectId: 'project',
      storedStartMonth: null,
      period: resolveProjectAnalysisPeriod(null),
    },
  });
});

test('PATCH uses energy.manage, CAS, owner visibility, and updates project.updatedAt', async () => {
  const state = fixture();
  const startMonth = resolveProjectAnalysisPeriod(null).startMonth;
  const response = await state.exports.PATCH(state.request({ startMonth, expectedStartMonth: null }), state.context);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.state.permission, 'energy.manage');
  assert.equal(state.state.updateCount, 1);
  assert.match(state.state.updateSql, /analysisStartMonth/);
  assert.match(state.state.updateSql, /updatedAt = CURRENT_TIMESTAMP\(3\)/);
  assert.match(state.state.updateSql, /ownerId/);
  assert.equal(body.data.projectId, 'project');
  assert.equal(body.data.storedStartMonth, startMonth);
  assert.equal(body.data.period.startMonth, startMonth);
  assert.equal(body.data.period.periodKeys.length, 12);
  assert.deepEqual(JSON.parse(JSON.stringify(state.state.auditLogs)), [{
    actorId: 'staff',
    clientId: 'client',
    entityType: 'Project',
    entityId: 'project',
    action: 'ANALYSIS_PERIOD_UPDATE',
    before: { analysisStartMonth: null },
    after: { analysisStartMonth: startMonth, period: body.data.period },
  }]);
});

test('PATCH returns 409 for a stale nullable revision without changing the stored month', async () => {
  const state = fixture({ storedStartMonth: '2025-01' });
  const startMonth = resolveProjectAnalysisPeriod(null).startMonth;
  const response = await state.exports.PATCH(state.request({ startMonth, expectedStartMonth: null }), state.context);
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.ok, false);
  assert.equal(state.state.updateCount, 0);
  assert.equal(state.state.storedStartMonth, '2025-01');
  assert.equal(state.state.auditLogs.length, 0);
});

test('PATCH can reset to legacy default with a matching expected month', async () => {
  const state = fixture({ storedStartMonth: '2025-10' });
  const response = await state.exports.PATCH(state.request({ startMonth: null, expectedStartMonth: '2025-10' }), state.context);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.storedStartMonth, null);
  assert.equal(body.data.period.startMonth, resolveProjectAnalysisPeriod(null).startMonth);
});

test('GET is scoped but does not require energy.manage; PATCH rejects future ranges and missing projects', async () => {
  const readOnly = fixture({ denied: 'energy.manage' });
  assert.equal((await readOnly.exports.GET(readOnly.request(), readOnly.context)).status, 200);

  const invalid = fixture();
  const period = resolveProjectAnalysisPeriod(null);
  assert.equal((await invalid.exports.PATCH(invalid.request({ startMonth: period.endMonth, expectedStartMonth: null }), invalid.context)).status, 400);
  assert.equal(invalid.state.updateCount, 0);

  const missing = fixture({ visible: false });
  const validStart = resolveProjectAnalysisPeriod(null).startMonth;
  assert.equal((await missing.exports.PATCH(missing.request({ startMonth: validStart, expectedStartMonth: null }), missing.context)).status, 404);
  assert.equal(missing.state.updateCount, 0);
});
