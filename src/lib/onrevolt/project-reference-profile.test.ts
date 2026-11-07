import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const file = path.resolve(__dirname, 'project-reference-profile.ts');
const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function fixture(rows: any[] = []) {
  const state = { queries: [] as any[], catalogReads: 0 };
  const db = { $queryRaw: async (_parts: any, id: string) => { state.queries.push(id); return rows; } };
  const modules: Record<string, any> = {
    './prisma': { prisma: db },
    './reference-profile-catalog-server': { readReferenceProfileCatalog: async () => { state.catalogReads++; return [{ key: 'good' }, { key: 'grid' }]; } },
    './reference-profile-comparison': { getReferenceProfileCalculationEligibility: (p: any) => ({ eligible: p.key === 'good', reason: 'Nieprawidłowy rodzaj energii.' }) },
    '../../../scripts/profile-catalog/storage-core': { profileContentHash: () => 'a'.repeat(64) },
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (key: string) => modules[key] });
  return { exports, state, db };
}
test('absent or explicit default selection returns legacy choice without loading catalog', async () => {
  const f = fixture(); assert.equal(await f.exports.readSelectedReferenceProfile('project'), null);
  assert.equal(f.state.catalogReads, 0); assert.deepEqual(f.state.queries, ['project']);
  assert.equal(await f.exports.resolveSelectedReferenceProfile(undefined), null);
});
test('selected catalog version must match persisted SHA-256; invalid selection never becomes default', async () => {
  const f = fixture(); const selected = { key: 'good', revision: 1, profileName: 'Dobry', contentHash: 'a'.repeat(64) };
  assert.equal((await f.exports.resolveSelectedReferenceProfile(selected)).profile.key, 'good');
  for (const change of [{ key: 'missing' }, { key: 'grid' }, { contentHash: 'b'.repeat(64) }, { contentHash: null }]) {
    await assert.rejects(() => f.exports.resolveSelectedReferenceProfile({ ...selected, ...change }));
  }
});
test('locked transaction can read selection and unknown projection version is rejected', async () => {
  const row = { profileKey: 'good', contentHash: 'a'.repeat(64), profileName: 'Dobry', revision: 2, projectionVersion: 1 };
  const f = fixture([row]); const selection = await f.exports.readProjectReferenceProfileSelection('project', f.db);
  assert.equal(selection.key, 'good'); assert.equal(selection.revision, 2);
  const invalid = fixture([{ ...row, projectionVersion: 2 }]);
  await assert.rejects(() => invalid.exports.readSelectedReferenceProfile('project'));
});
