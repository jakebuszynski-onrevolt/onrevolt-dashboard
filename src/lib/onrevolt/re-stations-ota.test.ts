import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { isSolisStationType, isValidSolisFirmwareVersion } from './solis-ota';

// Test rzeczywistej funkcji bez połączenia z produkcyjną bazą.
const source = readFileSync(new URL('./re-stations.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function requestReStationOta(');
const end = source.indexOf('\nexport async function ', start + 1);
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(source.slice(start, end).replace('export async', 'async'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(overrides: Record<string, unknown> = {}, optional = true, affected = 1) {
  const before = { station: '41', type: 'Solis S6 Hybrid', firmwareVersion: '2026.10.26.1', otaEnabled: false, ...overrides };
  const columns = new Map(['firmware_target_version', 'ota_enabled', ...(optional
    ? ['firmware_target_url', 'firmware_target_sha256', 'firmware_target_size'] : [])].map((key) => [key, {}]));
  const writes: unknown[][] = [];
  const db = { $executeRawUnsafe: async (...args: unknown[]) => { writes.push(args); return affected; } };
  class RequestError extends Error {}
  const request = new Function('isValidSolisFirmwareVersion', 'isSolisStationType',
    'readReStationDeviceStatus', 'rePrisma', 'readEnergyMeterColumns', 'ReStationOtaRequestError',
    code + '\nreturn requestReStationOta;')(
    isValidSolisFirmwareVersion, isSolisStationType, async () => before,
    () => db, async () => columns, RequestError,
  ) as (station: string, version: string) => Promise<unknown>;
  return { request, writes, columns };
}

test('wybór OTA atomowo czyści trzy stare nadpisania i zachowuje blokadę współbieżności', async () => {
  const f = fixture();
  await f.request('41', '2026.10.27.1');
  assert.deepEqual(f.writes, [[
    "UPDATE `EnergyMeter_users` SET `firmware_target_version` = ?, `ota_enabled` = 1, `firmware_target_url` = '', `firmware_target_sha256` = '', `firmware_target_size` = 0 WHERE `station` = ? AND `ota_enabled` = 0 LIMIT 1",
    '2026.10.27.1', '41',
  ]]);
});

test('wybór OTA obsługuje schemat bez opcjonalnych nadpisań', async () => {
  const f = fixture({}, false);
  await f.request('41', '2026.10.27.1');
  assert.equal(f.writes[0][0], 'UPDATE `EnergyMeter_users` SET `firmware_target_version` = ?, `ota_enabled` = 1 WHERE `station` = ? AND `ota_enabled` = 0 LIMIT 1');
});

test('każdy kolejny wybór wersji ponownie czyści nadpisania, również dla diagnostyki', async () => {
  for (const version of ['2026.10.28.1', '2026.10.28.diag1']) {
    const f = fixture({ firmwareVersion: '2026.10.27.1' });
    await f.request('41', version);
    assert.match(String(f.writes[0][0]), /`firmware_target_size` = 0/);
    assert.equal(f.writes[0][1], version);
  }
});

test('nie zmienia stacji przy aktywnym OTA, tej samej wersji lub niewłaściwym urządzeniu', async () => {
  for (const overrides of [{ otaEnabled: true }, { firmwareVersion: '2026.10.27.1' }, { type: 'Victron' }, { firmwareVersion: null }]) {
    const f = fixture(overrides);
    await assert.rejects(f.request('41', '2026.10.27.1'));
    assert.equal(f.writes.length, 0);
  }
});

test('nie zapisuje nieprawidłowej wersji ani niepełnego schematu', async () => {
  const f = fixture();
  await assert.rejects(f.request('41', '../bad'));
  f.columns.delete('ota_enabled');
  await assert.rejects(f.request('41', '2026.10.27.1'));
  assert.equal(f.writes.length, 0);
});

test('zgłasza konflikt jeśli inny proces zdążył włączyć OTA', async () => {
  const f = fixture({}, true, 0);
  await assert.rejects(f.request('41', '2026.10.27.1'), /Nie udało się włączyć OTA/);
  assert.equal(f.writes.length, 1);
});
