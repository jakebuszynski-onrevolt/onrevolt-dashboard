import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { resolveProjectAnalysisPeriod } from './project-analysis-period';
import * as projectPvSettings from './project-pv-settings';

const routePath = path.resolve(__dirname, '../../app/api/projects/[id]/pv-profile/route.ts');
const routeCode = ts.transpileModule(readFileSync(routePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: routePath,
}).outputText;
const analysisPeriod = resolveProjectAnalysisPeriod('2025-10', new Date('2026-10-30T12:00:00.000Z'));

function fixture(project: any) {
  const state = { profileInput: null as any, profileCalls: 0 };
  const modules: Record<string, unknown> = {
    'lib/onrevolt/api': {
      badRequest: (message: string) => Response.json({ ok: false, error: message }, { status: 400 }),
      forbidden: (message: string) => Response.json({ ok: false, error: message }, { status: 403 }),
      jsonResponse: (value: unknown, init?: ResponseInit) => Response.json(value, init),
      notFound: (message: string) => Response.json({ ok: false, error: message }, { status: 404 }),
      readJsonObject: async (req: any) => req.json(),
      serverError: (message: string) => Response.json({ ok: false, error: message }, { status: 500 }),
    },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async () => ({ ok: true, user: { id: 'staff', systemRole: 'ADMIN' } }),
      hasStaffPermission: () => true,
    },
    'lib/onrevolt/prisma': { prisma: { project: { findFirst: async () => project } } },
    'lib/onrevolt/offer-workspace-server': {
      offerWorkspaceProjectWhere: (id: string) => ({ id, visibleTo: 'staff' }),
    },
    'lib/onrevolt/offer-pv-profile': {
      readOfferPvProfile: async (input: any) => {
        state.profileCalls++;
        state.profileInput = input;
        return { hours: [{ pvKwh: 1.25 }, { pvKwh: 2.5 }], source: 'PV model', model: 'test model' };
      },
    },
    'lib/onrevolt/project-pv-settings': projectPvSettings,
    'lib/onrevolt/project-analysis-period-server': {
      readProjectAnalysisPeriod: async (projectId: string) => ({
        projectId, storedStartMonth: analysisPeriod.startMonth, period: analysisPeriod,
      }),
    },
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

test('GET returns legacy PV, read-only coordinates and revision zero without a draft', async () => {
  const state = fixture({
    investmentSite: { latitude: 52.2, longitude: 21.0 },
    offerWorkspace: null,
    energyAudits: [{ existingPvKw: 7, roofTiltDeg: 30, roofOrientation: 'S' }],
  });
  const response = await state.exports.GET(state.request(), state.context);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.data, {
    period: analysisPeriod,
    existingPv: { powerKw: 7, tiltDegrees: 30, azimuthDegrees: 180, lossPercent: null },
    latitude: 52.2, longitude: 21.0, revision: 0,
  });
});

test('POST echoes canonical site coordinates used by the PV model', async () => {
  const state = fixture({ investmentSite: { latitude: '52.2', longitude: '21.0' } });
  const response = await state.exports.POST(state.request({ existingPv: {
    powerKw: 5, tiltDegrees: 30, azimuthDegrees: 180, lossPercent: 14,
  } }), state.context);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.period.periodKeys.length, 12);
  assert.deepEqual(body.data, {
    period: analysisPeriod,
    annualKwh: 3.75,
    source: 'PV model',
    model: 'test model',
    fromUtc: analysisPeriod.fromUtc,
    untilUtc: analysisPeriod.untilUtc,
    latitude: 52.2,
    longitude: 21,
  });
  assert.equal(state.state.profileInput.latitude, body.data.latitude);
  assert.equal(state.state.profileInput.longitude, body.data.longitude);
  assert.equal(state.state.profileInput.fromUtc, analysisPeriod.fromUtc);
  assert.equal(state.state.profileInput.untilUtc, analysisPeriod.untilUtc);
});

test('POST rejects out-of-range site coordinates before model execution', async () => {
  const state = fixture({ investmentSite: { latitude: 91, longitude: 21 } });
  const response = await state.exports.POST(state.request({ existingPv: {
    powerKw: 5, tiltDegrees: 30, azimuthDegrees: 180, lossPercent: 14,
  } }), state.context);

  assert.equal(response.status, 422);
  assert.equal(state.state.profileCalls, 0);
});
