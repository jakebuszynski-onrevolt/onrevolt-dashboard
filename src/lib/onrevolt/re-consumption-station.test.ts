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
  const state = { writes: 0, resolutions: 0, profileRequests: 0, profileSyncInputs: [] as any[],
    selection: { key: null as string | null, revision: 0, contentHash: null as string | null, profileName: null as string | null },
    auditAnnual: 3650, auditWhere: null as any, events: [] as string[] };
  const prisma: any = {
    project: {
      findMany: async () => missing ? [] : [project],
      findUniqueOrThrow: async () => project,
      update: async ({ data }: any) => { state.writes++; Object.assign(project, data); return project; },
    },
    energyAudit: { findFirst: async ({ where }: any) => { state.auditWhere = where; return { annualConsumptionKwh: state.auditAnnual }; } },
    $queryRaw: async () => { state.events.push('lock'); return [{ id: 'project' }]; },
    $transaction: async (fn: any) => {
      state.events.push('transaction-start');
      const result = await fn(prisma);
      state.events.push('transaction-commit');
      return result;
    },
  };
  const modules: Record<string, unknown> = {
    'node:crypto': {}, 'node:fs/promises': {}, 'node:path': {}, './audit': {},
    './energy-measurement-document': {}, './prisma': { prisma },
    './project-reference-profile': {
      readProjectReferenceProfileSelection: async () => state.selection,
      resolveSelectedReferenceProfile: async (selection: any) => selection.key
        ? { profile: { key: selection.key, name: selection.profileName }, contentHash: selection.contentHash }
        : null,
    },
    './re-reference-profile': {
      syncProjectReferenceLoadProfile: async (input: any) => {
        state.events.push('re-sync');
        state.profileSyncInputs.push(input);
        return { status: 'synced', station: '41', retryAllowed: false, message: 'Profil RE zsynchronizowany.' };
      },
    },
    './re-consumption-api': {
      validateReConsumptionPeriod: () => undefined,
      preflightReConsumptionWorkbook: async () => { state.profileRequests++; return { status: 'ready', station: '41' }; },
    },
    './project-analysis-period-server': {
      readProjectAnalysisPeriod: async (projectId: string) => ({
        projectId,
        storedStartMonth: '2025-10',
        period: { periodKeys: Array.from({ length: 12 }, (_, index) => {
          const date = new Date(Date.UTC(2025, 9 + index, 1));
          return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
        }) },
      }),
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
  return { exported, prisma, state };
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
    assert.equal(state.writes, 0);
    assert.equal(state.resolutions, 0);
    assert.equal(state.profileRequests, 0);
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
  assert.equal(state.writes, 0);
  assert.equal(state.resolutions, 0);
  assert.equal(state.profileRequests, 0);
});

test('link init rereads and replays the current selected profile using the latest project annual amount', async () => {
  const { exported, state } = fixture('41');
  state.selection = { key: 'bdew-2025-h25', revision: 3, contentHash: 'a'.repeat(64), profileName: 'Dom' };
  const result = await exported.syncProjectReferenceProfileAfterLink({ clientId: 'client', projectId: 'project', actorId: 'staff' });
  assert.equal(result.status, 'synced');
  assert.equal(state.profileSyncInputs.length, 1);
  assert.equal(state.profileSyncInputs[0].projectId, 'project');
  assert.equal(state.profileSyncInputs[0].clientId, 'client');
  assert.equal(state.profileSyncInputs[0].actorId, 'staff');
  assert.equal(state.profileSyncInputs[0].annualKwh, 3650);
  assert.equal(state.profileSyncInputs[0].referenceProfile.profile.key, 'bdew-2025-h25');
  assert.equal(state.profileSyncInputs[0].referenceProfile.contentHash, 'a'.repeat(64));
  assert.equal(state.auditWhere.profileSource, 'ANNUAL_DECLARATION');
});

test('link init replays a saved null selection as a default overlay and leaves unselected projects untouched', async () => {
  const { exported, state } = fixture('41');
  state.selection = { key: null, revision: 2, contentHash: null, profileName: null };
  const reset = await exported.syncProjectReferenceProfileAfterLink({ clientId: 'client', projectId: 'project' });
  assert.equal(reset.status, 'synced');
  assert.equal(state.profileSyncInputs[0].referenceProfile, null);
  state.selection = { key: null, revision: 0, contentHash: null, profileName: null };
  assert.equal(await exported.syncProjectReferenceProfileAfterLink({ clientId: 'client', projectId: 'project' }), null);
  assert.equal(state.profileSyncInputs.length, 1);
});

test('station POST commits its link before replaying RE and rejects stale initial station snapshots', async () => {
  const { exported, state } = fixture();
  state.selection = { key: 'bdew-2025-h25', revision: 1, contentHash: 'a'.repeat(64), profileName: 'Dom' };
  const result = await exported.commitProjectStationLinkAndReplay({
    clientId: 'client', projectId: 'project', expected: { dashboardStation: null, dashboardStationNumber: null },
    station: { stationHash: 'station-token', station: '41', weatherStation: null }, actorId: 'staff',
  });
  assert.equal(result.updatedProject.dashboardStation, 'station-token');
  assert.equal(result.referenceProfileSync.status, 'synced');
  assert.deepEqual(state.events.filter(event => event === 'transaction-commit' || event === 're-sync'), [
    'transaction-commit', 're-sync', 'transaction-commit',
  ]);

  const stale = fixture();
  stale.state.events.length = 0;
  await assert.rejects(() => stale.exported.commitProjectStationLinkAndReplay({
    clientId: 'client', projectId: 'project', expected: { dashboardStation: 'old-token', dashboardStationNumber: '40' },
    station: { stationHash: 'other-token', station: '99', weatherStation: null },
  }), /zmieniło się podczas zapisu/);
  assert.equal(stale.state.profileSyncInputs.length, 0);
  assert.equal(stale.state.writes, 0);
});

test('manual CRM link can replay only after committed exact station fields', async () => {
  const { exported, prisma, state } = fixture('41');
  state.selection = { key: 'bdew-2025-h25', revision: 1, contentHash: 'a'.repeat(64), profileName: 'Dom' };
  await prisma.$transaction(async (tx: any) => {
    await exported.assertProjectStationSnapshot(tx, { clientId: 'client', projectId: 'project',
      expected: { dashboardStation: null, dashboardStationNumber: '41' } });
    await tx.project.update({ where: { id: 'project' }, data: { dashboardStation: 'station-token' } });
  });
  const replay = await exported.replayProjectReferenceProfileForLinkedStation({
    clientId: 'client', projectId: 'project', stationHash: 'station-token', stationNumber: '41',
  });
  assert.equal(replay.status, 'synced');
  assert.equal(state.events.indexOf('transaction-commit') < state.events.indexOf('re-sync'), true);
  assert.equal(state.profileSyncInputs.length, 1);

  await assert.rejects(() => exported.replayProjectReferenceProfileForLinkedStation({
    clientId: 'client', projectId: 'project', stationHash: 'old-token', stationNumber: '41',
  }), /zmieniło się przed odtworzeniem/);
  assert.equal(state.profileSyncInputs.length, 1);
});
