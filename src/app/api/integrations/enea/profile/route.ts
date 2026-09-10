import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, optionalString, serverError } from 'lib/onrevolt/api';
import { readProjectReConsumptionProfile } from 'lib/onrevolt/re-consumption-profile';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  try {
    const url = new URL(req.url);
    const clientId = optionalString({ clientId: url.searchParams.get('clientId') }, 'clientId');
    const projectId = optionalString({ projectId: url.searchParams.get('projectId') }, 'projectId');
    if (!clientId && !projectId) return badRequest('Podaj clientId albo projectId');

    const project = await prisma.project.findFirst({
      where: { ...(clientId ? { clientId } : {}), ...(projectId ? { id: projectId } : {}) },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, clientId: true },
    });
    if (!project) return badRequest('Nie znaleziono projektu klienta');
    return jsonResponse({ ok: true, data: await readProjectReConsumptionProfile(project.id, { clientId: project.clientId }) });
  } catch (error) {
    return serverError('Nie udało się przygotować profilu zużycia', error);
  }
}
