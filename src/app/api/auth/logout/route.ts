import { NextResponse } from 'next/server';
import { jsonResponse } from 'lib/onrevolt/api';
import { staffSessionCookie } from 'lib/onrevolt/staff-server';

export async function POST() {
  const response = jsonResponse({ ok: true });
  (response as NextResponse).cookies.set(staffSessionCookie, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
