import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

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
        dashboardStation: optionalString(body, 'dashboardStation'),
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

