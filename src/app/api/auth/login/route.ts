import { NextRequest, NextResponse } from 'next/server';
import { badRequest, jsonResponse, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { verifyPassword } from 'lib/onrevolt/staff';
import { serializeStaffUser, staffSessionCookie, staffUserInclude } from 'lib/onrevolt/staff-server';

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const email = requireString(body, 'email').toLowerCase();
    const password = requireString(body, 'password');
    const user = await prisma.staffUser.findUnique({
      where: { email },
      include: staffUserInclude,
    });

    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      return badRequest('Nieprawidłowy email lub hasło');
    }

    const updated = await prisma.staffUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      include: staffUserInclude,
    });
    const response = jsonResponse({ ok: true, data: serializeStaffUser(updated) });
    (response as NextResponse).cookies.set(staffSessionCookie, updated.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    if (error instanceof Error) return badRequest(error.message);
    return serverError('Nie udało się zalogować', error);
  }
}
