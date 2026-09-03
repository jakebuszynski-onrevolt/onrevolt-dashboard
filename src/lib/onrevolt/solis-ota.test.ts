import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveSolisRapidCommandState,
  deriveSolisOtaState,
  isSolisStationType,
  isValidSolisRapidCommand,
  isValidSolisFirmwareVersion,
  listSolisFirmwareReleases,
  supportsSolisRapidCommands,
} from './solis-ota';

test('rozpoznaje stacje Solis bez względu na wielkość liter', () => {
  assert.equal(isSolisStationType('Solis S6 Hybrid'), true);
  assert.equal(isSolisStationType('solis-modbus'), true);
  assert.equal(isSolisStationType('Victron'), false);
});

test('akceptuje wyłącznie bezpieczne identyfikatory firmware', () => {
  assert.equal(isValidSolisFirmwareVersion('2026.09.02.3'), true);
  assert.equal(isValidSolisFirmwareVersion('release_test-1'), true);
  assert.equal(isValidSolisFirmwareVersion('../firmware.bin'), false);
  assert.equal(isValidSolisFirmwareVersion('wersja z odstępem'), false);
});

test('stan OTA blokuje kolejne zlecenie podczas oczekiwania i pobierania', () => {
  assert.equal(deriveSolisOtaState({
    firmwareVersion: '2026.09.02.2',
    targetVersion: '2026.09.02.3',
    otaEnabled: true,
    lastStatus: 'healthy',
  }), 'WAITING');
  assert.equal(deriveSolisOtaState({
    firmwareVersion: '2026.09.02.2',
    targetVersion: '2026.09.02.3',
    otaEnabled: true,
    lastStatus: 'downloading',
  }), 'DOWNLOADING');
});

test('rozróżnia potwierdzoną wersję i błąd OTA', () => {
  assert.equal(deriveSolisOtaState({
    firmwareVersion: '2026.09.02.3',
    targetVersion: '2026.09.02.3',
    otaEnabled: false,
    lastStatus: 'healthy',
  }), 'CURRENT');
  assert.equal(deriveSolisOtaState({
    firmwareVersion: '2026.09.02.2',
    targetVersion: '2026.09.02.3',
    otaEnabled: false,
    lastStatus: 'failed',
  }), 'FAILED');
});

test('udostępnia szybkie polecenia dopiero od firmware 2026.09.02.4', () => {
  assert.equal(supportsSolisRapidCommands('2026.09.02.3'), false);
  assert.equal(supportsSolisRapidCommands('2026.09.02.4'), true);
  assert.equal(supportsSolisRapidCommands('2026.09.03.1'), true);
  assert.equal(supportsSolisRapidCommands(null), false);
});

test('akceptuje wyłącznie znane szybkie polecenia Solis', () => {
  assert.equal(isValidSolisRapidCommand('OTA_CHECK_NOW'), true);
  assert.equal(isValidSolisRapidCommand('export_block_on'), true);
  assert.equal(isValidSolisRapidCommand('RESTART'), false);
});

test('rozróżnia oczekujące, wygasłe i potwierdzone szybkie polecenia', () => {
  const now = new Date('2026-09-02T14:00:00.000Z');
  assert.equal(deriveSolisRapidCommandState({
    sequence: 12,
    command: 'PV_BLOCK_ON',
    expiresAt: '2026-09-02T14:05:00.000Z',
    acknowledgedSequence: 11,
    acknowledgedAt: '2026-09-02T13:59:00.000Z',
    ok: true,
  }, now), 'PENDING');
  assert.equal(deriveSolisRapidCommandState({
    sequence: 12,
    command: 'PV_BLOCK_ON',
    expiresAt: '2026-09-02T13:59:59.000Z',
    acknowledgedSequence: 11,
    acknowledgedAt: null,
    ok: null,
  }, now), 'EXPIRED');
  assert.equal(deriveSolisRapidCommandState({
    sequence: 12,
    command: null,
    expiresAt: null,
    acknowledgedSequence: 12,
    acknowledgedAt: '2026-09-02T14:00:03.000Z',
    ok: true,
  }, now), 'ACKNOWLEDGED');
  assert.equal(deriveSolisRapidCommandState({
    sequence: 13,
    command: null,
    expiresAt: null,
    acknowledgedSequence: 13,
    acknowledgedAt: '2026-09-02T14:00:04.000Z',
    ok: false,
  }, now), 'FAILED');
});

test('pobiera i porządkuje wyłącznie poprawne wydania z katalogu HTTPS', async () => {
  const previousUrl = process.env.ONREVOLT_SOLIS_RELEASES_URL;
  const previousFetch = globalThis.fetch;
  process.env.ONREVOLT_SOLIS_RELEASES_URL = 'https://windyone.pl/OTA/Solis/catalog.php';
  globalThis.fetch = async () => new Response(JSON.stringify({
    releases: [
      {
        version: '2026.09.02.2',
        url: 'https://windyone.pl/OTA/Solis/firmware/solis-2026.09.02.2.bin',
        sha256: 'a'.repeat(64),
        size: 1200,
        created_at: '2026-09-02 12:57:04',
      },
      {
        version: '2026.09.02.3',
        url: 'https://windyone.pl/OTA/Solis/firmware/solis-2026.09.02.3.bin',
        sha256: 'b'.repeat(64),
        size: 1300,
        created_at: '2026-09-02 14:34:05',
      },
      { version: '../niepoprawna', url: 'http://example.test/a.bin', sha256: 'x', size: 0 },
    ],
  }), { status: 200 });

  try {
    const releases = await listSolisFirmwareReleases();
    assert.deepEqual(releases.map((release) => release.version), ['2026.09.02.3', '2026.09.02.2']);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl == null) delete process.env.ONREVOLT_SOLIS_RELEASES_URL;
    else process.env.ONREVOLT_SOLIS_RELEASES_URL = previousUrl;
  }
});
