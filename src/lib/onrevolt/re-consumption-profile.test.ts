import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { prisma } from './prisma';
import { rePrisma } from './re-stations';
import type { ReConsumptionProfile } from './re-consumption-api';
import { buildReEnergyUsageProfile, readProjectReConsumptionProfile } from './re-consumption-profile';
import { resolveProjectAnalysisPeriod } from './project-analysis-period';
import type { CatalogProfile } from './reference-profile-comparison';
import { buildReferenceProfileProjection } from './reference-profile-comparison';
import { profileContentHash } from '../../../scripts/profile-catalog/storage-core';

const profileCatalog = JSON.parse(readFileSync(path.join(process.cwd(), 'output', 'profile-catalog-20261106', 'catalog.json'), 'utf8')) as { profiles: CatalogProfile[] };
const bdewH25 = profileCatalog.profiles.find(item => item.key === 'bdew-2025-h25')!;

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

test('explicit rolling period keeps actual dates and annual shares within its twelve months', t => {
  timezone(t);
  const period = resolveProjectAnalysisPeriod('2025-10', new Date('2026-10-30T12:00:00.000Z'));
  const result = buildReEnergyUsageProfile({ profile: profile(), analysisPeriod: period,
    dashboard: { account: { dateStart: '2024-08-27' }, energy: { datetime: '2026-10-02 12:00:00' },
      usageData: { records: [actualRecord('2025-10-01'), actualRecord('2026-09-30'), actualRecord('2026-10-01')] } } });

  assert.deepEqual(result.months.map(month => month.key), period.periodKeys);
  assert.equal(result.months[0].importSource, 'part');
  assert.equal(result.months[11].importSource, 'part');
  assert.equal(result.measuredDays, 2);
  assert.equal(result.annualKwh, result.months.reduce((sum, month) => sum + month.totalKwh, 0));
  assert.ok(Math.abs(result.months.reduce((sum, month) => sum + month.sharePercent, 0) - 100) < 1e-8);
});

test('XLSX from a different year remains a forecast pattern in an explicit period', () => {
  const p = xlsx();
  p.exportSources.fill('standard');
  const years = { imports: Array<number | null>(12).fill(null), exports: Array<number | null>(12).fill(null) };
  years.imports[0] = 2025;
  const period = resolveProjectAnalysisPeriod('2026-01', new Date('2027-02-15T12:00:00.000Z'));
  const result = buildReEnergyUsageProfile({ profile: p, dashboard: dashboard(), hourly: january(),
    hourlySourceYears: years, analysisPeriod: period });

  assert.equal(result.months[0].key, '2026-01');
  assert.equal(result.months[0].importSource, 'forecast');
  assert.equal(result.months[0].sourceFiles, 0);
  assert.match(result.warnings.join(' '), /pochodzi z 2025; pokazano go jako prognozę dla 2026/);
  assert.equal(result.measuredDays, 0);
});

function linked(t: TestContext, hasMeasurements: boolean, fixture: {
  profile?: ReConsumptionProfile; metadata?: Record<string, unknown>; rows?: Record<string, unknown>[];
  history?: Record<string, unknown>[];
  analysisStartMonth?: string | null;
  project?: {
    offerWorkspace?: { input?: unknown } | null;
    energyAudits?: Array<Record<string, unknown>>;
    investmentSite?: { latitude?: unknown; longitude?: unknown } | null;
  };
  pvRows?: Array<[string, number, number?]>;
  pvUrls?: string[];
  projectQuery?: (args: any) => void;
  referenceSelection?: { key: string | null; revision: number; contentHash: string | null; profileName: string | null };
  referenceProfile?: CatalogProfile;
} = {}) {
  const previous = process.env.ONREVOLT_RE_DATABASE_URL;
  process.env.ONREVOLT_RE_DATABASE_URL = 'mysql://test:test@localhost:1/unused';
  t.after(() => { if (previous == null) delete process.env.ONREVOLT_RE_DATABASE_URL; else process.env.ONREVOLT_RE_DATABASE_URL = previous; });
  const originalFind = prisma.project.findFirst;
  prisma.project.findFirst = (async (args: any) => {
    fixture.projectQuery?.(args);
    return {
      dashboardStation: 'token', dashboardStationNumber: '41',
      offerWorkspace: fixture.project?.offerWorkspace ?? null,
      energyAudits: fixture.project?.energyAudits || [],
      investmentSite: fixture.project?.investmentSite ?? null,
    };
  }) as unknown as typeof originalFind;
  t.after(() => { prisma.project.findFirst = originalFind; });
  const originalRaw = prisma.$queryRaw;
  prisma.$queryRaw = (async (strings: TemplateStringsArray) => {
    const sql = Array.from(strings).join(' ');
    if (sql.includes('ProjectReferenceLoadProfile')) {
      if (!fixture.referenceSelection) return [];
      return [{ profileKey: fixture.referenceSelection.key, revision: fixture.referenceSelection.revision,
        contentHash: fixture.referenceSelection.contentHash, profileName: fixture.referenceSelection.profileName, projectionVersion: 1 }];
    }
    if (sql.includes('FROM ReferenceLoadProfile') && fixture.referenceProfile) {
      const profile = fixture.referenceProfile;
      return [{ key: profile.key, sourceKey: profile.sourceKey, name: profile.name, category: profile.category, kind: profile.kind,
        quantity: profile.quantity, unit: profile.unit, timeBasis: profile.timeBasis, resolutionMinutes: profile.resolutionMinutes,
        start: profile.start, end: profile.end, contentHash: profileContentHash(profile as any), pointCount: profile.series.length,
        seriesJson: JSON.stringify(profile.series), metadataJson: JSON.stringify(profile.metadata), qualityJson: JSON.stringify(profile.quality) }];
    }
    return [{ analysisStartMonth: fixture.analysisStartMonth ?? null }];
  }) as typeof originalRaw;
  t.after(() => { prisma.$queryRaw = originalRaw; });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.searchParams.get('api') === 'pv') {
      fixture.pvUrls?.push(url.toString());
      return new Response(JSON.stringify(fixture.pvRows || []));
    }
    return new Response(JSON.stringify({ ok: true, data: { ...(fixture.profile || profile()), measurementHistory: [] } }));
  });
  const queries: string[] = [];
  const db = rePrisma(), originalQuery = db.$queryRawUnsafe;
  db.$queryRawUnsafe = (async (sql: string) => {
    queries.push(sql);
    if (sql.startsWith('SHOW TABLES')) return [{}];
    if (sql.startsWith('SHOW COLUMNS')) return [{ Field: 'station' }, { Field: 'station_hash' }];
    if (sql.includes('DATE_FORMAT')) return [{ dateStart: '2026-08-27', annualUsageKwh: 500, pvSizeKwp: 8, lat: 52, lon: 16, ...fixture.metadata }];
    if (sql.includes('FROM EnergyMeter_users_usage_hourly')) return fixture.rows || [];
    if (sql.includes('FROM EnergyMeter_users_usage_history')) return fixture.history || [];
    if (sql.startsWith('SELECT 1 FROM EnergyMeter ')) return hasMeasurements ? [{ 1: 1 }] : [];
    return [{ station: '41', station_hash: 'token' }];
  }) as typeof originalQuery;
  t.after(() => { db.$queryRawUnsafe = originalQuery; });
  return queries;
}

function januaryDbRows() {
  return january().map(([stamp, imported, exported]) => ({
    month_no: 1,
    day_no: Number(stamp.slice(8, 10)),
    hour_no: Number(stamp.slice(11, 13)),
    kwh: imported,
    export_kwh: exported,
    source: 'xlsx',
    source_year: 2025,
    export_source: 'xlsx',
    export_source_year: 2025,
  }));
}

test('confirmed absence uses indexed existence and the effective default period, not CLI', async t => {
  const queries = linked(t, false);
  const result = await readProjectReConsumptionProfile('project', { clientId: 'client' });
  assert.equal(result.source, 'RE'); assert.equal(result.station, '41'); assert.equal(result.measuredDays, 0);
  const period = resolveProjectAnalysisPeriod(null);
  assert.equal(result.analysisStartMonth, period.startMonth);
  assert.deepEqual(result.months.map(month => month.key), period.periodKeys);
  assert.ok(queries.includes('SELECT 1 FROM EnergyMeter USE INDEX (station) WHERE station=? LIMIT 1'));
  assert.ok(queries.every(sql => !/\b(UPDATE|INSERT|ALTER|DELETE|COUNT)\b/i.test(sql)));
});

test('explicit project period overrides RE station dateStart and returns exactly those months', async t => {
  linked(t, false, { analysisStartMonth: '2025-10', metadata: { dateStart: '2024-08-27' } });
  const result = await readProjectReConsumptionProfile('project', { clientId: 'client' });
  const period = resolveProjectAnalysisPeriod('2025-10');
  assert.equal(result.analysisStartMonth, period.startMonth);
  assert.deepEqual(result.months.map(month => month.key), period.periodKeys);
  assert.equal(result.months[0].key, '2025-10');
  assert.equal(result.months[11].key, '2026-09');
  assert.equal(result.measuredDays, 0);
});

test('linked selected reference shape uses current CRM annual across an exact rolling year and returns daily provenance', async t => {
  const contentHash = profileContentHash(bdewH25 as any);
  const selection = { key: bdewH25.key, revision: 4, contentHash, profileName: bdewH25.name };
  linked(t, false, {
    profile: { ...profile(), annualUsageKwh: 99_999 },
    metadata: { annualUsageKwh: 88_888, dateStart: '2022-01-01' },
    analysisStartMonth: '2025-10',
    referenceSelection: selection,
    referenceProfile: bdewH25,
    project: { energyAudits: [{ annualConsumptionKwh: 3600.001, existingPvKw: 0 }] },
  });

  const result = await readProjectReConsumptionProfile('project');
  const monthlyTotal = result.months.reduce((sum, month) => sum + month.totalKwh, 0);
  const period = resolveProjectAnalysisPeriod('2025-10', new Date('2026-10-30T12:00:00.000Z'));

  assert.ok(Math.abs(monthlyTotal - 3600.001) < 1e-9,
    'the selected shape normalizes the exact requested 12 months to current CRM annual consumption');
  assert.deepEqual(result.months.map(month => month.key), period.periodKeys);
  assert.equal(result.referenceProfile?.key, bdewH25.key);
  assert.equal(result.referenceProfile?.contentHash, contentHash);
  assert.equal(result.referenceProfile?.projectionVersion, 1);
  assert.equal(Object.keys(result.dailyConsumptionKwh || {}).length,
    period.periodKeys.reduce((total, monthKey) => total + new Date(Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0)).getUTCDate(), 0));
  assert.ok(Object.values(result.dailyConsumptionKwh || {}).every(hours => hours.length === 24 && hours.every(value => value >= 0)));
  assert.ok(result.warnings.some(warning => warning.includes(`Wybrany profil referencyjny ${bdewH25.name}`)));
});

test('selected profile replaces generated manual USE24 hours but keeps explicit manual monthly totals', () => {
  const manualProfile = profile();
  manualProfile.annualUsageKwh = 9_999;
  manualProfile.months = Array(12).fill(100);
  manualProfile.sources = Array(12).fill('manual');
  manualProfile.exportSources = Array(12).fill('standard');
  manualProfile.hourlyProfile = { exists: true, rows: 31 * 24 };
  const manualRows: Array<[string, number, number?]> = january().map(([stamp]) => [stamp, 4, 0]);
  const referenceProfile = { profile: bdewH25, contentHash: profileContentHash(bdewH25 as any) };
  const analysisPeriod = resolveProjectAnalysisPeriod('2025-10', new Date('2026-10-30T12:00:00.000Z'));
  const result = buildReEnergyUsageProfile({ profile: manualProfile, dashboard: dashboard(), hourly: manualRows,
    linked: false, analysisPeriod, referenceProfile, referenceProfileSelectionRevision: 4, currentCRMAnnualKwh: 3600.001 });
  const januaryWeight = buildReferenceProfileProjection(bdewH25, Array.from({ length: 31 }, (_, index) => `2026-01-${String(index + 1).padStart(2, '0')}`))
    .days.reduce((total, day) => total + day.hours.reduce((sum, value) => sum + value, 0), 0);
  const expected = buildReferenceProfileProjection(bdewH25, ['2026-01-02']).days[0].hours.map(value => 100 * value / januaryWeight);
  const actual = result.dailyConsumptionKwh!['2026-01-02'];

  assert.ok(Math.abs(result.months.find(month => month.key === '2026-01')!.totalKwh - 100) < 1e-10);
  assert.equal(result.annualKwh, 1200, 'the twelve explicit manual monthly totals remain authoritative');
  assert.ok(expected.every((value, hour) => Math.abs(actual[hour] - value) < 1e-10),
    'manual month totals use the selected hourly shape instead of the generated USE24 pattern');
});

test('a saved reset to default RE ignores stale linked annual metadata and keeps the exact CRM annual', () => {
  const result = buildReEnergyUsageProfile({
    profile: { ...profile(), annualUsageKwh: 99_999 },
    dashboard: dashboard(),
    linked: false,
    analysisPeriod: resolveProjectAnalysisPeriod('2025-10', new Date('2026-10-30T12:00:00.000Z')),
    referenceProfileSelectionRevision: 5,
    currentCRMAnnualKwh: 3600.001,
  });
  assert.ok(Math.abs(result.annualKwh - 3600.001) < 1e-9);
  assert.ok(result.warnings.some(warning => warning.includes('zresetowany')));
  assert.equal(result.referenceProfile, undefined);
});

test('CRM PV 9.9 kWp zastępuje RE metadata 0, lokalizacja projektu i okres trafiają do pobrania PV', async t => {
  const pvUrls: string[] = [];
  const queries = linked(t, false, {
    profile: xlsx(),
    metadata: { dateStart: '2024-08-27', pvSizeKwp: 0, lat: 51, lon: 17 },
    rows: januaryDbRows(),
    analysisStartMonth: '2025-10',
    project: {
      energyAudits: [{ existingPvKw: 9.9 }],
      investmentSite: { latitude: 52.23, longitude: 21.01 },
    },
    pvRows: series('2025-10-01', '2026-10-01', () => 1000),
    pvUrls,
    projectQuery: args => {
      assert.ok(args.select.offerWorkspace.select.input);
      assert.deepEqual(args.select.energyAudits, {
        select: { annualConsumptionKwh: true, existingPvKw: true, roofTiltDeg: true, roofOrientation: true }, take: 1,
      });
      assert.deepEqual(args.select.investmentSite, { select: { latitude: true, longitude: true } });
    },
  });

  const result = await readProjectReConsumptionProfile('project', { clientId: 'client' });
  const januaryMonth = result.months.find(month => month.key === '2026-01');
  const pvRequest = new URL(pvUrls[0]);

  assert.ok(Math.abs((januaryMonth?.totalKwh || 0) - 744 * (1 + 9.9 * 1.05 - 0.5)) < 1e-7);
  assert.equal(pvRequest.searchParams.get('lat'), '52.23');
  assert.equal(pvRequest.searchParams.get('lon'), '21.01');
  assert.equal(pvRequest.searchParams.get('from'), '2025-10-01');
  assert.equal(pvRequest.searchParams.get('to'), '2026-10-01');
  assert.ok(queries.every(sql => !/\b(UPDATE|INSERT|ALTER|DELETE)\b/i.test(sql)));
});

test('workspace PV ma pierwszeństwo przed audytem i RE, a sam audyt jest źródłem bez workspace', async t => {
  for (const source of [
    { offerWorkspace: { input: { existingPv: { powerKw: 4.2, tiltDegrees: 30, azimuthDegrees: 180, lossPercent: 14 } } },
      energyAudits: [{ existingPvKw: 9.9 }] },
    { offerWorkspace: null, energyAudits: [{ existingPvKw: 4.2 }] },
  ]) {
    const pvUrls: string[] = [];
    const queries = linked(t, false, {
      profile: xlsx(), metadata: { pvSizeKwp: 8 }, rows: januaryDbRows(), analysisStartMonth: '2025-10',
      project: { ...source, investmentSite: { latitude: 53.1, longitude: 18.6 } },
      pvRows: series('2025-10-01', '2026-10-01', () => 1000), pvUrls,
    });
    const result = await readProjectReConsumptionProfile('project');
    const januaryMonth = result.months.find(month => month.key === '2026-01');
    const pvRequest = new URL(pvUrls[0]);
    assert.ok(Math.abs((januaryMonth?.totalKwh || 0) - 744 * (1 + 4.2 * 1.05 - 0.5)) < 1e-7);
    assert.equal(pvRequest.searchParams.get('lat'), '53.1');
    assert.equal(pvRequest.searchParams.get('lon'), '18.6');
    assert.ok(queries.every(sql => !/\b(UPDATE|INSERT|ALTER|DELETE)\b/i.test(sql)));
  }
});

test('projektowe 0/null nie spadają do RE ani telemetrii, a brak lokalizacji CRM nie używa RE', async t => {
  for (const powerKw of [0, null]) {
    assert.throws(() => buildReEnergyUsageProfile({
      profile: xlsx(),
      dashboard: { account: { dateStart: '2026-01-01', pvSizeKwp: 8, lat: 51, lon: 17 },
        rawEnergy: { installedPowerKw: 12 }, pvData: { records: [{ quarters: [{ powerW: 12000 }] }] } },
      hourly: january(),
      projectPv: { powerKw, latitude: 52, longitude: 21 },
    }), /Brak mocy PV/);
  }

  for (const powerKw of [0, null]) {
    const pvUrls: string[] = [];
    const queries = linked(t, false, {
      profile: xlsx(), metadata: { pvSizeKwp: 8, lat: 51, lon: 17 }, rows: januaryDbRows(), analysisStartMonth: '2025-10',
      project: { offerWorkspace: { input: { existingPv: { powerKw } } }, investmentSite: { latitude: 52, longitude: 21 } },
      pvUrls,
    });
    await assert.rejects(readProjectReConsumptionProfile('project'), /Brak mocy PV/);
    assert.deepEqual(pvUrls, []);
    assert.ok(queries.every(sql => !/\b(UPDATE|INSERT|ALTER|DELETE)\b/i.test(sql)));
  }

  const queries = linked(t, false, {
    profile: xlsx(), metadata: { pvSizeKwp: 8, lat: 51, lon: 17 }, rows: januaryDbRows(), analysisStartMonth: '2025-10',
    project: { energyAudits: [{ existingPvKw: 9.9 }], investmentSite: null },
    pvRows: series('2025-10-01', '2026-10-01', () => 1000),
  });
  await assert.rejects(readProjectReConsumptionProfile('project'), /Brak lokalizacji projektu do pobrania danych PV/);
  assert.ok(queries.every(sql => !/\b(UPDATE|INSERT|ALTER|DELETE)\b/i.test(sql)));
});

test('explicit RE XLSX pattern uses source-year bookkeeping and is not relabeled as a measurement', async t => {
  const p = xlsx();
  p.exportSources.fill('standard');
  const rows = Array.from({ length: 31 * 24 }, (_, hour) => ({ month_no: 1, day_no: Math.floor(hour / 24) + 1,
    hour_no: hour % 24, kwh: 1, export_kwh: 0, source: 'xlsx', source_year: 2025,
    export_source: 'standard', export_source_year: null }));
  const queries = linked(t, false, { profile: p, rows, analysisStartMonth: '2025-10' });
  const result = await readProjectReConsumptionProfile('project');
  const january = result.months.find(month => month.key === '2026-01');

  assert.ok(queries.some(sql => sql.includes('source_year') && sql.includes('export_source_year')));
  assert.ok(queries.every(sql => !/\b(UPDATE|INSERT|ALTER|DELETE)\b/i.test(sql)));
  assert.equal(january?.importSource, 'forecast');
  assert.equal(january?.sourceFiles, 0);
  assert.match(result.warnings.join(' '), /pochodzi z 2025; pokazano go jako prognozę dla 2026/);
  assert.equal(result.measuredDays, 0);
});

test('a measured station surfaces CLI failure instead of using declaration or files', async t => {
  linked(t, true);
  const previous = process.env.ONREVOLT_PHP_BIN;
  process.env.ONREVOLT_PHP_BIN = 'nonexistent-re-profile-test-php';
  t.after(() => { if (previous == null) delete process.env.ONREVOLT_PHP_BIN; else process.env.ONREVOLT_PHP_BIN = previous; });
  await assert.rejects(readProjectReConsumptionProfile('project'), /odczytać dashboardu RE/);
});

test('archived June from the requested year replaces latest pattern hours, totals and forecast labels', async t => {
  const p = profile();
  p.months = Array(12).fill(100); p.sources = Array(12).fill('manual'); p.sources[5] = 'xlsx';
  p.exportSources = Array(12).fill('standard'); p.hourlyProfile = { exists: true, rows: 720 };
  const rows = Array.from({ length: 720 }, (_, i) => ({ month_no: 6, day_no: Math.floor(i / 24) + 1,
    hour_no: i % 24, kwh: 2, export_kwh: 0, source: 'xlsx', source_year: 2026, export_source: 'standard', export_source_year: null }));
  const history = [2025, 2026].flatMap(year => rows.map(row => ({ year_no: year, month_no: 6,
    day_no: row.day_no, hour_no: row.hour_no, direction: 'import', kwh: year === 2025 ? 0.5 : 2 })));
  linked(t, false, { profile: p, rows, history, analysisStartMonth: '2025-06' });
  const result = await readProjectReConsumptionProfile('project');
  const june = result.months.find(month => month.key === '2025-06');
  assert.equal(june?.totalKwh, 360);
  assert.equal(june?.importSource, 'xlsx');
  assert.ok(!result.warnings.some(warning => warning.includes('pochodzi z 2026')));
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
  const originalRaw = prisma.$queryRaw;
  prisma.project.findFirst = (async (args: any) => {
    assert.deepEqual(args.where, { id: 'project', clientId: 'client' });
    return { dashboardStation: null, dashboardStationNumber: null };
  }) as typeof originalFind;
  prisma.energyAudit.findUnique = (async () => ({ annualConsumptionKwh: 3650 })) as unknown as typeof originalAudit;
  prisma.$queryRaw = (async (strings: TemplateStringsArray) => Array.from(strings).join(' ').includes('ProjectReferenceLoadProfile')
    ? [] : [{ analysisStartMonth: null }]) as typeof originalRaw;
  t.after(() => { prisma.project.findFirst = originalFind; prisma.energyAudit.findUnique = originalAudit; prisma.$queryRaw = originalRaw; });
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
    hour_no: hour % 24, kwh: 1, export_kwh: 0, source: 'xlsx', source_year: 2024,
    export_source: 'standard', export_source_year: null }));
  linked(t, false, { profile: p, metadata: { dateStart: '2028-08-27' }, rows, analysisStartMonth: '2023-03' });
  const result = await readProjectReConsumptionProfile('project');
  assert.equal(result.months[11].key, '2024-02'); assert.equal(result.months[11].totalKwh, 29 * 24);
  assert.equal(result.months[11].weekdayDays + result.months[11].weekendDays, 29);
});
