import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as XLSX from 'xlsx';

const repository = path.resolve(__dirname, '../../..');
const preparePath = path.join(repository, 'scripts/prepare-re-consumption-assets.ts');
const enginePath = path.join(repository, 'public/shared/re-consumption-engine.js');
const canonicalPath = process.env.RE_CONSUMPTION_CANONICAL_SOURCE ||
  path.join(repository, '_workspace-artifacts/re-profile-20260909/baseline/my.onrevolt.com/re/js/scripts.js');
const sourceRoot = path.resolve(path.dirname(canonicalPath), '../..');
const requiredAssets = ['re/js/scripts.js', 'js/scripts.js', 'index.html', 're/index.php',
  're/GetRe_site.php', 'api/dashboard.php', 're/setup_func.php'];
const parityOptions = {
  skip: requiredAssets.some(relative => !existsSync(path.join(sourceRoot, relative))) &&
    'Immutable original RE baseline is unavailable; set RE_CONSUMPTION_CANONICAL_SOURCE to an original, unwrapped re/js/scripts.js.',
};
const fill = (value: number) => new Array(24).fill(value);
const sources = (value: string) => new Array(12).fill(value);
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const approx = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10,
  `${actual} != ${expected}`);

type Generated = { originals: Map<string, string>; output: Map<string, string> };
let generated: Generated;

function generateAssets(overrides: Record<string, string> = {}): Generated {
  const originals = new Map(requiredAssets.map(relative => [relative,
    overrides[relative] ?? readFileSync(path.join(sourceRoot, relative), 'utf8')]));
  const output = new Map<string, string>();
  const virtualOutput = path.join(repository, '__virtual_re_consumption_assets__');
  const virtualRead = (filename: string) => {
    if (path.resolve(filename) === enginePath) return readFileSync(enginePath, 'utf8');
    const relative = path.relative(sourceRoot, filename).split(path.sep).join('/');
    assert.ok(originals.has(relative), `Unexpected generator read: ${filename}`);
    return originals.get(relative);
  };
  const virtualWrite = (filename: string, contents: string) => {
    const relative = path.relative(virtualOutput, filename).split(path.sep).join('/');
    assert.ok(relative && !relative.startsWith('../') && !path.isAbsolute(relative),
      `Unexpected generator write: ${filename}`);
    output.set(relative, contents);
  };
  const script = ts.transpileModule(readFileSync(preparePath, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: preparePath,
  }).outputText;
  const context = vm.createContext({
    exports: {},
    process: { argv: ['node', preparePath, `--source-root=${sourceRoot}`, `--output=${virtualOutput}`] },
    console: { log() {} },
    require: (name: string) => {
      if (name === 'typescript') return ts;
      if (name === 'node:path') return { ...path, resolve: (...parts: string[]) => path.resolve(repository, ...parts) };
      if (name === 'node:fs') return {
        readFileSync: virtualRead, writeFileSync: virtualWrite, mkdirSync() {},
        copyFileSync: (from: string, to: string) => virtualWrite(to, virtualRead(from)),
      };
      throw new Error(`Unexpected generator import: ${name}`);
    },
  });
  // Execute the real preparation program; every filesystem write stays in memory.
  new vm.Script(script, { filename: preparePath }).runInContext(context, { timeout: 10000 });
  return { originals, output };
}

function assets() {
  return generated ??= generateAssets();
}

function runPhp(program: string) {
  return execFileSync(process.env.ONREVOLT_PHP_BIN?.trim() || 'php', [], {
    input: `<?php\n${program}`, encoding: 'utf8', windowsHide: true,
  });
}

function phpFunctions(source: string, names: string[]): Record<string, string> {
  const encodedSource = Buffer.from(source).toString('base64');
  const encodedNames = Buffer.from(JSON.stringify(names)).toString('base64');
  return JSON.parse(runPhp(`
$tokens = token_get_all(base64_decode('${encodedSource}'));
$names = json_decode(base64_decode('${encodedNames}'), true);
$functions = [];
for ($i = 0; $i < count($tokens); $i++) {
    if (!is_array($tokens[$i]) || $tokens[$i][0] !== T_FUNCTION) continue;
    $n = $i + 1;
    while (is_array($tokens[$n]) && $tokens[$n][0] === T_WHITESPACE) $n++;
    if (!is_array($tokens[$n]) || !in_array($tokens[$n][1], $names, true)) continue;
    $name = $tokens[$n][1];
    $text = ''; $depth = 0; $opened = false;
    for ($j = $i; $j < count($tokens); $j++) {
        $token = $tokens[$j];
        $text .= is_array($token) ? $token[1] : $token;
        if ($token === '{') { $depth++; $opened = true; }
        if ($token === '}') $depth--;
        if ($opened && $depth === 0) break;
    }
    $functions[$name] = $text;
}
if (count($functions) !== count($names)) throw new RuntimeException('Missing selected PHP function');
echo json_encode($functions, JSON_THROW_ON_ERROR);
`));
}

const parserNames = [
  'usage_profile_year', 'usage_days_in_month', 'xlsx_col_index', 'xlsx_open_archive',
  'xlsx_archive_get', 'xlsx_shared_strings', 'xlsx_first_sheet_path', 'xlsx_cell_value', 'xlsx_row_values',
  'parse_osd_xlsx_datetime', 'parse_osd_xlsx_number', 'osd_xlsx_days_in_month',
  'osd_xlsx_fallback_transition', 'osd_xlsx_period_start', 'osd_xlsx_is_missing_dst_hour',
  'osd_xlsx_fill_missing_dst_hour', 'osd_xlsx_is_repeated_dst_hour', 'is_osd_xlsx_data_status',
  'parse_osd_consumption_xlsx',
];
const parserDeclarations = new Map<boolean, string>();

function parseOsdFixture(rows: unknown[][], original = false) {
  if (!parserDeclarations.has(original)) {
    const source = (original ? assets().originals : assets().output).get('re/setup_func.php');
    parserDeclarations.set(original, Object.values(phpFunctions(source, parserNames)).join('\n'));
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Pomiar');
  const bytes: Buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const declarations = Buffer.from(parserDeclarations.get(original)).toString('base64');
  // Only selected declarations run; the endpoint bootstrap, credentials and DB functions never execute.
  return JSON.parse(runPhp(`
eval(base64_decode('${declarations}'));
$file = tmpfile();
if ($file === false) throw new RuntimeException('Cannot create synthetic workbook');
try {
    fwrite($file, base64_decode('${bytes.toString('base64')}'));
    $parsed = parse_osd_consumption_xlsx(stream_get_meta_data($file)['uri']);
    echo json_encode(['parsed'=>$parsed], JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    echo json_encode(['error'=>$e->getMessage()], JSON_THROW_ON_ERROR);
} finally {
    fclose($file);
}
`));
}

function osdMonthRows(month: number, direction = 'import', year = 2025): unknown[][] {
  const header = direction === 'import' ? 'Energia czynna pobrana po bilansowaniu' : 'Energia czynna oddana po bilansowaniu';
  const rows: unknown[][] = [['Dzień', header, 'Status']];
  const first = Date.UTC(year, month - 1, 1, 1);
  const last = Date.UTC(year, month, 1);
  for (let timestamp = first; timestamp <= last; timestamp += 3600000) {
    const date = new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
    rows.push([date, 0.3, 'Dane rzeczywiste']);
  }
  return rows;
}

function octoberRows(direction: string): unknown[][] {
  const rows = osdMonthRows(10, direction);
  const repeated = rows.findIndex(row => row[0] === '2025-10-26 03:00:00');
  rows[repeated][1] = direction === 'import' ? 0.195 : 0;
  rows.splice(repeated + 1, 0, ['2025-10-26 03:00:00 czasu zimowego', 0.214, 'Dane rzeczywiste']);
  const expectedWh = direction === 'import' ? 256906 : 274958;
  const actualWh = rows.slice(1).reduce((sum, row) => sum + Math.round(Number(row[1]) * 1000), 0);
  rows[1][1] = (300 + expectedWh - actualWh) / 1000;
  rows.push(['Suma', expectedWh / 1000, '']);
  return rows;
}

let setupDeclarations: Record<string, string>;
function setupFunctions() {
  return setupDeclarations ??= phpFunctions(assets().output.get('re/setup_func.php'), [
    'with_user_consumption_lock', 'save_user_consumption_xlsx', 'save_user_consumption_profile', 'normalize_user_station',
    'user_consumption_source_columns', 'user_consumption_export_source_columns', 'normalize_usage_source',
    'user_consumption_columns', 'normalize_consumption_months', 'normalize_consumption_sources',
  ]);
}

function phpConcurrencyFixture(body: string) {
  const declarations = Buffer.from(Object.values(setupFunctions()).join('\n')).toString('base64');
  return JSON.parse(runPhp(`
eval(base64_decode('${declarations}'));
$store = []; $trace = []; $parsed = []; $yieldSnapshot = null;
function profile() { return ['months'=>array_fill(0, 12, 100.0), 'sources'=>array_fill(0, 12, 'standard'), 'exportSources'=>array_fill(0, 12, 'standard')]; }
class FixturePdo extends PDO {
    public static array $locks = [];
    public string $lockName = '';
    public bool $failAcquire = false;
    public function __construct(public string $id) {}
    public function prepare(string $query, array $options = []): PDOStatement|false { return new FixtureStatement($this, $query); }
}
class FixtureStatement extends PDOStatement {
    private mixed $result = null;
    public function __construct(private FixturePdo $pdo, private string $sql) {}
    public function execute(?array $params = null): bool {
        $pdo = $this->pdo;
        if (str_starts_with($this->sql, 'SELECT GET_LOCK(')) {
            if ($pdo->failAcquire) { $this->result = 0; return true; }
            while (isset(FixturePdo::$locks[$params[0]]) && FixturePdo::$locks[$params[0]] !== $pdo->id) Fiber::suspend('waiting');
            FixturePdo::$locks[$params[0]] = $pdo->id;
            $pdo->lockName = $params[0];
            $GLOBALS['trace'][] = [$pdo->id, 'acquire'];
            $this->result = 1;
        } elseif (str_starts_with($this->sql, 'SELECT RELEASE_LOCK(')) {
            if ((FixturePdo::$locks[$params[0]] ?? null) !== $pdo->id) throw new RuntimeException('Wrong lock owner');
            unset(FixturePdo::$locks[$params[0]]);
            $GLOBALS['trace'][] = [$pdo->id, 'release'];
            $this->result = 1;
        } elseif (str_starts_with($this->sql, 'SELECT ') && str_contains($this->sql, 'FROM EnergyMeter_users_data WHERE station=? AND data_type=?')) {
            if ((FixturePdo::$locks[$pdo->lockName] ?? null) !== $pdo->id) throw new RuntimeException('Conflict read without lock');
            if ($params[1] !== 'consumption_profile') throw new RuntimeException('Wrong profile type');
            $GLOBALS['trace'][] = [$pdo->id, 'check'];
            if (!isset($GLOBALS['store'][$params[0]])) { $this->result = false; return true; }
            $current = $GLOBALS['store'][$params[0]];
            $this->result = [];
            foreach (user_consumption_columns() as $index => $column) $this->result[$column] = $current['months'][$index];
            foreach (user_consumption_source_columns() as $index => $column) $this->result[$column] = $current['sources'][$index];
            foreach (user_consumption_export_source_columns() as $index => $column) $this->result[$column] = $current['exportSources'][$index];
        } else throw new RuntimeException('Unexpected SQL in isolated fixture');
        return true;
    }
    public function fetchColumn(int $column = 0): mixed { return $this->result; }
    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $cursorOrientation = PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed { return $this->result; }
}
function assert_user_station_exists(PDO $pdo, string $station): void {}
function parse_osd_consumption_xlsx(string $path): array { return $GLOBALS['parsed'][$path]; }
function load_existing_or_default_consumption_profile(PDO $pdo, string $station): array {
    $GLOBALS['trace'][] = [$pdo->id, 'load'];
    $p = $GLOBALS['store'][$station] ?? profile();
    if ($GLOBALS['yieldSnapshot'] === $pdo->id) { $GLOBALS['yieldSnapshot'] = null; Fiber::suspend('snapshot'); }
    return [$p['months'], $p['sources'], $p['exportSources']];
}
function writing(PDO $pdo): void {
    if ((FixturePdo::$locks[$pdo->lockName] ?? null) !== $pdo->id) throw new RuntimeException('Write without lock');
    $GLOBALS['trace'][] = [$pdo->id, 'write'];
}
function upsert_user_consumption_profile_row(PDO $pdo, string $station, array $months, array $sources): void {
    writing($pdo); $GLOBALS['store'][$station] ??= profile();
    $GLOBALS['store'][$station]['months'] = $months; $GLOBALS['store'][$station]['sources'] = $sources;
}
function upsert_user_consumption_export_sources(PDO $pdo, string $station, array $sources): void {
    writing($pdo); $GLOBALS['store'][$station]['exportSources'] = $sources;
}
function save_user_annual_usage_kwh(PDO $pdo, string $station, float $annual): void { writing($pdo); }
function save_user_usage_hourly_month(PDO $pdo, string $station, int $month, array $rows, string $source, ?int $year = null, string $direction = 'import'): void { writing($pdo); }
function rebuild_user_usage_hourly_from_months(PDO $pdo, string $station, array $months, array $sources): void { writing($pdo); }
function load_user_consumption_profile(PDO $pdo, string $station): array { return $GLOBALS['store'][$station] ?? profile(); }
function workbook(string $id, string $direction, int $month, float $total): array {
    $GLOBALS['parsed'][$id] = ['channels'=>[$direction=>['month'=>$month, 'totalKwh'=>$total, 'sourceYear'=>2026, 'hours'=>[]]]];
    return ['error'=>UPLOAD_ERR_OK, 'tmp_name'=>$id];
}
${body}
`));
}

function sourceFile(source: string) {
  return ts.createSourceFile('trusted-re.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function namedFunctions(source: string, names: string[], nested = false) {
  const ast = sourceFile(source);
  const found = new Map<string, ts.FunctionDeclaration[]>();
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) {
      found.set(node.name.text, [...(found.get(node.name.text) || []), node]);
    }
    if (nested || node === ast) node.forEachChild(visit);
  }
  visit(ast);
  return names.map(name => {
    const declarations = found.get(name) || [];
    assert.equal(declarations.length, 1, `Expected exactly one trusted function ${name}`);
    return declarations[0].getText(ast);
  }).join('\n\n');
}

const calculationFunctions = [
  'parseUsageKWh', 'normalizeMonthlyUsageProfile', 'normalizeUsageSource', 'normalizeUsageSources',
  'getAnnualUsageInput', 'getAnnualUsageKWh', 'reUsageDateKey', 'getUsageProfileMonthIndex',
  'currentUsageMonthExportSources', 'hasUsageExportProfileForDay', 'getCurrentPvKwp',
  'getProfilePvOffsetForDate', 'getMonthDayHourKey', 'getProfilePvLookup', 'getProfilePvPatternRow',
  'getProfilePvKWhForHour', 'getHourlyUsageProfileForDay', 'assertUsageHourlyProfileIsHealthy',
  'getUsageProfileYear', 'getDaysInYear', 'getDaysInMonthForProfile', 'currentUsageMonthSources',
  'getReActualDay', 'buildHourlyUseForDay',
  'reActualNumber', 'reActualFirstNumber', 'reActualDateKey', 'reActualDayKeyFromRecord',
  'reActualHourFromQuarter', 'createReActualHour', 'createReActualDay', 'addReActualQuarterValue',
  'applyReActualUsageRecord', 'applyReActualPvRecord', 'applyReActualStorageRecord',
  'isCompleteReActualRecord', 'getReActualCutoff', 'trimReActualRecordToCutoff',
  'buildReActualHourlyMapFromPayload', 'buildReUsageForecastModel',
];

type Fixture = {
  dayKey?: string;
  profileKey?: string;
  imports?: number[] | null;
  exports?: number[] | null;
  pvRows?: Array<[string, number]>;
  pvWatts?: number;
  source?: string;
  exportSource?: string;
  monthly?: number[] | null;
  learned?: number[] | null;
  actualDay?: { isComplete: boolean; hours: Array<{ use: number; hasUse: boolean }> };
  profileError?: string;
};

function runtime(wrapped: boolean, fixture: Fixture = {}) {
  const { originals, output } = assets();
  const dayKey = fixture.dayKey ?? '2026-07-12';
  const profileKey = fixture.profileKey ?? dayKey;
  const moduleSource = output.get('re/js/re-consumption-engine.js');
  const context = vm.createContext({
    Date,
    START: `${dayKey.slice(0, 4)}-01-01T00:00:00`,
    usage: { value: '8760' },
    pvInp: { value: String(fixture.pvWatts ?? 4000) },
    document: { getElementById: () => null },
    usageMonthlyProfileKWh: fixture.monthly ?? null,
    usageMonthlySources: sources(fixture.source ?? 'xlsx'),
    usageMonthlyExportSources: sources(fixture.exportSource ?? 'xlsx'),
    usageHourlyByDay: new Map(fixture.imports === null ? [] : [[profileKey, fixture.imports ?? fill(1)]]),
    usageExportHourlyByDay: new Map(fixture.exports === null ? [] : [[profileKey, fixture.exports ?? fill(2)]]),
    usageHourlyPatternByMonthDay: new Map([[profileKey.slice(5), profileKey]]),
    reActualHourlyByDay: new Map(fixture.actualDay ? [[dayKey, fixture.actualDay]] : []),
    reUsageForecastModel: fixture.learned ? { monthlyHours: Array.from({ length: 12 }, () => fixture.learned) } : null,
    reUsageProfileError: fixture.profileError ?? '',
    profilePvLookupSource: null,
    profilePvLookupByMonthDayHour: null,
    pv: fixture.pvRows ?? fill(0).map((_, hour) => [`${profileKey} ${String(hour).padStart(2, '0')}:00:00`,
      hour >= 8 && hour <= 17 ? 1000 : 0]),
    pvK: (irradiance: number, kwp: number) => irradiance * kwp * 1.05 / 1000,
  });
  context.window = context;
  new vm.Script(moduleSource, { filename: 'generated-re-consumption-engine.js' }).runInContext(context);
  context.USE24 = context.ReConsumptionEngine.DEFAULT_HOURLY_PERCENT;
  const source = (wrapped ? output : originals).get('re/js/scripts.js');
  // Execute only explicitly named declarations from the trusted RE source, never its DOM boot code.
  new vm.Script(namedFunctions(source, calculationFunctions), { filename: wrapped ? 'generated-re-functions.js' : 'original-re-functions.js' })
    .runInContext(context, { timeout: 5000 });
  const calls: Array<{ name: string; args: any[] }> = [];
  const api = context.ReConsumptionEngine;
  context.ReConsumptionEngine = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name,
    typeof fn === 'function' ? (...args: any[]) => {
      assert.ok(calls.length < 50, 'Unexpected recursive engine delegation');
      calls.push({ name, args });
      return (fn as Function)(...args);
    } : fn]));
  let pvCalls = 0;
  const readPv = context.getProfilePvKWhForHour;
  context.getProfilePvKWhForHour = (...args: any[]) => { pvCalls += 1; return readPv(...args); };
  return { context, calls, get pvCalls() { return pvCalls; } };
}

function buildDay(state: ReturnType<typeof runtime>, dayKey = '2026-07-12', options: object = {}) {
  return plain(state.context.buildHourlyUseForDay(dayKey, 8760, undefined, options));
}

test('legacy generator changes only the four calculation declarations and copies identical UMD bytes', parityOptions, () => {
  const { originals, output } = assets();
  assert.deepEqual([...output.keys()].sort(), [...requiredAssets, 're/js/re-consumption-engine.js'].sort());
  assert.equal(output.get('re/js/re-consumption-engine.js'), readFileSync(enginePath, 'utf8'));
  const changed = ['buildReActualHourlyMapFromPayload', 'buildReUsageForecastModel',
    'buildHourlyUseForDay', 'getHourlyUsageProfileForDay'];
  function withoutChanged(source: string) {
    const text = source.replace(/\r\n/g, '\n');
    const ast = sourceFile(text);
    return ast.statements.filter(node => ts.isFunctionDeclaration(node) && changed.includes(node.name?.text))
      .sort((left, right) => right.pos - left.pos)
      .reduce((result, node) => result.slice(0, node.getStart(ast)) + '/* calculation */' + result.slice(node.end), text);
  }
  assert.equal(withoutChanged(output.get('re/js/scripts.js')), withoutChanged(originals.get('re/js/scripts.js')));
});

for (const relative of ['re/index.php', 're/GetRe_site.php']) {
test(`legacy ${relative} loads the same browser UMD synchronously before its RE wrappers`, parityOptions, () => {
  const index = assets().output.get(relative);
  const tags = [...index.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)><\/script>/g)];
  const engineTags = tags.filter(tag => tag[2].startsWith('js/re-consumption-engine.js?'));
  const wrapperTags = tags.filter(tag => tag[2].startsWith('js/scripts.js?'));
  assert.equal(engineTags.length, 1);
  assert.equal(wrapperTags.length, 1);
  assert.ok(engineTags[0].index < wrapperTags[0].index);
  for (const tag of [...engineTags, ...wrapperTags]) assert.doesNotMatch(tag[1] + tag[3], /\b(async|defer|type)\b/);
  assert.equal(engineTags[0][2].split('?')[1], wrapperTags[0][2].split('?')[1]);
  const state = runtime(true);
  assert.equal(typeof state.context.ReConsumptionEngine.resolveDay, 'function');
  assert.deepEqual(buildDay(state), buildDay(runtime(false)));
});
}

test('legacy dashboard index changes only its main script cache key to the shared engine version', parityOptions, () => {
  const { originals, output } = assets();
  const tag = /<script src="js\/scripts\.js\?v=[^"]+"><\/script>/g;
  const before = originals.get('index.html');
  const after = output.get('index.html');
  assert.equal([...after.matchAll(tag)].length, 1);
  assert.notEqual(before.match(tag)[0], after.match(tag)[0]);
  assert.equal(before.replace(tag, '<!-- main script -->'), after.replace(tag, '<!-- main script -->'));
  const mainVersion = after.match(/src="js\/scripts\.js\?v=([^"]+)"/)[1];
  for (const relative of ['re/index.php', 're/GetRe_site.php']) {
    const versions = [...output.get(relative).matchAll(/src="js\/(?:scripts|re-consumption-engine)\.js\?v=([^"]+)"/g)];
    assert.equal(versions.length, 2);
    assert.ok(versions.every(match => match[1] === mainVersion));
  }
  const loaderVersions = [...output.get('js/scripts.js')
    .matchAll(/loadDashboardReScript\(new URL\("js\/(?:scripts|re-consumption-engine)\.js\?v=([^"]+)"/g)];
  assert.equal(loaderVersions.length, 2);
  assert.ok(loaderVersions.every(match => match[1] === mainVersion));
});

test('legacy PHP consumers retain every byte outside the replaced script tag', parityOptions, () => {
  const { originals, output } = assets();
  for (const relative of ['re/index.php', 're/GetRe_site.php']) {
    const before = originals.get(relative);
    const after = output.get(relative);
    const originalTag = before.match(/^([ \t]*)<script src="js\/scripts\.js\?v=[^"]+"><\/script>/m)[0];
    const generatedTags = /^([ \t]*)<script src="js\/re-consumption-engine\.js\?v=[^"]+"><\/script>\r?\n\1<script src="js\/scripts\.js\?v=[^"]+"><\/script>/m;
    assert.equal(after.replace(generatedTags, () => originalTag), before, relative);
  }
});

test('legacy dashboard PHP changes only the existing strict CLI read-only guard', parityOptions, () => {
  const { originals, output } = assets();
  const before = originals.get('api/dashboard.php');
  const after = output.get('api/dashboard.php');
  const guard = /\r?\n    if \(PHP_SAPI === 'cli'\r?\n        && defined\('ONREVOLT_CRM_READ_ONLY_PROFILE'\)\r?\n        && ONREVOLT_CRM_READ_ONLY_PROFILE === true\r?\n        && \(\$_SERVER\['REQUEST_METHOD'\] \?\? ''\) === 'GET'\) \{\r?\n        return true;\r?\n    \}/g;
  assert.equal([...after.matchAll(guard)].length, 1);
  assert.equal(after.replace(guard, ''), before);
});

test('legacy PHP guard bypasses normal authorization only for explicit true plus GET in CLI', parityOptions, (t) => {
  const apiBase64 = Buffer.from(assets().output.get('api/dashboard.php')).toString('base64');
  const php = process.env.ONREVOLT_PHP_BIN?.trim() || 'php';
  const cases = [
    { flag: true, method: 'GET', expected: true },
    { flag: false, method: 'GET', expected: false },
    { flag: 1, method: 'GET', expected: false },
    { flag: 'true', method: 'GET', expected: false },
    { method: 'GET', expected: false },
    { flag: true, method: 'POST', expected: false },
    { flag: true, method: 'get', expected: false },
    { flag: true, expected: false },
  ];
  for (const fixture of cases) {
    const fixtureBase64 = Buffer.from(JSON.stringify(fixture)).toString('base64');
    // PHP tokenization extracts one function; the endpoint bootstrap and DB code never run.
    const program = `<?php
$tokens = token_get_all(base64_decode('${apiBase64}'));
$declaration = '';
for ($i = 0; $i < count($tokens); $i++) {
    if (!is_array($tokens[$i]) || $tokens[$i][0] !== T_FUNCTION) continue;
    $nameIndex = $i + 1;
    while (is_array($tokens[$nameIndex]) && $tokens[$nameIndex][0] === T_WHITESPACE) $nameIndex++;
    if (!is_array($tokens[$nameIndex]) || $tokens[$nameIndex][1] !== 'dashboardCurrentUserCanAccessStationToken') continue;
    $depth = 0;
    $opened = false;
    for ($j = $i; $j < count($tokens); $j++) {
        $token = $tokens[$j];
        $declaration .= is_array($token) ? $token[1] : $token;
        if ($token === '{') { $depth++; $opened = true; }
        if ($token === '}') $depth--;
        if ($opened && $depth === 0) break;
    }
    break;
}
if ($declaration === '') throw new RuntimeException('Missing authorization function');
$legacyCalls = 0;
function energyMeterPdo(array $config) { $GLOBALS['legacyCalls']++; return null; }
function onrevoltAuthCurrentUser($pdo) { return null; }
eval($declaration);
$fixture = json_decode(base64_decode('${fixtureBase64}'), true, 512, JSON_THROW_ON_ERROR);
if (array_key_exists('flag', $fixture)) define('ONREVOLT_CRM_READ_ONLY_PROFILE', $fixture['flag']);
$_SERVER = array_key_exists('method', $fixture) ? ['REQUEST_METHOD' => $fixture['method']] : [];
$allowed = dashboardCurrentUserCanAccessStationToken([], '41');
echo json_encode(['allowed' => $allowed, 'legacyCalls' => $legacyCalls], JSON_THROW_ON_ERROR);
`;
    let result: string;
    try {
      result = execFileSync(php, [], { input: program, encoding: 'utf8', windowsHide: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        t.skip('PHP is unavailable; configure ONREVOLT_PHP_BIN for the isolated CLI guard test.');
        return;
      }
      throw error;
    }
    assert.deepEqual(JSON.parse(result), { allowed: fixture.expected, legacyCalls: fixture.expected ? 0 : 1 });
  }
});

test('legacy dashboard awaits the UMD loader before evaluating RE and exposes that same engine', parityOptions, async () => {
  const source = assets().output.get('js/scripts.js');
  const mount = namedFunctions(source, ['mountDashboardReFullApp'], true);
  const ast = sourceFile(mount);
  const loads: ts.ExpressionStatement[] = [];
  function visit(node: ts.Node) {
    if (ts.isExpressionStatement(node) && ts.isAwaitExpression(node.expression)) {
      const expression = node.expression.expression;
      if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) &&
          expression.expression.text === 'loadDashboardReScript') loads.push(node);
    }
    node.forEachChild(visit);
  }
  visit(ast);
  const engineIndex = loads.findIndex(node => node.getText(ast).includes('js/re-consumption-engine.js?'));
  assert.ok(engineIndex >= 0);
  assert.ok(loads[engineIndex + 1].getText(ast).includes('js/scripts.js?'));
  assert.equal(loads.filter(node => node.getText(ast).includes('js/re-consumption-engine.js?')).length, 1);
  const loaded: string[] = [];
  const state = runtime(false);
  delete state.context.ReConsumptionEngine;
  const engineSource = assets().output.get('re/js/re-consumption-engine.js');
  const wrapperSource = namedFunctions(assets().output.get('re/js/scripts.js'), calculationFunctions);
  const baseUrl = 'https://fixture.invalid/re/';
  const context = vm.createContext({ URL, baseUrl, loadDashboardReScript: async (url: string) => {
    await Promise.resolve();
    loaded.push(url);
    if (new URL(url).pathname === '/re/js/re-consumption-engine.js') {
      new vm.Script(engineSource).runInContext(state.context);
    } else {
      assert.equal(typeof state.context.ReConsumptionEngine.resolveDay, 'function');
      new vm.Script(wrapperSource).runInContext(state.context);
    }
  } });
  await new vm.Script(`(async function () {\n${loads.slice(engineIndex, engineIndex + 2).map(node => node.getText(ast)).join('\n')}\n}())`)
    .runInContext(context);
  assert.deepEqual(loaded.map(url => new URL(url).pathname), ['/re/js/re-consumption-engine.js', '/re/js/scripts.js']);
  assert.equal(new URL(loaded[0]).search, new URL(loaded[1]).search);
  assert.deepEqual(buildDay(state), buildDay(runtime(false)));
});

for (const dayKey of ['2026-01-12', '2026-07-12']) {
  test(`legacy generated XLSX wrappers preserve ${dayKey} PV self-consumption once without recursion`, parityOptions, () => {
    const fixture = { dayKey, profileKey: dayKey.replace('2026', '2025'), learned: fill(50) };
    const original = runtime(false, fixture);
    const wrapped = runtime(true, fixture);
    const hours = buildDay(wrapped, dayKey);
    assert.deepEqual(hours, buildDay(original, dayKey));
    assert.equal(hours[0], 1);
    approx(hours[12], 3.2);
    assert.equal(wrapped.pvCalls, 24);
    assert.equal(original.pvCalls, 24);
    assert.deepEqual(wrapped.calls.map(call => call.name), ['resolveDay', 'resolveDay']);
    assert.equal(wrapped.calls[0].args[0].hasExport, true);
    assert.notEqual(wrapped.calls[1].args[0].hasExport, true);
    assert.deepEqual(plain(wrapped.calls[1].args[0].hourlyProfile), hours);
  });
}

test('legacy getHourly correction ignores manual import source but honors export source and explicit PV options', parityOptions, () => {
  for (const exportSource of ['xlsx', 'standard', 'manual', 'real', 'part', 'forecast']) {
    const fixture = { source: 'manual', exportSource };
    const original = runtime(false, fixture);
    const wrapped = runtime(true, fixture);
    const options = { kWp: 2, pvOffset: 0 };
    const expected = plain(original.context.getHourlyUsageProfileForDay('2026-07-12', options));
    assert.deepEqual(plain(wrapped.context.getHourlyUsageProfileForDay('2026-07-12', options)), expected);
    approx(expected[12], exportSource === 'xlsx' ? 1.1 : 1);
    assert.equal(wrapped.pvCalls, exportSource === 'xlsx' ? 24 : 0);
  }
});

test('legacy generated wrappers retain negative-energy clamps and do not count excess exports as negative load', parityOptions, () => {
  const imports = fill(1), exports = fill(2);
  imports[12] = -2;
  exports[12] = -3;
  exports[13] = 100;
  const fixture = { imports, exports };
  const expected = buildDay(runtime(false, fixture));
  const actual = buildDay(runtime(true, fixture));
  assert.deepEqual(actual, expected);
  approx(actual[12], 4.2);
  assert.equal(actual[13], 1);
});

const pvErrorFixtures: Array<[string, Fixture, string]> = [
  ['negative PV power', { pvWatts: -100 }, 'Brak mocy PV'],
  ['zero PV power', { pvWatts: 0 }, 'Brak mocy PV'],
  ['missing PV series', { pvRows: [] }, 'Brak danych PV'],
  ['missing export profile', { exports: null }, 'Brak godzinowej energii oddanej'],
];

for (const [name, fixture, message] of pvErrorFixtures) {
  test(`legacy generated wrapper preserves ${name} error`, parityOptions, () => {
    function errorMessage(wrapped: boolean) {
      try { buildDay(runtime(wrapped, fixture)); } catch (error) { return (error as Error).message; }
      assert.fail('Expected an explicit PV/export error');
    }
    assert.equal(errorMessage(true), errorMessage(false));
    assert.match(errorMessage(true), new RegExp(message));
  });
}

test('legacy complete actual including zeros bypasses missing PV/export, invalid PV power and profile errors', parityOptions, () => {
  for (const use of [0, 2]) {
    const fixture = { pvRows: [], pvWatts: -1, exports: null, profileError: 'uszkodzony profil',
      actualDay: { isComplete: true, hours: fill(0).map(() => ({ use, hasUse: true })) } };
    const original = runtime(false, fixture);
    const wrapped = runtime(true, fixture);
    assert.deepEqual(buildDay(wrapped), fill(use));
    assert.deepEqual(buildDay(wrapped), buildDay(original));
    assert.equal(wrapped.pvCalls, 0);
    assert.equal(original.pvCalls, 0);
    assert.ok(wrapped.calls.every(call => call.name === 'resolveDay' && call.args[0].hourlyProfile === null));
  }
});

test('legacy partial actual overlays only hasUse hours after one PV reconstruction', parityOptions, () => {
  const fixture = { actualDay: { isComplete: false, hours: fill(0).map((_, hour) => ({
    hasUse: hour === 11 || hour === 12, use: hour === 11 ? 0 : 0.2,
  })) } };
  const wrapped = runtime(true, fixture);
  const actual = buildDay(wrapped);
  assert.deepEqual(actual, buildDay(runtime(false, fixture)));
  assert.equal(actual[11], 0);
  assert.equal(actual[12], 0.2);
  approx(actual[13], 3.2);
  assert.equal(wrapped.pvCalls, 24);
  const missing = { ...fixture, pvRows: [] };
  assert.throws(() => buildDay(runtime(true, missing)), /Brak danych PV/);
  assert.throws(() => buildDay(runtime(false, missing)), /Brak danych PV/);
});

test('legacy isComplete without all hasUse flags still requires modeled PV for missing hours', parityOptions, () => {
  const fixture = { pvRows: [], actualDay: { isComplete: true,
    hours: fill(0).map((_, hour) => ({ hasUse: hour !== 12, use: 0 })),
  } };
  assert.throws(() => buildDay(runtime(false, fixture)), /Brak danych PV/);
  assert.throws(() => buildDay(runtime(true, fixture)), /Brak danych PV/);
});

test('legacy standard/learned/monthly priority, health checks and default annual input remain identical', parityOptions, () => {
  for (const fixture of [
    { source: 'standard', pvRows: [], learned: fill(7) },
    { source: 'manual', exportSource: 'standard', monthly: new Array(12).fill(1000), learned: fill(7) },
    { source: 'manual', imports: null, monthly: new Array(12).fill(1000), learned: fill(7) },
    { source: 'standard', imports: null },
  ]) {
    const original = runtime(false, fixture);
    const wrapped = runtime(true, fixture);
    assert.deepEqual(buildDay(wrapped), buildDay(original));
    assert.deepEqual(plain(wrapped.context.buildHourlyUseForDay(new Date(2026, 6, 12))),
      plain(original.context.buildHourlyUseForDay(new Date(2026, 6, 12))));
  }
  for (const wrapped of [false, true]) {
    assert.throws(() => buildDay(runtime(wrapped, {
      source: 'standard', imports: null, profileError: 'uszkodzony profil',
    })), /uszkodzony profil/);
    assert.deepEqual(buildDay(runtime(wrapped, {
      source: 'standard', learned: fill(7), profileError: 'uszkodzony profil',
    })), fill(7));
  }
});

function payloadFixture() {
  function record(date: string, use: number) {
    return { date, slotCount: 96, measuredSlotCount: 96, measurementCoverage: 1,
      quarters: Array.from({ length: 96 }, (_, slot) => {
        const start = Date.parse(`${date}T00:00:00Z`) + slot * 900000;
        return { slotStart: new Date(start).toISOString().slice(0, 19),
          slotEnd: new Date(start + 900000).toISOString().slice(0, 19), hour: Math.floor(slot / 4),
          totalLoadKwh: use, pvGenerationKwh: 0, gridImportKwh: use, gridExportKwh: 0 };
      }) };
  }
  const records = [record('2026-01-12', 0.75), record('2026-07-12', 0.25), record('2026-09-09', 0)];
  return { rawEnergy: { datetime: '2026-09-09 10:15:00' }, usageData: { records } };
}

test('legacy actual-map and forecast wrappers delegate once and match closed/current seasonal records', parityOptions, () => {
  const payload = payloadFixture();
  const original = runtime(false);
  const wrapped = runtime(true);
  assert.deepEqual(plain([...wrapped.context.buildReActualHourlyMapFromPayload(payload)]),
    plain([...original.context.buildReActualHourlyMapFromPayload(payload)]));
  assert.deepEqual(plain(wrapped.context.buildReUsageForecastModel(payload)),
    plain(original.context.buildReUsageForecastModel(payload)));
  assert.deepEqual(wrapped.calls.map(call => call.name), ['buildActualMap', 'buildForecastModel']);
  assert.ok(wrapped.calls.every(call => call.args[0] === payload));
});

function actionCatchBody(source: string, action: string, nextAction: string) {
  const start = source.indexOf(`if ($action === '${action}')`);
  const end = source.indexOf(`if ($action === '${nextAction}')`, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end).match(/catch \(Throwable \$e\) \{([\s\S]*?)\r?\n\t\t\}/)[1];
}

function uploadCatchBody(source: string) {
  return actionCatchBody(source, 'user_consumption_xlsx_upload', 'user_consumption_month_reset');
}

test('legacy setup changes only locking, conflict guards and narrow XLSX date parsing; auth/schema/constants remain intact', parityOptions, () => {
  const before = assets().originals.get('re/setup_func.php');
  const after = assets().output.get('re/setup_func.php');
  const changedNames = ['save_user_consumption_xlsx', 'save_user_consumption_profile',
    'parse_osd_xlsx_datetime', 'parse_osd_consumption_xlsx'];
  const originalFunctions = phpFunctions(before, changedNames);
  const declarations = { ...setupFunctions(), ...phpFunctions(after, changedNames) };
  let restored = after;
  for (const [name, declaration] of Object.entries(originalFunctions)) {
    restored = restored.replace(declarations[name], () => declaration);
  }
  const helper = declarations.with_user_consumption_lock;
  const helperEnd = restored.indexOf(helper) + helper.length;
  const helperNewline = restored.slice(helperEnd).startsWith('\r\n') ? '\r\n' : '\n';
  restored = restored.replace(helper + helperNewline, '');
  const operations = [
    ['user_consumption_get', 'load_user_consumption_profile($pdo, $station)'],
    ['user_consumption_save', 'save_user_consumption_profile($pdo, $station, $months, $sources)'],
    ['user_consumption_xlsx_upload', "save_user_consumption_xlsx($pdo, $station, $_FILES['file'])"],
    ['user_consumption_month_reset', 'reset_user_consumption_month($pdo, $station, $month, $direction)'],
  ];
  assert.equal((after.match(/'data'=>with_user_consumption_lock\(/g) || []).length, 4);
  for (const [action, operation] of operations) {
    const protectedOperation = action === 'user_consumption_xlsx_upload'
      ? "save_user_consumption_xlsx($pdo, $station, $_FILES['file'], (string)($_POST['reject_existing'] ?? '') === '1')"
      : action === 'user_consumption_save'
      ? "save_user_consumption_profile($pdo, $station, $months, $sources, ($body['protect_detailed'] ?? false) === true)"
      : operation;
    const wrapped = `with_user_consumption_lock($pdo, $station, fn() => ${protectedOperation})`;
    assert.equal(restored.split(wrapped).length, 2, action);
    const actionStart = restored.indexOf(`if ($action === '${action}')`);
    const resolveStation = restored.indexOf('$station = resolve_user_station($pdo, $station);', actionStart);
    assert.ok(resolveStation > actionStart && resolveStation < restored.indexOf(wrapped), action);
    restored = restored.replace(wrapped, () => operation);
  }
  restored = restored.replace(uploadCatchBody(restored), () => uploadCatchBody(before));
  restored = restored.replace(actionCatchBody(restored, 'user_consumption_save', 'user_consumption_xlsx_upload'),
    () => actionCatchBody(before, 'user_consumption_save', 'user_consumption_xlsx_upload'));
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  // Hash comparison never exposes the connection settings in a failed assertion.
  assert.equal(digest(restored), digest(before));
  assert.match(helper, /SELECT GET_LOCK\(\?, 30\)/);
  assert.match(helper, /finally\s*\{[\s\S]*SELECT RELEASE_LOCK\(\?\)/);
  assert.doesNotMatch(helper, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|beginTransaction|commit)\b/);
});

for (const direction of ['import', 'export']) {
  test(`legacy October ${direction} retains all 745 real measurements in 744 civil hours`, parityOptions, () => {
    const rows = octoberRows(direction);
    assert.equal(rows.length - 2, 745);
    const expectedTotal = direction === 'import' ? 256.906 : 274.958;
    const original = parseOsdFixture(rows, true).parsed.channels[direction];
    assert.equal(original.hours.length, 744);
    assert.equal(original.totalKwh, Math.round((expectedTotal - 0.214) * 1000) / 1000);
    const result = parseOsdFixture(rows);
    assert.equal(result.error, undefined);
    const channel = result.parsed.channels[direction];
    assert.equal(channel.month, 10);
    assert.equal(channel.sourceYear, 2025);
    assert.equal(channel.hours.length, 744);
    assert.equal(channel.totalKwh, expectedTotal);
    assert.equal(channel.hours.find((hour: { day: number; hour: number }) => hour.day === 26 && hour.hour === 2).kwh,
      direction === 'import' ? 0.409 : 0.214);
    assert.equal(Math.round(channel.hours.reduce((sum: number, hour: { kwh: number }) => sum + hour.kwh, 0) * 1000),
      Math.round(expectedTotal * 1000));
    assert.deepEqual(channel.hours.filter((hour: { day: number; hour: number }) => hour.day !== 26 || hour.hour !== 2),
      original.hours.filter((hour: { day: number; hour: number }) => hour.day !== 26 || hour.hour !== 2));
  });
}

for (const month of [1, 6, 10]) {
  test(`legacy ordinary month ${month} keeps exact original parsing and explicit zero`, parityOptions, () => {
    const rows = osdMonthRows(month);
    rows[10][1] = 0;
    rows[11][2] = 'Dane szacowane';
    const original = parseOsdFixture(rows, true);
    assert.equal(original.error, undefined);
    assert.deepEqual(parseOsdFixture(rows), original);
  });
}

test('legacy spring transition retains original real energy and structural nonexistent-hour handling', parityOptions, () => {
  const rows = osdMonthRows(3).filter(row => row[0] !== '2025-03-30 02:00:00');
  assert.equal(rows.length - 1, 743);
  const original = parseOsdFixture(rows, true);
  assert.equal(original.error, undefined);
  assert.deepEqual(parseOsdFixture(rows), original);
});

for (const date of [
  '2025-10-25 03:00:00 czasu zimowego',
  '2025-10-26 02:00:00 czasu zimowego',
  '2025-10-26 04:00:00 czasu zimowego',
  '2025-10-26 03:01:00 czasu zimowego',
  '2025-03-30 03:00:00 czasu zimowego',
  '2025-09-56 03:00:00 czasu zimowego',
  '2025-10-26 03:00:00 czasu letniego',
  '2025-10-26 03:00:00 czasu zimowego dodatkowo',
  '2025-10-26 03:00:00 unknown',
  '26.10.2025 03:00:00 unknown',
  'not a date',
]) {
  test(`legacy rejects invalid measurement date instead of silently losing energy: ${date}`, parityOptions, () => {
    const rows = octoberRows('import');
    const index = rows.findIndex(row => row[0] === '2025-10-26 03:00:00 czasu zimowego');
    rows[index][0] = date;
    assert.match(parseOsdFixture(rows).error, /data|dat[ayę]|dopisek|Dopisek/i);
  });
}

test('legacy DST suffix follows the actual transition date in a different year', parityOptions, () => {
  const rows = osdMonthRows(10, 'import', 2026);
  const index = rows.findIndex(row => row[0] === '2026-10-25 03:00:00');
  rows.splice(index + 1, 0, ['2026-10-25 03:00:00 czasu zimowego', 0.214, 'Dane rzeczywiste']);
  const result = parseOsdFixture(rows);
  assert.equal(result.error, undefined);
  assert.equal(result.parsed.channels.import.hours.find((hour: { day: number; hour: number }) => hour.day === 25 && hour.hour === 2).kwh, 0.514);
});

test('legacy DST correction retains strict statuses and negative-energy rejection', parityOptions, () => {
  const negative = octoberRows('import');
  const index = negative.findIndex(row => row[0] === '2025-10-26 03:00:00 czasu zimowego');
  negative[index][1] = -0.214;
  assert.match(parseOsdFixture(negative).error, /Ujemne/);
  const missingStatus = octoberRows('import');
  missingStatus[index][2] = '';
  assert.match(parseOsdFixture(missingStatus).error, /bez statusu/);
  const july = osdMonthRows(7, 'import', 2026);
  for (const row of july.slice(169)) { row[1] = ''; row[2] = ''; }
  assert.equal(july.length - 1, 744);
  assert.match(parseOsdFixture(july).error, /bez statusu/);
});

test('legacy station lock serializes concurrent different-month imports without losing either month', parityOptions, () => {
  const result = phpConcurrencyFixture(`
$a = new FixturePdo('a'); $b = new FixturePdo('b');
$first = workbook('first', 'import', 1, 111);
$second = workbook('second', 'import', 2, 222);
$yieldSnapshot = 'a';
$one = new Fiber(fn() => with_user_consumption_lock($a, '41', fn() => save_user_consumption_xlsx($a, '41', $first, true)));
$two = new Fiber(fn() => with_user_consumption_lock($b, '41', fn() => save_user_consumption_xlsx($b, '41', $second, true)));
$pauses = [$one->start(), $two->start()];
$one->resume(); $two->resume();
echo json_encode(['pauses'=>$pauses, 'profile'=>$store['41'], 'trace'=>$trace, 'locks'=>count(FixturePdo::$locks)], JSON_THROW_ON_ERROR);
`);
  assert.deepEqual(result.pauses, ['snapshot', 'waiting']);
  assert.deepEqual(result.profile.months.slice(0, 3), [111, 222, 100]);
  assert.deepEqual(result.profile.sources.slice(0, 3), ['xlsx', 'xlsx', 'standard']);
  const releaseA = result.trace.findIndex((item: string[]) => item[0] === 'a' && item[1] === 'release');
  const acquireB = result.trace.findIndex((item: string[]) => item[0] === 'b' && item[1] === 'acquire');
  assert.ok(releaseA < acquireB);
  assert.equal(result.locks, 0);
});

test('legacy same-month reject_existing is checked after waiting and before any rebuilding/write', parityOptions, () => {
  const result = phpConcurrencyFixture(`
$a = new FixturePdo('native'); $b = new FixturePdo('crm');
$first = workbook('first', 'import', 1, 111); $second = workbook('second', 'import', 1, 999);
$yieldSnapshot = 'native';
$one = new Fiber(fn() => with_user_consumption_lock($a, '41', fn() => save_user_consumption_xlsx($a, '41', $first)));
$two = new Fiber(fn() => with_user_consumption_lock($b, '41', fn() => save_user_consumption_xlsx($b, '41', $second, true)));
$one->start(); $wait = $two->start(); $one->resume();
try { $two->resume(); $code = 0; } catch (Throwable $e) { $code = $e->getCode(); }
echo json_encode(['wait'=>$wait, 'code'=>$code, 'total'=>$store['41']['months'][0], 'trace'=>$trace, 'locks'=>count(FixturePdo::$locks)], JSON_THROW_ON_ERROR);
`);
  assert.equal(result.wait, 'waiting');
  assert.equal(result.code, 409);
  assert.equal(result.total, 111);
  assert.deepEqual(result.trace.filter((item: string[]) => item[0] === 'crm').map((item: string[]) => item[1]),
    ['acquire', 'check', 'release']);
  assert.equal(result.locks, 0);
});

test('legacy conflict guard treats import/export independently, checks every channel, and retains native replacement', parityOptions, () => {
  const result = phpConcurrencyFixture(`
$pdo = new FixturePdo('native'); $store['41'] = profile(); $store['41']['sources'][0] = 'xlsx';
$export = workbook('export', 'export', 1, 300);
with_user_consumption_lock($pdo, '41', fn() => save_user_consumption_xlsx($pdo, '41', $export, true));
$afterExport = $store['41'];
$replacement = workbook('replacement', 'import', 1, 999);
$native = with_user_consumption_lock($pdo, '41', fn() => save_user_consumption_xlsx($pdo, '41', $replacement));
$trace = [];
$mixed = workbook('mixed', 'import', 2, 888);
$parsed['mixed']['channels']['export'] = $parsed['export']['channels']['export'];
try { with_user_consumption_lock($pdo, '41', fn() => save_user_consumption_xlsx($pdo, '41', $mixed, true)); $code = 0; }
catch (Throwable $e) { $code = $e->getCode(); }
echo json_encode(['afterExport'=>$afterExport, 'native'=>$native, 'mixedCode'=>$code, 'trace'=>$trace, 'month2'=>$store['41']['months'][1]], JSON_THROW_ON_ERROR);
`);
  assert.equal(result.afterExport.sources[0], 'xlsx');
  assert.equal(result.afterExport.exportSources[0], 'xlsx');
  assert.equal(result.afterExport.months[0], 100);
  assert.equal(result.native.months[0], 999);
  assert.deepEqual(result.native.imported, { month: 1, sourceYear: 2026, totalKwh: 999 });
  assert.equal(result.mixedCode, 409);
  assert.equal(result.month2, 100);
  assert.deepEqual(result.trace.map((item: string[]) => item[1]), ['acquire', 'check', 'release']);
});

test('legacy lock is station-scoped, releases on exceptions and never runs an operation after timeout', parityOptions, () => {
  const result = phpConcurrencyFixture(`
$a = new FixturePdo('a'); $b = new FixturePdo('b');
$one = new Fiber(fn() => with_user_consumption_lock($a, '41', function () { Fiber::suspend('held'); throw new RuntimeException('callback failed', 409); }));
$one->start();
$value = with_user_consumption_lock($b, '42', fn() => 123);
try { $one->resume(); } catch (Throwable $e) { $message = $e->getMessage(); $code = $e->getCode(); }
$timeout = new FixturePdo('timeout'); $timeout->failAcquire = true; $ran = false;
try { with_user_consumption_lock($timeout, '41', function () use (&$ran) { $ran = true; }); } catch (Throwable $e) {}
echo json_encode(['value'=>$value, 'message'=>$message, 'code'=>$code, 'ran'=>$ran, 'locks'=>count(FixturePdo::$locks), 'names'=>[$a->lockName, $b->lockName], 'trace'=>$trace], JSON_THROW_ON_ERROR);
`);
  assert.equal(result.value, 123);
  assert.equal(result.message, 'callback failed');
  assert.equal(result.code, 409);
  assert.equal(result.ran, false);
  assert.equal(result.locks, 0);
  assert.notEqual(result.names[0], result.names[1]);
  assert.ok(result.names.every((name: string) => name.length <= 64));
  assert.deepEqual(result.trace, [['a', 'acquire'], ['b', 'acquire'], ['b', 'release'], ['a', 'release']]);
});

test('legacy upload error response distinguishes RE_MONTH_EXISTS/409 from unchanged native 400 errors', parityOptions, () => {
  const body = uploadCatchBody(assets().output.get('re/setup_func.php'));
  for (const code of [0, 409]) {
    const result = JSON.parse(runPhp(`
ob_start();
try { throw new RuntimeException('fixture error', ${code}); } catch (Throwable $e) { ${body} }
$body = json_decode(ob_get_clean(), true);
echo json_encode(['status'=>http_response_code(), 'body'=>$body], JSON_THROW_ON_ERROR);
`));
    assert.deepEqual(result, { status: code === 409 ? 409 : 400,
      body: { ok: false, error: 'fixture error', ...(code === 409 ? { code: 'RE_MONTH_EXISTS' } : {}) } });
  }
});

test('legacy protect_detailed rejects a stale CRM declaration after waiting for native XLSX upload', parityOptions, () => {
  const result = phpConcurrencyFixture(`
$store['41'] = profile();
$stale = $store['41']; $stale['months'][1] = 200;
$native = new FixturePdo('native'); $crm = new FixturePdo('crm');
$file = workbook('native', 'import', 1, 111);
$yieldSnapshot = 'native';
$one = new Fiber(fn() => with_user_consumption_lock($native, '41', fn() => save_user_consumption_xlsx($native, '41', $file)));
$two = new Fiber(fn() => with_user_consumption_lock($crm, '41', fn() => save_user_consumption_profile($crm, '41', $stale['months'], $stale['sources'], true)));
$one->start(); $wait = $two->start(); $one->resume();
try { $two->resume(); $code = 0; $message = ''; } catch (Throwable $e) { $code = $e->getCode(); $message = $e->getMessage(); }
echo json_encode(['wait'=>$wait, 'code'=>$code, 'message'=>$message, 'profile'=>$store['41'], 'trace'=>$trace, 'locks'=>count(FixturePdo::$locks)], JSON_THROW_ON_ERROR);
`);
  assert.equal(result.wait, 'waiting');
  assert.equal(result.code, 409);
  assert.match(result.message, /miesiąca 1.*Odśwież profil/);
  assert.deepEqual(result.profile.months.slice(0, 2), [111, 100]);
  assert.equal(result.profile.sources[0], 'xlsx');
  assert.deepEqual(result.trace.filter((item: string[]) => item[0] === 'crm').map((item: string[]) => item[1]),
    ['acquire', 'check', 'release']);
  assert.equal(result.locks, 0);
});

test('legacy protect_detailed rejects changed value or source for both XLSX and manual months, including zero', parityOptions, () => {
  const result = phpConcurrencyFixture(`
$results = [];
foreach (['xlsx', 'manual'] as $source) {
    foreach (['value', 'source'] as $change) {
        $store['41'] = profile(); $store['41']['sources'][0] = $source; $store['41']['months'][0] = 0.0;
        $incoming = $store['41'];
        if ($change === 'value') $incoming['months'][0] = 1.0; else $incoming['sources'][0] = 'standard';
        $pdo = new FixturePdo($source . '-' . $change); $trace = [];
        try { with_user_consumption_lock($pdo, '41', fn() => save_user_consumption_profile($pdo, '41', $incoming['months'], $incoming['sources'], true)); $code = 0; }
        catch (Throwable $e) { $code = $e->getCode(); }
        $results[] = ['code'=>$code, 'month'=>$store['41']['months'][0], 'source'=>$store['41']['sources'][0], 'trace'=>$trace];
    }
}
echo json_encode($results, JSON_THROW_ON_ERROR);
`);
  assert.equal(result.length, 4);
  for (const row of result) {
    assert.equal(row.code, 409);
    assert.equal(row.month, 0);
    assert.ok(['xlsx', 'manual'].includes(row.source));
    assert.deepEqual(row.trace.map((item: string[]) => item[1]), ['acquire', 'check', 'release']);
  }
});

test('legacy protect_detailed permits unchanged detailed months and standard updates using existing normalization', parityOptions, () => {
  const result = phpConcurrencyFixture(`
$store['41'] = profile(); $store['41']['months'][0] = 111.0; $store['41']['sources'][0] = 'xlsx';
$store['41']['months'][1] = 222.0; $store['41']['sources'][1] = 'manual';
$store['41']['exportSources'][0] = 'xlsx';
$incoming = $store['41']; $incoming['months'][0] = '111,000'; $incoming['months'][1] = '222.0004'; $incoming['months'][2] = 333;
$pdo = new FixturePdo('crm');
$saved = with_user_consumption_lock($pdo, '41', fn() => save_user_consumption_profile($pdo, '41', $incoming['months'], $incoming['sources'], true));
$new = new FixturePdo('new');
$created = with_user_consumption_lock($new, '42', fn() => save_user_consumption_profile($new, '42', array_fill(0, 12, 50), array_fill(0, 12, 'standard'), true));
echo json_encode(['saved'=>$saved, 'created'=>$created, 'trace'=>$trace, 'locks'=>count(FixturePdo::$locks)], JSON_THROW_ON_ERROR);
`);
  assert.deepEqual(result.saved.months.slice(0, 3), [111, 222, 333]);
  assert.deepEqual(result.saved.sources.slice(0, 3), ['xlsx', 'manual', 'standard']);
  assert.equal(result.saved.exportSources[0], 'xlsx');
  assert.deepEqual(result.created.months, new Array(12).fill(50));
  assert.equal(result.locks, 0);
  assert.deepEqual(result.trace.slice(0, 3).map((item: string[]) => item[1]), ['acquire', 'check', 'write']);
});

test('legacy native save without protect_detailed retains full replacement without an extra guard read', parityOptions, () => {
  const result = phpConcurrencyFixture(`
$store['41'] = profile(); $store['41']['sources'][0] = 'xlsx'; $store['41']['months'][0] = 111.0;
$pdo = new FixturePdo('native');
$saved = with_user_consumption_lock($pdo, '41', fn() => save_user_consumption_profile($pdo, '41', array_fill(0, 12, 200), array_fill(0, 12, 'manual')));
echo json_encode(['saved'=>$saved, 'trace'=>$trace], JSON_THROW_ON_ERROR);
`);
  assert.deepEqual(result.saved.months, new Array(12).fill(200));
  assert.deepEqual(result.saved.sources, new Array(12).fill('manual'));
  assert.ok(result.trace.every((item: string[]) => item[1] !== 'check'));
});

test('legacy protected declaration conflict is HTTP 409 with readable error; normal validation remains 400', parityOptions, () => {
  const body = actionCatchBody(assets().output.get('re/setup_func.php'), 'user_consumption_save', 'user_consumption_xlsx_upload');
  for (const code of [0, 409]) {
    const result = JSON.parse(runPhp(`
ob_start();
try { throw new RuntimeException('Odśwież profil przed zapisem.', ${code}); } catch (Throwable $e) { ${body} }
$body = json_decode(ob_get_clean(), true);
echo json_encode(['status'=>http_response_code(), 'body'=>$body], JSON_THROW_ON_ERROR);
`));
    assert.deepEqual(result, { status: code === 409 ? 409 : 400,
      body: { ok: false, error: 'Odśwież profil przed zapisem.' } });
  }
});

test('legacy generator rejects ambiguous/missing anchors instead of silently generating partial wrappers', parityOptions, () => {
  const { originals } = assets();
  const original = originals.get('re/js/scripts.js');
  assert.throws(() => generateAssets({ 're/js/scripts.js': `${original}\nfunction buildHourlyUseForDay() {}` }),
    /Oczekiwano jednej funkcji buildHourlyUseForDay/);
  assert.throws(() => generateAssets({ 're/js/scripts.js': original.replace('pvKWh - exportKwh', 'pvKWh + exportKwh') }),
    /Zmienił się wzór rekonstrukcji PV/);
  assert.throws(() => generateAssets({ 're/index.php': '<html></html>' }), /jednoznacznego znacznika RE/);
  assert.throws(() => generateAssets({ 'js/scripts.js': '' }), /jednoznacznego ładowania RE/);
  for (const relative of ['index.html', 're/GetRe_site.php']) {
    assert.throws(() => generateAssets({ [relative]: '<html></html>' }), /jednoznacznego znacznika/);
    const duplicate = `${originals.get(relative)}\n<script src="js/scripts.js?v=duplicate"></script>`;
    assert.throws(() => generateAssets({ [relative]: duplicate }), /jednoznacznego znacznika/);
  }
});
