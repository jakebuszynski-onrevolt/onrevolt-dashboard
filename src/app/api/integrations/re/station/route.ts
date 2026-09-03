import { NextRequest } from 'next/server';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { badRequest, forbidden, jsonResponse, notFound, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import {
  createReStation,
  readReStationDeviceStatus,
  requestReStationRapidCommand,
  requestReStationOta,
  resolveReStation,
  updateReStationControlSettings,
  updateReStationInverterPowerLimit,
  ReStationControlRequestError,
  ReStationOtaRequestError,
  type ReStationDeviceStatus,
} from 'lib/onrevolt/re-stations';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest, isAdminUser } from 'lib/onrevolt/staff-server';
import {
  deriveSolisOtaState,
  deriveSolisRapidCommandState,
  isSolisStationType,
  listSolisFirmwareReleases,
  supportsSolisRapidCommands,
  type SolisFirmwareRelease,
} from 'lib/onrevolt/solis-ota';
import {
  calculateSolisMaxExportPowerW,
  isValidSolisPowerLimitPercent,
} from 'lib/onrevolt/solis-inverter';

export const runtime = 'nodejs';

async function findProjectStation(clientId: string, projectId?: string) {
  const project = await prisma.project.findFirst({
    where: {
      clientId,
      ...(projectId ? { id: projectId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      clientId: true,
      dashboardStation: true,
      dashboardStationNumber: true,
    },
  });
  if (!project) return null;
  const stationRef = project.dashboardStationNumber?.trim() || project.dashboardStation?.trim() || '';
  return { project, stationRef };
}

function serializeStationStatus(
  status: ReStationDeviceStatus,
  admin: boolean,
  releases: SolisFirmwareRelease[],
) {
  const solis = isSolisStationType(status.type);
  const firmware = admin && solis && status.firmwareVersion
    ? {
      currentVersion: status.firmwareVersion,
      seenAt: status.firmwareSeenAt,
      targetVersion: status.firmwareTargetVersion,
      otaEnabled: status.otaEnabled,
      otaForce: status.otaForce,
      lastStatus: status.otaLastStatus,
      lastError: status.otaLastError,
      lastTargetVersion: status.otaLastTargetVersion,
      lastAt: status.otaLastAt,
      controlEnabled: status.controlEnabled,
      shadowOnly: status.shadowOnly,
      inverterRatedPowerW: status.inverterRatedPowerW,
      inverterPowerLimitPercent: status.inverterPowerLimitPercent,
      maxExportPowerW: calculateSolisMaxExportPowerW(
        status.inverterRatedPowerW,
        status.inverterPowerLimitPercent,
      ),
      uid: status.uid,
      rapidControl: {
        supported: supportsSolisRapidCommands(status.firmwareVersion),
        command: {
          sequence: status.rapidCommandSequence,
          name: status.rapidCommand,
          requestedAt: status.rapidCommandRequestedAt,
          expiresAt: status.rapidCommandExpiresAt,
          acknowledgedSequence: status.rapidCommandAcknowledgedSequence,
          acknowledgedAt: status.rapidCommandAcknowledgedAt,
          result: status.rapidCommandResult,
          ok: status.rapidCommandOk,
          state: deriveSolisRapidCommandState({
            sequence: status.rapidCommandSequence,
            command: status.rapidCommand,
            expiresAt: status.rapidCommandExpiresAt,
            acknowledgedSequence: status.rapidCommandAcknowledgedSequence,
            acknowledgedAt: status.rapidCommandAcknowledgedAt,
            ok: status.rapidCommandOk,
          }),
        },
        exportBlocked: status.exportBlocked,
        pvBlocked: status.pvBlocked,
        exportBlockApplied: status.exportBlockApplied,
        pvBlockApplied: status.pvBlockApplied,
      },
      state: deriveSolisOtaState({
        firmwareVersion: status.firmwareVersion,
        targetVersion: status.firmwareTargetVersion,
        otaEnabled: status.otaEnabled,
        lastStatus: status.otaLastStatus,
      }),
      releases,
    }
    : null;

  return {
    station: status.station,
    type: status.type,
    isSolis: solis,
    firmware,
  };
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const clientId = req.nextUrl.searchParams.get('clientId')?.trim() || '';
    const projectId = req.nextUrl.searchParams.get('projectId')?.trim() || undefined;
    if (!clientId) return badRequest('Brak identyfikatora klienta');

    const association = await findProjectStation(clientId, projectId);
    if (!association) return notFound('Nie znaleziono projektu klienta');
    if (!association.stationRef) return badRequest('Projekt nie ma powiązanej stacji RE');

    const status = await readReStationDeviceStatus(association.stationRef);
    if (!status) return notFound('Nie znaleziono powiązanej stacji w EnergyMeter_users');

    const admin = isAdminUser(access.user);
    const releases = admin && isSolisStationType(status.type) && status.firmwareVersion
      ? await listSolisFirmwareReleases()
      : [];
    return jsonResponse({ ok: true, data: serializeStationStatus(status, admin, releases) });
  } catch (error) {
    return serverError('Nie udało się pobrać statusu stacji RE', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
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

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  if (!isAdminUser(access.user)) return forbidden('Tylko administrator może sterować stacją Solis');

  try {
    const body = await readJsonObject(req);
    const clientId = requireString(body, 'clientId');
    const projectId = optionalString(body, 'projectId');
    const action = optionalString(body, 'action') || 'REQUEST_OTA';

    const association = await findProjectStation(clientId, projectId);
    if (!association) return notFound('Nie znaleziono projektu klienta');
    if (!association.stationRef) return badRequest('Projekt nie ma powiązanej stacji RE');

    let result: { before: ReStationDeviceStatus; after: ReStationDeviceStatus };
    let auditAction: string;
    let auditAfter: Record<string, unknown>;
    let releases: SolisFirmwareRelease[] = [];

    if (action === 'REQUEST_OTA') {
      const targetVersion = requireString(body, 'targetVersion');
      releases = await listSolisFirmwareReleases();
      if (!releases.some((release) => release.version === targetVersion)) {
        return badRequest('Wybrana wersja firmware nie jest dostępna na serwerze OTA');
      }
      result = await requestReStationOta(association.stationRef, targetVersion);
      auditAction = 'OTA_REQUEST';
      auditAfter = {
        station: result.after.station,
        firmwareTargetVersion: result.after.firmwareTargetVersion,
        otaEnabled: result.after.otaEnabled,
      };
    } else if (action === 'UPDATE_CONTROL_SETTINGS') {
      if (typeof body.controlEnabled !== 'boolean' || typeof body.shadowOnly !== 'boolean') {
        return badRequest('Ustawienia kontroli falownika muszą mieć wartość logiczną');
      }
      result = await updateReStationControlSettings(association.stationRef, {
        controlEnabled: body.controlEnabled,
        shadowOnly: body.shadowOnly,
      });
      auditAction = 'SOLIS_CONTROL_SETTINGS_UPDATE';
      auditAfter = {
        station: result.after.station,
        controlEnabled: result.after.controlEnabled,
        shadowOnly: result.after.shadowOnly,
      };
    } else if (action === 'UPDATE_INVERTER_POWER_LIMIT') {
      if (!isValidSolisPowerLimitPercent(body.inverterPowerLimitPercent)) {
        return badRequest('Limit mocy falownika musi być całkowitą wartością od 0% do 100%');
      }
      result = await updateReStationInverterPowerLimit(
        association.stationRef,
        body.inverterPowerLimitPercent,
      );
      auditAction = 'SOLIS_INVERTER_POWER_LIMIT_UPDATE';
      auditAfter = {
        station: result.after.station,
        inverterRatedPowerW: result.after.inverterRatedPowerW,
        inverterPowerLimitPercent: result.after.inverterPowerLimitPercent,
        maxExportPowerW: calculateSolisMaxExportPowerW(
          result.after.inverterRatedPowerW,
          result.after.inverterPowerLimitPercent,
        ),
      };
    } else if (action === 'REQUEST_RAPID_COMMAND') {
      const command = requireString(body, 'command');
      const commandResult = await requestReStationRapidCommand(association.stationRef, command);
      result = commandResult;
      auditAction = 'SOLIS_COMMAND_REQUEST';
      auditAfter = {
        station: result.after.station,
        command: commandResult.command,
        sequence: commandResult.sequence,
        expiresAt: result.after.rapidCommandExpiresAt,
      };
    } else {
      return badRequest('Nieznana operacja sterowania stacją Solis');
    }

    if (!releases.length && isSolisStationType(result.after.type) && result.after.firmwareVersion) {
      try {
        releases = await listSolisFirmwareReleases();
      } catch (catalogError) {
        console.error('Nie udało się odświeżyć katalogu firmware po operacji na stacji', catalogError);
      }
    }
    let auditLogged = true;
    try {
      await writeAuditLog({
        actorId: access.user.id,
        clientId,
        entityType: 'EnergyMeterStation',
        entityId: result.after.station,
        action: auditAction,
        before: result.before,
        after: auditAfter,
      });
    } catch (auditError) {
      auditLogged = false;
      console.error('Nie udało się zapisać historii zlecenia OTA', auditError);
    }

    return jsonResponse({
      ok: true,
      data: serializeStationStatus(result.after, true, releases),
      auditLogged,
    });
  } catch (error) {
    if (error instanceof ReStationOtaRequestError || error instanceof ReStationControlRequestError) {
      return badRequest(error.message);
    }
    return serverError('Nie udało się wykonać operacji na stacji Solis', error);
  }
}
