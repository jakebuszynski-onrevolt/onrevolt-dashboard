import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { prisma } from './prisma';
import { rePrisma } from './re-stations';
import type { ReConsumptionProfile } from './re-consumption-api';
import { buildReEnergyUsageProfile, readProjectReConsumptionProfile } from './re-consumption-profile';

const profile = (): ReConsumptionProfile => ({ station: '41', months: null, sources: null, exportSources: null,
  annualUsageKwh: 3650, hourlyProfile: { exists: false, rows: 0 } });
const dashboard = () => ({ account: { dateStart: '2026-01-01', pvSizeKwp: 1.23456, lat: 52, lon: 16 }, energy: {} });
const january = () => Array.from({ length: 31 * 24 }, (_, i): [string, number, number] =>
  [`2025-01-${String(Math.floor(i / 24) + 1).padStart(2, '0')} ${String(i % 24).padStart(2, '0')}:00:00`, 1, 0.5]);
function xlsx() {
  const p = profile();
  p.months = Array(12).fill(100); p.sources = Array(12).fill('manual'); p.sources[0] = 'xlsx';
  p.exportSources = Array(12).fill('standard'); p.exportSources[0] = 'xlsx';
  p.hourlyProfile = { exists: true, rows: 744 };
  return p;
}
function timezone(t: TestContext, zone = 'Europe/Warsaw') {
  const previous = process.env.TZ; process.env.TZ = zone;
  t.after(() => { if (previous == null) delete process.env.TZ; else process.env.TZ = previous; });
}
function actualRecord(date = '2026-01-01') {
  return { date, slotCount: 96, measurementCoverage: 1, measuredSlotCount: 96,
    quarters: Array.from({ length: 96 }, (_, i) => ({ hour: Math.floor(i / 4), totalLoadKwh: 0.5,
      slotStart: new Date(Date.parse(`${date}T00:00:00+01:00`) + i * 900000).toLocaleString('sv-SE', { timeZone: 'Europe/Warsaw' }).replace(' ', 'T') + '+01:00',
      slotEnd: new Date(Date.parse(`${date}T00:00:00+01:00`) + (i + 1) * 900000).toLocaleString('sv-SE', { timeZone: 'Europe/Warsaw' }).replace(' ', 'T') + '+01:00' })) };
}

test('declaration uses the shared percentages, Jan-Dec and no RE attribution without a link', () => {
  const result = buildReEnergyUsageProfile({ profile: profile(), dashboard: dashboard(), linked: false });
  assert.equal(result.source, undefined); assert.equal(result.months.length, 12);
  assert.equal(result.months[0].hourly[0], 31 * 10 * 2.97 / 100);
  assert.equal(result.months[0].weekdayDays + result.months[0].weekendDays, 31);
  assert.equal(result.annualKwh, result.months.reduce((sum, month) => sum + month.totalKwh, 0));
});

test('XLSX reconstructs existing PV rounded through watts and keeps both source arrows', () => {
  const hourly = january();
  const result = buildReEnergyUsageProfile({ profile: xlsx(), dashboard: dashboard(), hourly,
    pv: hourly.map(([stamp]) => [stamp, 1000]) });
  assert.ok(Math.abs(result.months[0].totalKwh - 744 * (1 + 1.235 * 1.05 - 0.5)) < 1e-8);
  assert.equal(result.months[0].importSource, 'xlsx'); assert.equal(result.months[0].exportSource, 'xlsx');
  assert.equal(result.months[0].sourceFiles, 1); assert.equal(result.pvIncluded, true);
});

test('required PV and missing XLSX hours fail visibly, without monthly substitution', () => {
  assert.throws(() => buildReEnergyUsageProfile({ profile: xlsx(), dashboard: dashboard(), hourly: january() }), /Brak danych PV/);
  assert.throws(() => buildReEnergyUsageProfile({ profile: xlsx(), dashboard: { account: { dateStart: '2026-01-01', pvSizeKwp: 0 } } }), /Brak mocy PV/);
  const p = xlsx(); p.exportSources[0] = 'standard';
  assert.throws(() => buildReEnergyUsageProfile({ profile: p, dashboard: dashboard() }), /Brak godzinowego profilu XLSX/);
});

test('raw API energy cutoff drives real overlay, forecast and source display', t => {
  timezone(t);
  const result = buildReEnergyUsageProfile({ profile: profile(), dashboard: { ...dashboard(),
    energy: { datetime: '2026-01-02 12:00:00' }, usageData: { records: [actualRecord()] } } });
  assert.ok(Math.abs(result.annualKwh - 365 * 48) < 1e-8);
  assert.equal(result.months[0].importSource, 'part'); assert.equal(result.months[0].exportSource, 'part');
  assert.equal(result.months[1].importSource, 'forecast'); assert.equal(result.months[1].exportSource, 'standard');
});

test('historyStart selects the calendar year and excludes earlier actual records', t => {
  timezone(t);
  const result = buildReEnergyUsageProfile({ profile: profile(), dashboard: { account: { historyStart: '2026-08-27' },
    energy: { datetime: '2026-09-01 00:00:00' }, usageData: { records: [actualRecord()] } } });
  assert.equal(result.months[0].key, '2026-01'); assert.equal(result.measuredDays, 0);
  assert.equal(result.months[0].importSource, 'standard');
});

function linked(t: TestContext, hasMeasurements: boolean, fixture: {
  profile?: ReConsumptionProfile; metadata?: Record<string, unknown>; rows?: Record<string, unknown>[];
} = {}) {
  const previous = process.env.ONREVOLT_RE_DATABASE_URL;
  process.env.ONREVOLT_RE_DATABASE_URL = 'mysql://test:test@localhost:1/unused';
  t.after(() => { if (previous == null) delete process.env.ONREVOLT_RE_DATABASE_URL; else process.env.ONREVOLT_RE_DATABASE_URL = previous; });
  const originalFind = prisma.project.findFirst;
  prisma.project.findFirst = (async () => ({ dashboardStation: 'token', dashboardStationNumber: '41' })) as typeof originalFind;
  t.after(() => { prisma.project.findFirst = originalFind; });
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ok: true, data: fixture.profile || profile() })));
  const queries: string[] = [];
  const db = rePrisma(), originalQuery = db.$queryRawUnsafe;
  db.$queryRawUnsafe = (async (sql: string) => {
    queries.push(sql);
    if (sql.startsWith('SHOW TABLES')) return [{}];
    if (sql.startsWith('SHOW COLUMNS')) return [{ Field: 'station' }, { Field: 'station_hash' }];
    if (sql.includes('DATE_FORMAT')) return [{ dateStart: '2026-08-27', annualUsageKwh: 500, pvSizeKwp: 8, lat: 52, lon: 16, ...fixture.metadata }];
    if (sql.includes('FROM EnergyMeter_users_usage_hourly')) return fixture.rows || [];
    if (sql.startsWith('SELECT 1 FROM EnergyMeter ')) return hasMeasurements ? [{ 1: 1 }] : [];
    return [{ station: '41', station_hash: 'token' }];
  }) as typeof originalQuery;
  t.after(() => { db.$queryRawUnsafe = originalQuery; });
  return queries;
}

test('confirmed absence uses indexed existence and explicit profile-only, not CLI', async t => {
  const queries = linked(t, false);
  const result = await readProjectReConsumptionProfile('project', { clientId: 'client' });
  assert.equal(result.source, 'RE'); assert.equal(result.station, '41'); assert.equal(result.measuredDays, 0);
  assert.ok(queries.includes('SELECT 1 FROM EnergyMeter USE INDEX (station) WHERE station=? LIMIT 1'));
  assert.ok(queries.every(sql => !/\b(UPDATE|INSERT|ALTER|DELETE|COUNT)\b/i.test(sql)));
});

test('a measured station surfaces CLI failure instead of using declaration or files', async t => {
  linked(t, true);
  const previous = process.env.ONREVOLT_PHP_BIN;
  process.env.ONREVOLT_PHP_BIN = 'nonexistent-re-profile-test-php';
  t.after(() => { if (previous == null) delete process.env.ONREVOLT_PHP_BIN; else process.env.ONREVOLT_PHP_BIN = previous; });
  await assert.rejects(readProjectReConsumptionProfile('project'), /odczytać dashboardu RE/);
});

test('import-only XLSX with existing PV warns but does not invent self-consumption', () => {
  const p = xlsx(); p.exportSources[0] = 'standard';
  const result = buildReEnergyUsageProfile({ profile: p, dashboard: dashboard(), hourly: january() });
  assert.equal(result.months[0].totalKwh, 744);
  assert.equal(result.months[0].exportSource, 'standard'); assert.equal(result.pvIncluded, false);
  assert.match(result.warnings[0], /Brak plików energii oddanej: Styczeń;.*nie pełne zużycie budynku/);
});

test('complete measured month overrides import-only XLSX and suppresses its warning', t => {
  timezone(t);
  const p = xlsx(); p.exportSources[0] = 'standard';
  const records = Array.from({ length: 31 }, (_, day) => actualRecord(`2026-01-${String(day + 1).padStart(2, '0')}`));
  const result = buildReEnergyUsageProfile({ profile: p, dashboard: { ...dashboard(),
    energy: { datetime: '2026-02-01 12:00:00' }, usageData: { records } } });
  assert.equal(result.months[0].totalKwh, 31 * 48); assert.equal(result.months[0].importSource, 'real');
  assert.equal(result.months[0].exportSource, 'real'); assert.deepEqual(result.warnings, []);
});

test('unlinked project reads only its scoped annual declaration', async t => {
  const originalFind = prisma.project.findFirst, originalAudit = prisma.energyAudit.findUnique;
  prisma.project.findFirst = (async (args: any) => {
    assert.deepEqual(args.where, { id: 'project', clientId: 'client' });
    return { dashboardStation: null, dashboardStationNumber: null };
  }) as typeof originalFind;
  prisma.energyAudit.findUnique = (async () => ({ annualConsumptionKwh: 3650 })) as unknown as typeof originalAudit;
  t.after(() => { prisma.project.findFirst = originalFind; prisma.energyAudit.findUnique = originalAudit; });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected RE request'); });
  const result = await readProjectReConsumptionProfile('project', { clientId: 'client' });
  assert.equal(result.source, undefined); assert.equal(result.months.length, 12);
  assert.ok(result.months.every(month => month.importSource === 'standard' && month.sourceFiles === 0));
});

test('UTC fails explicitly for measurements but permits the timezone-independent profile-only path', t => {
  timezone(t, 'UTC');
  assert.throws(() => buildReEnergyUsageProfile({ profile: profile(), dashboard: { ...dashboard(),
    energy: { datetime: '2026-01-02 12:00:00' }, usageData: { records: [actualRecord()] } } }), /TZ=Europe\/Warsaw/);
  assert.equal(buildReEnergyUsageProfile({ profile: profile(), dashboard: dashboard() }).months.length, 12);
});

function series(from: string, to: string, value: (date: Date) => number): Array<[string, number, number]> {
  return Array.from({ length: (Date.parse(to) - Date.parse(from)) / 3600000 }, (_, hour) => {
    const date = new Date(Date.parse(from) + hour * 3600000);
    return [date.toISOString().slice(0, 19).replace('T', ' '), value(date), 0.5];
  });
}

for (const [name, from, to] of [['calendar', '2026-01-01', '2027-01-01'], ['RE range', '2026-08-27', '2027-08-27']]) {
  test(`August 27 start selects January-December PV correctly from ${name} rows`, () => {
    const p = xlsx(); p.sources.fill('xlsx'); p.exportSources.fill('xlsx');
    const result = buildReEnergyUsageProfile({ profile: p,
      dashboard: { account: { dateStart: '2026-08-27', pvSizeKwp: 1 } },
      hourly: series('2024-01-01', '2025-01-01', () => 1),
      pv: series(from, to, date => (date.getUTCMonth() + 1) * 1000) });
    result.months.forEach(month => {
      const days = new Date(Date.UTC(2026, month.month, 0)).getUTCDate();
      assert.ok(Math.abs(month.totalKwh - days * 24 * (1 + month.month * 1.05 - 0.5)) < 1e-7, month.key);
    });
  });
}

test('database month/day rows retain February 29 in a leap-year projection', async t => {
  const p = xlsx(); p.sources.fill('manual'); p.sources[1] = 'xlsx'; p.exportSources.fill('standard');
  const rows = Array.from({ length: 29 * 24 }, (_, hour) => ({ month_no: 2, day_no: Math.floor(hour / 24) + 1,
    hour_no: hour % 24, kwh: 1, export_kwh: 0 }));
  linked(t, false, { profile: p, metadata: { dateStart: '2028-08-27' }, rows });
  const result = await readProjectReConsumptionProfile('project');
  assert.equal(result.months[1].key, '2028-02'); assert.equal(result.months[1].totalKwh, 29 * 24);
  assert.equal(result.months[1].weekdayDays + result.months[1].weekendDays, 29);
});
