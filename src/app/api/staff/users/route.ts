import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonResponse, optionalString, readJsonObject, requireString, serverError, unauthorized } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { generateTemporaryPassword, hashPassword } from 'lib/onrevolt/staff';
import { authorizeStaffRequest, getCurrentStaffUser, isAdminUser, serializeStaffUser, staffUserInclude } from 'lib/onrevolt/staff-server';

function optionalBoolean(value: unknown) {
  if (value == null || value === '') return undefined;
  return Boolean(value);
}

function normalizeCompanyRoleIds(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : [];
}

function normalizeSystemRole(value: unknown) {
  if (value === 'ADMIN' || value === 'MODERATOR' || value === 'USER') return value;
  return 'USER';
}

async function assertAdmin(req: NextRequest) {
  const user = await getCurrentStaffUser(req);
  if (!user) throw new Error('Wymagane logowanie');
  if (!isAdminUser(user)) throw new Error('Brak uprawnień administratora');
  return user;
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'users.manage');
  if (!access.ok) return access.response;
  try {
    const currentUser = await assertAdmin(req);
    const [users, companyRoles] = await Promise.all([
      prisma.staffUser.findMany({
        include: staffUserInclude,
        orderBy: [{ active: 'desc' }, { systemRole: 'asc' }, { createdAt: 'asc' }, { name: 'asc' }],
      }),
      prisma.companyRole.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ]);

    return jsonResponse({
      ok: true,
      data: {
        currentUser: serializeStaffUser(currentUser),
        users: users.map(serializeStaffUser),
        companyRoles,
        systemRoles: [
          { code: 'ADMIN', name: 'Admin' },
          { code: 'MODERATOR', name: 'Moderator' },
          { code: 'USER', name: 'Użytkownik' },
        ],
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Wymagane logowanie')) return unauthorized(error.message);
    if (error instanceof Error && error.message.includes('Brak uprawnień')) return forbidden(error.message);
    return serverError('Nie udało się pobrać użytkowników', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'users.manage');
  if (!access.ok) return access.response;
  try {
    await assertAdmin(req);
    const body = await readJsonObject(req);
    const companyRoleIds = normalizeCompanyRoleIds(body.companyRoleIds);
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const tempPassword = generateTemporaryPassword();

    const user = await prisma.staffUser.create({
      data: {
        email: requireString(body, 'email').toLowerCase(),
        name: requireString(body, 'name'),
        phone: optionalString(body, 'phone'),
        active: body.active !== false,
        systemRole: normalizeSystemRole(body.systemRole) as any,
        positionTitle: optionalString(body, 'positionTitle'),
        avatarUrl: optionalString(body, 'avatarUrl'),
        passwordHash: hashPassword(tempPassword),
        passwordResetRequired: true,
        roleId: adminRole.id,
        companyRoles: {
          create: companyRoleIds.map((companyRoleId) => ({ companyRoleId })),
        },
      },
      include: staffUserInclude,
    });

    await prisma.emailMessage.create({
      data: {
        to: user.email,
        subject: 'Dostęp do panelu onRevolt',
        body: `Utworzono konto w panelu onRevolt.\nLogin: ${user.email}\nHasło tymczasowe: ${tempPassword}\nPo zalogowaniu zmień hasło.`,
        status: 'QUEUED',
      },
    });

    await writeAuditLog({
      actorId: access.user.id,
      entityType: 'StaffUser',
      entityId: user.id,
      action: 'CREATE',
      after: serializeStaffUser(user),
    });
    return jsonResponse({ ok: true, data: serializeStaffUser(user), tempPassword }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Wymagane logowanie')) return unauthorized(error.message);
    if (error instanceof Error && error.message.includes('Brak uprawnień')) return forbidden(error.message);
    return serverError('Nie udało się utworzyć użytkownika', error);
  }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'users.manage');
  if (!access.ok) return access.response;
  try {
    await assertAdmin(req);
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const companyRoleIds = normalizeCompanyRoleIds(body.companyRoleIds);
    const before = await prisma.staffUser.findUnique({ where: { id }, include: staffUserInclude });

    const updateData: Record<string, any> = {};
    if ('email' in body) updateData.email = requireString(body, 'email').toLowerCase();
    if ('name' in body) updateData.name = requireString(body, 'name');
    if ('phone' in body) updateData.phone = optionalString(body, 'phone') || null;
    if ('active' in body) updateData.active = optionalBoolean(body.active);
    if ('systemRole' in body) updateData.systemRole = normalizeSystemRole(body.systemRole);
    if ('positionTitle' in body) updateData.positionTitle = optionalString(body, 'positionTitle') || null;
    if ('avatarUrl' in body) updateData.avatarUrl = optionalString(body, 'avatarUrl') || null;

    const user = await prisma.$transaction(async (tx) => {
      await tx.staffUser.update({ where: { id }, data: updateData });
      if ('companyRoleIds' in body) {
        await tx.staffUserCompanyRole.deleteMany({ where: { staffUserId: id } });
        if (companyRoleIds.length > 0) {
          await tx.staffUserCompanyRole.createMany({
            data: companyRoleIds.map((companyRoleId) => ({ staffUserId: id, companyRoleId })),
          });
        }
      }

      return tx.staffUser.findUniqueOrThrow({ where: { id }, include: staffUserInclude });
    });

    await writeAuditLog({
      actorId: access.user.id,
      entityType: 'StaffUser',
      entityId: user.id,
      action: 'UPDATE',
      before: serializeStaffUser(before),
      after: serializeStaffUser(user),
    });
    return jsonResponse({ ok: true, data: serializeStaffUser(user) });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Wymagane logowanie')) return unauthorized(error.message);
    if (error instanceof Error && error.message.includes('Brak uprawnień')) return forbidden(error.message);
    return serverError('Nie udało się zaktualizować użytkownika', error);
  }
}

export async function DELETE(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'users.manage');
  if (!access.ok) return access.response;
  try {
    const currentUser = await assertAdmin(req);
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    if (currentUser?.id === id) return badRequest('Nie możesz usunąć własnego konta');

    const before = await prisma.staffUser.findUnique({ where: { id }, include: staffUserInclude });
    await prisma.staffUser.delete({ where: { id } });
    await writeAuditLog({
      actorId: access.user.id,
      entityType: 'StaffUser',
      entityId: id,
      action: 'DELETE',
      before: serializeStaffUser(before),
    });
    return jsonResponse({ ok: true, data: { id } });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Wymagane logowanie')) return unauthorized(error.message);
    if (error instanceof Error && error.message.includes('Brak uprawnień')) return forbidden(error.message);
    return serverError('Nie udało się usunąć użytkownika', error);
  }
}
