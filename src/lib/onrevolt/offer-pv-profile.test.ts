import childProcess from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import test, { type TestContext } from 'node:test';
import { gzipSync } from 'node:zlib';
import { readOfferPvProfile, readOfferPvProfileWithSourceRevision, type OfferPvProfileInput } from './offer-pv-profile';

function fixture(overrides: Partial<OfferPvProfileInput> = {}): OfferPvProfileInput {
  return {
    latitude: 52.23,
    longitude: 21.01,
    powerKw: 0,
    tiltDegrees: 35,
    azimuthDegrees: 180,
    lossPercent: 14,
    fromUtc: '2026-03-29T00:00:00Z',
    untilUtc: '2026-03-29T05:00:00Z',
    ...overrides,
  };
}

function configuredRuntime(t: TestContext) {
  const previousToolsDir = process.env.ONREVOLT_PV_TOOLS_DIR;
  const previousPython = process.env.ONREVOLT_PV_PYTHON;
  const toolsDir = mkdtempSync(path.join(os.tmpdir(), 'offer-pv-profile-test-'));
  mkdirSync(path.join(toolsDir, 'pvgis-cache'), { recursive: true });
  for (const name of ['engine.py', 'solar_model.py', 'pvgis_data.py']) {
    writeFileSync(path.join(toolsDir, name), `# test fixture ${name}\n`, 'utf8');
  }
  process.env.ONREVOLT_PV_TOOLS_DIR = toolsDir;
  process.env.ONREVOLT_PV_PYTHON = process.execPath;
  t.after(() => {
    if (previousToolsDir === undefined) delete process.env.ONREVOLT_PV_TOOLS_DIR;
    else process.env.ONREVOLT_PV_TOOLS_DIR = previousToolsDir;
    if (previousPython === undefined) delete process.env.ONREVOLT_PV_PYTHON;
    else process.env.ONREVOLT_PV_PYTHON = previousPython;
  });
  return {
    toolsDir,
    addLocations(inputs: OfferPvProfileInput[]) {
      for (const input of inputs) {
        const format = (value: number) => Object.is(value, -0) ? '-0.000000' : value.toFixed(6);
        const base = path.join(toolsDir, 'pvgis-cache', `sarah3-v6-2020-2024-${format(input.latitude)}-${format(input.longitude)}`);
        const bytes = gzipSync(Buffer.from('fixture PVGIS data\n', 'utf8'));
        writeFileSync(`${base}.csv.gz`, bytes);
        writeFileSync(`${base}.csv.json`, JSON.stringify({
          source: 'PVGIS 6 / SARAH-3', period: '2020-2024', latitude: input.latitude, longitude: input.longitude,
          sha256: createHash('sha256').update(bytes).digest('hex'), fetchedAt: '2026-11-05T00:00:00Z',
        }), 'utf8');
      }
    },
  };
}

function installWorker(t: TestContext, options: {
  failFirst?: number;
  delayMs?: number;
  afterInput?: (input: OfferPvProfileInput) => void;
} = {}) {
  let calls = 0;
  const fakeSpawn = (() => {
    calls += 1;
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true,
    });
    let request = '';
    child.stdin.on('data', (chunk: Buffer) => { request += chunk.toString('utf8'); });
    child.stdin.once('finish', () => {
      const finish = () => {
        const failed = calls <= (options.failFirst ?? 0);
        let response = '';
        if (!failed) {
          const input = JSON.parse(request) as OfferPvProfileInput;
          options.afterInput?.(input);
          const startMs = Date.parse(input.fromUtc);
          const count = (Date.parse(input.untilUtc) - startMs) / 3600000;
          response = JSON.stringify({
            hours: Array.from({ length: count }, (_, index) => ({
              startUtc: new Date(startMs + index * 3600000).toISOString(),
              pvKwh: 1,
            })),
            source: 'PVGIS 6 / SARAH-3',
            model: 'Hay-Davies · Martin–Ruiz · Faiman · Huld (cSi 2025)',
            referencePeriod: '2020-2024',
          });
        }
        const code = failed ? 1 : 0;
        let ended = 0;
        const onEnd = () => {
          ended += 1;
          if (ended === 2) child.emit('close', code, null);
        };
        child.stdout.once('end', onEnd);
        child.stderr.once('end', onEnd);
        child.stdout.end(response);
        child.stderr.end(failed ? 'mock PV failure' : '');
      };
      if (options.delayMs) setTimeout(finish, options.delayMs);
      else setImmediate(finish);
    });
    return child as unknown as ReturnType<typeof childProcess.spawn>;
  }) as typeof childProcess.spawn;
  t.mock.method(childProcess, 'spawn', fakeSpawn);
  return { calls: () => calls };
}

function positiveFixture(overrides: Partial<OfferPvProfileInput> = {}): OfferPvProfileInput {
  return fixture({ powerKw: 5, latitude: 53.5, longitude: 20.5, ...overrides });
}

test('zero PV produces exact contiguous UTC hours without requiring Python configuration', async () => {
  const toolsDir = process.env.ONREVOLT_PV_TOOLS_DIR;
  const pythonPath = process.env.ONREVOLT_PV_PYTHON;
  delete process.env.ONREVOLT_PV_TOOLS_DIR;
  delete process.env.ONREVOLT_PV_PYTHON;
  try {
    const result = await readOfferPvProfile(fixture());
    assert.deepEqual(result.hours.map((hour) => hour.startUtc), [
      '2026-03-29T00:00:00.000Z',
      '2026-03-29T01:00:00.000Z',
      '2026-03-29T02:00:00.000Z',
      '2026-03-29T03:00:00.000Z',
      '2026-03-29T04:00:00.000Z',
    ]);
    assert.ok(result.hours.every((hour) => hour.pvKwh === 0));
    assert.equal(result.quality, 'MODELLED');
    assert.equal(result.measuredHistory, false);
    assert.equal(result.temporalBasis, 'zero-capacity');
  } finally {
    if (toolsDir !== undefined) process.env.ONREVOLT_PV_TOOLS_DIR = toolsDir;
    if (pythonPath !== undefined) process.env.ONREVOLT_PV_PYTHON = pythonPath;
  }
});

test('positive PV requires both explicitly configured runtime paths', async () => {
  const toolsDir = process.env.ONREVOLT_PV_TOOLS_DIR;
  const pythonPath = process.env.ONREVOLT_PV_PYTHON;
  process.env.ONREVOLT_PV_TOOLS_DIR = '';
  process.env.ONREVOLT_PV_PYTHON = '';
  try {
    await assert.rejects(readOfferPvProfile(fixture({ powerKw: 5 })), /ONREVOLT_PV_TOOLS_DIR/);
    process.env.ONREVOLT_PV_TOOLS_DIR = process.cwd();
    await assert.rejects(readOfferPvProfile(fixture({ powerKw: 5 })), /ONREVOLT_PV_PYTHON/);
  } finally {
    if (toolsDir === undefined) delete process.env.ONREVOLT_PV_TOOLS_DIR;
    else process.env.ONREVOLT_PV_TOOLS_DIR = toolsDir;
    if (pythonPath === undefined) delete process.env.ONREVOLT_PV_PYTHON;
    else process.env.ONREVOLT_PV_PYTHON = pythonPath;
  }
});

test('input bounds reject invalid geometry, UTC boundaries, and oversized periods', async () => {
  await assert.rejects(readOfferPvProfile(fixture({ latitude: 91 })), /latitude/);
  await assert.rejects(readOfferPvProfile(fixture({ powerKw: 0.0005 })), /co najmniej 0,001/);
  await assert.rejects(readOfferPvProfile(fixture({ fromUtc: '2026-03-29T00:30:00Z' })), /pełną godzinę UTC/);
  await assert.rejects(readOfferPvProfile(fixture({ fromUtc: '0000-01-01T00:00:00Z' })), /Nieprawidłowa data UTC/);
  await assert.rejects(readOfferPvProfile(fixture({ untilUtc: '2027-03-31T00:00:00Z' })), /366 dni/);
});

test('identical in-flight PV requests share work and cache cloned successful results', async (t) => {
  const runtime = configuredRuntime(t);
  const worker = installWorker(t, { delayMs: 15 });
  const input = positiveFixture({ latitude: 53.5001 });
  runtime.addLocations([input]);

  const [first, second] = await Promise.all([readOfferPvProfile(input), readOfferPvProfile(input)]);
  assert.equal(worker.calls(), 1);
  assert.notStrictEqual(first, second);
  first.hours[0].pvKwh = 99;
  assert.equal(second.hours[0].pvKwh, 1);

  const cached = await readOfferPvProfile(input);
  assert.equal(worker.calls(), 1);
  assert.equal(cached.hours[0].pvKwh, 1);
});

test('identical cold-cache PV requests share one worker and return its established source revision', async (t) => {
  const runtime = configuredRuntime(t);
  const worker = installWorker(t, { delayMs: 15, afterInput: input => runtime.addLocations([input]) });
  const input = positiveFixture({ latitude: 53.50015 });

  const [first, second] = await Promise.all([
    readOfferPvProfileWithSourceRevision(input),
    readOfferPvProfileWithSourceRevision(input),
  ]);
  assert.equal(worker.calls(), 1);
  assert.match(first.sourceRevision || '', /^[a-f0-9]{64}$/u);
  assert.equal(second.sourceRevision, first.sourceRevision);
  assert.notStrictEqual(first.profile, second.profile);

  await readOfferPvProfileWithSourceRevision(input);
  assert.equal(worker.calls(), 1);
});

test('failed PV subprocesses are retried and never cached', async (t) => {
  const runtime = configuredRuntime(t);
  const worker = installWorker(t, { failFirst: 1 });
  const input = positiveFixture({ latitude: 53.5002 });
  runtime.addLocations([input]);

  await assert.rejects(readOfferPvProfile(input), /mock PV failure/);
  const result = await readOfferPvProfile(input);
  assert.equal(result.hours[0].pvKwh, 1);
  assert.equal(worker.calls(), 2);
  await readOfferPvProfile(input);
  assert.equal(worker.calls(), 2);
});

test('changed PV model source creates a distinct in-memory profile cache entry', async (t) => {
  const runtime = configuredRuntime(t);
  const worker = installWorker(t);
  const input = positiveFixture({ latitude: 53.5003 });
  runtime.addLocations([input]);

  await readOfferPvProfile(input);
  writeFileSync(path.join(runtime.toolsDir, 'engine.py'), '# changed model fixture\n', 'utf8');
  await readOfferPvProfile(input);
  assert.equal(worker.calls(), 2);
});

test('successful profile cache is LRU-bounded to 16 entries and expires after one hour', async (t) => {
  const runtime = configuredRuntime(t);
  const now = { value: Date.now() };
  t.mock.method(Date, 'now', () => now.value);
  const worker = installWorker(t);
  const inputs = Array.from({ length: 17 }, (_, index) => positiveFixture({ longitude: 20.6 + index / 1000 }));
  runtime.addLocations(inputs);

  for (const input of inputs) await readOfferPvProfile(input);
  assert.equal(worker.calls(), 17);
  await readOfferPvProfile(inputs[0]);
  assert.equal(worker.calls(), 18);
  await readOfferPvProfile(inputs[1]);
  assert.equal(worker.calls(), 19);

  now.value += 60 * 60 * 1000;
  await readOfferPvProfile(inputs[0]);
  assert.equal(worker.calls(), 20);
});

test('distinct simultaneous PV requests are bounded to 16 subprocesses', async (t) => {
  const runtime = configuredRuntime(t);
  const worker = installWorker(t, { delayMs: 20 });
  const inputs = Array.from({ length: 16 }, (_, index) => positiveFixture({ longitude: 22 + index / 1000 }));
  runtime.addLocations(inputs);
  const pending = inputs.map((input) => readOfferPvProfile(input));

  assert.equal(worker.calls(), 16);
  await assert.rejects(readOfferPvProfile(positiveFixture({ longitude: 23 })), /limit 16/);
  await Promise.all(pending);
});
