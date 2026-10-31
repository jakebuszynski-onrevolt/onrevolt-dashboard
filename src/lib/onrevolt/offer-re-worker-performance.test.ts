import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { OFFER_RE_ENGINE_SHA256, prepareOfferReInput, type OfferReInput } from './offer-re-adapter';

const projectRoot = process.cwd();
const runnerPath = path.join(projectRoot, 'scripts', 'run-offer-re.cjs');
const enginePath = path.join(projectRoot, 'integrations', 're', 'offer-runtime', 'prosumer-engine.js');
const intrinsicNames = ['Math', 'Number', 'Object', 'Array', 'String', 'Boolean', 'Date', 'JSON', 'Map', 'Set'];
const intrinsicList = intrinsicNames.join(', ');

function hash(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function productionWrapperBlock(lineEnding = '\n') {
  const declaration = '    const scopedCode = `(function(' + intrinsicList + ') {\\n${code}\\n})(' + intrinsicList + ');`;';
  return `${declaration}${lineEnding}    vm.runInContext(scopedCode, context, { filename: enginePath, timeout: 3000 });`;
}

function createRunnerFixture(root: string, runnerSource: string, engineSource?: string) {
  const fixtureRunner = path.join(root, 'scripts', 'run-offer-re.cjs');
  const fixtureEngine = path.join(root, 'integrations', 're', 'offer-runtime', 'prosumer-engine.js');
  mkdirSync(path.dirname(fixtureRunner), { recursive: true });
  mkdirSync(path.dirname(fixtureEngine), { recursive: true });
  writeFileSync(fixtureRunner, runnerSource, 'utf8');
  if (engineSource === undefined) copyFileSync(enginePath, fixtureEngine);
  else writeFileSync(fixtureEngine, engineSource, 'utf8');
  return fixtureRunner;
}

function workerEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    TZ: 'Europe/Warsaw',
    ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
  };
}

function runRunner(pathToRunner: string, cwd: string, inputJson: string) {
  return spawnSync(process.execPath, [pathToRunner], {
    cwd,
    env: workerEnvironment(),
    input: inputJson,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 135000,
    windowsHide: true,
  });
}

function removeTempFixture(root: string) {
  const tempRoot = path.resolve(os.tmpdir());
  const fixtureRoot = path.resolve(root);
  const relative = path.relative(tempRoot, fixtureRoot);
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'fixture cleanup path must remain inside the OS temp directory');
  rmSync(fixtureRoot, { recursive: true, force: true });
}

type FixtureOptions = {
  startUtc: string;
  minutes: 15 | 60;
  count: number;
  capacityKwh: number;
  initialSocKwh: number;
  initialDepositPln: number;
  socStepKwh: number;
  withPv: boolean;
};

function makeInput(options: FixtureOptions): OfferReInput {
  const start = Date.parse(options.startUtc);
  const durationHours = options.minutes / 60;
  return {
    settlement: 'NET_BILLING',
    initialSocKwh: options.initialSocKwh,
    initialDepositPln: options.initialDepositPln,
    socStepKwh: options.socStepKwh,
    battery: {
      capacityKwh: options.capacityKwh,
      reserveKwh: options.capacityKwh === 0 ? 0 : options.capacityKwh * 0.2,
      maxChargeKw: options.capacityKwh === 0 ? 0 : 2.5,
      maxDischargeKw: options.capacityKwh === 0 ? 0 : 2,
      chargeEfficiency: 0.92,
      dischargeEfficiency: 0.94,
    },
    intervals: Array.from({ length: options.count }, (_, index) => {
      const hour = Math.floor((index * options.minutes) % 1440 / 60);
      const solarShape = Math.max(0, Math.sin(Math.PI * (hour - 7) / 11));
      return {
        startUtc: new Date(start + index * options.minutes * 60000).toISOString(),
        endUtc: new Date(start + (index + 1) * options.minutes * 60000).toISOString(),
        demandKwh: (hour < 6 ? 0.55 : hour >= 18 ? 1.05 : 0.75) * durationHours,
        pvKwh: options.withPv && hour >= 7 && hour <= 18 ? 2.4 * solarShape * durationHours : 0,
        energyBuyPrice: hour < 6 ? 0.16 : hour < 16 ? 0.42 : 0.91,
        distributionBuyPrice: 0.17,
        sellPrice: hour >= 10 && hour < 16 ? 0.28 : 0.19,
      };
    }),
  };
}

test('zoptymalizowany worker zachowuje bajtowo identyczny wynik runnera sprzed optymalizacji', () => {
  const runnerSource = readFileSync(runnerPath, 'utf8');
  const wrapperBlock = productionWrapperBlock(runnerSource.includes('\r\n') ? '\r\n' : '\n');
  assert.ok(runnerSource.includes(wrapperBlock), 'produkcyjny wrapper ma oczekiwaną, dokładną postać');

  const referenceBlock = '    vm.runInContext(code, context, { filename: enginePath, timeout: 3000 });';
  const referenceRunner = runnerSource.replace(wrapperBlock, referenceBlock);
  assert.notEqual(referenceRunner, runnerSource, 'referencja powstaje przez zastąpienie wrappera');
  assert.equal(referenceRunner.includes('scopedCode'), false);

  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'offer-re-reference-'));
  try {
    const referenceRunnerPath = createRunnerFixture(fixtureRoot, referenceRunner);
    const scenarios: Array<{ name: string; options: FixtureOptions; daySlots?: number[] }> = [
      {
        name: 'hourly, bez PV, zerowy magazyn',
        options: { startUtc: '2026-01-01T23:00:00Z', minutes: 60, count: 48, capacityKwh: 0,
          initialSocKwh: 0, initialDepositPln: 0, socStepKwh: 0.25, withPv: false },
      },
      {
        name: 'hourly, PV, niezerowy SOC i depozyt, 2 kWh',
        options: { startUtc: '2026-01-01T23:00:00Z', minutes: 60, count: 48, capacityKwh: 2,
          initialSocKwh: 1, initialDepositPln: 83.5, socStepKwh: 0.5, withPv: true },
      },
      {
        name: '15 minut, bez PV, 4 kWh',
        options: { startUtc: '2026-01-01T23:00:00Z', minutes: 15, count: 192, capacityKwh: 4,
          initialSocKwh: 2, initialDepositPln: 0, socStepKwh: 1, withPv: false },
      },
      {
        name: '15 minut, PV, niezerowy SOC i depozyt, 8 kWh',
        options: { startUtc: '2026-01-01T23:00:00Z', minutes: 15, count: 192, capacityKwh: 8,
          initialSocKwh: 4, initialDepositPln: 120.25, socStepKwh: 2, withPv: true },
      },
      {
        name: 'wiosenna zmiana czasu, 23+24 godziny',
        options: { startUtc: '2026-03-28T23:00:00Z', minutes: 60, count: 47, capacityKwh: 2,
          initialSocKwh: 1, initialDepositPln: 23, socStepKwh: 1, withPv: false },
        daySlots: [23, 24],
      },
      {
        name: 'jesienna zmiana czasu, 25+24 godziny',
        options: { startUtc: '2026-10-24T22:00:00Z', minutes: 60, count: 49, capacityKwh: 2,
          initialSocKwh: 1, initialDepositPln: 41, socStepKwh: 1, withPv: false },
        daySlots: [25, 24],
      },
    ];

    for (const scenario of scenarios) {
      const prepared = prepareOfferReInput(makeInput(scenario.options));
      if (scenario.daySlots) assert.deepEqual(prepared.days.map((day) => day.slots.length), scenario.daySlots, scenario.name);
      const payload = JSON.stringify(prepared);
      const optimized = runRunner(runnerPath, projectRoot, payload);
      const reference = runRunner(referenceRunnerPath, fixtureRoot, payload);
      assert.equal(optimized.error, undefined, `${scenario.name}: ${optimized.error?.message ?? ''}`);
      assert.equal(reference.error, undefined, `${scenario.name}: ${reference.error?.message ?? ''}`);
      assert.equal(optimized.status, 0, `${scenario.name}: ${optimized.stderr.toString('utf8')}`);
      assert.equal(reference.status, 0, `${scenario.name}: ${reference.stderr.toString('utf8')}`);
      assert.equal(optimized.stderr.length, 0, `${scenario.name}: optimized worker stderr`);
      assert.equal(reference.stderr.length, 0, `${scenario.name}: reference worker stderr`);
      assert.ok(optimized.stdout.equals(reference.stdout),
        `${scenario.name}: output bytes differ (optimized ${hash(optimized.stdout)}, reference ${hash(reference.stdout)})`);
    }
  } finally {
    removeTempFixture(fixtureRoot);
  }
});

test('silnik zachowuje intrinsics własnego VM i brak dostępu do procesu, require oraz code generation', () => {
  const runnerSource = readFileSync(runnerPath, 'utf8');
  const engineSource = readFileSync(enginePath, 'utf8');
  const wrapperBlock = productionWrapperBlock(runnerSource.includes('\r\n') ? '\r\n' : '\n');
  assert.equal(hash(engineSource), OFFER_RE_ENGINE_SHA256);
  assert.ok(runnerSource.includes(`const expectedHash = '${OFFER_RE_ENGINE_SHA256}';`));
  assert.ok(runnerSource.includes("vm.createContext({ window: {} }, { codeGeneration: { strings: false, wasm: false } })"));
  assert.ok(runnerSource.includes(wrapperBlock));

  const context = vm.createContext({ window: {} }, { codeGeneration: { strings: false, wasm: false } });
  const wrappedEngine = `(function(${intrinsicList}) {\n${engineSource}\nwindow.__boundIntrinsics = [${intrinsicList}];\n})(${intrinsicList});`;
  vm.runInContext(wrappedEngine, context, { filename: enginePath, timeout: 3000 });

  const globalIntrinsics = vm.runInContext(`[${intrinsicList}]`, context) as unknown[];
  const boundIntrinsics = vm.runInContext('window.__boundIntrinsics', context) as unknown[];
  const hostIntrinsics = [Math, Number, Object, Array, String, Boolean, Date, JSON, Map, Set];
  assert.equal(boundIntrinsics.length, intrinsicNames.length);
  for (const [index, name] of intrinsicNames.entries()) {
    assert.strictEqual(boundIntrinsics[index], globalIntrinsics[index], `${name} binding comes from the VM`);
    assert.notStrictEqual(boundIntrinsics[index], hostIntrinsics[index], `${name} is not the host intrinsic`);
  }
  assert.equal(vm.runInContext('typeof process', context), 'undefined');
  assert.equal(vm.runInContext('typeof require', context), 'undefined');
  assert.throws(() => vm.runInContext('Function("return 1")()', context), /Code generation from strings disallowed/);
  assert.throws(() => vm.runInContext('eval("1 + 1")', context), /Code generation from strings disallowed/);
});

test('runner odrzuca zmieniony silnik w odizolowanym katalogu fixture', () => {
  const runnerSource = readFileSync(runnerPath, 'utf8');
  const engineSource = readFileSync(enginePath, 'utf8');
  assert.equal(hash(engineSource), OFFER_RE_ENGINE_SHA256);
  const tamperedEngine = engineSource.replace('DashboardProsumerEngine', 'DashboardProsumerEnginX');
  assert.notEqual(hash(tamperedEngine), OFFER_RE_ENGINE_SHA256);

  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'offer-re-tampered-'));
  try {
    const fixtureRunnerPath = createRunnerFixture(fixtureRoot, runnerSource, tamperedEngine);
    const result = runRunner(fixtureRunnerPath, fixtureRoot, '{}');
    assert.equal(result.error, undefined, result.error?.message ?? 'subprocess launch failed');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr.toString('utf8'), /Zmieniła się przypięta wersja silnika RE/);
  } finally {
    removeTempFixture(fixtureRoot);
  }
});
