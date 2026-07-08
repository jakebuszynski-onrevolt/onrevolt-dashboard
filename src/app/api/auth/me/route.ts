import { NextRequest, NextResponse } from 'next/server';
import { jsonResponse, serverError, unauthorized } from 'lib/onrevolt/api';
import { getCurrentStaffUser, serializeStaffUser, staffSessionCookie } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentStaffUser(req);
    if (!user) {
      const response = unauthorized();
      (response as NextResponse).cookies.set(staffSessionCookie, '', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      });
      return response;
    }

    const response = jsonResponse({ ok: true, data: serializeStaffUser(user) });
    return response;
  } catch (error) {
    return serverError('Nie udało się pobrać bieżącego użytkownika', error);
  }
}
