import { NextRequest } from 'next/server';
import { jsonResponse, notFound, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

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
    email: optionalNestedString(contactBody, 'email'),
    phone: optionalNestedString(contactBody, 'phone'),
    addressLine: optionalNestedString(contactBody, 'addressLine'),
    postalCode: optionalNestedString(contactBody, 'postalCode'),
    city: optionalNestedString(contactBody, 'city'),
    investmentAddress: optionalNestedString(contactBody, 'investmentAddress'),
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
    clientType: validateClientType(projectBody.clientType, clientType) as any,
    source: optionalNestedString(projectBody, 'source') || 'manual',
    dashboardStation: optionalNestedString(projectBody, 'dashboardStation'),
    locationAddress: optionalNestedString(projectBody, 'locationAddress') || optionalNestedString(contactBody, 'investmentAddress'),
    investmentSiteId,
    notes: optionalNestedString(projectBody, 'notes'),
  };
}

export async function GET(req: NextRequest) {
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
              configurations: true,
              documents: true,
            },
            orderBy: { updatedAt: 'desc' },
          },
          documents: true,
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
        projects: { include: projectInclude, orderBy: { updatedAt: 'desc' } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return jsonResponse({ ok: true, data: clients });
  } catch (error) {
    return serverError('Nie udało się pobrać klientów', error);
  }
}

export async function POST(req: NextRequest) {
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
          notes: optionalString(body, 'notes'),
          contacts: contactBody ? { create: contactData(displayName, contactBody)! } : undefined,
        },
      });

      const siteInput = investmentSiteData(savedClient.id, displayName, contactBody, projectBody);
      const site = siteInput ? await tx.investmentSite.create({ data: siteInput }) : null;
      const projectInput = projectData(displayName, clientType, projectBody, contactBody, site?.id);
      if (projectInput) {
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
    return jsonResponse({ ok: true, data: full }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać klienta', error);
  }
}

export async function PUT(req: NextRequest) {
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
        projects: { orderBy: { updatedAt: 'desc' }, take: 1 },
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

    const updated = await prisma.$transaction(async (tx) => {
      const client = await tx.client.update({
        where: { id },
        data: {
          displayName,
          clientType: clientType as any,
          taxId: optionalString(body, 'taxId'),
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
        const preferredSiteId =
          typeof projectBody.investmentSiteId === 'string' && projectBody.investmentSiteId
            ? projectBody.investmentSiteId
            : existing.projects[0]?.investmentSiteId || existing.investmentSites[0]?.id;
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
          after: { displayName, clientType, contact: contactBody, project: projectBody },
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

    return jsonResponse({ ok: true, data: full });
  } catch (error) {
    return serverError('Nie udało się zaktualizować klienta', error);
  }
}
