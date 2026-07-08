import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, optionalString, readJsonObject, serverError, unauthorized } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { getCurrentStaffUser, serializeStaffUser, staffUserInclude } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentStaffUser(req);
    if (!user) return unauthorized();
    return jsonResponse({ ok: true, data: serializeStaffUser(user) });
  } catch (error) {
    return serverError('Nie udało się pobrać profilu', error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const currentUser = await getCurrentStaffUser(req);
    if (!currentUser) return unauthorized();
    const body = await readJsonObject(req);
    const updateData: Record<string, any> = {};
    if ('name' in body) updateData.name = optionalString(body, 'name') || currentUser.name;
    if ('phone' in body) updateData.phone = optionalString(body, 'phone') || null;
    if ('positionTitle' in body) updateData.positionTitle = optionalString(body, 'positionTitle') || null;
    if ('avatarUrl' in body) updateData.avatarUrl = optionalString(body, 'avatarUrl') || null;

    const user = await prisma.staffUser.update({
      where: { id: currentUser.id },
      data: updateData,
      include: staffUserInclude,
    });
    return jsonResponse({ ok: true, data: serializeStaffUser(user) });
  } catch (error) {
    if (error instanceof Error) return badRequest(error.message);
    return serverError('Nie udało się zapisać profilu', error);
  }
}
