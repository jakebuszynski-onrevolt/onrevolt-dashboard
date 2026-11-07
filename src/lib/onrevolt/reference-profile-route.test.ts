import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const routePath = path.resolve(__dirname, '../../app/api/reference-load-profiles/route.ts');
const routeCode = ts.transpileModule(readFileSync(routePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: routePath,
}).outputText;

function fixture(options: { authorized?: boolean; catalog?: any[]; catalogError?: string } = {}) {
  const state = { permission: [] as string[], reads: 0, comparisons: [] as any[], summaries: 0 };
  const catalog = options.catalog ?? [
    { key: 'electric', eligible: true },
    { key: 'heat', eligible: false, reason: 'Profil ciepła nie jest profilem elektrycznym.' },
  ];
  const modules: Record<string, unknown> = {
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async (_req: unknown, permission: string) => {
        state.permission.push(permission);
        return options.authorized === false
          ? { ok: false, response: Response.json({ error: 'Brak uprawnień.' }, { status: 403 }) }
          : { ok: true, user: { id: 'staff' } };
      },
    },
    'lib/onrevolt/api': {
      badRequest: (message: string) => Response.json({ error: message }, { status: 400 }),
      jsonResponse: (value: unknown, init?: ResponseInit) => Response.json(value, init),
    },
    'lib/onrevolt/reference-profile-catalog-server': {
      readReferenceProfileCatalog: async () => {
        state.reads++;
        if (options.catalogError) throw new Error(options.catalogError);
        return catalog;
      },
    },
    'lib/onrevolt/reference-profile-comparison': {
      getReferenceProfileCalculationEligibility: (profile: any) => ({ eligible: profile.eligible, reason: profile.reason ?? null }),
      summarizeReferenceProfile: (profile: any) => {
        state.summaries++;
        return { key: profile.key, eligible: profile.eligible, reason: profile.reason ?? null };
      },
      compareReferenceProfiles: (profiles: any[], input: any) => {
        state.comparisons.push({ profiles, input });
        return profiles.map(profile => ({ key: profile.key }));
      },
    },
  };
  const exports: any = {};
  vm.runInNewContext(routeCode, {
    exports,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected route import: ${name}`);
      return modules[name];
    },
    Response,
    console: { error: () => {} },
    Set,
    Number,
  });
  const request = (body?: unknown) => ({ json: async () => body });
  return { exports, state, request };
}

test('reference profile GET and POST require energy.manage before reading the catalog', async () => {
  const f = fixture({ authorized: false });
  const get = await f.exports.GET(f.request());
  const post = await f.exports.POST(f.request({ keys: ['electric'], annualKwh: 5000, month: null, dayType: 'all' }));
  assert.equal(get.status, 403);
  assert.equal(post.status, 403);
  assert.deepEqual(f.state.permission, ['energy.manage', 'energy.manage']);
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.comparisons.length, 0);
});

test('reference profile GET returns summaries and a private uncached response', async () => {
  const f = fixture();
  const response = await f.exports.GET(f.request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(body.data.comparisonYear, 2025);
  assert.deepEqual(JSON.parse(JSON.stringify(body.data.profiles)), [
    { key: 'electric', eligible: true, reason: null, calculationEligible: true, calculationReason: null },
    { key: 'heat', eligible: false, reason: 'Profil ciepła nie jest profilem elektrycznym.', calculationEligible: false, calculationReason: 'Profil ciepła nie jest profilem elektrycznym.' },
  ]);
  assert.equal(f.state.comparisons.length, 0);
});

test('reference profile POST rejects malformed and oversized selections before catalog access', async () => {
  const invalid = [
    { keys: [], annualKwh: 5000, month: null, dayType: 'all' },
    { keys: Array.from({ length: 7 }, (_, i) => `p${i}`), annualKwh: 5000, month: null, dayType: 'all' },
    { keys: ['electric', 'electric'], annualKwh: 5000, month: null, dayType: 'all' },
    { keys: ['x'.repeat(192)], annualKwh: 5000, month: null, dayType: 'all' },
    { keys: ['electric'], annualKwh: 0, month: null, dayType: 'all' },
    { keys: ['electric'], annualKwh: 1e12 + 1, month: null, dayType: 'all' },
    { keys: ['electric'], annualKwh: 5000, month: 13, dayType: 'all' },
    { keys: ['electric'], annualKwh: 5000, month: null, dayType: 'holiday' },
  ];
  const f = fixture();
  for (const body of invalid) {
    const response = await f.exports.POST(f.request(body));
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.comparisons.length, 0);
});

test('reference profile POST rejects unknown and ineligible profiles without comparing', async () => {
  const f = fixture();
  for (const key of ['unknown', 'heat']) {
    const response = await f.exports.POST(f.request({ keys: [key], annualKwh: 5000, month: null, dayType: 'all' }));
    assert.equal(response.status, 400);
  }
  assert.equal(f.state.comparisons.length, 0);
});

test('reference profile POST compares selected catalog profiles with validated inputs', async () => {
  const f = fixture();
  const response = await f.exports.POST(f.request({ keys: ['electric'], annualKwh: 5000, month: 2, dayType: 'weekend' }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(body.data.annualKwh, 5000);
  assert.deepEqual(JSON.parse(JSON.stringify(body.data.profiles)), [{ key: 'electric' }]);
  assert.equal(f.state.comparisons.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.comparisons[0].input)), {
    keys: ['electric'], annualKwh: 5000, month: 2, dayType: 'weekend',
  });
  assert.equal(f.state.comparisons[0].profiles[0].key, 'electric');
});

test('reference profile routes return a readable error when the catalog fails validation', async () => {
  const f = fixture({ catalogError: 'Niezgodna suma kontrolna profilu referencyjnego.' });
  const get = await f.exports.GET(f.request());
  const post = await f.exports.POST(f.request({ keys: ['electric'], annualKwh: 5000, month: null, dayType: 'all' }));
  assert.equal(get.status, 500);
  assert.equal(post.status, 500);
  assert.match((await get.json()).error, /katalogu profili/);
  assert.match((await post.json()).error, /porównania profili/);
  assert.equal(f.state.comparisons.length, 0);
});
