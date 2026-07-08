import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonResponse, readJsonObject, requireString, serverError, unauthorized } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { generateTemporaryPassword, hashPassword } from 'lib/onrevolt/staff';
import { getCurrentStaffUser, isAdminUser, serializeStaffUser, staffUserInclude } from 'lib/onrevolt/staff-server';

async function assertAdmin(req: NextRequest) {
  const user = await getCurrentStaffUser(req);
  if (!user) throw new Error('Wymagane logowanie');
  if (!isAdminUser(user)) throw new Error('Brak uprawnień administratora');
  return user;
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const tempPassword = generateTemporaryPassword();
    const user = await prisma.staffUser.update({
      where: { id },
      data: {
        passwordHash: hashPassword(tempPassword),
        passwordResetRequired: true,
      },
      include: staffUserInclude,
    });

    await prisma.emailMessage.create({
      data: {
        to: user.email,
        subject: 'Nowe hasło tymczasowe do panelu onRevolt',
        body: `Wygenerowano nowe hasło tymczasowe do panelu onRevolt.\nLogin: ${user.email}\nHasło tymczasowe: ${tempPassword}\nPo zalogowaniu zmień hasło.`,
        status: 'QUEUED',
      },
    });

    return jsonResponse({ ok: true, data: serializeStaffUser(user), tempPassword });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Wymagane logowanie')) return unauthorized(error.message);
    if (error instanceof Error && error.message.includes('Brak uprawnień')) return forbidden(error.message);
    if (error instanceof Error) return badRequest(error.message);
    return serverError('Nie udało się wygenerować hasła', error);
  }
}
