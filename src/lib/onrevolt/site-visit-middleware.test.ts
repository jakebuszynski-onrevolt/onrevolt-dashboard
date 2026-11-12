import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server';
import { isSiteVisitPage } from './site-visit-navigation';

test('middleware sprawdza sesję i kieruje wizje przed renderowaniem strony lub RSC', async () => {
  let user: any = { restricted: true };
  let calls = 0;
  const exports: any = {};
  const code = ts.transpileModule(readFileSync(path.resolve(__dirname, '../../middleware.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, URL, Headers, require: (name: string) => {
    if (name === 'next/server') return { NextRequest, NextResponse };
    if (name.endsWith('/staff-server')) return { getCurrentStaffUser: async () => { calls++; return user; }, isSiteVisitOnlyUser: (value: any) => value.restricted };
    if (name.endsWith('/site-visit-navigation')) return { isSiteVisitPage };
    throw Error(name);
  } });
  const req = (route: string, cookie = true) => new NextRequest(`https://onrevolt.com${route}`, {
    headers: { ...(cookie ? { cookie: 'onrevolt_staff_session=token' } : {}), RSC: '1', 'x-onrevolt-admin-path': '/admin/clients' },
  });
  const denied = await exports.middleware(req('/admin/settings'));
  assert.equal(denied.status, 307);
  assert.equal(denied.headers.get('location'), 'https://onrevolt.com/admin/clients');
  const allowed = await exports.middleware(req('/admin/clients'));
  assert.equal(allowed.headers.get('x-middleware-next'), '1');
  user = { restricted: false };
  const admin = await exports.middleware(req('/admin/settings'));
  assert.equal(admin.headers.get('x-middleware-next'), '1');
  assert.equal(admin.headers.get('x-middleware-request-x-onrevolt-admin-path'), '/admin/settings');
  user = null;
  assert.match((await exports.middleware(req('/admin/clients'))).headers.get('location')!, /\/auth\/sign-in\/default/);
  const before = calls;
  assert.equal((await exports.middleware(req('/admin/clients', false))).status, 307);
  assert.equal(calls, before);
});
