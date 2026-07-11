import { NextRequest } from 'next/server';
import { InstallationStatus } from '@prisma/client';
import {
  badRequest,
  forbidden,
  jsonResponse,
  notFound,
  optionalString,
  parseDate,
  readJsonObject,
  requireString,
  serverError,
  unauthorized,
} from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { getCurrentStaffUser, isAdminUser, serializeStaffUser } from 'lib/onrevolt/staff-server';

const activeStatuses = [
  InstallationStatus.TO_SCHEDULE,
  InstallationStatus.PLANNED,
  InstallationStatus.CONFIRMED,
  InstallationStatus.IN_PROGRESS,
  InstallationStatus.NEEDS_COMPLETION,
  InstallationStatus.WAITING_OSD,
];

const installationStatuses = Object.values(InstallationStatus) as string[];

const defaultChecklist = [
  'Potwierdzono termin z klientem',
  'Zweryfikowano adres montażu i kontakt na miejscu',
  'Sprawdzono komplet urządzeń i osprzętu',
  'Wykonano dokumentację zdjęciową',
  'Spisano numery seryjne urządzeń',
  'Podpisano protokół odbioru',
  'Przekazano komplet dokumentów do biura / OSD',
];

const userSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  positionTitle: true,
  systemRole: true,
} as const;

const installationInclude: any = {
  project: {
    include: {
      client: { select: { id: true, displayName: true, clientType: true } },
      owner: { select: userSelect },
      investmentSite: true,
      energyPortalAccounts: {
        select: { id: true, operator: true, tariff: true, ppeNumber: true, portalPpeId: true },
        take: 3,
      },
    },
  },
  offer: {
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      configurationId: true,
      totalGross: true,
      updatedAt: true,
    },
  },
  configuration: {
    select: {
      id: true,
      name: true,
      status: true,
      kind: true,
      targetPowerKw: true,
      targetCapacityKwh: true,
      updatedAt: true,
    },
  },
  teamLead: { select: userSelect },
  teamMembers: {
    include: { staffUser: { select: userSelect } },
    orderBy: [{ isLead: 'desc' as const }, { assignedAt: 'asc' as const }],
  },
  checklistItems: {
    include: { completedBy: { select: userSelect } },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  },
  plannedItems: {
    include: {
      product: { select: { id: true, sku: true, name: true, producer: true, category: true } },
      installedDevices: { select: { id: true, serialNumber: true } },
    },
    orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }],
  },
  installedDevices: {
    include: {
      product: { select: { id: true, sku: true, name: true, producer: true, category: true } },
      plannedItem: { select: { id: true, name: true, position: true } },
    },
    orderBy: [{ installedAt: 'desc' as const }, { updatedAt: 'desc' as const }],
  },
  documents: {
    orderBy: { createdAt: 'desc' as const },
    take: 40,
  },
  tasks: {
    include: {
      assignedTo: { select: userSelect },
      createdBy: { select: userSelect },
      _count: { select: { comments: true } },
    },
    orderBy: [{ status: 'asc' as const }, { dueAt: 'asc' as const }, { updatedAt: 'desc' as const }],
    take: 50,
  },
};

function dayRange(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function optionalNullableString(body: Record<string, any>, key: string) {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`Pole ${key} musi być tekstem`);
  return value.trim();
}

function parseNullableDate(body: Record<string, any>, key: string) {
  if (!(key in body)) return undefined;
  if (body[key] == null || body[key] === '') return null;
  return parseDate(body[key]);
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())));
}

function normalizeStatus(value: unknown, fallback: InstallationStatus) {
  return typeof value === 'string' && installationStatuses.includes(value) ? value as InstallationStatus : fallback;
}

function canSeeInstallation(user: any, admin: boolean, installation: any) {
  if (admin) return true;
  if (installation.teamLeadId === user.id) return true;
  if (installation.project?.ownerId === user.id) return true;
  if ((installation.teamMembers || []).some((member: any) => member.staffUserId === user.id)) return true;
  if ((installation.tasks || []).some((task: any) => task.assignedToId === user.id || task.createdById === user.id)) return true;
  return false;
}

function buildAccessWhere(user: any, admin: boolean) {
  if (admin) return {};
  return {
    OR: [
      { teamLeadId: user.id },
      { teamMembers: { some: { staffUserId: user.id } } },
      { project: { ownerId: user.id } },
      { tasks: { some: { OR: [{ assignedToId: user.id }, { createdById: user.id }] } } },
    ],
  };
}

function buildSearchWhere(query: string) {
  const text = query.trim();
  if (!text) return {};
  return {
    OR: [
      { address: { contains: text } },
      { contactName: { contains: text } },
      { contactPhone: { contains: text } },
      { notes: { contains: text } },
      { project: { title: { contains: text } } },
      { project: { client: { displayName: { contains: text } } } },
      { project: { energyPortalAccounts: { some: { ppeNumber: { contains: text } } } } },
      { offer: { number: { contains: text } } },
      { teamLead: { name: { contains: text } } },
    ],
  };
}

function buildListWhere(req: NextRequest, user: any, admin: boolean) {
  const { searchParams } = new URL(req.url);
  const { start, end } = dayRange();
  const and: any[] = [buildAccessWhere(user, admin)];
  const query = searchParams.get('q') || '';
  const scope = searchParams.get('scope') || 'active';
  const status = searchParams.get('status') || '';
  const teamLeadId = searchParams.get('teamLeadId') || '';
  const projectId = searchParams.get('projectId') || '';
  const clientId = searchParams.get('clientId') || '';

  const searchWhere = buildSearchWhere(query);
  if (Object.keys(searchWhere).length > 0) and.push(searchWhere);
  if (installationStatuses.includes(status)) and.push({ status });
  if (teamLeadId) and.push({ OR: [{ teamLeadId }, { teamMembers: { some: { staffUserId: teamLeadId } } }] });
  if (projectId) and.push({ projectId });
  if (clientId) and.push({ project: { clientId } });

  if (scope === 'active') and.push({ status: { in: activeStatuses } });
  if (scope === 'mine') and.push({
    OR: [
      { teamLeadId: user.id },
      { teamMembers: { some: { staffUserId: user.id } } },
      { tasks: { some: { assignedToId: user.id } } },
    ],
  });
  if (scope === 'to_schedule') and.push({ status: InstallationStatus.TO_SCHEDULE });
  if (scope === 'planned') and.push({ status: { in: [InstallationStatus.PLANNED, InstallationStatus.CONFIRMED] } });
  if (scope === 'in_progress') and.push({ status: InstallationStatus.IN_PROGRESS });
  if (scope === 'today') and.push({ status: { in: activeStatuses }, plannedAt: { gte: start, lt: end } });
  if (scope === 'overdue') and.push({ status: { in: activeStatuses }, plannedAt: { lt: start } });
  if (scope === 'needs') and.push({ status: InstallationStatus.NEEDS_COMPLETION });
  if (scope === 'completed') and.push({ status: InstallationStatus.COMPLETED });

  return { AND: and };
}

function serializeUser(user: any) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    positionTitle: user.positionTitle,
    systemRole: user.systemRole,
  };
}

function serializeTask(task: any) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    assignedToId: task.assignedToId,
    assignedTo: serializeUser(task.assignedTo),
    createdBy: serializeUser(task.createdBy),
    commentsCount: task._count?.comments || 0,
  };
}

function serializeInstallation(installation: any) {
  const checklist = installation.checklistItems || [];
  const plannedItems = installation.plannedItems || [];
  const installedDevices = installation.installedDevices || [];
  const checklistDone = checklist.filter((item: any) => item.completed).length;

  return {
    ...installation,
    teamLead: serializeUser(installation.teamLead),
    teamMembers: (installation.teamMembers || []).map((member: any) => ({
      installationId: member.installationId,
      staffUserId: member.staffUserId,
      role: member.role,
      isLead: member.isLead,
      assignedAt: member.assignedAt,
      staffUser: serializeUser(member.staffUser),
    })),
    checklistItems: checklist.map((item: any) => ({
      ...item,
      completedBy: serializeUser(item.completedBy),
    })),
    tasks: (installation.tasks || []).map(serializeTask),
    progress: {
      checklistDone,
      checklistTotal: checklist.length,
      plannedItems: plannedItems.length,
      installedDevices: installedDevices.length,
      documents: installation.documents?.length || 0,
    },
  };
}

async function loadMeta() {
  const [users, projects] = await Promise.all([
    prisma.staffUser.findMany({
      where: { active: true },
      select: userSelect,
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    }),
    prisma.project.findMany({
      where: {
        OR: [
          { offers: { some: { status: 'ACCEPTED' } } },
          { configurations: { some: { status: { in: ['READY', 'OFFERED', 'ACCEPTED'] } } } },
          { status: { in: ['OFERTA_ZAAKCEPTOWANA', 'ZALICZKA_MONTAZ', 'PROCEDURA_OSD', 'ODBIOR'] } },
        ],
      },
      include: {
        client: { select: { id: true, displayName: true, clientType: true } },
        investmentSite: true,
        offers: {
          where: { OR: [{ status: 'ACCEPTED' }, { configurationId: { not: null } }] },
          select: { id: true, number: true, title: true, status: true, configurationId: true, updatedAt: true },
          orderBy: [{ acceptedAt: 'desc' }, { updatedAt: 'desc' }],
          take: 5,
        },
        configurations: {
          select: { id: true, name: true, status: true, kind: true, updatedAt: true },
          orderBy: [{ updatedAt: 'desc' }],
          take: 5,
        },
        installations: {
          select: { id: true, status: true, plannedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: 3,
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
      take: 1000,
    }),
  ]);

  return { users, projects };
}

async function loadStats(user: any, admin: boolean) {
  const { start, end } = dayRange();
  const baseWhere = buildAccessWhere(user, admin);
  const [total, toSchedule, planned, today, inProgress, needsCompletion, completed] = await Promise.all([
    prisma.installation.count({ where: baseWhere }),
    prisma.installation.count({ where: { AND: [baseWhere, { status: InstallationStatus.TO_SCHEDULE }] } }),
    prisma.installation.count({ where: { AND: [baseWhere, { status: { in: [InstallationStatus.PLANNED, InstallationStatus.CONFIRMED] } }] } }),
    prisma.installation.count({ where: { AND: [baseWhere, { status: { in: activeStatuses }, plannedAt: { gte: start, lt: end } }] } }),
    prisma.installation.count({ where: { AND: [baseWhere, { status: InstallationStatus.IN_PROGRESS }] } }),
    prisma.installation.count({ where: { AND: [baseWhere, { status: InstallationStatus.NEEDS_COMPLETION }] } }),
    prisma.installation.count({ where: { AND: [baseWhere, { status: InstallationStatus.COMPLETED }] } }),
  ]);

  return { total, toSchedule, planned, today, inProgress, needsCompletion, completed };
}

async function loadInstallation(id: string) {
  return prisma.installation.findUnique({ where: { id }, include: installationInclude });
}

function createNotificationData(params: {
  staffUserId?: string | null;
  actorId?: string | null;
  taskId: string;
  title: string;
  message?: string | null;
}) {
  if (!params.staffUserId || params.staffUserId === params.actorId) return null;
  return {
    staffUserId: params.staffUserId,
    actorId: params.actorId || null,
    taskId: params.taskId,
    type: 'INSTALLATION_TASK',
    title: params.title,
    message: params.message || null,
    href: `/admin/installations?taskId=${params.taskId}`,
  };
}

async function createTeamTasks(tx: any, params: {
  installation: any;
  project: any;
  currentUserId: string;
  teamIds: string[];
}) {
  const uniqueTeamIds = Array.from(new Set(params.teamIds.filter(Boolean)));
  if (uniqueTeamIds.length === 0) return;

  const createdTasks = [];
  for (const staffUserId of uniqueTeamIds) {
    const task = await tx.task.create({
      data: {
        title: `Montaż: ${params.project.title}`,
        description: [
          params.installation.address ? `Adres: ${params.installation.address}` : '',
          params.installation.contactName ? `Kontakt: ${params.installation.contactName}` : '',
          params.installation.contactPhone ? `Telefon: ${params.installation.contactPhone}` : '',
        ].filter(Boolean).join('\n') || undefined,
        status: 'OPEN',
        priority: 'HIGH',
        dueAt: params.installation.plannedAt,
        clientId: params.project.clientId,
        projectId: params.project.id,
        installationId: params.installation.id,
        assignedToId: staffUserId,
        createdById: params.currentUserId,
      },
    });
    createdTasks.push(task);
  }

  const notifications = createdTasks
    .map((task: any) => createNotificationData({
      staffUserId: task.assignedToId,
      actorId: params.currentUserId,
      taskId: task.id,
      title: 'Nowe zadanie montażowe',
      message: task.title,
    }))
    .filter(Boolean);

  if (notifications.length > 0) await tx.panelNotification.createMany({ data: notifications });
}

async function resolveSource(body: Record<string, any>, projectId: string) {
  const [project, requestedOffer, requestedConfiguration] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        investmentSite: true,
        offers: {
          where: { OR: [{ status: 'ACCEPTED' }, { configurationId: { not: null } }] },
          include: {
            configuration: {
              include: {
                items: { include: { product: true }, orderBy: { position: 'asc' } },
              },
            },
          },
          orderBy: [{ acceptedAt: 'desc' }, { updatedAt: 'desc' }],
        },
        configurations: {
          include: { items: { include: { product: true }, orderBy: { position: 'asc' } } },
          orderBy: { updatedAt: 'desc' },
        },
      },
    }),
    optionalString(body, 'offerId')
      ? prisma.offer.findUnique({
        where: { id: optionalString(body, 'offerId') },
        include: { configuration: { include: { items: { include: { product: true }, orderBy: { position: 'asc' } } } } },
      })
      : Promise.resolve(null),
    optionalString(body, 'configurationId')
      ? prisma.configuration.findUnique({
        where: { id: optionalString(body, 'configurationId') },
        include: { items: { include: { product: true }, orderBy: { position: 'asc' } } },
      })
      : Promise.resolve(null),
  ]);

  if (!project) throw new Error('Nie znaleziono projektu');
  const offer = requestedOffer || project.offers.find((item) => item.status === 'ACCEPTED') || project.offers[0] || null;
  const configuration = requestedConfiguration || offer?.configuration || project.configurations.find((item) => item.status === 'ACCEPTED') || project.configurations[0] || null;

  if (!offer && !configuration) {
    throw new Error('Projekt nie ma zaakceptowanej oferty ani konfiguracji do przekazania na montaż');
  }

  return { project, offer, configuration };
}

function plannedItemsFromSource(configuration: any, offer: any) {
  if (configuration?.items?.length) {
    return configuration.items.map((item: any, index: number) => ({
      configurationItemId: item.id,
      productId: item.productId,
      position: item.position || index + 1,
      name: item.product?.name || item.description,
      quantity: item.quantity,
      role: item.role || 'OTHER',
      supplyMode: item.supplyMode || 'ONREVOLT_SUPPLIED',
      notes: item.notes,
    }));
  }

  if (Array.isArray(offer?.lineItemsSnapshot) && offer.lineItemsSnapshot.length) {
    return offer.lineItemsSnapshot.map((item: any, index: number) => ({
      productId: item.productId || null,
      position: Number(item.position || index + 1),
      name: String(item.name || item.description || `Pozycja ${index + 1}`),
      quantity: Number(item.quantity || 1),
      role: item.role || 'OTHER',
      supplyMode: item.supplyMode || 'ONREVOLT_SUPPLIED',
      notes: item.notes || null,
    }));
  }

  return [];
}

export async function GET(req: NextRequest) {
  try {
    const currentUser = await getCurrentStaffUser(req);
    if (!currentUser) return unauthorized();
    const admin = isAdminUser(currentUser);

    const [installations, stats, meta] = await Promise.all([
      prisma.installation.findMany({
        where: buildListWhere(req, currentUser, admin),
        include: installationInclude,
        orderBy: [{ status: 'asc' }, { plannedAt: 'asc' }, { updatedAt: 'desc' }],
        take: 300,
      }),
      loadStats(currentUser, admin),
      loadMeta(),
    ]);

    return jsonResponse({
      ok: true,
      data: {
        currentUser: serializeStaffUser(currentUser),
        isAdmin: admin,
        installations: installations.map(serializeInstallation),
        stats,
        meta,
      },
    });
  } catch (error) {
    return serverError('Nie udało się pobrać montaży', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentStaffUser(req);
    if (!currentUser) return unauthorized();
    const body = await readJsonObject(req);
    const projectId = requireString(body, 'projectId');
    const { project, offer, configuration } = await resolveSource(body, projectId);
    const teamLeadId = optionalString(body, 'teamLeadId');
    const memberIds = stringArray(body.teamMemberIds);
    const teamIds = Array.from(new Set([teamLeadId, ...memberIds].filter(Boolean))) as string[];
    const sourceItems = plannedItemsFromSource(configuration, offer);

    const installation = await prisma.$transaction(async (tx) => {
      const created = await tx.installation.create({
        data: {
          projectId,
          offerId: offer?.id || undefined,
          configurationId: configuration?.id || undefined,
          status: normalizeStatus(body.status, InstallationStatus.TO_SCHEDULE),
          plannedAt: parseDate(body.plannedAt),
          plannedEndAt: parseDate(body.plannedEndAt),
          teamLeadId,
          address: optionalString(body, 'address') || project.investmentSite?.fullAddress || project.locationAddress || undefined,
          contactName: optionalString(body, 'contactName'),
          contactPhone: optionalString(body, 'contactPhone'),
          notes: optionalString(body, 'notes'),
          internalNotes: optionalString(body, 'internalNotes'),
        },
      });

      if (teamIds.length > 0) {
        await tx.installationTeamMember.createMany({
          data: teamIds.map((staffUserId) => ({
            installationId: created.id,
            staffUserId,
            role: staffUserId === teamLeadId ? 'Kierownik ekipy' : 'Członek ekipy',
            isLead: staffUserId === teamLeadId,
          })),
        });
      }

      await tx.installationChecklistItem.createMany({
        data: defaultChecklist.map((title, index) => ({
          installationId: created.id,
          title,
          required: true,
          sortOrder: index + 1,
        })),
      });

      if (sourceItems.length > 0) {
        await tx.installationPlannedItem.createMany({
          data: sourceItems.map((item: any) => ({
            installationId: created.id,
            configurationItemId: item.configurationItemId || undefined,
            productId: item.productId || undefined,
            position: item.position,
            name: item.name,
            quantity: item.quantity,
            role: item.role,
            supplyMode: item.supplyMode,
            notes: item.notes || undefined,
          })),
        });
      }

      if (body.createTasks !== false) {
        await createTeamTasks(tx, {
          installation: created,
          project,
          currentUserId: currentUser.id,
          teamIds,
        });
      }

      if (project.status !== 'ZAKONCZONY') {
        await tx.project.update({
          where: { id: project.id },
          data: { status: 'ZALICZKA_MONTAZ', installationDate: created.plannedAt },
        });
      }

      return created;
    });

    const full = await loadInstallation(installation.id);
    return jsonResponse({ ok: true, data: serializeInstallation(full) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('nie ma zaakceptowanej')) return badRequest(message);
    return serverError('Nie udało się zapisać montażu', error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const currentUser = await getCurrentStaffUser(req);
    if (!currentUser) return unauthorized();
    const admin = isAdminUser(currentUser);
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');

    const existing = await prisma.installation.findUnique({
      where: { id },
      include: {
        project: true,
        teamMembers: true,
        tasks: true,
      },
    });
    if (!existing) return notFound('Nie znaleziono montażu');
    if (!canSeeInstallation(currentUser, admin, existing)) return forbidden();

    const updateData: Record<string, any> = {};
    if ('status' in body) {
      const status = normalizeStatus(body.status, existing.status);
      updateData.status = status;
      if (status === InstallationStatus.CONFIRMED && !existing.confirmedAt) updateData.confirmedAt = new Date();
      if (status === InstallationStatus.IN_PROGRESS && !existing.startedAt) updateData.startedAt = new Date();
      if (status === InstallationStatus.COMPLETED && !existing.completedAt) updateData.completedAt = new Date();
    }
    if ('plannedAt' in body) updateData.plannedAt = parseNullableDate(body, 'plannedAt');
    if ('plannedEndAt' in body) updateData.plannedEndAt = parseNullableDate(body, 'plannedEndAt');
    if ('startedAt' in body) updateData.startedAt = parseNullableDate(body, 'startedAt');
    if ('completedAt' in body) updateData.completedAt = parseNullableDate(body, 'completedAt');
    if ('teamLeadId' in body) updateData.teamLeadId = optionalNullableString(body, 'teamLeadId');
    if ('address' in body) updateData.address = optionalNullableString(body, 'address');
    if ('contactName' in body) updateData.contactName = optionalNullableString(body, 'contactName');
    if ('contactPhone' in body) updateData.contactPhone = optionalNullableString(body, 'contactPhone');
    if ('notes' in body) updateData.notes = optionalNullableString(body, 'notes');
    if ('internalNotes' in body) updateData.internalNotes = optionalNullableString(body, 'internalNotes');

    await prisma.$transaction(async (tx) => {
      if (Object.keys(updateData).length > 0) {
        await tx.installation.update({ where: { id }, data: updateData });
      }

      if ('teamMemberIds' in body || 'teamLeadId' in body) {
        const nextLeadId = updateData.teamLeadId === undefined ? existing.teamLeadId : updateData.teamLeadId;
        const teamIds = Array.from(new Set([nextLeadId, ...stringArray(body.teamMemberIds)].filter(Boolean))) as string[];
        await tx.installationTeamMember.deleteMany({ where: { installationId: id } });
        if (teamIds.length > 0) {
          await tx.installationTeamMember.createMany({
            data: teamIds.map((staffUserId) => ({
              installationId: id,
              staffUserId,
              role: staffUserId === nextLeadId ? 'Kierownik ekipy' : 'Członek ekipy',
              isLead: staffUserId === nextLeadId,
            })),
          });
        }
        if (body.createTasks === true) {
          await createTeamTasks(tx, {
            installation: { ...existing, ...updateData, id },
            project: existing.project,
            currentUserId: currentUser.id,
            teamIds,
          });
        }
      }

      if (Array.isArray(body.checklistItems)) {
        for (const item of body.checklistItems) {
          if (!item?.id) continue;
          const completed = Boolean(item.completed);
          await tx.installationChecklistItem.update({
            where: { id: item.id },
            data: {
              completed,
              completedAt: completed ? new Date() : null,
              completedById: completed ? currentUser.id : null,
              notes: typeof item.notes === 'string' ? item.notes : undefined,
            },
          });
        }
      }

      if (updateData.status === InstallationStatus.COMPLETED) {
        await tx.project.update({
          where: { id: existing.projectId },
          data: { status: 'ODBIOR', installationDate: updateData.completedAt || existing.completedAt || new Date() },
        });
      }
    });

    const full = await loadInstallation(id);
    return jsonResponse({ ok: true, data: serializeInstallation(full) });
  } catch (error) {
    return serverError('Nie udało się zaktualizować montażu', error);
  }
}
