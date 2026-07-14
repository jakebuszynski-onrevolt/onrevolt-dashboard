import { NextRequest, NextResponse } from 'next/server';
import { jsonResponse } from 'lib/onrevolt/api';
import {
  assertSameOrigin,
  clearStaffSessionCookie,
  revokeStaffSession,
  staffAuthorizationResponse,
} from 'lib/onrevolt/staff-server';

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    await revokeStaffSession(req);
    const response = jsonResponse({ ok: true });
    clearStaffSessionCookie(response as NextResponse);
    return response;
  } catch (error) {
    const authorizationResponse = staffAuthorizationResponse(error);
    if (authorizationResponse) return authorizationResponse;
    throw error;
  }
}
