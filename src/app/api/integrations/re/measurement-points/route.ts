import { NextRequest } from 'next/server';
import { writeAuditLog } from 'lib/onrevolt/audit';
import {
  badRequest,
  jsonResponse,
  notFound,
  optionalString,
  readJsonObject,
  requireString,
  serverError,
} from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import {
  attachReMeasurementPoint,
  detachReMeasurementPoint,
  readReMeasurementPoints,
  ReMeasurementPointError,
  reorderReMeasurementPoints,
  resolveReStation,
  searchReMeasurementPointCandidates,
  updateReMeasurementPoint,
} from 'lib/onrevolt/re-stations';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';

async function findProjectStation(clientId: string, projectId?: string) {
  const project = await prisma.project.findFirst({
    where: { clientId, ...(projectId ? { id: projectId } : {}) },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      clientId: true,
      title: true,
      dashboardStation: true,
      dashboardStationNumber: true,
    },
  });
  if (!project) return null;
  const stationRef = project.dashboardStationNumber?.trim() || project.dashboardStation?.trim() || '';
  return { project, stationRef };
}

async function readAssociation(clientId: string, projectId?: string) {
  const association = await findProjectStation(clientId, projectId);
  if (!association) throw new ReMeasurementPointError('Nie znaleziono projektu klienta');
  if (!association.stationRef) throw new ReMeasurementPointError('Projekt nie ma powiązanej stacji RE');
  return association;
}

async function writeMeasurementPointAudit(input: {
  actorId: string;
  clientId: string;
  station: string;
  action: string;
  before?: unknown;
  after?: unknown;
}) {
  await writeAuditLog({
    actorId: input.actorId,
    clientId: input.clientId,
    entityType: 'EnergyMeterStation',
    entityId: input.station,
    action: input.action,
    before: input.before,
    after: input.after,
  });
}

function handleError(error: unknown) {
  if (error instanceof ReMeasurementPointError) return badRequest(error.message);
  return serverError('Nie udało się zapisać konfiguracji punktów pomiarowych', error);
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('query')?.trim() || '';
  const access = await authorizeStaffRequest(req, query ? 'energy.manage' : undefined);
  if (!access.ok) return access.response;
  try {
    const clientId = req.nextUrl.searchParams.get('clientId')?.trim() || '';
    const projectId = req.nextUrl.searchParams.get('projectId')?.trim() || undefined;
    if (!clientId) return badRequest('Brak identyfikatora klienta');
    const association = await findProjectStation(clientId, projectId);
    if (!association) return notFound('Nie znaleziono projektu klienta');
    if (!association.stationRef) return badRequest('Projekt nie ma powiązanej stacji RE');

    const points = await readReMeasurementPoints(association.stationRef);
    if (!query) return jsonResponse({ ok: true, data: { points } });

    const linkedProjects = await prisma.project.findMany({
      where: {
        id: { not: association.project.id },
        OR: [
          { dashboardStationNumber: { not: null } },
          { dashboardStation: { not: null } },
        ],
      },
      select: { dashboardStationNumber: true, dashboardStation: true },
    });
    const excludedStations = linkedProjects
      .map((project) => project.dashboardStationNumber?.trim())
      .filter((station): station is string => Boolean(station));
    const excludedHashes = new Set(
      linkedProjects
        .map((project) => project.dashboardStation?.trim())
        .filter((station): station is string => Boolean(station)),
    );
    const candidates = (await searchReMeasurementPointCandidates(association.stationRef, query, excludedStations))
      .filter((candidate) => !excludedHashes.has(candidate.stationHash || ''));
    return jsonResponse({ ok: true, data: { points, candidates } });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const clientId = requireString(body, 'clientId');
    const projectId = optionalString(body, 'projectId');
    const station = requireString(body, 'station');
    const association = await readAssociation(clientId, projectId);
    const candidate = await resolveReStation(station);
    if (!candidate) return notFound('Nie znaleziono wskazanej stacji RE');

    const conflictingProject = await prisma.project.findFirst({
      where: {
        id: { not: association.project.id },
        OR: [
          { dashboardStationNumber: candidate.station },
          { dashboardStation: candidate.stationHash },
        ],
      },
      select: { id: true, title: true },
    });
    if (conflictingProject) {
      return badRequest(`Stacja jest punktem głównym innego projektu: ${conflictingProject.title || conflictingProject.id}`);
    }

    const before = await readReMeasurementPoints(association.stationRef);
    const result = await attachReMeasurementPoint(association.stationRef, candidate.station);
    const after = await readReMeasurementPoints(association.stationRef);
    await writeMeasurementPointAudit({
      actorId: access.user.id,
      clientId,
      station: result.mainStation,
      action: 'MEASUREMENT_POINT_ATTACH',
      before,
      after,
    });
    return jsonResponse({ ok: true, data: { points: after } }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const clientId = requireString(body, 'clientId');
    const projectId = optionalString(body, 'projectId');
    const association = await readAssociation(clientId, projectId);
    const before = await readReMeasurementPoints(association.stationRef);

    let action = 'MEASUREMENT_POINT_UPDATE';
    if (Array.isArray(body.orderedStations)) {
      const orderedStations = body.orderedStations.map((station) => String(station ?? '').trim());
      await reorderReMeasurementPoints(association.stationRef, orderedStations);
      action = 'MEASUREMENT_POINT_REORDER';
    } else {
      const station = requireString(body, 'station');
      const name = requireString(body, 'name');
      const location = optionalString(body, 'location');
      await updateReMeasurementPoint(association.stationRef, station, { name, location });
    }

    const after = await readReMeasurementPoints(association.stationRef);
    const mainStation = after.find((point) => point.main)?.station || association.stationRef;
    await writeMeasurementPointAudit({
      actorId: access.user.id,
      clientId,
      station: mainStation,
      action,
      before,
      after,
    });
    return jsonResponse({ ok: true, data: { points: after } });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const clientId = requireString(body, 'clientId');
    const projectId = optionalString(body, 'projectId');
    const station = requireString(body, 'station');
    const association = await readAssociation(clientId, projectId);
    const before = await readReMeasurementPoints(association.stationRef);
    const result = await detachReMeasurementPoint(association.stationRef, station);
    const after = await readReMeasurementPoints(association.stationRef);
    await writeMeasurementPointAudit({
      actorId: access.user.id,
      clientId,
      station: result.mainStation,
      action: 'MEASUREMENT_POINT_DETACH',
      before,
      after,
    });
    return jsonResponse({ ok: true, data: { points: after } });
  } catch (error) {
    return handleError(error);
  }
}
