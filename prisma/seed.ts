import { CompanyRoleCode, PrismaClient, StaffRoleCode } from '@prisma/client';
import { companyRoleLabels, companyRoleOrder, hashPassword } from '../src/lib/onrevolt/staff';

const prisma = new PrismaClient();

const legacyRoles: Array<{ code: StaffRoleCode; name: string; permissions: string[] }> = [
  { code: 'ADMIN', name: 'Administrator', permissions: ['*'] },
  { code: 'SZEF', name: 'Szef', permissions: ['clients:read', 'clients:write', 'pricing:read', 'pricing:write', 'reports:read', 'tasks:assign'] },
  { code: 'SPRZEDAWCA', name: 'Sprzedawca', permissions: ['clients:read', 'clients:write', 'configurations:write', 'offers:write', 'tasks:write'] },
  { code: 'MONTER', name: 'Monter', permissions: ['installations:read', 'installations:write', 'documents:upload', 'tasks:write'] },
  { code: 'SERWIS', name: 'Serwis', permissions: ['service:read', 'service:write', 'documents:upload', 'tasks:write'] },
  { code: 'KSIEGOWOSC', name: 'Księgowość', permissions: ['contracts:read', 'documents:read', 'documents:upload', 'reports:finance'] },
];

const stages = [
  { name: 'Lead', sortOrder: 10, color: '#7C3AED' },
  { name: 'Czeka na kalkulację', sortOrder: 20, color: '#2563EB' },
  { name: 'W trakcie obsługi', sortOrder: 30, color: '#0EA5E9' },
  { name: 'Oferta przygotowana', sortOrder: 40, color: '#F59E0B' },
  { name: 'Zaakceptowano ofertę', sortOrder: 50, color: '#16A34A' },
  { name: 'Wpłacono zaliczkę / montaż', sortOrder: 60, color: '#059669' },
  { name: 'Zamontowano / procedura OSD', sortOrder: 70, color: '#0284C7' },
  { name: 'Protokół odbioru / zakończono', sortOrder: 80, color: '#15803D', isTerminal: true },
  { name: 'Serwis', sortOrder: 90, color: '#DC2626' },
];

async function main() {
  for (const role of legacyRoles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, permissions: role.permissions },
      create: role,
    });
  }

  for (const [index, code] of companyRoleOrder.entries()) {
    await prisma.companyRole.upsert({
      where: { code: code as CompanyRoleCode },
      update: { name: companyRoleLabels[code], sortOrder: (index + 1) * 10 },
      create: {
        code: code as CompanyRoleCode,
        name: companyRoleLabels[code],
        sortOrder: (index + 1) * 10,
      },
    });
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  const bossCompanyRole = await prisma.companyRole.findUniqueOrThrow({ where: { code: 'SZEF' } });
  const artur = await prisma.staffUser.upsert({
    where: { email: 'artur@majtczak.com' },
    update: {
      name: 'Artur Majtczak',
      active: true,
      systemRole: 'ADMIN',
      positionTitle: 'Administrator',
      roleId: adminRole.id,
      passwordHash: hashPassword('Lukasek27#'),
      passwordResetRequired: false,
      avatarUrl: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    create: {
      email: 'artur@majtczak.com',
      name: 'Artur Majtczak',
      phone: '',
      active: true,
      systemRole: 'ADMIN',
      positionTitle: 'Administrator',
      roleId: adminRole.id,
      passwordHash: hashPassword('Lukasek27#'),
      passwordResetRequired: false,
      avatarUrl: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });

  await prisma.staffUserCompanyRole.upsert({
    where: {
      staffUserId_companyRoleId: {
        staffUserId: artur.id,
        companyRoleId: bossCompanyRole.id,
      },
    },
    update: {},
    create: {
      staffUserId: artur.id,
      companyRoleId: bossCompanyRole.id,
    },
  });

  const admin = await prisma.staffUser.upsert({
    where: { email: 'admin@onrevolt.com' },
    update: {
      name: 'Administrator onRevolt',
      active: true,
      systemRole: 'ADMIN',
      positionTitle: 'Administrator',
      roleId: adminRole.id,
    },
    create: {
      email: 'admin@onrevolt.com',
      name: 'Administrator onRevolt',
      phone: '',
      active: true,
      systemRole: 'ADMIN',
      positionTitle: 'Administrator',
      roleId: adminRole.id,
      passwordHash: hashPassword('OnRevolt2026!'),
      passwordResetRequired: true,
      avatarUrl: null,
    },
  });

  await prisma.staffUserCompanyRole.upsert({
    where: {
      staffUserId_companyRoleId: {
        staffUserId: admin.id,
        companyRoleId: bossCompanyRole.id,
      },
    },
    update: {},
    create: {
      staffUserId: admin.id,
      companyRoleId: bossCompanyRole.id,
    },
  });

  for (const stage of stages) {
    const existing = await prisma.pipelineStage.findFirst({ where: { name: stage.name } });
    if (existing) {
      await prisma.pipelineStage.update({ where: { id: existing.id }, data: stage });
    } else {
      await prisma.pipelineStage.create({ data: stage });
    }
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
