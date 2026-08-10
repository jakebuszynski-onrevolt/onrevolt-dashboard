import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, optionalString, serverError } from 'lib/onrevolt/api';
import { buildEnergyUsageProfile } from 'lib/onrevolt/energy-profile';
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

    const files = await prisma.energyMeasurementFile.findMany({
      where: {
        clientId,
        projectId,
        kind: 'ACTIVE_IMPORT',
        status: 'DOWNLOADED',
      },
      include: { document: true },
      orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
      take: 36,
    });

    return jsonResponse({ ok: true, data: await buildEnergyUsageProfile(files) });
  } catch (error) {
    return serverError('Nie udało się przygotować profilu zużycia', error);
  }
}
