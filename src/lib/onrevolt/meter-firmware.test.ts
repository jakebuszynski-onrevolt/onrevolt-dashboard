import assert from 'node:assert/strict';
import test from 'node:test';
import { listMeterFirmwareReleases, parseMeterFirmwareRelease } from './meter-firmware';

function manifest(version: string, pge = false) {
  return {
    version,
    ...(pge ? { family: 'PGE-SX1276' } : {}),
    url: `https://windyone.pl/OTA/EnergyMeter/${pge ? 'PGE/' : ''}firmware/${version}.bin`,
    size: 3,
    sha256: 'a'.repeat(64),
  };
}

test('manifesty liczników nie mogą wskazywać firmware innej rodziny ani lokalizacji', () => {
  const regular = manifest('2026.09.26.2');
  const pge = manifest('PGE-2026.09.26.4', true);
  assert.equal(parseMeterFirmwareRelease(regular, 'ENERGYMETER', `${regular.version}.json`).version, regular.version);
  assert.equal(parseMeterFirmwareRelease(pge, 'PGE', `${pge.version}.json`).version, pge.version);
  assert.throws(() => parseMeterFirmwareRelease(pge, 'ENERGYMETER', `${pge.version}.json`));
  assert.throws(() => parseMeterFirmwareRelease(regular, 'PGE', `${regular.version}.json`));
  assert.throws(() => parseMeterFirmwareRelease({ ...regular, url: regular.url.replace('windyone.pl', 'example.com') }, 'ENERGYMETER', `${regular.version}.json`));
  assert.throws(() => parseMeterFirmwareRelease({ ...regular, sha256: 'bad' }, 'ENERGYMETER', `${regular.version}.json`));
  assert.throws(() => parseMeterFirmwareRelease(regular, 'ENERGYMETER', 'other.json'));
});

test('katalog odczytuje osobne endpointy rodzin i sortuje numerycznie', async () => {
  const fakeFetch: typeof fetch = async (input, options) => {
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.redirect, 'error');
    const pge = String(input).includes('/PGE/');
    assert.equal(String(input), `https://windyone.pl/OTA/EnergyMeter/${pge ? 'PGE/' : ''}releases.php`);
    return Response.json({ family: pge ? 'PGE' : 'ENERGYMETER', releases: pge
      ? [manifest('PGE-2026.09.26.4', true)]
      : [manifest('2026.09.26.2'), manifest('2026.09.26.10')] });
  };
  assert.deepEqual((await listMeterFirmwareReleases('ENERGYMETER', fakeFetch)).map((release) => release.version), ['2026.09.26.10', '2026.09.26.2']);
  assert.deepEqual((await listMeterFirmwareReleases('PGE', fakeFetch)).map((release) => release.version), ['PGE-2026.09.26.4']);
});

test('pusty, uszkodzony lub niewłaściwy katalog nie sugeruje wersji do aktualizacji', async () => {
  await assert.rejects(listMeterFirmwareReleases('ENERGYMETER', async () => new Response('', { status: 503 })), /HTTP 503/);
  await assert.rejects(listMeterFirmwareReleases('ENERGYMETER', async () => Response.json({ family: 'PGE', releases: [manifest('PGE-2026.09.26.4', true)] })), /Nieprawidłowy katalog/);
  await assert.rejects(listMeterFirmwareReleases('ENERGYMETER', async () => Response.json({ family: 'ENERGYMETER', releases: [] })), /Brak opublikowanych/);
  await assert.rejects(listMeterFirmwareReleases('ENERGYMETER', async () => Response.json({ family: 'ENERGYMETER', releases: [manifest('PGE-2026.09.26.4', true)] })), /Nieprawidłowe metadane/);
});
