import { NextRequest } from 'next/server';
import { forbidden, jsonResponse, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { listReStationDeviceStatuses } from 'lib/onrevolt/re-stations';
import { authorizeStaffRequest, isAdminUser } from 'lib/onrevolt/staff-server';
import { deriveSolisRapidCommandState, isSolisStationType, listSolisFirmwareReleases } from 'lib/onrevolt/solis-ota';
import { classifyAdminEmsGroup, deduplicateAdminEmsStations } from 'lib/onrevolt/admin-ems';
import { listMeterFirmwareReleases } from 'lib/onrevolt/meter-firmware';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  if (!isAdminUser(access.user)) return forbidden('Tylko administrator może wyświetlić panel EMS');

  try {
    const [listedStations, projects] = await Promise.all([
      listReStationDeviceStatuses(),
      prisma.project.findMany({
        where: {
          OR: [
            { dashboardStationNumber: { not: null } },
            { dashboardStation: { not: null } },
          ],
        },
        orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
        select: {
          id: true,
          clientId: true,
          title: true,
          dashboardStation: true,
          dashboardStationNumber: true,
          client: { select: { displayName: true } },
        },
      }),
    ]);
    const stations = deduplicateAdminEmsStations(listedStations);
    const stationByNumber = new Map(stations.map((station) => [station.station, station]));
    const stationByHash = new Map(
      stations.filter((station) => station.stationHash).map((station) => [station.stationHash as string, station]),
    );
    const projectByStation = new Map<string, (typeof projects)[number]>();
    for (const project of projects) {
      const number = project.dashboardStationNumber?.trim() || '';
      const hash = project.dashboardStation?.trim() || '';
      const station = (number ? stationByNumber.get(number) : null)
        || (hash ? stationByHash.get(hash) : null);
      if (station && !projectByStation.has(station.station)) projectByStation.set(station.station, project);
    }

    const rows = stations.map((status) => {
      const project = projectByStation.get(status.station) || null;
      const parentProject = status.parentStation
        ? projectByStation.get(status.parentStation) || null
        : null;
      return {
        projectId: project?.id || null,
        clientId: project?.clientId || null,
        projectName: project?.title || null,
        clientName: project?.client.displayName || null,
        station: status.station,
        parentStation: status.parentStation,
        parentProjectName: parentProject?.title || null,
        parentClientName: parentProject?.client.displayName || null,
        type: status?.type || null,
        firmwareVersion: status?.firmwareVersion || null,
        firmwareTargetVersion: status?.firmwareTargetVersion || null,
        otaEnabled: status?.otaEnabled ?? null,
        otaLastStatus: status?.otaLastStatus || null,
        otaLastError: status?.otaLastError || null,
        otaLastAt: status?.otaLastAt || null,
        controlEnabled: status?.controlEnabled ?? null,
        shadowOnly: status?.shadowOnly ?? null,
        inverterRatedPowerW: status?.inverterRatedPowerW ?? null,
        exportBlocked: status?.exportBlocked ?? null,
        exportBlockApplied: status?.exportBlockApplied ?? null,
        smartPortFanEnabled: status?.smartPortFanEnabled ?? null,
        smartPortFanOnTemperatureCx10: status?.smartPortFanOnTemperatureCx10 ?? null,
        smartPortFanOffTemperatureCx10: status?.smartPortFanOffTemperatureCx10 ?? null,
        rapidCommand: status?.rapidCommand || null,
        rapidCommandSequence: status?.rapidCommandSequence ?? 0,
        rapidCommandExpiresAt: status?.rapidCommandExpiresAt || null,
        rapidCommandAcknowledgedSequence: status?.rapidCommandAcknowledgedSequence ?? 0,
        rapidCommandAcknowledgedAt: status?.rapidCommandAcknowledgedAt || null,
        rapidCommandResult: status?.rapidCommandResult || null,
        rapidCommandOk: status?.rapidCommandOk ?? null,
        rapidCommandState: status
          ? deriveSolisRapidCommandState({
            sequence: status.rapidCommandSequence,
            command: status.rapidCommand,
            expiresAt: status.rapidCommandExpiresAt,
            acknowledgedSequence: status.rapidCommandAcknowledgedSequence,
            acknowledgedAt: status.rapidCommandAcknowledgedAt,
            ok: status.rapidCommandOk,
          })
          : null,
      };
    });

    let latestFirmwareVersion: string | null = null;
    let firmwareCatalogError: string | null = null;
    if (rows.some((row) => isSolisStationType(row.type))) {
      try {
        latestFirmwareVersion = (await listSolisFirmwareReleases())[0]?.version || null;
      } catch (error) {
        firmwareCatalogError = error instanceof Error ? error.message : String(error);
        console.error('Nie udało się pobrać katalogu firmware Solis dla panelu EMS', error);
      }
    }

    const groups = new Set(rows.map((row) => classifyAdminEmsGroup(row.type)));
    const [energyMeterCatalog, pgeCatalog] = await Promise.all([
      groups.has('ESP32') ? listMeterFirmwareReleases('ENERGYMETER')
        .then((releases) => ({ version: releases[0].version, error: null }))
        .catch((error: unknown) => {
          console.error('Nie udało się pobrać katalogu firmware EnergyMeter', error);
          return { version: null, error: 'Katalog firmware EnergyMeter jest niedostępny lub niekompletny.' };
        }) : Promise.resolve({ version: null, error: null }),
      groups.has('PGE') ? listMeterFirmwareReleases('PGE')
        .then((releases) => ({ version: releases[0].version, error: null }))
        .catch((error: unknown) => {
          console.error('Nie udało się pobrać katalogu firmware PGE', error);
          return { version: null, error: 'Katalog firmware PGE jest niedostępny lub niekompletny.' };
        }) : Promise.resolve({ version: null, error: null }),
    ]);

    return jsonResponse({
      ok: true,
      data: {
        stations: rows,
        latestFirmwareVersion,
        firmwareCatalogError,
        latestEnergyMeterFirmwareVersion: energyMeterCatalog.version,
        energyMeterFirmwareCatalogError: energyMeterCatalog.error,
        latestPgeFirmwareVersion: pgeCatalog.version,
        pgeFirmwareCatalogError: pgeCatalog.error,
      },
    });
  } catch (error) {
    return serverError('Nie udało się pobrać listy stacji EMS', error);
  }
}
