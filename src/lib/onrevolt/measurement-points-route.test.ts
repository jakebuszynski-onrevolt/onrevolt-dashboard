import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const filename = path.resolve(__dirname, '../../app/api/integrations/re/measurement-points/route.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

type FixtureOptions = { denied?: boolean; conflict?: boolean };

function fixture(options: FixtureOptions = {}) {
  const calls: any[] = [];
  const permissions: Array<string | undefined> = [];
  const audits: any[] = [];
  const main = { station: '103', stationHash: 'mainhash', name: 'Stacja 103', location: null, order: 0, parentStation: null, main: true, latestDataAt: null, fresh: false };
  const child = { station: '101', stationHash: 'child101', name: 'Stacja 101', location: null, order: 1, parentStation: '103', main: false, latestDataAt: null, fresh: false };
  const candidate = { station: '102', stationHash: 'child102', name: 'Stacja 102', location: null, order: 0, parentStation: null, main: false, latestDataAt: null, fresh: false };
  let points = [main, child];

  class ReMeasurementPointError extends Error {}
  const prisma = {
    project: {
      findFirst: async ({ where }: any) => {
        if (where.clientId) return { id: 'project', clientId: 'client', title: 'Projekt', dashboardStation: 'mainhash', dashboardStationNumber: '103' };
        return options.conflict ? { id: 'other', title: 'Inny projekt' } : null;
      },
      findMany: async () => [
        { dashboardStationNumber: '999', dashboardStation: 'occupiedhash' },
      ],
    },
  };
  const modules: Record<string, unknown> = {
    'lib/onrevolt/api': {
      badRequest: (message: string) => ({ status: 400, value: { message } }),
      jsonResponse: (value: unknown, init?: { status: number }) => ({ status: init?.status || 200, value }),
      notFound: (message: string) => ({ status: 404, value: { message } }),
      optionalString: (body: any, key: string) => typeof body[key] === 'string' && body[key].trim() ? body[key].trim() : undefined,
      readJsonObject: async (request: any) => request.body,
      requireString: (body: any, key: string) => {
        const value = typeof body[key] === 'string' ? body[key].trim() : '';
        if (!value) throw new ReMeasurementPointError(`Brak ${key}`);
        return value;
      },
      serverError: (message: string) => ({ status: 500, value: { message } }),
    },
    'lib/onrevolt/audit': { writeAuditLog: async (entry: unknown) => { audits.push(entry); } },
    'lib/onrevolt/prisma': { prisma },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async (_request: unknown, permission?: string) => {
        permissions.push(permission);
        return options.denied ? { ok: false, response: { status: 403 } } : { ok: true, user: { id: 'staff' } };
      },
    },
    'lib/onrevolt/re-stations': {
      ReMeasurementPointError,
      resolveReStation: async (station: string) => station === '102' ? { station: '102', stationHash: 'child102' } : null,
      readReMeasurementPoints: async () => points,
      searchReMeasurementPointCandidates: async (_station: string, _query: string, excluded: string[]) => {
        calls.push({ action: 'search', excluded });
        return [candidate, { ...candidate, station: '998', stationHash: 'occupiedhash' }];
      },
      attachReMeasurementPoint: async (_mainStation: string, station: string) => {
        calls.push({ action: 'attach', station });
        points = [...points, { ...candidate, parentStation: '103', order: 2 }];
        return { mainStation: '103', childStation: station };
      },
      updateReMeasurementPoint: async (_mainStation: string, station: string, value: unknown) => {
        calls.push({ action: 'update', station, value });
      },
      reorderReMeasurementPoints: async (_mainStation: string, orderedStations: string[]) => {
        calls.push({ action: 'reorder', orderedStations });
      },
      detachReMeasurementPoint: async (_mainStation: string, station: string) => {
        calls.push({ action: 'detach', station });
        points = points.filter((point) => point.station !== station);
        return { mainStation: '103', childStation: station };
      },
    },
  };
  const exports: any = {};
  vm.runInNewContext(code, {
    exports,
    require: (key: string) => {
      if (!modules[key]) throw new Error(`Unexpected module: ${key}`);
      return modules[key];
    },
    console,
  });
  const request = (method: string, body: unknown = null, query = '') => ({
    body,
    method,
    nextUrl: new URL(`https://crm.example.test/api/integrations/re/measurement-points?clientId=client&projectId=project${query}`),
  });
  return { exports, request, calls, permissions, audits };
}

test('measurement point writes require energy.manage before project or RE access', async () => {
  const state = fixture({ denied: true });
  const result = await state.exports.POST(state.request('POST', { clientId: 'client', projectId: 'project', station: '102' }));
  assert.equal(result.status, 403);
  assert.deepEqual(state.permissions, ['energy.manage']);
  assert.equal(state.calls.length, 0);
});

test('candidate search excludes stations assigned to another CRM project by number and token', async () => {
  const state = fixture();
  const result = await state.exports.GET(state.request('GET', null, '&query=Stacja'));
  assert.equal(result.status, 200);
  assert.deepEqual(state.permissions, ['energy.manage']);
  assert.deepEqual(state.calls[0].excluded, ['999']);
  assert.deepEqual(Array.from(result.value.data.candidates, (point: any) => point.station), ['102']);
});

test('station used as another project main point cannot be attached', async () => {
  const state = fixture({ conflict: true });
  const result = await state.exports.POST(state.request('POST', { clientId: 'client', projectId: 'project', station: '102' }));
  assert.equal(result.status, 400);
  assert.equal(state.calls.some((call) => call.action === 'attach'), false);
  assert.equal(state.audits.length, 0);
});

test('reorder and detach are audited and return refreshed hierarchy', async () => {
  const state = fixture();
  const reordered = await state.exports.PATCH(state.request('PATCH', {
    clientId: 'client', projectId: 'project', orderedStations: ['101'],
  }));
  assert.equal(reordered.status, 200);
  assert.deepEqual(state.calls[0], { action: 'reorder', orderedStations: ['101'] });
  assert.equal(state.audits[0].action, 'MEASUREMENT_POINT_REORDER');

  const detached = await state.exports.DELETE(state.request('DELETE', {
    clientId: 'client', projectId: 'project', station: '101',
  }));
  assert.equal(detached.status, 200);
  assert.equal(state.audits[1].action, 'MEASUREMENT_POINT_DETACH');
  assert.deepEqual(Array.from(detached.value.data.points, (point: any) => point.station), ['103']);
});
