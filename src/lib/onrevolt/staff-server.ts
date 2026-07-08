import { NextRequest } from 'next/server';
import { prisma } from './prisma';

export const staffSessionCookie = 'onrevolt_staff_user';

export const staffUserInclude = {
  role: true,
  companyRoles: {
    include: { companyRole: true },
  },
} as const;

export async function getCurrentStaffUser(req?: NextRequest) {
  const cookieUserId = req?.cookies.get(staffSessionCookie)?.value;
  if (!cookieUserId) return null;
  return prisma.staffUser.findFirst({
    where: { id: cookieUserId, active: true },
    include: staffUserInclude,
  });
}

export function serializeStaffUser(user: any) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    active: user.active,
    systemRole: user.systemRole,
    positionTitle: user.positionTitle,
    avatarUrl: user.avatarUrl,
    passwordResetRequired: user.passwordResetRequired,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    legacyRole: user.role ? {
      id: user.role.id,
      code: user.role.code,
      name: user.role.name,
    } : null,
    companyRoles: [...(user.companyRoles || [])]
      .sort((a: any, b: any) => (a.companyRole?.sortOrder ?? 0) - (b.companyRole?.sortOrder ?? 0))
      .map((entry: any) => ({
        id: entry.companyRole.id,
        code: entry.companyRole.code,
        name: entry.companyRole.name,
        sortOrder: entry.companyRole.sortOrder,
      })),
  };
}

export function isAdminUser(user: any) {
  return user?.systemRole === 'ADMIN';
}
