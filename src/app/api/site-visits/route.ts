import { NextRequest } from 'next/server';
import { jsonResponse, notFound, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { requireSiteVisitProject, SITE_VISIT_STAGE_CODE } from 'lib/onrevolt/site-visit-access';
import {
  authorizeSiteVisitRequest,
  isSiteVisitOnlyUser,
  serializeStaffUser,
  staffAuthorizationResponse,
} from 'lib/onrevolt/staff-server';

const stageFilter = { is: { code: SITE_VISIT_STAGE_CODE, isActive: true } };
const projectSummarySelect = {
  id: true,
  title: true,
  clientId: true,
  client: {
    select: {
      id: true,
      displayName: true,
      clientType: true,
      contacts: { select: { name: true, phone: true, email: true } },
    },
  },
  investmentSite: { select: { fullAddress: true, addressLine: true } },
  locationAddress: true,
} as const;

const projectDetailSelect = {
  id: true,
  title: true,
  clientId: true,
  clientType: true,
  locationAddress: true,
  investmentSite: {
    select: {
      id: true,
      name: true,
      fullAddress: true,
      addressLine: true,
      postalCode: true,
      city: true,
      latitude: true,
      longitude: true,
    },
  },
  energyAudits: {
    select: {
      id: true,
      status: true,
      terrainType: true,
      buildingType: true,
      roofShape: true,
      connectionType: true,
      connectionPowerKw: true,
      phaseCount: true,
      mainFuseA: true,
      roofType: true,
      roofAreaM2: true,
      roofOrientation: true,
      roofTiltDeg: true,
      shadingNotes: true,
      existingPvKw: true,
      existingInverter: true,
      existingBatteryKwh: true,
      heatingSource: true,
      heatingSourceDetail: true,
    },
  },
  existingAssets: {
    select: {
      kind: true,
      name: true,
      producer: true,
      model: true,
      powerKw: true,
      capacityKwh: true,
      phaseCount: true,
    },
  },
} as const;

function listSearch(q: string) {
  return q ? {
    OR: [
      { title: { contains: q } },
      { locationAddress: { contains: q } },
      { client: { is: { displayName: { contains: q } } } },
      { client: { is: { contacts: { some: { name: { contains: q } } } } } },
      { client: { is: { contacts: { some: { phone: { contains: q } } } } } },
      { client: { is: { contacts: { some: { email: { contains: q } } } } } },
      { investmentSite: { is: { fullAddress: { contains: q } } } },
      { investmentSite: { is: { addressLine: { contains: q } } } },
    ],
  } : {};
}

export async function GET(req: NextRequest) {
  const access = await authorizeSiteVisitRequest(req, 'crm.read');
  if (!access.ok) return access.response;

  try {
    const clientId = req.nextUrl.searchParams.get('clientId')?.trim();
    if (clientId) {
      const projectWhere = { clientId, stage: stageFilter };
      const scopedProjectIds = await prisma.project.findMany({
        where: projectWhere,
        select: { id: true },
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
      });
      if (!scopedProjectIds.length) return notFound('Nie znaleziono klienta z projektem Wizji Lokalnej');
      await Promise.all(scopedProjectIds.map(({ id }) => requireSiteVisitProject(access.user, id)));

      const [client, projects, staffUsers, configurations] = await Promise.all([
        prisma.client.findUnique({
          where: { id: clientId },
          select: {
            id: true,
            displayName: true,
            clientType: true,
            contacts: { select: { name: true, phone: true, email: true } },
          },
        }),
        prisma.project.findMany({
          where: projectWhere,
          select: projectDetailSelect,
          orderBy: [{ title: 'asc' }, { id: 'asc' }],
        }),
        isSiteVisitOnlyUser(access.user)
          ? Promise.resolve([{ id: access.user.id, name: access.user.name }])
          : prisma.staffUser.findMany({
              where: { active: true },
              select: { id: true, name: true },
              orderBy: [{ name: 'asc' }, { id: 'asc' }],
            }),
        prisma.configuration.findMany({
          where: { project: { is: projectWhere } },
          select: { id: true, name: true, kind: true, projectId: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
      ]);
      if (!client) return notFound('Nie znaleziono klienta');
      if (!projects.length) return notFound('Nie znaleziono projektu Wizji Lokalnej');
      await Promise.all(projects.map(({ id }) => requireSiteVisitProject(access.user, id)));

      const clientProjects = projects.map(({ id, title }) => ({ id, title }));
      return jsonResponse({
        ok: true,
        data: {
          client: { ...client, projects: clientProjects },
          projects,
          staffUsers,
          configurations,
          currentUser: serializeStaffUser(access.user),
        },
      });
    }

    const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 120);
    const projects = await prisma.project.findMany({
      where: { stage: stageFilter, ...listSearch(q) },
      select: projectSummarySelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    await Promise.all(projects.map(({ id }) => requireSiteVisitProject(access.user, id)));
    return jsonResponse({
      ok: true,
      data: { projects, stage: { name: 'Wizja Lokalna' } },
    });
  } catch (error) {
    const authorizationResponse = staffAuthorizationResponse(error);
    if (authorizationResponse) return authorizationResponse;
    return serverError('Nie udało się pobrać danych wizji lokalnych', error);
  }
}
