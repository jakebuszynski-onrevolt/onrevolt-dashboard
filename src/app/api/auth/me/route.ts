import { NextRequest, NextResponse } from 'next/server';
import { jsonResponse, serverError, unauthorized } from 'lib/onrevolt/api';
import { clearStaffSessionCookie, getCurrentStaffUser, serializeStaffUser } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentStaffUser(req);
    if (!user) {
      const response = unauthorized();
      clearStaffSessionCookie(response as NextResponse);
      return response;
    }

    const response = jsonResponse({ ok: true, data: serializeStaffUser(user) });
    return response;
  } catch (error) {
    return serverError('Nie udało się pobrać bieżącego użytkownika', error);
  }
}
