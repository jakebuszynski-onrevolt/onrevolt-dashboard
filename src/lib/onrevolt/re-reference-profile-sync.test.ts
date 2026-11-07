import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync('src/lib/onrevolt/re-reference-profile.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function fixture(options: { owner?: string; station?: boolean; table?: boolean; client?: string; failReadback?: boolean } = {}) {
  const state = { writes: 0, row: options.owner ? { projectId: options.owner } as any : null };
  const crm = { project: { findUnique: async () => ({ clientId: options.client ?? 'client', dashboardStation: options.station === false ? null : 'hash', dashboardStationNumber: options.station === false ? null : '1' }) } };
  const tx = {
    $queryRawUnsafe: async (sql: string) => sql.includes('LIMIT 1') && options.failReadback ? [] : state.row ? [state.row] : [],
    $executeRawUnsafe: async (_sql: string, _station: string, projectId: string, profileKey: string | null, contentHash: string | null, payloadJson: string | null, annualKwh: number, projectionVersion: number) => {
      state.writes++; state.row = { projectId, profileKey, contentHash, payloadJson, annualKwh, projectionVersion }; return 1;
    },
  };
  const modules: Record<string, any> = {
    './prisma': { prisma: crm },
    './re-stations': { resolveReStation: async () => ({ station: '1', stationHash: 'hash' }), rePrisma: () => ({
      $queryRawUnsafe: async () => options.table === false ? [] : [{}], $transaction: async (fn: any) => fn(tx),
    }) },
    './reference-profile-comparison': {},
    '../../../scripts/profile-catalog/storage-core': {},
  };
  const exports: any = {}; vm.runInNewContext(code, { exports, require: (name: string) => modules[name], Buffer });
  return { state, call: () => exports.syncProjectReferenceLoadProfile({ projectId: 'project', clientId: 'client', annualKwh: 4200.001, referenceProfile: null, crmDb: crm }) };
}
test('RE synchronization persists and reads back exact annual default selection', async () => {
  const f = fixture(); const result = await f.call(); assert.equal(result.status, 'synced');
  assert.equal(f.state.row.annualKwh, 4200.001); assert.equal(f.state.row.profileKey, null); assert.equal(f.state.row.projectId, 'project');
});
test('RE selection cannot overwrite another project or cross client scope', async () => {
  for (const options of [{ owner: 'another-project' }, { client: 'another-client' }]) {
    const f = fixture(options); assert.equal((await f.call()).status, 'failed'); assert.equal(f.state.writes, 0);
  }
});
test('missing station is explicit skipped while missing schema or readback is failed', async () => {
  const unlinked = fixture({ station: false }); assert.equal((await unlinked.call()).status, 'skipped'); assert.equal(unlinked.state.writes, 0);
  const missing = fixture({ table: false }); assert.equal((await missing.call()).status, 'failed'); assert.equal(missing.state.writes, 0);
  const uncertain = fixture({ failReadback: true }); assert.equal((await uncertain.call()).status, 'failed');
});
