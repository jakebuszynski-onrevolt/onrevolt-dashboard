import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, readJsonObject, requireString, serverError, unauthorized } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { hashPassword, verifyPassword } from 'lib/onrevolt/staff';
import { getCurrentStaffUser, serializeStaffUser, staffUserInclude } from 'lib/onrevolt/staff-server';

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentStaffUser(req);
    if (!currentUser) return unauthorized();
    const body = await readJsonObject(req);
    const newPassword = requireString(body, 'newPassword');
    const confirmation = requireString(body, 'confirmation');
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';

    if (newPassword.length < 8) return badRequest('Hasło musi mieć minimum 8 znaków');
    if (newPassword !== confirmation) return badRequest('Potwierdzenie hasła nie zgadza się z nowym hasłem');
    if (!currentUser.passwordResetRequired && !verifyPassword(currentPassword, currentUser.passwordHash)) {
      return badRequest('Aktualne hasło jest nieprawidłowe');
    }

    const user = await prisma.staffUser.update({
      where: { id: currentUser.id },
      data: {
        passwordHash: hashPassword(newPassword),
        passwordResetRequired: false,
      },
      include: staffUserInclude,
    });
    return jsonResponse({ ok: true, data: serializeStaffUser(user) });
  } catch (error) {
    if (error instanceof Error) return badRequest(error.message);
    return serverError('Nie udało się zmienić hasła', error);
  }
}
