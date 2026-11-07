import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { gzipSync } from 'node:zlib';
import { getOfferPvSourceRevision } from './offer-pv-source-revision';

const location = { latitude: 52.23, longitude: 21.01 };

function sourceFixture(t: TestContext, coordinates = location, cacheKey?: string) {
  const previousToolsDir = process.env.ONREVOLT_PV_TOOLS_DIR;
  const previousPython = process.env.ONREVOLT_PV_PYTHON;
  const toolsDir = mkdtempSync(path.join(os.tmpdir(), 'offer-pv-source-test-'));
  mkdirSync(path.join(toolsDir, 'pvgis-cache'), { recursive: true });
  for (const name of ['engine.py', 'solar_model.py', 'pvgis_data.py']) {
    writeFileSync(path.join(toolsDir, name), `# ${name}\n`, 'utf8');
  }
  process.env.ONREVOLT_PV_TOOLS_DIR = toolsDir;
  process.env.ONREVOLT_PV_PYTHON = process.execPath;
  t.after(() => {
    if (previousToolsDir === undefined) delete process.env.ONREVOLT_PV_TOOLS_DIR;
    else process.env.ONREVOLT_PV_TOOLS_DIR = previousToolsDir;
    if (previousPython === undefined) delete process.env.ONREVOLT_PV_PYTHON;
    else process.env.ONREVOLT_PV_PYTHON = previousPython;
  });
  const base = path.join(toolsDir, 'pvgis-cache', cacheKey
    || `sarah3-v6-2020-2024-${coordinates.latitude.toFixed(6)}-${coordinates.longitude.toFixed(6)}`);
  const compressed = gzipSync(Buffer.from('fixture PVGIS rows\n', 'utf8'));
  writeFileSync(`${base}.csv.gz`, compressed);
  const metadata = {
    source: 'PVGIS 6 / SARAH-3', period: '2020-2024', ...coordinates,
    hours: 1, fetchedAt: '2026-11-05T00:00:00Z',
    sha256: createHash('sha256').update(compressed).digest('hex'),
  };
  writeFileSync(`${base}.csv.json`, JSON.stringify(metadata), 'utf8');
  return { toolsDir, metadata, metadataPath: `${base}.csv.json`, csvPath: `${base}.csv.gz`, lockPath: `${base}.csv.lock` };
}

test('cold PVGIS cache has no reusable source revision', (t) => {
  const previousToolsDir = process.env.ONREVOLT_PV_TOOLS_DIR;
  const previousPython = process.env.ONREVOLT_PV_PYTHON;
  const toolsDir = mkdtempSync(path.join(os.tmpdir(), 'offer-pv-cold-source-test-'));
  mkdirSync(toolsDir, { recursive: true });
  for (const name of ['engine.py', 'solar_model.py', 'pvgis_data.py']) writeFileSync(path.join(toolsDir, name), name, 'utf8');
  process.env.ONREVOLT_PV_TOOLS_DIR = toolsDir;
  process.env.ONREVOLT_PV_PYTHON = process.execPath;
  t.after(() => {
    if (previousToolsDir === undefined) delete process.env.ONREVOLT_PV_TOOLS_DIR;
    else process.env.ONREVOLT_PV_TOOLS_DIR = previousToolsDir;
    if (previousPython === undefined) delete process.env.ONREVOLT_PV_PYTHON;
    else process.env.ONREVOLT_PV_PYTHON = previousPython;
  });
  assert.equal(getOfferPvSourceRevision(location), null);
});

test('PV source revision includes raw bytes and metadata and rejects a checksum mismatch', (t) => {
  const fixture = sourceFixture(t);
  const first = getOfferPvSourceRevision(location);
  assert.match(first || '', /^[a-f0-9]{64}$/u);

  writeFileSync(fixture.metadataPath, JSON.stringify({ ...fixture.metadata, fetchedAt: '2026-11-06T00:00:00Z' }), 'utf8');
  const metadataChanged = getOfferPvSourceRevision(location);
  assert.notEqual(metadataChanged, first);

  writeFileSync(fixture.csvPath, Buffer.from('altered compressed bytes'));
  assert.throws(() => getOfferPvSourceRevision(location), /Niezgodna suma kontrolna zapisanych danych PVGIS/u);
});

test('PV source lookup matches Python ties-to-even six-decimal cache filenames', (t) => {
  const tieLocation = { latitude: 52.0078125, longitude: -21.0078125 };
  const fixture = sourceFixture(t, tieLocation, 'sarah3-v6-2020-2024-52.007812--21.007812');
  assert.equal(path.basename(fixture.csvPath), 'sarah3-v6-2020-2024-52.007812--21.007812.csv.gz');
  assert.match(getOfferPvSourceRevision(tieLocation) || '', /^[a-f0-9]{64}$/u);
});

test('active PVGIS publication lock makes an incomplete CSV/metadata pair transient, not reusable', (t) => {
  const fixture = sourceFixture(t);
  writeFileSync(fixture.csvPath, Buffer.from('new CSV before metadata rename'));
  writeFileSync(fixture.lockPath, 'writer active', 'utf8');
  assert.equal(getOfferPvSourceRevision(location), null);

  unlinkSync(fixture.lockPath);
  assert.throws(() => getOfferPvSourceRevision(location), /Niezgodna suma kontrolna zapisanych danych PVGIS/u);
});
