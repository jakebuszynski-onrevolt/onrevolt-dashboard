import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

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

export async function GET() {
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
  try {
    const body = await readJsonObject(req);
    const project = await prisma.project.create({
      data: {
        clientId: requireString(body, 'clientId'),
        title: requireString(body, 'title'),
        status: body.status || 'LEAD',
        stageId: optionalString(body, 'stageId'),
        ownerId: optionalString(body, 'ownerId'),
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
    return jsonResponse({ ok: true, data: project }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać projektu', error);
  }
}
