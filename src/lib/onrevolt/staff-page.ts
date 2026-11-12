import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';
import { getCurrentStaffUser, hasStaffPermission, isSiteVisitOnlyUser, type StaffPermission } from './staff-server';
import { isSiteVisitPage } from './site-visit-navigation';

export async function requireStaffPage(permission?: StaffPermission) {
  const incoming = await headers();
  const user = await getCurrentStaffUser(new NextRequest('http://localhost/admin', {
    headers: { cookie: incoming.get('cookie') || '' },
  }));
  if (!user) redirect('/auth/sign-in/default');
  if ((permission && !hasStaffPermission(user, permission))
    || (isSiteVisitOnlyUser(user) && !isSiteVisitPage(incoming.get('x-onrevolt-admin-path') || ''))) {
    redirect('/admin/clients');
  }
  return user;
}
