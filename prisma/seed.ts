import { CompanyRoleCode, PrismaClient, ProjectStatus, StaffRoleCode } from '@prisma/client';
import { companyRoleLabels, companyRoleOrder, hashPassword } from '../src/lib/onrevolt/staff';
import { operationalPipelineStages, projectStatusStageCode } from '../src/lib/onrevolt/pipeline-stages';

const prisma = new PrismaClient();

const legacyRoles: Array<{ code: StaffRoleCode; name: string; permissions: string[] }> = [
  { code: 'ADMIN', name: 'Administrator', permissions: ['*'] },
  { code: 'SZEF', name: 'Szef', permissions: ['clients:read', 'clients:write', 'pricing:read', 'pricing:write', 'reports:read', 'tasks:assign'] },
  { code: 'SPRZEDAWCA', name: 'Sprzedawca', permissions: ['clients:read', 'clients:write', 'configurations:write', 'offers:write', 'tasks:write'] },
  { code: 'MONTER', name: 'Monter', permissions: ['installations:read', 'installations:write', 'documents:upload', 'tasks:write'] },
  { code: 'SERWIS', name: 'Serwis', permissions: ['service:read', 'service:write', 'documents:upload', 'tasks:write'] },
  { code: 'KSIEGOWOSC', name: 'Księgowość', permissions: ['contracts:read', 'documents:read', 'documents:upload', 'reports:finance'] },
];

const stages = operationalPipelineStages;

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
    const existing = await prisma.pipelineStage.findFirst({
      where: { OR: [{ code: stage.code }, { name: stage.name }] },
    });
    const data = {
      ...stage,
      isTerminal: stage.isTerminal ?? false,
      requiresOwner: stage.requiresOwner ?? true,
      requiresNextAction: stage.requiresNextAction ?? true,
      isActive: true,
      source: 'LOCAL',
    };
    if (existing) {
      await prisma.pipelineStage.update({ where: { id: existing.id }, data });
    } else {
      await prisma.pipelineStage.create({ data });
    }
  }

  for (const [status, code] of Object.entries(projectStatusStageCode)) {
    const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { code } });
    await prisma.project.updateMany({
      where: { status: status as ProjectStatus },
      data: {
        stageId: stage.id,
        closedAt: stage.isTerminal ? new Date() : undefined,
      },
    });
  }

  const workflowRules = [
    { stageCode: 'CRM_CZEKA_NA_KALKULACJE', name: 'Dane do audytu', taskTitle: 'Uzupełnij dane energetyczne i audyt', dueOffsetDays: 2, taskPriority: 'HIGH' as const },
    { stageCode: 'CRM_OFERTA_PRZYGOTOWANA', name: 'Kontakt po ofercie', taskTitle: 'Skontaktuj się po wysłaniu oferty', dueOffsetDays: 2, taskPriority: 'HIGH' as const },
    { stageCode: 'CRM_OFERTA_ZAAKCEPTOWANA', name: 'Umowa i zaliczka', taskTitle: 'Przygotuj umowę i zaliczkę', dueOffsetDays: 1, taskPriority: 'HIGH' as const },
    { stageCode: 'CRM_ZALICZKA_MONTAZ', name: 'Termin montażu', taskTitle: 'Ustal termin montażu z klientem', dueOffsetDays: 3, taskPriority: 'NORMAL' as const },
    { stageCode: 'CRM_PROCEDURA_OSD', name: 'Dokumenty OSD', taskTitle: 'Przygotuj i złóż dokumenty OSD', dueOffsetDays: 1, taskPriority: 'HIGH' as const },
  ];

  for (const rule of workflowRules) {
    const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { code: rule.stageCode } });
    const existing = await prisma.workflowRule.findFirst({ where: { name: rule.name } });
    const data = {
      name: rule.name,
      triggerStageId: stage.id,
      taskTitle: rule.taskTitle,
      dueOffsetDays: rule.dueOffsetDays,
      taskPriority: rule.taskPriority,
      active: true,
      assignToOwner: true,
    };
    if (existing) await prisma.workflowRule.update({ where: { id: existing.id }, data });
    else await prisma.workflowRule.create({ data });
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
