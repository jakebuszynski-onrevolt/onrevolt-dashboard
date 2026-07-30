import { createHash, randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from './prisma';

export const staffSessionCookie = 'onrevolt_staff_session';
export const staffSessionMaxAgeSeconds = 60 * 60 * 24 * 30;

export type StaffPermission =
  | 'crm.read'
  | 'crm.write'
  | 'pricing.read'
  | 'pricing.write'
  | 'catalog.manage'
  | 'configurations.manage'
  | 'offers.manage'
  | 'installations.manage'
  | 'service.manage'
  | 'documents.manage'
  | 'energy.manage'
  | 'site-audits.manage'
  | 'reports.read'
  | 'synchronization.manage'
  | 'users.manage'
  | 'settings.manage';

const allPermissions: StaffPermission[] = [
  'crm.read',
  'crm.write',
  'pricing.read',
  'pricing.write',
  'catalog.manage',
  'configurations.manage',
  'offers.manage',
  'installations.manage',
  'service.manage',
  'documents.manage',
  'energy.manage',
  'site-audits.manage',
  'reports.read',
  'synchronization.manage',
  'users.manage',
  'settings.manage',
];

const moderatorPermissions = allPermissions.filter(
  (permission) => permission !== 'users.manage' && permission !== 'settings.manage',
);

const companyRolePermissions: Record<string, StaffPermission[]> = {
  SZEF: moderatorPermissions,
  KOORDYNATOR: [
    'crm.read', 'crm.write', 'pricing.read', 'catalog.manage',
    'configurations.manage', 'offers.manage', 'installations.manage',
    'service.manage', 'documents.manage', 'energy.manage', 'site-audits.manage', 'reports.read',
  ],
  SPRZEDAWCA: [
    'crm.read', 'crm.write', 'pricing.read', 'configurations.manage',
    'offers.manage', 'documents.manage', 'energy.manage', 'site-audits.manage',
  ],
  MONTER: ['crm.read', 'installations.manage', 'documents.manage', 'site-audits.manage'],
  ELEKTRYK: ['crm.read', 'installations.manage', 'documents.manage', 'service.manage', 'site-audits.manage'],
  SERWIS: ['crm.read', 'service.manage', 'documents.manage'],
  PROJEKTANT: ['crm.read', 'pricing.read', 'configurations.manage', 'documents.manage', 'energy.manage', 'site-audits.manage'],
  DEVELOPER: moderatorPermissions,
  KSIEGOWOSC: ['crm.read', 'pricing.read', 'offers.manage', 'documents.manage', 'reports.read'],
  BIURO: ['crm.read', 'crm.write', 'documents.manage', 'energy.manage', 'site-audits.manage'],
  PODWYKONAWCA: ['crm.read', 'installations.manage', 'documents.manage', 'site-audits.manage'],
};

export const staffUserInclude = {
  role: true,
  companyRoles: {
    include: { companyRole: true },
  },
} as const;

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function requestIpHash(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || '';
  return ip ? sha256(ip) : undefined;
}

export function assertSameOrigin(req: NextRequest) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') throw new StaffAuthorizationError(403, 'Żądanie z obcej domeny zostało odrzucone');

  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');
  if (!host || origin !== `${proto}://${host}`) {
    throw new StaffAuthorizationError(403, 'Żądanie z obcej domeny zostało odrzucone');
  }
}

export async function createStaffSession(req: NextRequest, staffUserId: string) {
  const token = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + staffSessionMaxAgeSeconds * 1000);
  await prisma.staffSession.create({
    data: {
      tokenHash: sha256(token),
      staffUserId,
      expiresAt,
      userAgent: req.headers.get('user-agent')?.slice(0, 500) || undefined,
      ipHash: requestIpHash(req),
    },
  });
  return { token, expiresAt };
}

export function setStaffSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(staffSessionCookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: staffSessionMaxAgeSeconds,
  });
}

export function clearStaffSessionCookie(response: NextResponse) {
  response.cookies.set(staffSessionCookie, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function revokeStaffSession(req: NextRequest) {
  const token = req.cookies.get(staffSessionCookie)?.value;
  if (!token) return;
  await prisma.staffSession.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getCurrentStaffUser(req?: NextRequest) {
  const token = req?.cookies.get(staffSessionCookie)?.value;
  if (!token) return null;

  const session = await prisma.staffSession.findFirst({
    where: {
      tokenHash: sha256(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
      staffUser: { active: true },
    },
    include: {
      staffUser: { include: staffUserInclude },
    },
  });
  if (!session) return null;

  if (Date.now() - session.lastSeenAt.getTime() > 15 * 60 * 1000) {
    await prisma.staffSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
  }
  return session.staffUser;
}

export function getStaffPermissions(user: any): Set<StaffPermission> {
  if (!user) return new Set();
  if (user.systemRole === 'ADMIN') return new Set(allPermissions);
  if (user.systemRole === 'MODERATOR') return new Set(moderatorPermissions);

  const permissions = new Set<StaffPermission>(['crm.read']);
  for (const entry of user.companyRoles || []) {
    for (const permission of companyRolePermissions[entry.companyRole?.code] || []) {
      permissions.add(permission);
    }
  }
  return permissions;
}

export function hasStaffPermission(user: any, permission: StaffPermission) {
  return getStaffPermissions(user).has(permission);
}

export class StaffAuthorizationError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
    this.name = 'StaffAuthorizationError';
  }
}

export async function requireStaffUser(req: NextRequest, permission: StaffPermission = 'crm.read') {
  assertSameOrigin(req);
  const user = await getCurrentStaffUser(req);
  if (!user) throw new StaffAuthorizationError(401, 'Wymagane logowanie');
  if (!hasStaffPermission(user, permission)) {
    throw new StaffAuthorizationError(403, 'Brak uprawnień do tej operacji');
  }
  return user;
}

export async function authorizeStaffRequest(
  req: NextRequest,
  permission: StaffPermission = 'crm.read',
) {
  try {
    return { ok: true as const, user: await requireStaffUser(req, permission) };
  } catch (error) {
    const response = staffAuthorizationResponse(error);
    if (response) return { ok: false as const, response };
    throw error;
  }
}

export function staffAuthorizationResponse(error: unknown) {
  if (!(error instanceof StaffAuthorizationError)) return null;
  return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
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
    permissions: Array.from(getStaffPermissions(user)),
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
