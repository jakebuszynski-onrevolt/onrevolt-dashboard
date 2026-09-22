import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const sourcePath = path.join(__dirname, 're-consumption-sync.ts');
const source = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(reference: string | null = null, missing = false) {
  const project = { id: 'project', clientId: 'client', dashboardStation: null, dashboardStationNumber: reference };
  const state = { writes: 0, resolutions: 0, profileRequests: 0 };
  const prisma: any = {
    project: {
      findMany: async () => missing ? [] : [project],
      findUniqueOrThrow: async () => project,
      update: async () => { state.writes++; },
    },
    $queryRaw: async () => [{ id: 'project' }],
    $transaction: async (fn: any) => fn(prisma),
  };
  const modules: Record<string, unknown> = {
    'node:crypto': {}, 'node:fs/promises': {}, 'node:path': {}, './audit': {},
    './energy-measurement-document': {}, './prisma': { prisma },
    './re-consumption-api': {
      validateReConsumptionPeriod: () => undefined,
      preflightReConsumptionWorkbook: async () => { state.profileRequests++; return { status: 'ready', station: '41' }; },
    },
    './re-stations': {
      resolveReStation: async (ref: string) => {
        state.resolutions++;
        assert.equal(ref, '41');
        return { station: '41', stationHash: 'station-token', weatherStation: null };
      },
      createReStation: () => { throw new Error('Import must never create a station'); },
    },
  };
  const exported: any = {};
  new vm.Script(source, { filename: sourcePath }).runInNewContext({
    exports: exported, Error,
    require: (name: string) => { assert.ok(name in modules, name); return modules[name]; },
  });
  return { exported, state };
}

for (const reference of [null, '', '   ']) {
  test(`brak stacji ${JSON.stringify(reference)} wymaga przypisania w EMS bez tworzenia profilu`, async () => {
    const { exported, state } = fixture(reference);
    for (const operation of [
      () => exported.requireProjectReStation('client', 'project'),
      () => exported.ensureProjectReStation('client', 'project'),
      () => exported.preflightProjectReConsumption({ clientId: 'client', projectId: 'project', workbook: {} }),
    ]) {
      await assert.rejects(operation, (error: Error) => {
        assert.ok(error instanceof exported.ReStationRequiredError);
        assert.match(error.message, /Najpierw przypisz stację w zakładce EMS/);
        return true;
      });
    }
    assert.deepEqual(state, { writes: 0, resolutions: 0, profileRequests: 0 });
  });
}

test('przypisana stacja przechodzi wstępną kontrolę bez zapisu', async () => {
  const { exported, state } = fixture('41');
  const station = await exported.requireProjectReStation('client', 'project');
  assert.equal(station.station, '41');
  assert.equal(state.writes, 0);
  assert.equal(state.resolutions, 1);
});

test('brak projektu nie prowadzi do odczytu ani tworzenia obcej stacji', async () => {
  const { exported, state } = fixture(null, true);
  await assert.rejects(() => exported.requireProjectReStation('client', 'project'), /Nie znaleziono projektu/);
  assert.deepEqual(state, { writes: 0, resolutions: 0, profileRequests: 0 });
});
