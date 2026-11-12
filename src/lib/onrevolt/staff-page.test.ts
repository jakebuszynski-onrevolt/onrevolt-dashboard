import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function loadModule(file: string, modules: Record<string, unknown>) {
  const source = readFileSync(file, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: Record<string, any> = {};
  new vm.Script(code, { filename: file }).runInNewContext({
    exports,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Nieznana zależność testu: ${name}`);
      return modules[name];
    },
    React: { createElement: (...args: unknown[]) => args },
  });
  return exports;
}

const pageHelperPath = path.resolve(__dirname, 'staff-page.ts');
const printPagePath = path.resolve(__dirname, '../../app/admin/offers/[offerId]/print/page.tsx');

test('strony administracyjne blokują rolę wizji na innych trasach i uprawnieniach', async () => {
  const restricted = { systemRole: 'USER', companyRoles: [{ companyRole: { code: 'WIZJA_LOKALNA' } }] };
  let user: object | null = restricted;
  let pathname = '/admin/offers/offer-1/print';
  const redirects: string[] = [];
  const { requireStaffPage } = loadModule(pageHelperPath, {
    'next/headers': { headers: async () => ({ get: (name: string) => name === 'x-onrevolt-admin-path' ? pathname : 'session=example' }) },
    'next/navigation': { redirect: (url: string) => { redirects.push(url); throw new Error(`redirect:${url}`); } },
    'next/server': { NextRequest: class { constructor(_url: string, _options: unknown) {} } },
    './staff-server': {
      getCurrentStaffUser: async () => user,
      hasStaffPermission: (_user: object, permission: string) => permission === 'site-visits.access',
      isSiteVisitOnlyUser: (candidate: any) => candidate === restricted,
    },
    './site-visit-navigation': { isSiteVisitPage: (value: string) => /^\/admin\/clients(?:\/[^/]+)?$/.test(value) },
  });

  await assert.rejects(requireStaffPage(), /redirect:\/admin\/clients/);
  pathname = '/admin/clients';
  assert.equal(await requireStaffPage(), restricted);
  await assert.rejects(requireStaffPage('offers.manage'), /redirect:\/admin\/clients/);
  user = null;
  await assert.rejects(requireStaffPage(), /redirect:\/auth\/sign-in\/default/);
  assert.deepEqual(redirects, ['/admin/clients', '/admin/clients', '/auth/sign-in/default']);
});

test('wydruk oferty sprawdza uprawnienia przed odczytem danych', async () => {
  let authorized = false;
  let reads = 0;
  const { default: printPage } = loadModule(printPagePath, {
    'next/navigation': { notFound: () => { throw new Error('notFound'); } },
    'components/onrevolt/OfferDocument': { default: 'OfferDocument' },
    'lib/onrevolt/offers': { offerInclude: {} },
    'lib/onrevolt/prisma': { prisma: { offer: { findUnique: async () => { reads++; return { id: 'offer-1' }; } } } },
    'lib/onrevolt/staff-page': { requireStaffPage: async (permission: string) => {
      assert.equal(permission, 'offers.manage');
      if (!authorized) throw new Error('redirect:/admin/clients');
    } },
  });

  await assert.rejects(printPage({ params: Promise.resolve({ offerId: 'offer-1' }) }), /redirect:\/admin\/clients/);
  assert.equal(reads, 0);
  authorized = true;
  await printPage({ params: Promise.resolve({ offerId: 'offer-1' }) });
  assert.equal(reads, 1);
});
