import { NextRequest, NextResponse } from 'next/server';

const sessionCookie = 'onrevolt_staff_session';

export function middleware(req: NextRequest) {
  const hasSession = Boolean(req.cookies.get(sessionCookie)?.value);
  if (hasSession) return NextResponse.next();

  const signInUrl = new URL('/auth/sign-in/default', req.url);
  signInUrl.searchParams.set('next', `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ['/admin/:path*'],
};
