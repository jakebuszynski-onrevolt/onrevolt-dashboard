import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { projectGeneralTariff } from './client-tariffs';

const filename = path.resolve(__dirname, 'client-tariffs-server.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function fixture(row: Record<string, unknown> | null, invalidCatalog = false) {
  const calls: unknown[][] = [];
  const modules: Record<string, unknown> = {
    'node:child_process': {}, 'node:path': {}, './prisma': {}, './client-tariffs': { projectGeneralTariff },
    './re-stations': { rePrisma: () => ({ $queryRawUnsafe: async (...args: unknown[]) => {
      calls.push(args);
      if (String(args[0]).includes('EnergyMeter_users')) return row ? [row] : [];
      return invalidCatalog ? [] : [{ operator: 'ENEA', code: args[1] === 1 ? 'G11' : 'G13active' }];
    }, $executeRawUnsafe: async (...args: unknown[]) => { calls.push(args); return row ? 1 : 0; } }) },
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (key: string) => { if (!modules[key]) throw new Error(key); return modules[key]; }, console });
  return { read: exports.readProjectGeneralTariffs, updateTarget: exports.updateProjectTargetTariff, calls };
}
const scope = { clientId: 'client', projectId: 'project', station: '40', generalTariff: { operator: 'PGE', code: 'C11' } };
const selection = { tariff_current_osd_id: 1, tariff_current_tariff_id: 1, tariff_target_osd_id: 1, tariff_target_tariff_id: 27 };
test('linked project reads current and simulation tariffs directly from RE, not the CRM account', async () => {
  const f = fixture(selection), value = await f.read(scope);
  assert.equal(value.generalTariffSource, 'RE');
  assert.equal(value.generalTariff.code, 'G11');
  assert.equal(value.targetTariff.code, 'G13active');
  assert.equal(f.calls[0][1], '40');
  assert.ok(f.calls.every(args => String(args[0]).startsWith('SELECT ')));
});
test('missing RE selection remains missing and never substitutes the CRM selection', async () => {
  const f = fixture({ tariff_current_osd_id: null, tariff_current_tariff_id: null, tariff_target_osd_id: null, tariff_target_tariff_id: null });
  const value = await f.read(scope);
  assert.equal(value.generalTariff, null); assert.equal(value.targetTariff, null);
  assert.equal(value.generalTariffSource, 'RE');
});
test('projects without a station use their saved account without querying RE', async () => {
  const f = fixture(null), value = await f.read({ ...scope, station: null });
  assert.equal(value.generalTariff.code, 'C11'); assert.equal(value.generalTariffSource, 'CRM');
  assert.equal(f.calls.length, 0);
});
test('broken RE station or tariff mapping is reported, not silently replaced', async () => {
  await assert.rejects(() => fixture(null).read(scope), /Nie znaleziono/);
  await assert.rejects(() => fixture({ ...selection, tariff_current_osd_id: null }).read(scope), /Niekompletny/);
  await assert.rejects(() => fixture(selection, true).read(scope), /nie istnieje/);
});
test('target tariff is validated against the operator and saved for the linked station', async () => {
  const f = fixture(selection);
  const value = await f.updateTarget(scope, 1, 75);
  assert.equal(value.targetTariff.code, 'G13active');
  assert.ok(f.calls.some(args => String(args[0]).startsWith('UPDATE EnergyMeter_users SET tariff_target_osd_id')));
  await assert.rejects(() => f.updateTarget({ ...scope, station: null }, 1, 75), /przypisz stację/);
});
