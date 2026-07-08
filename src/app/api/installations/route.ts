import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

export async function GET() {
  try {
    const installations = await prisma.installation.findMany({
      include: { project: { include: { client: true } }, installedDevices: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return jsonResponse({ ok: true, data: installations });
  } catch (error) {
    return serverError('Nie udało się pobrać montaży', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const installation = await prisma.installation.create({
      data: {
        projectId: requireString(body, 'projectId'),
        status: body.status || 'PLANNED',
        plannedAt: parseDate(body.plannedAt),
        startedAt: parseDate(body.startedAt),
        completedAt: parseDate(body.completedAt),
        teamLeadId: optionalString(body, 'teamLeadId'),
        address: optionalString(body, 'address'),
        notes: optionalString(body, 'notes'),
      },
    });
    return jsonResponse({ ok: true, data: installation }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać montażu', error);
  }
}

