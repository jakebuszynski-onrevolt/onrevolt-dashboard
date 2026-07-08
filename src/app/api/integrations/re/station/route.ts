import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, notFound, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { createReStation, resolveReStation } from 'lib/onrevolt/re-stations';
import { prisma } from 'lib/onrevolt/prisma';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const clientId = requireString(body, 'clientId');
    const projectIdInput = optionalString(body, 'projectId');

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        contacts: { take: 1 },
        projects: { orderBy: { updatedAt: 'desc' }, take: 1 },
      },
    });
    if (!client) return notFound('Nie znaleziono klienta');

    const project = projectIdInput
      ? await prisma.project.findFirst({ where: { id: projectIdInput, clientId } })
      : client.projects[0];
    if (!project) return badRequest('Najpierw utwórz projekt klienta, potem stację RE');

    if (project.dashboardStation && project.dashboardStationNumber) {
      return badRequest('Projekt ma już powiązaną stację RE');
    }

    const stationRef = project.dashboardStation || project.dashboardStationNumber;
    const station = stationRef
      ? await resolveReStation(stationRef)
      : await createReStation({
        displayName: client.displayName,
        email: client.contacts[0]?.email,
      });

    if (!station) {
      return badRequest(`Nie znaleziono stacji RE dla ${stationRef}`);
    }

    const updatedProject = await prisma.project.update({
      where: { id: project.id },
      data: {
        dashboardStation: station.stationHash,
        dashboardStationNumber: station.station,
        weatherStationNumber: station.weatherStation,
      },
    });

    return jsonResponse({
      ok: true,
      data: {
        project: updatedProject,
        station: station.station,
        stationHash: station.stationHash,
        weatherStation: station.weatherStation,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('ONREVOLT_RE_DATABASE_URL')) {
      return badRequest(error.message);
    }
    return serverError('Nie udało się utworzyć stacji RE', error);
  }
}
