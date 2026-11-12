import assert from 'node:assert/strict';
import test from 'node:test';
import { requireSiteVisitProject, SITE_VISIT_STAGE_CODE } from './site-visit-access';
import { isSiteVisitPage } from './site-visit-navigation';

const inspector = { systemRole: 'USER', companyRoles: [{ companyRole: { code: 'WIZJA_LOKALNA' } }] };
test('dostęp do wizji wymaga aktywnego etapu po stronie serwera', async () => {
  const calls: any[] = [];
  let eligible = true;
  const db: any = { project: { findFirst: async (args: any) => { calls.push(args); return eligible ? { id: 'p' } : null; } } };
  await requireSiteVisitProject(inspector, 'p', db);
  assert.deepEqual(calls[0].where, { id: 'p', stage: { code: SITE_VISIT_STAGE_CODE, isActive: true } });
  eligible = false;
  await assert.rejects(requireSiteVisitProject(inspector, 'p', db), { status: 403 });
  await assert.rejects(requireSiteVisitProject(inspector, '', db), { status: 403 });
  const count = calls.length;
  await requireSiteVisitProject({ systemRole: 'ADMIN' }, 'p', db);
  assert.equal(calls.length, count);
});
test('wizje mają tylko listę, szczegóły klienta i własny profil', () => {
  for (const route of ['/admin/clients', '/admin/clients/abc', '/admin/profile']) assert.equal(isSiteVisitPage(route), true);
  for (const route of ['', '/admin/dashboard', '/admin/offers/o/print', '/admin/clients/abc/offer', '/admin/clients-archive', '/admin/settings']) assert.equal(isSiteVisitPage(route), false);
});
