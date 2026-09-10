import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const modulePath = path.resolve(__dirname, '../../../public/shared/re-consumption-engine.js');
const engine = require(modulePath);
const canonicalPath = process.env.RE_CONSUMPTION_CANONICAL_SOURCE ||
  path.resolve(__dirname, '../../../_workspace-artifacts/re-profile-20260909/baseline/my.onrevolt.com/re/js/scripts.js');
const parityOptions = {
  skip: !existsSync(canonicalPath) && 'Immutable original RE baseline is unavailable; set RE_CONSUMPTION_CANONICAL_SOURCE to an original, unwrapped re/js/scripts.js.',
};
const fill = (value: number) => new Array(24).fill(value);
const sources = (value: string) => new Array(12).fill(value);
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const approx = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

type Slot = {
  slotStart: string;
  slotEnd: string;
  hour: number;
  totalLoadKwh?: unknown;
  [key: string]: unknown;
};
type UsageRecord = {
  date: string;
  slotCount: number;
  measuredSlotCount: number;
  measurementCoverage: number;
  quarters: Slot[];
};

const warsaw = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

function localStamp(timestamp: number) {
  const parts = Object.fromEntries(warsaw.formatToParts(timestamp).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${parts.timeZoneName.replace('GMT', '')}`;
}

function record(date: string, consumptionForHour: number | ((hour: number, index: number) => number) = 0.25): UsageRecord {
  // Derive both midnight offsets independently so real DST days have 92/100 slots.
  const noon = Date.parse(`${date}T12:00:00Z`);
  const nextDate = new Date(noon + 86400000).toISOString().slice(0, 10);
  const offsetAt = (time: number) => localStamp(time).slice(-6);
  const start = Date.parse(`${date}T00:00:00${offsetAt(noon - 12 * 3600000)}`);
  const end = Date.parse(`${nextDate}T00:00:00${offsetAt(noon + 12 * 3600000)}`);
  const quarters: Slot[] = [];
  for (let timestamp = start; timestamp < end; timestamp += 900000) {
    const slotStart = localStamp(timestamp);
    const hour = Number(slotStart.slice(11, 13));
    quarters.push({
      slotStart, slotEnd: localStamp(timestamp + 900000), hour,
      totalLoadKwh: typeof consumptionForHour === 'function' ? consumptionForHour(hour, quarters.length) : consumptionForHour,
    });
  }
  return { date, slotCount: quarters.length, measuredSlotCount: quarters.length, measurementCoverage: 1, quarters };
}

function payload(records: UsageRecord[], cutoff = '2026-09-09 10:15:00') {
  return { rawEnergy: { datetime: cutoff }, usageData: { records } };
}

function actualFixture() {
  const winter = record('2026-01-12', (hour) => (hour < 7 || hour > 17 ? 1.5 : 0.5));
  winter.quarters.forEach(slot => Object.assign(slot, {
    pvGenerationKwh: 1, gridImportKwh: 0.5, gridToStorageKwh: 0.75,
    gridExportKwh: 0.25, storageToGridKwh: 0.5,
  }));
  const summer = record('2026-07-12', hour => hour >= 10 && hour <= 16 ? 0.25 : 0.75);
  const incomplete = record('2026-09-08');
  incomplete.quarters = incomplete.quarters.slice(0, 12);
  const current = record('2026-09-09', 0.5);
  const pv = record(winter.date);
  pv.quarters.forEach(slot => { slot.productionKwh = slot.hour === 12 ? 2 : 0; });
  const storage = record(winter.date);
  storage.quarters.forEach((slot, index) => { slot.socPercent = index; slot.capacityKwh = 10; });
  return {
    ...payload([winter, summer, incomplete, current, record('2026-09-10')]),
    pvData: { records: [pv, record('2026-08-01')] },
    storageData: { records: [storage] },
  };
}

function seasonalFixture() {
  const records: UsageRecord[] = [];
  for (const [month, count, use] of [[1, 6, 1], [2, 7, 2], [3, 14, 3], [7, 28, 4]]) {
    for (let day = 1; day <= count; day += 1) {
      records.push(record(`2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, use));
    }
  }
  return payload(records.reverse());
}

const actualDeclarations = [
  'reActualNumber', 'reActualFirstNumber', 'reActualDateKey', 'reActualDayKeyFromRecord',
  'reActualHourFromQuarter', 'createReActualHour', 'createReActualDay',
  'addReActualQuarterValue', 'applyReActualUsageRecord', 'applyReActualPvRecord',
  'applyReActualStorageRecord', 'isCompleteReActualRecord', 'getReActualCutoff',
  'trimReActualRecordToCutoff', 'buildReActualHourlyMapFromPayload', 'buildReUsageForecastModel',
];
const profileDeclarations = [
  'parseUsageKWh', 'normalizeMonthlyUsageProfile', 'normalizeUsageSource', 'normalizeUsageSources',
  'reUsageDateKey', 'getUsageProfileMonthIndex', 'currentUsageMonthExportSources',
  'hasUsageExportProfileForDay', 'getProfilePvOffsetForDate', 'getHourlyUsageProfileForDay',
  'assertUsageHourlyProfileIsHealthy', 'getUsageProfileYear', 'getDaysInYear',
  'getDaysInMonthForProfile', 'getReActualDay', 'currentUsageMonthSources', 'buildHourlyUseForDay',
  'actualUsageHourValues', 'getActualUsageMonthStats', 'getUsageMonthDisplaySource',
  'getUsageMonthExportDisplaySource',
];

let canonicalDeclarations: string;

function legacy(globals: Record<string, unknown> = {}) {
  if (!canonicalDeclarations) {
    const source = ts.createSourceFile(canonicalPath, readFileSync(canonicalPath, 'utf8'),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const declarations = new Map(source.statements.filter(ts.isFunctionDeclaration)
      .map(node => [node.name?.text, node.getText(source)]));
    canonicalDeclarations = [...actualDeclarations, ...profileDeclarations].map(name => {
      assert.ok(declarations.has(name), `Missing trusted canonical function: ${name}`);
      return declarations.get(name);
    }).join('\n\n');
  }
  // No top-level source statements, DOM setup, event handlers, imports or eval.
  const context = vm.createContext({ Date, ...globals });
  new vm.Script(canonicalDeclarations, { filename: 'canonical-re-functions.js' })
    .runInContext(context, { timeout: 5000 });
  return context;
}

function legacyDay(inputs: Record<string, any>) {
  const key = inputs.dayKey;
  const monthIndex = Number(key.slice(5, 7)) - 1;
  const monthlyHours = Array.from({ length: 12 }, () => inputs.learnedHours);
  const context = legacy({
    START: `${inputs.year ?? key.slice(0, 4)}-01-01T00:00:00`,
    USE24: engine.DEFAULT_HOURLY_PERCENT,
    window: {},
    usageMonthlyProfileKWh: inputs.monthlyKwh ?? null,
    usageMonthlySources: inputs.sources ?? null,
    usageMonthlyExportSources: sources(inputs.hasExport ? 'xlsx' : 'standard'),
    usageHourlyByDay: new Map(inputs.hourlyProfile ? [[key, inputs.hourlyProfile]] : []),
    usageHourlyPatternByMonthDay: new Map(),
    usageExportHourlyByDay: new Map(inputs.exportHourlyKwh ? [[key, inputs.exportHourlyKwh]] : []),
    reActualHourlyByDay: new Map(inputs.actualDay ? [[key, inputs.actualDay]] : []),
    reUsageForecastModel: inputs.learnedHours ? { monthlyHours } : null,
    // PV conversion is the caller's responsibility; exercise the original import/PV/export formula.
    getProfilePvKWhForHour: (hour: number) => {
      if (!inputs.pvHourlyKwh) throw new Error('Brak danych PV');
      return inputs.pvHourlyKwh[hour];
    },
  });
  const day = new Date(inputs.year ?? Number(key.slice(0, 4)), monthIndex, Number(key.slice(8, 10)));
  return plain(context.buildHourlyUseForDay(day, inputs.annualKwh,
    inputs.defaultHourlyPercent === undefined ? engine.DEFAULT_HOURLY_PERCENT : inputs.defaultHourlyPercent));
}

test('consumption engine exposes browser UMD and CommonJS without DOM', () => {
  const context = vm.createContext({});
  new vm.Script(readFileSync(modulePath, 'utf8')).runInContext(context);
  assert.deepEqual(Object.keys(context.ReConsumptionEngine), Object.keys(engine));
  const inputs = { dayKey: '2026-07-12', annualKwh: 3650 };
  assert.deepEqual(plain(context.ReConsumptionEngine.resolveDay(inputs)), engine.resolveDay(inputs));
  approx(sum(engine.DEFAULT_HOURLY_PERCENT), 100);
  assert.equal(Object.isFrozen(engine.DEFAULT_HOURLY_PERCENT), true);
});

test('actual map preserves winter/summer consumption, PV replacement and grid/storage bounds', () => {
  const map = engine.buildActualMap(actualFixture());
  assert.deepEqual([...map.keys()], ['2026-01-12', '2026-07-12', '2026-09-09']);
  const winter = map.get('2026-01-12');
  assert.equal(winter.isComplete, true);
  assert.equal(winter.hours[0].use, 6);
  assert.equal(winter.hours[12].use, 2);
  assert.equal(winter.hours[0].pv, 0);
  assert.equal(winter.hours[0].hasPv, true);
  assert.equal(winter.hours[12].pv, 8);
  assert.equal(winter.hours[0].buyBank, 2);
  assert.equal(winter.hours[0].soldBank, 1);
  assert.equal(winter.socOut, 9.5);
  assert.equal(winter.hours[0].batteryKwh, 0.3);
  assert.equal(map.get('2026-07-12').hours[12].use, 1);
  const current = map.get('2026-09-09');
  assert.equal(current.isComplete, false);
  assert.equal(current.hours[10].use, 1);
  assert.equal(current.hours[11].hasUse, false);
  assert.equal(current.totalUse, 21);
});

test('actual zero differs from missing; aliases do not coerce null, empty or boolean to measurements', () => {
  const row = record('2026-09-09');
  row.quarters = [0, 1, 2, 3].map(hour => ({ ...row.quarters[hour * 4], totalLoadKwh: null }));
  Object.assign(row.quarters[0], { totalLoadKwh: 0, load: 99 });
  Object.assign(row.quarters[1], { totalLoadKwh: '', load: false, usageKwh: null, pvGenerationKwh: 4 });
  Object.assign(row.quarters[2], { totalLoadKwh: false, load: '2.5' });
  Object.assign(row.quarters[3], { totalLoadKwh: -2 });
  const actualDay = engine.buildActualMap(payload([row])).get(row.date);
  assert.deepEqual(actualDay.hours.slice(0, 4).map((hour: any) => [hour.use, hour.hasUse]),
    [[0, true], [0, false], [2.5, true], [0, true]]);
  const hours = engine.resolveDay({ dayKey: row.date, annualKwh: 8760,
    defaultHourlyPercent: fill(100 / 24), actualDay });
  assert.deepEqual(hours.slice(0, 5), [0, 1, 2.5, 0, 1]);
});

test('actual map requires a cutoff and never treats PV-only or incomplete past days as measured usage', () => {
  assert.equal(engine.buildActualMap({}).size, 0);
  assert.equal(engine.buildActualMap({ usageData: { records: [record('2026-01-01')] } }).size, 0);
  assert.equal(engine.buildForecastModel({}), null);
});

test('complete actual usage precedes XLSX/PV reconstruction; incomplete flags still overlay matching hours', () => {
  const actualDay = { isComplete: true, hours: fill(0).map(() => ({ use: 0, hasUse: true })) };
  const inputs = { dayKey: '2026-07-12', annualKwh: 3650, sources: sources('xlsx'),
    hourlyProfile: fill(5), hasExport: true, actualDay };
  assert.deepEqual(engine.resolveDay(inputs), fill(0));
  actualDay.hours[12].hasUse = false;
  assert.throws(() => engine.resolveDay(inputs), /Brak godzinowej energii oddanej/);
  assert.deepEqual(engine.resolveDay({ ...inputs, hasExport: false }),
    fill(0).map((value, hour) => hour === 12 ? 5 : value));
});

test('XLSX adds PV self-consumption once and only when the export source is XLSX', () => {
  const pvHourlyKwh = fill(3);
  const exportHourlyKwh = fill(2);
  exportHourlyKwh[12] = 5;
  pvHourlyKwh[0] = 0;
  exportHourlyKwh[0] = 0;
  const inputs = { dayKey: '2026-07-12', annualKwh: 3650, sources: sources('xlsx'),
    hourlyProfile: fill(1), learnedHours: fill(50), pvHourlyKwh, exportHourlyKwh };
  assert.deepEqual(engine.resolveDay(inputs), fill(1));
  const hours = engine.resolveDay({ ...inputs, hasExport: true });
  assert.equal(hours[0], 1);
  assert.equal(hours[12], 1);
  assert.equal(hours[13], 2);
  const actualDay = { isComplete: false, hours: fill(0).map((_, hour) => ({ use: 0, hasUse: hour === 13 })) };
  assert.equal(engine.resolveDay({ ...inputs, hasExport: true, actualDay })[13], 0);
  const corrected = engine.reconstructPvLoad(inputs.hourlyProfile, pvHourlyKwh, exportHourlyKwh);
  assert.deepEqual(corrected, hours);
  assert.deepEqual(engine.resolveDay({ ...inputs, hourlyProfile: corrected, hasExport: false }), hours);
});

test('XLSX reconstruction rejects absent, incomplete or nonnumeric PV/export instead of estimating', () => {
  const inputs = { dayKey: '2026-07-12', annualKwh: 3650, sources: sources('xlsx'),
    hourlyProfile: fill(1), hasExport: true, exportHourlyKwh: fill(0), pvHourlyKwh: fill(0) };
  for (const bad of [undefined, null, [], fill(1).slice(1), new Array(24),
    fill(1).map((value, hour) => hour === 3 ? null : value),
    fill(1).map((value, hour) => hour === 3 ? NaN : value)]) {
    assert.throws(() => engine.resolveDay({ ...inputs, pvHourlyKwh: bad }), /Brak danych PV/);
    assert.throws(() => engine.resolveDay({ ...inputs, exportHourlyKwh: bad }), /Brak godzinowej energii oddanej/);
  }
  assert.deepEqual(engine.resolveDay(inputs), fill(1));
});

test('explicit monthly sources precede learned forecast; standard ignores supplied XLSX/monthly values', () => {
  const inputs = { dayKey: '2026-07-12', annualKwh: 8760, monthlyKwh: new Array(12).fill(1488),
    learnedHours: fill(8), defaultHourlyPercent: fill(100 / 24) };
  for (const source of ['manual', 'xlsx', 'real', 'part', 'forecast', 'XLSX', 'unknown']) {
    assert.deepEqual(engine.resolveDay({ ...inputs, sources: sources(source) }), fill(2), source);
    assert.deepEqual(engine.resolveDay({ ...inputs, sources: sources(source), hourlyProfile: fill(3) }), fill(3));
  }
  assert.deepEqual(engine.resolveDay(inputs), fill(2));
  assert.deepEqual(engine.resolveDay({ ...inputs, sources: sources('standard'), hourlyProfile: fill(3) }), fill(8));
  assert.deepEqual(engine.resolveDay({ ...inputs, monthlyKwh: null }), fill(8));
  assert.deepEqual(engine.resolveDay({ ...inputs, monthlyKwh: null, learnedHours: null }), fill(1));
});

test('monthly selection, decimal comma, zero and original default percentages match RE', () => {
  const monthlyKwh = new Array(12).fill('310,5');
  monthlyKwh[6] = '0';
  assert.deepEqual(engine.resolveDay({ dayKey: '2026-07-12', annualKwh: 8760, monthlyKwh }), fill(0));
  approx(sum(engine.resolveDay({ dayKey: '2026-01-12', annualKwh: 8760, monthlyKwh })), 310.5 / 31);
  const hours = engine.resolveDay({ dayKey: '2026-07-12', annualKwh: 36500 });
  assert.deepEqual(hours, engine.DEFAULT_HOURLY_PERCENT);
  const mixed = sources('standard');
  mixed[6] = 'manual';
  assert.deepEqual(engine.resolveDay({ dayKey: '2026-07-12', annualKwh: 8760,
    monthlyKwh, sources: mixed, learnedHours: fill(8) }), fill(0));
  assert.deepEqual(engine.resolveDay({ dayKey: '2026-01-12', annualKwh: 8760,
    monthlyKwh, sources: mixed, learnedHours: fill(8) }), fill(8));
});

test('calendar totals use leap year and local civil month independently of host timezone', () => {
  for (const [dayKey, days] of [['2024-02-29', 29], ['2026-02-01', 28], ['2026-04-01', 30], ['2026-07-01', 31]] as const) {
    const inputs = { dayKey, annualKwh: 3660, monthlyKwh: new Array(12).fill(days * 24), defaultHourlyPercent: fill(100 / 24) };
    assert.deepEqual(engine.resolveDay(inputs), fill(1));
    for (const timezone of ['UTC', 'America/Los_Angeles']) {
      const code = `const engine = require(${JSON.stringify(modulePath)}); process.stdout.write(JSON.stringify(engine.resolveDay(${JSON.stringify(inputs)})));`;
      const result = execFileSync(process.execPath, ['-e', code], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' });
      assert.deepEqual(JSON.parse(result), fill(1));
    }
  }
  approx(sum(engine.resolveDay({ dayKey: '2024-02-29', annualKwh: 3660 })), 10);
  approx(sum(engine.resolveDay({ dayKey: '2026-02-01', annualKwh: 3650 })), 10);
});

test('forecast uses last 28 valid days and monthly weights of zero, 7/28, 14/28 and 28/28', () => {
  const model = engine.buildForecastModel(seasonalFixture());
  assert.equal(model.days, 55);
  assert.equal(model.recentDays, 28);
  assert.equal(model.firstDate, '2026-01-01');
  assert.equal(model.lastDate, '2026-07-28');
  assert.equal(model.cutoffDate, '2026-09-09');
  assert.deepEqual(model.monthDays, [6, 7, 14, 0, 0, 0, 28, 0, 0, 0, 0, 0]);
  assert.deepEqual(model.monthlyHours[0], fill(16));
  assert.deepEqual(model.monthlyHours[1], fill(14));
  assert.deepEqual(model.monthlyHours[2], fill(14));
  assert.deepEqual(model.monthlyHours[6], fill(16));
  assert.deepEqual(model.monthlyHours[11], fill(16));
  assert.notEqual(model.monthlyHours[0], model.monthlyHours[11]);
});

const invalidDays: Array<[string, (row: UsageRecord) => void]> = [
  ['missing slot', row => { row.quarters.pop(); }],
  ['coverage below 98%', row => { row.measurementCoverage = 0.979; }],
  ['measured slot count mismatch', row => { row.measuredSlotCount = 95; }],
  ['negative load', row => { row.quarters[12].totalLoadKwh = -1; }],
  ['missing load', row => { row.quarters[12].totalLoadKwh = null; }],
  ['boolean load', row => { row.quarters[12].totalLoadKwh = false; }],
  ['empty load', row => { row.quarters[12].totalLoadKwh = ''; }],
  ['invalid start', row => { row.quarters[12].slotStart = 'invalid'; }],
  ['invalid end', row => { row.quarters[12].slotEnd = 'invalid'; }],
  ['wrong duration', row => { row.quarters[12].slotEnd = row.quarters[13].slotEnd; }],
  ['duplicate slot', row => { row.quarters[12] = { ...row.quarters[11] }; }],
  ['gap or unsorted slots', row => { [row.quarters[11], row.quarters[12]] = [row.quarters[12], row.quarters[11]]; }],
  ['wrong civil day', row => { row.quarters[12].slotStart = row.quarters[12].slotStart.replace('2026-07-12', '2026-07-11'); }],
  ['shifted full day', row => { row.quarters.forEach(slot => {
    slot.slotStart = localStamp(Date.parse(slot.slotStart) + 900000);
    slot.slotEnd = localStamp(Date.parse(slot.slotEnd) + 900000);
  }); }],
];

for (const [name, invalidate] of invalidDays) {
  test(`forecast rejects ${name}`, () => {
    const row = record('2026-07-12');
    invalidate(row);
    assert.equal(engine.buildForecastModel(payload([row])), null);
  });
}

test('forecast accepts 98% coverage and true zeros, but excludes quality issues and open/old days', () => {
  const row = record('2026-07-12', 0);
  row.measurementCoverage = 0.98;
  assert.deepEqual(engine.buildForecastModel(payload([row])).monthlyHours[0], fill(0));
  for (const issue of [{ from: row.date, to: row.date }, { datetime: `${row.date} 13:00:00` }]) {
    assert.equal(engine.buildForecastModel({ ...payload([row]), dataQuality: { issues: [issue] } }), null);
  }
  const model = engine.buildForecastModel(payload([
    record('2025-09-08'), record('2025-09-09'), record('2026-09-09'), record('2026-09-10'),
  ]));
  assert.equal(model.days, 1);
  assert.equal(model.firstDate, '2025-09-09');
});

test('forecast deduplicates dates with the last valid record and averages recent valid days', () => {
  const first = record('2026-07-12', 0.25);
  const replacement = record('2026-07-12', 0.5);
  const model = engine.buildForecastModel(payload([first, record('2026-07-14', 1), replacement]));
  assert.equal(model.days, 2);
  assert.equal(model.recentDays, 2);
  assert.deepEqual(model.monthlyHours[0], fill(3));
});

for (const [date, slots, duration] of [['2026-03-29', 92, 23], ['2025-10-26', 100, 25]] as const) {
  test(`forecast normalizes ${slots}-slot DST day ${date} to 24 hours`, () => {
    const row = record(date, 0.25);
    assert.equal(row.quarters.length, slots);
    const model = engine.buildForecastModel(payload([row]));
    assert.equal(model.days, 1);
    approx(sum(model.monthlyHours[0]), 24);
    approx(model.monthlyHours[0][1], 24 / duration);
    approx(model.monthlyHours[0][2], slots === 92 ? 0 : 48 / duration);
    const actual = engine.buildActualMap(payload([row])).get(date);
    assert.equal(actual.isComplete, true);
    approx(actual.totalUse, duration);
  });
}

test('calculations do not mutate payloads or reuse caller-owned output arrays', () => {
  function freeze(value: any) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  const data = freeze(actualFixture());
  const before = JSON.stringify(data);
  engine.buildActualMap(data);
  engine.buildForecastModel(data);
  assert.equal(JSON.stringify(data), before);
  for (const inputs of [
    { dayKey: '2026-07-12', annualKwh: 8760, learnedHours: fill(2) },
    { dayKey: '2026-07-12', annualKwh: 8760, sources: sources('xlsx'), hourlyProfile: fill(2),
      pvHourlyKwh: fill(3), exportHourlyKwh: fill(1), hasExport: true },
  ]) {
    const snapshot = JSON.stringify(inputs);
    freeze(inputs);
    engine.resolveDay(inputs)[0] = 999;
    assert.equal(JSON.stringify(inputs), snapshot);
  }
});

test('buildProfile aggregates calendar months, hourly sums and weekday/weekend averages without rounding', () => {
  let calls = 0;
  const result = engine.buildProfile({
    year: 2026, annualKwh: 8760, sources: sources('xlsx'), exportSources: sources('xlsx'),
    getDayInputs: (dayKey: string) => {
      calls += 1;
      const weekday = new Date(`${dayKey}T12:00:00Z`).getUTCDay();
      return { hourlyProfile: fill(weekday === 0 || weekday === 6 ? 3 : 1), hasExport: false };
    },
  });
  assert.equal(calls, 365);
  assert.equal(result.months.length, 12);
  const july = result.months[6];
  assert.equal(july.month, 7);
  assert.equal(july.year, 2026);
  assert.equal(july.weekdayDays, 23);
  assert.equal(july.weekendDays, 8);
  assert.deepEqual(july.weekdayHourly, fill(1));
  assert.deepEqual(july.weekendHourly, fill(3));
  assert.deepEqual(july.hourly, fill(47));
  assert.equal(july.totalKwh, 1128);
  assert.equal(july.importSource, 'xlsx');
  assert.equal(july.exportSource, 'xlsx');
  assert.equal(july.hasData, true);
  assert.equal(result.annualKwh, sum(result.months.map((month: any) => month.totalKwh)));
  assert.equal(result.annualKwh, (261 + 104 * 3) * 24);
  for (const month of result.months) approx(sum(month.hourly), month.totalKwh);

  const leap = engine.buildProfile({ year: 2024, annualKwh: 8784, defaultHourlyPercent: fill(100 / 24) });
  assert.equal(leap.annualKwh, 8784);
  assert.equal(leap.months[1].weekdayDays + leap.months[1].weekendDays, 29);
  const zero = engine.buildProfile({ year: 2026, annualKwh: 0 });
  assert.equal(zero.annualKwh, 0);
  assert.equal(zero.months.every((month: any) => month.hasData), true);
});

function labeledProfileFixture() {
  const importSources = ['xlsx', 'xlsx', 'standard', 'standard', 'manual', 'xlsx',
    'xlsx', 'real', 'part', 'forecast', 'standard', 'manual'];
  const exportSources = ['xlsx', 'xlsx', 'xlsx', 'standard', 'manual', 'xlsx',
    'standard', 'standard', 'standard', 'xlsx', 'standard', 'standard'];
  const actuals = new Map();
  for (let day = 1; day <= 31; day += 1) {
    actuals.set(`2026-01-${String(day).padStart(2, '0')}`, {
      isComplete: true, hours: fill(0).map(() => ({ hasUse: true, use: 0 })),
    });
  }
  actuals.set('2026-02-01', {
    isComplete: false, hours: fill(0).map((_, hour) => ({ hasUse: hour === 1, use: 0 })),
  });
  return {
    actuals,
    inputs: {
      year: 2026, annualKwh: 8760, monthlyKwh: new Array(12).fill(1000),
      sources: importSources, exportSources,
      getDayInputs: (dayKey: string) => ({
        hourlyProfile: fill(2), hasExport: false, actualDay: actuals.get(dayKey),
        learnedHours: dayKey.slice(5, 7) === '03' ? fill(7) : null,
      }),
    },
  };
}

test('buildProfile preserves independent import/export display labels including zero real and partial data', () => {
  const { inputs } = labeledProfileFixture();
  const result = engine.buildProfile(inputs);
  assert.deepEqual(result.months.map((month: any) => [month.importSource, month.exportSource]), [
    ['real', 'real'], ['part', 'part'], ['forecast', 'standard'], ['standard', 'standard'],
    ['manual', 'manual'], ['xlsx', 'xlsx'], ['xlsx', 'standard'], ['real', 'real'],
    ['part', 'part'], ['forecast', 'standard'], ['standard', 'standard'], ['manual', 'standard'],
  ]);
  assert.equal(result.months[0].totalKwh, 0);
  assert.equal(result.months[0].hasData, true);
  assert.equal(result.months[1].totalKwh, 28 * 48 - 2);
});

test('buildProfile reconstructs grid profiles before aggregation and propagates missing PV errors', () => {
  const inputs = { year: 2026, annualKwh: 8760, sources: sources('xlsx'), exportSources: sources('xlsx') };
  const getDayInputs = () => ({ hourlyProfile: fill(1), pvHourlyKwh: fill(3), exportHourlyKwh: fill(2) });
  const result = engine.buildProfile({ ...inputs, getDayInputs });
  assert.equal(result.annualKwh, 17520);
  assert.throws(() => engine.buildProfile({ ...inputs,
    getDayInputs: () => ({ ...getDayInputs(), pvHourlyKwh: null }) }), /Brak danych PV/);
  assert.throws(() => engine.buildProfile({ year: 2026, annualKwh: NaN }), /Brak kompletnego profilu/);
  assert.throws(() => engine.buildProfile({ year: NaN, annualKwh: 8760 }), /Nieprawidłowy rok/);
});

test('parity: actual maps match named canonical RE functions for seasons, current cutoff and DST', parityOptions, () => {
  const reference = legacy();
  for (const data of [actualFixture(), payload([record('2026-03-29'), record('2025-10-26')]), {},
    payload([record('2026-09-09')], '2026-09-09 00:00:00')]) {
    assert.deepEqual(plain([...engine.buildActualMap(data)]), plain([...reference.buildReActualHourlyMapFromPayload(data)]));
  }
});

test('parity: forecasts match named canonical RE functions including quality gates and DST', parityOptions, () => {
  const reference = legacy();
  const invalid = invalidDays.map(([, invalidate]) => { const row = record('2026-07-12'); invalidate(row); return payload([row]); });
  for (const data of [seasonalFixture(), actualFixture(), payload([record('2026-03-29'), record('2025-10-26')]),
    ...invalid, { ...payload([record('2026-07-12')]), dataQuality: { issues: [{ datetime: '2026-07-12 13:00' }] } }]) {
    assert.deepEqual(plain(engine.buildForecastModel(data)), plain(reference.buildReUsageForecastModel(data)));
  }
});

test('parity: resolveDay matches canonical profile, reconstruction, seasonal and actual precedence', parityOptions, () => {
  const actuals = engine.buildActualMap(actualFixture());
  for (const dayKey of ['2026-01-12', '2026-07-12', '2026-09-09', '2024-02-29']) {
    for (const source of ['standard', 'manual', 'xlsx', 'real', 'part', 'forecast']) {
      const base = { dayKey, annualKwh: 8760, sources: sources(source), monthlyKwh: new Array(12).fill(1000),
        learnedHours: fill(7), actualDay: actuals.get(dayKey) };
      for (const inputs of [base, { ...base, actualDay: null },
        { ...base, hourlyProfile: fill(2), hasExport: false },
        { ...base, hourlyProfile: fill(2), hasExport: true, pvHourlyKwh: fill(3), exportHourlyKwh: fill(1) },
        { ...base, monthlyKwh: null, learnedHours: null, actualDay: null },
        { ...base, sources: null, defaultHourlyPercent: null, actualDay: null },
      ]) {
        assert.deepEqual(engine.resolveDay(inputs), legacyDay(inputs), `${dayKey}/${source}`);
      }
    }
  }
});

test('parity: buildProfile totals and source arrows match canonical RE day calculations and display rules', parityOptions, () => {
  const { inputs, actuals } = labeledProfileFixture();
  const result = engine.buildProfile(inputs);
  const reference = legacy({
    START: '2026-01-01T00:00:00', usageMonthlyProfileKWh: inputs.monthlyKwh,
    usageMonthlySources: inputs.sources, usageMonthlyExportSources: inputs.exportSources,
    reActualHourlyByDay: actuals,
  });
  for (const month of result.months) {
    reference.reUsageForecastModel = month.month === 3 ? {} : null;
    assert.equal(month.importSource, reference.getUsageMonthDisplaySource(month.month - 1));
    assert.equal(month.exportSource, reference.getUsageMonthExportDisplaySource(month.month - 1));
    let total = 0;
    for (let day = 1; day <= month.weekdayDays + month.weekendDays; day += 1) {
      const dayKey = `2026-${String(month.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      total += sum(legacyDay({ ...inputs, ...inputs.getDayInputs(dayKey), dayKey }));
    }
    assert.equal(month.totalKwh, total);
  }
});
