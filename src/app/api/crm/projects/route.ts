import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { isOperationalPipelineStageCode } from 'lib/onrevolt/pipeline-stages';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

function dashboardStationValue(value: unknown) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('Pole dashboardStation musi być tekstem');

  const station = value.trim();
  if (!station) return undefined;
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(station)) {
    throw new Error('Station może zawierać tylko litery, cyfry, podkreślenie i myślnik');
  }
  return station;
}

function stationIdentifierValue(value: unknown, label: string) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${label} musi być tekstem`);

  const station = value.trim();
  if (!station) return undefined;
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(station)) {
    throw new Error(`${label} może zawierać tylko litery, cyfry, podkreślenie i myślnik`);
  }
  return station;
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const projects = await prisma.project.findMany({
      include: { client: true, stage: true, owner: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return jsonResponse({ ok: true, data: projects });
  } catch (error) {
    return serverError('Nie udało się pobrać projektów', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'crm.write');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const stageId = optionalString(body, 'stageId');
    const stage = stageId
      ? await prisma.pipelineStage.findUnique({ where: { id: stageId } })
      : await prisma.pipelineStage.findUnique({ where: { code: 'CRM_LEAD' } });
    if (stageId && (!stage || !isOperationalPipelineStageCode(stage.code))) throw new Error('Nie znaleziono wybranego etapu projektu');
    const ownerId = optionalString(body, 'ownerId') || (stage?.requiresOwner ? access.user.id : undefined);
    const project = await prisma.project.create({
      data: {
        clientId: requireString(body, 'clientId'),
        title: requireString(body, 'title'),
        clientType: typeof body.clientType === 'string' ? body.clientType as any : 'UNKNOWN',
        status: stage?.status || body.status || 'LEAD',
        stageId: stage?.id,
        ownerId,
        nextActionTitle: optionalString(body, 'nextActionTitle'),
        nextActionAt: parseDate(body.nextActionAt),
        closedAt: stage?.isTerminal ? new Date() : undefined,
        source: optionalString(body, 'source'),
        dashboardStation: dashboardStationValue(body.dashboardStation),
        dashboardStationNumber: stationIdentifierValue(body.dashboardStationNumber, 'Numer stacji'),
        weatherStationNumber: stationIdentifierValue(body.weatherStationNumber, 'Numer stacji pogody'),
        locationAddress: optionalString(body, 'locationAddress'),
        notes: optionalString(body, 'notes'),
        expectedCloseAt: parseDate(body.expectedCloseAt),
        saleDate: parseDate(body.saleDate),
        installationDate: parseDate(body.installationDate),
      },
    });
    await writeAuditLog({
      actorId: access.user.id,
      clientId: project.clientId,
      entityType: 'Project',
      entityId: project.id,
      action: 'CREATE',
      after: project,
    });
    return jsonResponse({ ok: true, data: project }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać projektu', error);
  }
}
