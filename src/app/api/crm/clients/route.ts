import { NextRequest } from 'next/server';
import { TaskStatus } from '@prisma/client';
import { forbidden, jsonResponse, notFound, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { isOperationalPipelineStageCode, projectStatusStageCode } from 'lib/onrevolt/pipeline-stages';
import { authorizeStaffRequest, getCurrentStaffUser, isAdminUser } from 'lib/onrevolt/staff-server';

const clientTypes = new Set(['UNKNOWN', 'B2C', 'B2B', 'B2C_B2B']);
const projectStatuses = new Set([
  'LEAD',
  'CZEKA_NA_KALKULACJE',
  'W_TRAKCIE_OBSLUGI',
  'OFERTA_PRZYGOTOWANA',
  'OFERTA_ZAAKCEPTOWANA',
  'ZALICZKA_MONTAZ',
  'PROCEDURA_OSD',
  'ODBIOR',
  'ZAKONCZONY',
  'SERWIS',
  'WSTRZYMANY',
]);

const projectInclude = {
  stage: true,
  owner: true,
  investmentSite: true,
};

const assignedActiveTasksCount = {
  tasks: {
    where: {
      status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS] },
      OR: [
        { assignedToId: { not: null } },
        { assistants: { some: {} } },
      ],
    },
  },
};

const energyPortalAccountSelect = {
  id: true,
  clientId: true,
  projectId: true,
  operator: true,
  login: true,
  tariff: true,
  ppeNumber: true,
  portalPpeId: true,
  meterNumber: true,
  notes: true,
  lastSyncAt: true,
  lastSyncStatus: true,
  lastSyncMessage: true,
  createdAt: true,
  updatedAt: true,
  measurementFiles: {
    include: { document: true },
    orderBy: [{ periodYear: 'desc' as const }, { periodMonth: 'desc' as const }, { kind: 'asc' as const }],
    take: 40,
  },
};

function jsonSnapshot(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function optionalNestedString(source: Record<string, any> | undefined, key: string) {
  if (!source) return undefined;
  const value = source[key];
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`Pole ${key} musi być tekstem`);
  return value.trim();
}

function nullableNestedString(source: Record<string, any> | undefined, key: string) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  const value = source[key];
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`Pole ${key} musi być tekstem`);
  return value.trim() || null;
}

function optionalNestedDate(source: Record<string, any> | undefined, key: string) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  const value = source[key];
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`Nieprawidłowa data w polu ${key}`);
  return date;
}

function dashboardStationValue(source: Record<string, any> | undefined) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, 'dashboardStation')) return undefined;
  const value = source.dashboardStation;
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('Pole dashboardStation musi być tekstem');

  const station = value.trim();
  if (!station) return null;
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(station)) {
    throw new Error('Station może zawierać tylko litery, cyfry, podkreślenie i myślnik');
  }
  return station;
}

function stationIdentifierValue(source: Record<string, any> | undefined, key: string, label: string) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  const value = source[key];
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`Pole ${key} musi być tekstem`);

  const station = value.trim();
  if (!station) return null;
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(station)) {
    throw new Error(`${label} może zawierać tylko litery, cyfry, podkreślenie i myślnik`);
  }
  return station;
}

function validateStageId(stageId: unknown) {
  if (stageId == null || stageId === '') return undefined;
  if (typeof stageId !== 'string') throw new Error('Pole stageId musi być tekstem');
  return stageId;
}

function validateProjectStatus(status: unknown) {
  if (status == null || status === '') return 'LEAD';
  if (typeof status !== 'string' || !projectStatuses.has(status)) {
    throw new Error('Nieprawidłowy status projektu');
  }
  return status;
}

function validateClientType(value: unknown, fallback = 'UNKNOWN') {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string' || !clientTypes.has(value)) {
    throw new Error('Nieprawidłowy typ klienta/projektu');
  }
  return value;
}

function contactData(displayName: string, contactBody: Record<string, any> | undefined) {
  if (!contactBody) return undefined;
  return {
    name: optionalNestedString(contactBody, 'name') || displayName,
    email: nullableNestedString(contactBody, 'email'),
    phone: nullableNestedString(contactBody, 'phone'),
    addressLine: nullableNestedString(contactBody, 'addressLine'),
    postalCode: nullableNestedString(contactBody, 'postalCode'),
    city: nullableNestedString(contactBody, 'city'),
    investmentAddress: nullableNestedString(contactBody, 'investmentAddress'),
  };
}

function investmentSiteData(
  clientId: string,
  displayName: string,
  contactBody: Record<string, any> | undefined,
  projectBody: Record<string, any> | undefined,
) {
  const fullAddress =
    optionalNestedString(projectBody, 'locationAddress') ||
    optionalNestedString(contactBody, 'investmentAddress');
  if (!fullAddress) return undefined;

  return {
    clientId,
    name: optionalNestedString(projectBody, 'siteName') || optionalNestedString(projectBody, 'title') || `Punkt - ${displayName}`,
    addressLine: fullAddress,
    fullAddress,
    source: optionalNestedString(projectBody, 'source') || 'manual',
    notes: optionalNestedString(projectBody, 'siteNotes'),
  };
}

function projectData(
  displayName: string,
  clientType: string,
  projectBody: Record<string, any> | undefined,
  contactBody: Record<string, any> | undefined,
  investmentSiteId?: string,
) {
  if (!projectBody) return undefined;

  return {
    title: optionalNestedString(projectBody, 'title') || `Projekt - ${displayName}`,
    status: validateProjectStatus(projectBody.status) as any,
    stageId: validateStageId(projectBody.stageId),
    ownerId: optionalNestedString(projectBody, 'ownerId'),
    nextActionTitle: optionalNestedString(projectBody, 'nextActionTitle'),
    nextActionAt: optionalNestedDate(projectBody, 'nextActionAt'),
    closedAt: undefined as Date | null | undefined,
    clientType: validateClientType(projectBody.clientType, clientType) as any,
    source: optionalNestedString(projectBody, 'source') || 'manual',
    dashboardStation: dashboardStationValue(projectBody),
    dashboardStationNumber: stationIdentifierValue(projectBody, 'dashboardStationNumber', 'Numer stacji'),
    weatherStationNumber: stationIdentifierValue(projectBody, 'weatherStationNumber', 'Numer stacji pogody'),
    locationAddress: optionalNestedString(projectBody, 'locationAddress') || optionalNestedString(contactBody, 'investmentAddress'),
    investmentSiteId,
    notes: optionalNestedString(projectBody, 'notes'),
  };
}

function projectedValue(value: string | null | undefined, current: string | null | undefined) {
  if (value === undefined) return current || null;
  return value || null;
}

function lockedStationFieldsChanged(
  existingProject: { dashboardStation?: string | null; dashboardStationNumber?: string | null } | undefined,
  data: { dashboardStation?: string | null; dashboardStationNumber?: string | null },
) {
  if (!existingProject?.dashboardStation || !existingProject.dashboardStationNumber) return false;
  const nextToken = projectedValue(data.dashboardStation, existingProject.dashboardStation);
  const nextNumber = projectedValue(data.dashboardStationNumber, existingProject.dashboardStationNumber);

  return nextToken !== (existingProject.dashboardStation || null)
    || nextNumber !== (existingProject.dashboardStationNumber || null);
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (id) {
      const client = await prisma.client.findUnique({
        where: { id },
        include: {
          contacts: true,
          investmentSites: { orderBy: { updatedAt: 'desc' } },
          projects: {
            include: {
              ...projectInclude,
              tasks: true,
              existingAssets: {
                include: { product: true },
                orderBy: { updatedAt: 'desc' },
              },
              configurations: {
                include: {
                  items: {
                    include: { product: true },
                    orderBy: { position: 'asc' },
                  },
                  _count: {
                    select: { offers: true, installations: true, stockReservations: true },
                  },
                },
                orderBy: { updatedAt: 'desc' },
              },
              offers: {
                include: {
                  configuration: true,
                  contracts: {
                    include: { documents: { orderBy: { createdAt: 'desc' } } },
                  },
                  documents: { orderBy: { createdAt: 'desc' } },
                },
                orderBy: { updatedAt: 'desc' },
              },
              siteAudits: {
                include: { documents: { orderBy: { createdAt: 'desc' } } },
                orderBy: { updatedAt: 'desc' },
              },
              odsCase: {
                include: { documents: { orderBy: { createdAt: 'desc' } } },
              },
              installations: {
                include: {
                  offer: true,
                  configuration: true,
                  teamLead: {
                    select: { id: true, name: true, email: true, avatarUrl: true, positionTitle: true },
                  },
                  teamMembers: {
                    include: {
                      staffUser: {
                        select: { id: true, name: true, email: true, avatarUrl: true, positionTitle: true },
                      },
                    },
                    orderBy: [{ isLead: 'desc' }, { assignedAt: 'asc' }],
                  },
                  checklistItems: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
                  plannedItems: {
                    include: { product: true },
                    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
                  },
                  tasks: {
                    include: {
                      assignedTo: { select: { id: true, name: true, email: true, avatarUrl: true, positionTitle: true } },
                    },
                    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
                  },
                  documents: { orderBy: { createdAt: 'desc' } },
                  installedDevices: {
                    include: { product: true, plannedItem: true },
                    orderBy: { updatedAt: 'desc' },
                  },
                },
                orderBy: { updatedAt: 'desc' },
              },
              documents: true,
            },
            orderBy: { updatedAt: 'desc' },
          },
          documents: { orderBy: { createdAt: 'desc' } },
          energyPortalAccounts: {
            select: energyPortalAccountSelect,
            orderBy: { updatedAt: 'desc' },
          },
          serviceTickets: {
            include: {
              assignedTo: { select: { id: true, name: true, email: true, avatarUrl: true, positionTitle: true } },
              installedDevice: { select: { id: true, name: true, serialNumber: true } },
              documents: { orderBy: { createdAt: 'desc' } },
            },
            orderBy: { updatedAt: 'desc' },
          },
          tasks: true,
          reminders: true,
          auditLogs: { orderBy: { createdAt: 'desc' }, take: 50 },
        },
      });
      if (!client) return notFound('Nie znaleziono klienta');
      return jsonResponse({ ok: true, data: client });
    }

    const clients = await prisma.client.findMany({
      include: {
        contacts: true,
        investmentSites: { orderBy: { updatedAt: 'desc' } },
        projects: {
          include: {
            ...projectInclude,
            _count: { select: assignedActiveTasksCount },
          },
          orderBy: { updatedAt: 'desc' },
        },
        _count: { select: assignedActiveTasksCount },
      },
      orderBy: { updatedAt: 'desc' },
      take: 1000,
    });
    return jsonResponse({ ok: true, data: clients });
  } catch (error) {
    return serverError('Nie udało się pobrać klientów', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'crm.write');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const displayName = requireString(body, 'displayName');
    const clientType = validateClientType(body.clientType);
    const contactBody = body.contact && typeof body.contact === 'object' && !Array.isArray(body.contact)
      ? body.contact as Record<string, any>
      : undefined;
    const projectBody = body.project && typeof body.project === 'object' && !Array.isArray(body.project)
      ? body.project as Record<string, any>
      : undefined;

    const client = await prisma.$transaction(async (tx) => {
      const savedClient = await tx.client.create({
        data: {
          displayName,
          clientType: clientType as any,
          taxId: optionalString(body, 'taxId'),
          clientProblem: optionalString(body, 'clientProblem'),
          expectedResult: optionalString(body, 'expectedResult'),
          notes: optionalString(body, 'notes'),
          contacts: contactBody ? { create: contactData(displayName, contactBody)! } : undefined,
        },
      });

      const siteInput = investmentSiteData(savedClient.id, displayName, contactBody, projectBody);
      const site = siteInput ? await tx.investmentSite.create({ data: siteInput }) : null;
      const projectInput = projectData(displayName, clientType, projectBody, contactBody, site?.id);
      if (projectInput) {
        const stageCode = projectStatusStageCode[projectInput.status];
        const stage = projectInput.stageId
          ? await tx.pipelineStage.findUnique({ where: { id: projectInput.stageId } })
          : stageCode
            ? await tx.pipelineStage.findUnique({ where: { code: stageCode } })
            : null;
        if (projectInput.stageId && (!stage || !isOperationalPipelineStageCode(stage.code))) {
          throw new Error('Nie znaleziono wybranego etapu projektu');
        }
        if (stage) {
          projectInput.stageId = stage.id;
          projectInput.status = stage.status;
          if (stage.requiresOwner && !projectInput.ownerId) projectInput.ownerId = access.user.id;
          projectInput.closedAt = stage.isTerminal ? new Date() : null;
        }
        await tx.project.create({ data: { ...projectInput, clientId: savedClient.id } });
      }

      return savedClient;
    });

    const full = await prisma.client.findUnique({
      where: { id: client.id },
      include: {
        contacts: true,
        investmentSites: { orderBy: { updatedAt: 'desc' } },
        projects: { include: projectInclude, orderBy: { updatedAt: 'desc' } },
      },
    });
    await writeAuditLog({
      actorId: access.user.id,
      clientId: full.id,
      entityType: 'Client',
      entityId: full.id,
      action: 'CREATE',
      after: full,
    });
    return jsonResponse({ ok: true, data: full }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać klienta', error);
  }
}

export async function PUT(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'crm.write');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const displayName = requireString(body, 'displayName');
    const clientType = validateClientType(body.clientType);

    const existing = await prisma.client.findUnique({
      where: { id },
      include: {
        contacts: { take: 1 },
        investmentSites: { orderBy: { updatedAt: 'desc' } },
        projects: { orderBy: { updatedAt: 'desc' } },
      },
    });
    if (!existing) return notFound('Nie znaleziono klienta');

    const contactBody = body.contact && typeof body.contact === 'object' && !Array.isArray(body.contact)
      ? body.contact as Record<string, any>
      : undefined;
    const projectBody = body.project && typeof body.project === 'object' && !Array.isArray(body.project)
      ? body.project as Record<string, any>
      : undefined;
    const contactId = typeof body.contactId === 'string' ? body.contactId : existing.contacts[0]?.id;
    const projectId = typeof body.projectId === 'string' ? body.projectId : existing.projects[0]?.id;
    const currentUser = await getCurrentStaffUser(req);
    const isAdmin = isAdminUser(currentUser);

    if (projectBody && projectId) {
      const projected = projectData(displayName, clientType, projectBody, contactBody);
      const existingProject = existing.projects.find((project) => project.id === projectId) || existing.projects[0];
      if (!isAdmin && lockedStationFieldsChanged(existingProject, projected || {})) {
        return forbidden('Tylko administrator może zmienić numer stacji RE albo token dashboardu po zapisaniu powiązania');
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const client = await tx.client.update({
        where: { id },
        data: {
          displayName,
          clientType: clientType as any,
          taxId: optionalString(body, 'taxId'),
          clientProblem: nullableNestedString(body, 'clientProblem'),
          expectedResult: nullableNestedString(body, 'expectedResult'),
          notes: optionalString(body, 'notes'),
        },
      });

      if (contactBody) {
        const data = contactData(displayName, contactBody)!;
        if (contactId) {
          await tx.contact.update({ where: { id: contactId }, data });
        } else {
          await tx.contact.create({ data: { ...data, clientId: id } });
        }
      }

      if (projectBody) {
        const existingProject = existing.projects.find((project) => project.id === projectId) || existing.projects[0];
        const preferredSiteId =
          typeof projectBody.investmentSiteId === 'string' && projectBody.investmentSiteId
            ? projectBody.investmentSiteId
            : existingProject?.investmentSiteId || existing.investmentSites[0]?.id;
        const siteInput = investmentSiteData(id, displayName, contactBody, projectBody);
        let investmentSiteId = preferredSiteId;
        if (siteInput) {
          if (investmentSiteId) {
            await tx.investmentSite.update({ where: { id: investmentSiteId }, data: siteInput });
          } else {
            const site = await tx.investmentSite.create({ data: siteInput });
            investmentSiteId = site.id;
          }
        }

        const data = projectData(displayName, clientType, projectBody, contactBody, investmentSiteId)!;
        const stageCode = projectStatusStageCode[data.status];
        const stage = data.stageId
          ? await tx.pipelineStage.findUnique({ where: { id: data.stageId } })
          : stageCode
            ? await tx.pipelineStage.findUnique({ where: { code: stageCode } })
            : null;
        if (data.stageId && (!stage || !isOperationalPipelineStageCode(stage.code))) {
          throw new Error('Nie znaleziono wybranego etapu projektu');
        }
        if (stage) {
          data.stageId = stage.id;
          data.status = stage.status;
          if (stage.requiresOwner && !data.ownerId && !existingProject?.ownerId) data.ownerId = access.user.id;
          data.closedAt = stage.isTerminal ? new Date() : null;
        }
        if (projectId) {
          await tx.project.update({ where: { id: projectId }, data });
        } else {
          await tx.project.create({ data: { ...data, clientId: id } });
        }
      }

      await tx.auditLog.create({
        data: {
          clientId: id,
          entityType: 'Client',
          entityId: id,
          action: 'update',
          before: jsonSnapshot(existing),
          after: {
            displayName,
            clientType,
            clientProblem: nullableNestedString(body, 'clientProblem'),
            expectedResult: nullableNestedString(body, 'expectedResult'),
            contact: contactBody,
            project: projectBody,
          },
        },
      });

      return client;
    });

    const full = await prisma.client.findUnique({
      where: { id: updated.id },
      include: {
        contacts: true,
        investmentSites: { orderBy: { updatedAt: 'desc' } },
        projects: { include: projectInclude, orderBy: { updatedAt: 'desc' } },
      },
    });

    await writeAuditLog({
      actorId: access.user.id,
      clientId: full.id,
      entityType: 'Client',
      entityId: full.id,
      action: 'UPDATE',
      before: existing,
      after: full,
    });
    return jsonResponse({ ok: true, data: full });
  } catch (error) {
    return serverError('Nie udało się zaktualizować klienta', error);
  }
}
