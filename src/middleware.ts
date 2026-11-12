import { NextRequest, NextResponse } from 'next/server';
import { getCurrentStaffUser, isSiteVisitOnlyUser } from './lib/onrevolt/staff-server';
import { isSiteVisitPage } from './lib/onrevolt/site-visit-navigation';

const sessionCookie = 'onrevolt_staff_session';

export async function middleware(req: NextRequest) {
  const hasSession = Boolean(req.cookies.get(sessionCookie)?.value);
  const user = hasSession ? await getCurrentStaffUser(req) : null;
  if (user) {
    if (isSiteVisitOnlyUser(user) && !isSiteVisitPage(req.nextUrl.pathname)) {
      return NextResponse.redirect(new URL('/admin/clients', req.url));
    }
    const headers = new Headers(req.headers);
    // Overwrite user-supplied values; the server layout uses the actual route.
    headers.set('x-onrevolt-admin-path', req.nextUrl.pathname);
    return NextResponse.next({ request: { headers } });
  }

  const signInUrl = new URL('/auth/sign-in/default', req.url);
  signInUrl.searchParams.set('next', `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/admin/:path*'],
};
