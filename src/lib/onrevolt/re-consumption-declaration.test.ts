import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GET, POST } from '../../app/api/energy-audits/route';
import { prisma } from './prisma';
import { rePrisma } from './re-stations';
import { profileContentHash } from '../../../scripts/profile-catalog/storage-core';
import type { CatalogProfile } from './reference-profile-comparison';
import type { ReConsumptionProfile } from './re-consumption-api';
import { mergeReConsumptionDeclaration, shouldSyncReConsumptionDeclaration, syncProjectReConsumptionDeclaration } from './re-consumption-declaration';

function profile(): ReConsumptionProfile {
  return { station: '41', months: Array(12).fill(100), sources: Array(12).fill('standard'),
    exportSources: Array(12).fill('standard'), annualUsageKwh: 1200, hourlyProfile: { exists: true, rows: 8760 }, measurementHistory: [] };
}
function emptyProfile(): ReConsumptionProfile {
  return { station: '41', months: null, sources: null, exportSources: null,
    annualUsageKwh: 1200, hourlyProfile: { exists: false, rows: 0 }, measurementHistory: [] };
}
const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 1000) / 1000;
const serviceInput = { clientId: 'client', projectId: 'project', auditId: 'audit', annualConsumptionKwh: 3650, actorId: 'staff' };
const referenceCatalog = JSON.parse(readFileSync(join(process.cwd(), 'output', 'profile-catalog-20261106', 'catalog.json'), 'utf8')) as { profiles: CatalogProfile[] };
const referenceProfile = referenceCatalog.profiles.find(profile => profile.key === 'bdew-2025-h25')!;

test('merges only standard imports, retaining manual/XLSX values, source tags and exports', () => {
  const original = profile();
  original.sources[0] = 'xlsx'; original.months[0] = 123.456;
  original.sources[1] = 'manual'; original.months[1] = 234.567;
  original.exportSources[2] = 'xlsx';
  const snapshot = structuredClone(original);
  const merged = mergeReConsumptionDeclaration(original, 3650);
  assert.deepEqual(merged.months, [123.456, 234.567, 310, 300, 310, 300, 310, 310, 300, 310, 300, 310]);
  assert.deepEqual(merged.sources, original.sources);
  assert.deepEqual(merged.changedMonths, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.notEqual(sum(merged.months), 3650);
  assert.deepEqual(original, snapshot);
  assert.equal('exportSources' in merged, false);
});

test('initializes absent monthly profile explicitly as a 365-day pattern', () => {
  const result = mergeReConsumptionDeclaration(emptyProfile(), 3650);
  assert.deepEqual(result.months, [310, 280, 310, 300, 310, 300, 310, 310, 300, 310, 300, 310]);
  assert.equal(sum(result.months), 3650);
  assert.equal(result.sources.every(source => source === 'standard'), true);
  assert.equal(result.changedMonths.length, 12);
});

test('zero declaration is explicit and never erases protected months', () => {
  const original = profile(); original.sources[0] = 'xlsx';
  const merged = mergeReConsumptionDeclaration(original, 0);
  assert.equal(merged.months[0], 100);
  assert.equal(merged.months.slice(1).every(value => value === 0), true);
});

test('rejects malformed/effective source tags rather than reclassifying real/part/XLSX', () => {
  for (const bad of [NaN, Infinity, -1]) assert.throws(() => mergeReConsumptionDeclaration(profile(), bad));
  for (const bad of ['real', 'part', 'forecast']) {
    const original = profile(); original.sources[0] = bad as never;
    assert.throws(() => mergeReConsumptionDeclaration(original, 3650), /profil źródłowy/);
  }
  assert.throws(() => mergeReConsumptionDeclaration({ ...profile(), sources: null }, 3650));
});

test('unchanged, absent annual and OPERATOR_HOURLY do not trigger implicit synchronization', () => {
  const input = { annualWasProvided: true, previousAnnual: 1200, annual: 3650, profileSource: 'ANNUAL_DECLARATION' };
  assert.equal(shouldSyncReConsumptionDeclaration(input), true);
  assert.equal(shouldSyncReConsumptionDeclaration({ ...input, profileSource: 'MONTHLY_MANUAL' }), true);
  assert.equal(shouldSyncReConsumptionDeclaration({ ...input, annualWasProvided: false }), false);
  assert.equal(shouldSyncReConsumptionDeclaration({ ...input, annual: 1200 }), false);
  assert.equal(shouldSyncReConsumptionDeclaration({ ...input, annual: 1200, retry: true }), true);
  assert.equal(shouldSyncReConsumptionDeclaration({ ...input, profileSource: 'OPERATOR_HOURLY', retry: true }), false);
});

function replace(t: TestContext, object: any, key: string, replacement: any) {
  const original = object[key]; object[key] = replacement;
  t.after(() => { object[key] = original; });
}

function fixture(t: TestContext) {
  for (const [name, value] of Object.entries({ ONREVOLT_RE_DATABASE_URL: 'mysql://test:test@localhost:1/unused', ONREVOLT_RE_PROFILE_URL: 'https://re.example.test/setup_func.php' })) {
    const previous = process.env[name]; process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const state = {
    audit: { id: 'audit', projectId: 'project', annualConsumptionKwh: 1200, profileSource: 'ANNUAL_DECLARATION', status: 'APPROVED', scenarios: [] } as any,
    project: { id: 'project', clientId: 'client', dashboardStation: 'token', dashboardStationNumber: '41' },
    profile: profile(), logs: [] as any[], calls: [] as Array<{ method: string; body?: any }>, events: [] as string[],
    updates: 0, creates: 0, sql: [] as string[], failGet: false, failAfterSave: false, failLog: '',
    foreignProject: false, foreignAudit: false, allowed: true,
    referenceSelection: { key: null as string | null, revision: 0, contentHash: null as string | null, profileName: null as string | null },
    referenceRow: null as any,
    referenceWrites: [] as any[],
  };
  replace(t, prisma, '$transaction', async (callback: any) => {
    state.events.push('transaction');
    try { return await callback(prisma); } finally { state.events.push('commit'); }
  });
  replace(t, prisma, '$queryRaw', async (strings: TemplateStringsArray, ...values: any[]) => {
    const sql = strings.join('?');
    if (/SELECT id FROM Project[\s\S]*FOR UPDATE/.test(sql)) {
      assert.equal(values[0], 'project');
      if (values.length === 2) assert.equal(values[1], 'client');
      state.events.push('lock');
      return state.foreignProject ? [] : [{ id: 'project' }];
    }
    if (sql.includes('FROM ProjectReferenceLoadProfile')) {
      return state.referenceSelection.revision > 0 ? [{ profileKey: state.referenceSelection.key,
        revision: state.referenceSelection.revision, contentHash: state.referenceSelection.contentHash,
        profileName: state.referenceSelection.profileName, projectionVersion: 1 }] : [];
    }
    if (sql.includes('FROM ReferenceLoadProfile')) {
      const hash = profileContentHash(referenceProfile as any);
      return [{ key: referenceProfile.key, sourceKey: referenceProfile.sourceKey, name: referenceProfile.name,
        category: referenceProfile.category, kind: referenceProfile.kind, quantity: referenceProfile.quantity,
        unit: referenceProfile.unit, timeBasis: referenceProfile.timeBasis, resolutionMinutes: referenceProfile.resolutionMinutes,
        start: referenceProfile.start, end: referenceProfile.end, contentHash: hash, pointCount: referenceProfile.series.length,
        seriesJson: JSON.stringify(referenceProfile.series), metadataJson: JSON.stringify(referenceProfile.metadata),
        qualityJson: JSON.stringify(referenceProfile.quality) }];
    }
    throw new Error(`Unexpected CRM SQL ${sql}`);
  });
  replace(t, prisma.project, 'findUnique', async () => ({ ...state.project }));
  replace(t, prisma.project, 'findUniqueOrThrow', async () => ({ ...state.project }));
  replace(t, prisma.project, 'findMany', async () => [{ ...state.project }]);
  replace(t, prisma.energyAudit, 'findUnique', async () => state.audit ? { ...state.audit,
    ...(state.foreignAudit ? { projectId: 'other-project' } : {}) } : null);
  replace(t, prisma.energyAudit, 'findMany', async () => state.audit ? [state.audit] : []);
  replace(t, prisma.energyAudit, 'update', async (args: any) => {
    state.updates++;
    assert.deepEqual(args.where, { id: 'audit', projectId: 'project' });
    state.audit = { ...state.audit, ...Object.fromEntries(Object.entries(args.data).filter(([, value]) => value !== undefined)) };
    return { ...state.audit };
  });
  replace(t, prisma.energyAudit, 'create', async (args: any) => {
    state.creates++;
    state.audit = { id: 'audit', profileSource: 'ANNUAL_DECLARATION', status: 'DRAFT', scenarios: [],
      ...Object.fromEntries(Object.entries(args.data).filter(([, value]) => value !== undefined)) };
    return { ...state.audit };
  });
  replace(t, prisma.auditLog, 'create', async ({ data }: any) => {
    if (data.action === state.failLog) throw new Error('Audit unavailable');
    const log = { id: `log-${state.logs.length + 1}`, ...data };
    state.logs.push(log); return log;
  });
  replace(t, prisma.staffSession, 'findFirst', async () => ({ id: 'session', lastSeenAt: new Date(),
    staffUser: { id: 'staff', active: true, systemRole: state.allowed ? 'ADMIN' : 'USER', companyRoles: [] } }));
  const db = rePrisma();
  replace(t, db, '$transaction', async (callback: any) => callback(db));
  replace(t, db, '$queryRawUnsafe', async (sql: string) => {
    state.sql.push(sql);
    if (sql.startsWith('SHOW TABLES')) return [{}];
    if (sql.startsWith('SHOW COLUMNS')) return [{ Field: 'station' }, { Field: 'station_hash' }];
    if (sql.includes('EnergyMeter_reference_load_profiles')) return state.referenceRow ? [{ ...state.referenceRow }] : [];
    if (sql.includes('EnergyMeter_users')) return [{ station: '41', station_hash: 'token', weather_station: null }];
    throw new Error(`Unexpected SQL ${sql}`);
  });
  replace(t, db, '$executeRawUnsafe', async (sql: string, ...values: any[]) => {
    if (!sql.includes('INSERT INTO `EnergyMeter_reference_load_profiles`')) throw new Error('Unexpected RE SQL write');
    state.referenceWrites.push({ sql, values });
    state.referenceRow = { station: values[0], projectId: values[1], profileKey: values[2], contentHash: values[3],
      payloadJson: values[4], annualKwh: values[5], projectionVersion: values[6] };
  });
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert.equal(url.origin, 'https://re.example.test');
    state.events.push(init.method);
    if (init.method === 'GET') {
      state.calls.push({ method: 'GET' });
      assert.equal(url.searchParams.get('action'), 'user_consumption_get');
      if (state.failGet) throw new Error('RE niedostępne');
    } else {
      assert.equal(url.searchParams.get('action'), 'user_consumption_save');
      const body = JSON.parse(init.body as string);
      assert.deepEqual(Object.keys(body).sort(), ['months', 'protect_detailed', 'sources', 'station']);
      assert.equal(body.protect_detailed, true);
      state.calls.push({ method: 'POST', body });
      state.profile = { ...state.profile, months: body.months, sources: body.sources,
        exportSources: state.profile.exportSources ?? Array(12).fill('standard'),
        annualUsageKwh: sum(body.months), hourlyProfile: { exists: true, rows: 8760 } };
      if (state.failAfterSave) throw new Error('Utracono odpowiedź po zapisie');
    }
    return Response.json({ ok: true, data: state.profile });
  });
  return state;
}

function request(body: any) {
  return new NextRequest('https://crm.example.test/api/energy-audits', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: 'crm.example.test', Origin: 'https://crm.example.test', Cookie: 'onrevolt_staff_session=fixture' },
    body: JSON.stringify({ id: 'audit', projectId: 'project', ...body }) });
}

test('route locks project, saves declaration and uses only existing profile HTTP API', async t => {
  const state = fixture(t); state.profile.sources[0] = 'xlsx'; state.profile.sources[1] = 'manual'; state.profile.exportSources[2] = 'xlsx';
  const response = await POST(request({ annualConsumptionKwh: 3650 }));
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.reDeclarationSync.status, 'synced');
  assert.equal(state.audit.annualConsumptionKwh, 3650); assert.equal(state.audit.status, 'APPROVED');
  assert.equal(state.profile.months[0], 100); assert.equal(state.profile.months[1], 100);
  assert.equal(state.profile.months[2], 310); assert.equal(state.profile.exportSources[2], 'xlsx');
  assert.notEqual(body.reDeclarationSync.profileAnnualUsageKwh, 3650);
  assert.deepEqual(state.logs.map(log => log.action), ['UPDATE', 'RE_DECLARATION_REQUEST', 'RE_DECLARATION_SYNCED']);
  assert.deepEqual(state.events, ['transaction', 'lock', 'commit', 'transaction', 'lock', 'GET', 'POST', 'commit']);
  assert.ok(state.sql.every(sql => !/\b(INSERT|UPDATE|DELETE|ALTER)\b/.test(sql)));
});

test('annual declaration updates the selected RE reference profile without replacing its shape with monthly defaults', async t => {
  const state = fixture(t);
  state.referenceSelection = { key: referenceProfile.key, revision: 1,
    contentHash: profileContentHash(referenceProfile as any), profileName: referenceProfile.name };
  const response = await POST(request({ annualConsumptionKwh: 3650 }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.reDeclarationSync.status, 'synced');
  assert.equal(body.reDeclarationSync.profileAnnualUsageKwh, 3650);
  assert.equal(state.calls.length, 0);
  assert.equal(state.referenceWrites.length, 1);
  assert.equal(state.referenceRow.station, '41');
  assert.equal(state.referenceRow.projectId, 'project');
  assert.equal(state.referenceRow.profileKey, referenceProfile.key);
  assert.equal(state.referenceRow.contentHash, state.referenceSelection.contentHash);
  assert.equal(Number(state.referenceRow.annualKwh), 3650);
  assert.equal(Number(state.referenceRow.projectionVersion), 1);
});

test('annual declaration updates an explicit default/reset overlay and keeps legacy standard-month synchronization', async t => {
  const state = fixture(t);
  state.referenceSelection = { key: null, revision: 2, contentHash: null, profileName: null };
  const response = await POST(request({ annualConsumptionKwh: 3650 }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.reDeclarationSync.status, 'synced');
  assert.equal(state.calls.length, 2);
  assert.deepEqual(state.calls.map(call => call.method), ['GET', 'POST']);
  assert.equal(state.referenceWrites.length, 1);
  assert.equal(state.referenceRow.profileKey, null);
  assert.equal(state.referenceRow.contentHash, null);
  assert.equal(state.referenceRow.payloadJson, null);
  assert.equal(Number(state.referenceRow.annualKwh), 3650);
  assert.equal(state.profile.months[0], 310);
  assert.equal(state.profile.sources[0], 'standard');
  assert.equal(state.profile.exportSources[2], 'standard');
});

test('ordinary same-annual save preserves later RE changes and does not call RE', async t => {
  const state = fixture(t); state.profile.months[0] = 999;
  const response = await POST(request({ annualConsumptionKwh: '1200', notes: 'Nowa notatka' }));
  assert.equal(response.status, 200); assert.equal(state.calls.length, 0); assert.equal(state.sql.length, 0);
  assert.equal(state.profile.months[0], 999);
});

test('missing, null and empty annual leave declaration/source/status unchanged and never call RE', async t => {
  const state = fixture(t); state.audit.profileSource = 'OPERATOR_HOURLY';
  for (const body of [{ notes: 'Note' }, { annualConsumptionKwh: null }, { annualConsumptionKwh: '' }, { annualConsumptionKwh: '   ' }]) {
    const response = await POST(request(body));
    assert.equal(response.status, 200); assert.equal(state.audit.annualConsumptionKwh, 1200);
    assert.equal(state.audit.profileSource, 'OPERATOR_HOURLY'); assert.equal(state.audit.status, 'APPROVED');
  }
  assert.equal(state.calls.length, 0);
});

test('OPERATOR_HOURLY remains local even for explicit annual change and retry', async t => {
  const state = fixture(t);
  const response = await POST(request({ annualConsumptionKwh: 3650, profileSource: 'OPERATOR_HOURLY' }));
  assert.equal(response.status, 200); assert.equal(state.calls.length, 0); assert.equal(state.sql.length, 0);
  assert.equal((await POST(request({ annualConsumptionKwh: 3650, retryReDeclaration: true }))).status, 200);
  assert.equal(state.calls.length, 0);
});

test('unlinked annual-only save and GET never create or query an RE station', async t => {
  const state = fixture(t); state.project.dashboardStation = null; state.project.dashboardStationNumber = null;
  const response = await POST(request({ annualConsumptionKwh: 3650 }));
  assert.equal((await response.json()).reDeclarationSync.status, 'skipped');
  const getResponse = await GET(new NextRequest('https://crm.example.test/api/energy-audits?projectId=project', {
    headers: { Cookie: 'onrevolt_staff_session=fixture' },
  }));
  assert.equal(getResponse.status, 200); assert.equal(state.calls.length, 0); assert.equal(state.sql.length, 0);
});

test('cross-project audit id and unknown id are rejected before update or RE access', async t => {
  const state = fixture(t); state.foreignAudit = true;
  assert.equal((await POST(request({ annualConsumptionKwh: 3650 }))).status, 404);
  state.audit = null;
  assert.equal((await POST(request({ annualConsumptionKwh: 3650 }))).status, 404);
  assert.equal(state.updates, 0); assert.equal(state.creates, 0); assert.equal(state.logs.length, 0); assert.equal(state.calls.length, 0);
});

test('missing project and insufficient permission cannot save or synchronize', async t => {
  const state = fixture(t); state.foreignProject = true;
  assert.equal((await POST(request({ annualConsumptionKwh: 3650 }))).status, 404);
  state.allowed = false;
  assert.equal((await POST(request({ annualConsumptionKwh: 3650 }))).status, 403);
  assert.equal(state.updates, 0); assert.equal(state.calls.length, 0);
});

test('rejects malformed explicit declaration and retry before any write', async t => {
  const state = fixture(t);
  for (const body of [{ annualConsumptionKwh: true }, { annualConsumptionKwh: [100] }, { annualConsumptionKwh: -1 },
    { annualConsumptionKwh: 'bad' }, { retryReDeclaration: true }, { retryReDeclaration: 'true' }, { profileSource: 'real' }]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal(state.updates, 0); assert.equal(state.calls.length, 0);
});

test('failed RE read keeps CRM declaration, reports failure, and explicit retry can succeed', async t => {
  const state = fixture(t); state.failGet = true;
  const failed = await POST(request({ annualConsumptionKwh: 3650 }));
  const body = await failed.json();
  assert.equal(failed.status, 502); assert.equal(body.ok, false); assert.equal(body.auditSaved, true);
  assert.equal(body.reDeclarationSync.retryAllowed, true); assert.equal(state.audit.annualConsumptionKwh, 3650);
  assert.ok(state.logs.some(log => log.action === 'RE_DECLARATION_FAILED'));
  state.failGet = false;
  const callCount = state.calls.length;
  assert.equal((await POST(request({ annualConsumptionKwh: 3650 }))).status, 200);
  assert.equal(state.calls.length, callCount);
  const retried = await POST(request({ annualConsumptionKwh: 3650, retryReDeclaration: true }));
  assert.equal((await retried.json()).reDeclarationSync.status, 'synced');
  assert.equal(state.profile.annualUsageKwh, 3650);
});

test('unknown POST outcome is audited and explicit retry verifies matching data without another POST', async t => {
  const state = fixture(t); state.failAfterSave = true;
  assert.equal((await POST(request({ annualConsumptionKwh: 3650 }))).status, 502);
  assert.equal(state.profile.annualUsageKwh, 3650);
  assert.deepEqual(state.logs.map(log => log.action), ['UPDATE', 'RE_DECLARATION_REQUEST', 'RE_DECLARATION_FAILED']);
  state.failAfterSave = false;
  const retried = await POST(request({ annualConsumptionKwh: 3650, retryReDeclaration: true }));
  assert.equal(retried.status, 200);
  assert.equal(state.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(state.logs[state.logs.length - 1].action, 'RE_DECLARATION_VERIFIED');
});

test('audit failure is visible after CRM save and blocks RE write', async t => {
  const state = fixture(t); state.failLog = 'UPDATE';
  const response = await POST(request({ annualConsumptionKwh: 3650 }));
  const body = await response.json();
  assert.equal(response.status, 500); assert.equal(body.auditSaved, true); assert.equal(body.reDeclarationSync.retryAllowed, true);
  assert.equal(state.audit.annualConsumptionKwh, 3650); assert.equal(state.calls.length, 0);
});

test('service rechecks current audit value, source and scope after obtaining project lock', async t => {
  const state = fixture(t);
  assert.equal((await syncProjectReConsumptionDeclaration(serviceInput)).status, 'skipped');
  state.audit.annualConsumptionKwh = 3650; state.audit.profileSource = 'OPERATOR_HOURLY';
  assert.equal((await syncProjectReConsumptionDeclaration(serviceInput)).status, 'skipped');
  state.foreignAudit = true;
  assert.equal((await syncProjectReConsumptionDeclaration(serviceInput)).status, 'failed');
  assert.equal(state.calls.length, 0); assert.equal(state.logs.length, 0);
});

test('profile with all protected months stays untouched even when annual changes', async t => {
  const state = fixture(t); state.audit.annualConsumptionKwh = 3650;
  state.profile.sources = Array.from({ length: 12 }, (_, index) => index % 2 ? 'manual' : 'xlsx');
  const snapshot = structuredClone(state.profile);
  assert.equal((await syncProjectReConsumptionDeclaration(serviceInput)).status, 'skipped');
  assert.deepEqual(state.profile, snapshot); assert.deepEqual(state.calls.map(call => call.method), ['GET']);
});

test('stale explicit retry cannot replace a newer CRM declaration', async t => {
  const state = fixture(t); state.audit.annualConsumptionKwh = 7000;
  const response = await POST(request({ annualConsumptionKwh: 3650, retryReDeclaration: true }));
  assert.equal(response.status, 409); assert.equal(state.audit.annualConsumptionKwh, 7000);
  assert.equal(state.updates, 0); assert.equal(state.calls.length, 0);
});

test('creates an audit without creating an RE station and respects database defaults', async t => {
  const state = fixture(t); state.audit = null;
  state.project.dashboardStation = null; state.project.dashboardStationNumber = null;
  const response = await POST(request({ id: undefined, annualConsumptionKwh: 3650 }));
  assert.equal(response.status, 201); assert.equal(state.creates, 1);
  assert.equal(state.audit.profileSource, 'ANNUAL_DECLARATION'); assert.equal(state.audit.status, 'DRAFT');
  assert.equal(state.calls.length, 0); assert.equal(state.sql.length, 0);
});

test('failure while waiting for the project lock remains explicitly retryable', async t => {
  const state = fixture(t);
  replace(t, prisma, '$transaction', async () => { throw new Error('Transaction timed out'); });
  const result = await syncProjectReConsumptionDeclaration(serviceInput);
  assert.equal(result.status, 'failed'); assert.equal(result.retryAllowed, true);
  assert.equal(state.calls.length, 0); assert.equal(state.logs.length, 0);
});
