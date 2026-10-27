import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { classifyAdminEmsGroup } from './admin-ems';

const source = readFileSync(new URL('./re-stations.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function requestReMeterStationOta(');
const end = source.indexOf('\nexport async function ', start + 1);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(source.slice(start, end).replace('export async', 'async'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(overrides: Record<string, unknown> = {}, affected = 1) {
  const before = { station: '102', uid: 'EM-test', type: 'SDM630MCT', firmwareVersion: '2026.09.26.1', otaEnabled: false, ...overrides };
  const release = { version: '2026.09.26.2', url: 'https://windyone.pl/OTA/EnergyMeter/firmware/test.bin', sha256: 'a'.repeat(64), size: 123 };
  const columns = new Map(['firmware_target_version', 'firmware_target_url', 'firmware_target_sha256', 'firmware_target_size', 'ota_enabled', 'ota_force', 'uid', 'type', 'firmware_version'].map((key) => [key, {}]));
  const writes: unknown[][] = [];
  const catalogs: string[] = [];
  const db = { $executeRawUnsafe: async (...args: unknown[]) => { writes.push(args); return affected; } };
  const request = new Function('readReStationDeviceStatus', 'classifyAdminEmsGroup', 'listMeterFirmwareReleases', 'rePrisma', 'readEnergyMeterColumns', 'ReStationOtaRequestError', code + '\nreturn requestReMeterStationOta;')(
    async () => before, classifyAdminEmsGroup,
    async (family: string) => {
      catalogs.push(family);
      return [{ ...release, ...(family === 'PGE' ? { version: 'PGE-2026.09.26.4', url: 'https://windyone.pl/OTA/EnergyMeter/PGE/firmware/test.bin' } : {}) }];
    }, () => db, async () => columns, Error,
  ) as (station: string, version: string) => Promise<any>;
  return { request, before, release, writes, catalogs, columns };
}

test('OTA ESP32 zapisuje komplet metadanych katalogu i chroni atomowo tożsamość oraz zajętą stację', async () => {
  const f = fixture();
  const result = await f.request('102', f.release.version);
  assert.deepEqual(f.catalogs, ['ENERGYMETER']);
  assert.equal(result.targetVersion, f.release.version);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].slice(1), [f.release.version, f.release.url, f.release.sha256, f.release.size, '102', 'EM-test', 'SDM630MCT', '2026.09.26.1']);
  assert.match(String(f.writes[0][0]), /`ota_force` = 0, `ota_enabled` = 1/);
  assert.match(String(f.writes[0][0]), /WHERE `station` = \? AND `uid` <=> \? AND `type` = \? AND `firmware_version` = \? AND `ota_enabled` = 0 LIMIT 1/);
});

test('PGE używa wyłącznie katalogu PGE, także bez projektu', async () => {
  const f = fixture({ type: 'PGE-SX1276', firmwareVersion: 'PGE-2026.09.26.3' });
  await f.request('102', 'PGE-2026.09.26.4');
  assert.deepEqual(f.catalogs, ['PGE']);
  assert.equal(f.writes[0][1], 'PGE-2026.09.26.4');
  assert.match(String(f.writes[0][2]), /\/PGE\/firmware\//);
});

test('odrzuca obcą rodzinę, wersję spoza katalogu, aktywne OTA i bieżącą wersję bez zapisu', async () => {
  for (const [overrides, version] of [
    [{}, 'PGE-2026.09.26.4'], [{ type: 'PGE' }, '2026.09.26.2'],
    [{ type: 'Solis' }, '2026.09.26.2'], [{ type: 'Victron' }, '2026.09.26.2'],
    [{ otaEnabled: true }, '2026.09.26.2'], [{ firmwareVersion: null }, '2026.09.26.2'],
    [{ firmwareVersion: '2026.09.26.2' }, '2026.09.26.2'], [{}, '../x'],
  ] as Array<[Record<string, unknown>, string]>) {
    const f = fixture(overrides);
    await assert.rejects(f.request('102', version));
    assert.equal(f.writes.length, 0);
  }
});

test('odrzuca nieprawidłowy numer, niepełny schemat i zmianę stacji podczas zapisu', async () => {
  const f = fixture();
  for (const station of ['-1', '65536', '102 OR 1=1', '0102', 'hash']) {
    await assert.rejects(f.request(station, f.release.version));
  }
  f.columns.delete('firmware_target_sha256');
  await assert.rejects(f.request('102', f.release.version));
  assert.equal(f.writes.length, 0);
  const race = fixture({}, 0);
  await assert.rejects(race.request('102', race.release.version), /Status stacji zmienił się/);
});

test('endpoint wymaga admina przed odczytem body i OTA; audyt po zleceniu nie powoduje ponowienia', async () => {
  const routeSource = readFileSync(new URL('../../app/api/admin/ems/ota/route.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(routeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let admin = false;
  let authenticated = true;
  let writes = 0;
  let bodyReads = 0;
  let stationType = 'SDM630MCT';
  let solisWrites = 0;
  const modules: Record<string, unknown> = {
    'lib/onrevolt/api': {
      badRequest: (error: string) => ({ status: 400, error }), forbidden: () => ({ status: 403 }),
      jsonResponse: (data: unknown) => data, serverError: () => ({ status: 500 }),
    },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async (_req: unknown, permission: string) => {
        assert.equal(permission, 'energy.manage');
        return authenticated ? { ok: true, user: { id: 'admin' } } : { ok: false, response: { status: 401 } };
      },
      isAdminUser: () => admin,
    },
    'lib/onrevolt/re-stations': {
      ReStationOtaRequestError: class extends Error {},
      readReStationDeviceStatus: async () => ({ station: '102', type: stationType }),
      requestReStationOta: async () => { solisWrites++; return { before: { station: '102' } }; },
      requestReMeterStationOta: async () => { writes++; return { before: { station: '102' }, targetVersion: 'v', family: 'ENERGYMETER' }; },
    },
    'lib/onrevolt/solis-ota': {
      isSolisStationType: (type: string) => type === 'Solis',
      listSolisFirmwareReleases: async () => [{ version: '2026.10.27.1' }],
    },
    'lib/onrevolt/audit': { writeAuditLog: async () => {} },
  };
  const exports: Record<string, any> = {};
  new Function('require', 'exports', compiled)((name: string) => { assert.ok(modules[name], name); return modules[name]; }, exports);
  const req = { json: async () => { bodyReads++; return { station: '102', targetVersion: '2026.09.26.2' }; } };
  assert.equal((await exports.POST(req)).status, 403);
  authenticated = false;
  assert.equal((await exports.POST(req)).status, 401);
  assert.equal(bodyReads, 0);
  assert.equal(writes, 0);
  authenticated = true; admin = true;
  assert.equal((await exports.POST({ json: async () => ({ station: 102 }) })).status, 400);
  assert.equal(writes, 0);
  assert.equal((await exports.POST(req)).ok, true);
  assert.equal(writes, 1);
  (modules['lib/onrevolt/audit'] as { writeAuditLog: () => Promise<void> }).writeAuditLog = async () => { throw new Error('Test audit failure'); };
  const originalError = console.error;
  console.error = () => {};
  try {
    const accepted = await exports.POST(req);
    assert.equal(accepted.ok, true);
    assert.equal(accepted.auditLogged, false);
    assert.equal(writes, 2);
  } finally { console.error = originalError; }
  (modules['lib/onrevolt/audit'] as { writeAuditLog: () => Promise<void> }).writeAuditLog = async () => {};
  stationType = 'Solis';
  assert.equal((await exports.POST(req)).status, 400);
  assert.equal(solisWrites, 0);
  assert.equal((await exports.POST({ json: async () => ({ station: '102', targetVersion: 'PGE-2026.09.26.4' }) })).status, 400);
  assert.equal((await exports.POST({ json: async () => ({ station: '102', targetVersion: '2026.10.27.1' }) })).ok, true);
  assert.equal(solisWrites, 1);
  assert.equal(writes, 2);
});
