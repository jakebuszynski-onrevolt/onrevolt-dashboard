import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonResponse, serverError } from 'lib/onrevolt/api';
import { authorizeStaffRequest, isAdminUser } from 'lib/onrevolt/staff-server';
import { readReStationDeviceStatus, requestReStationOta, requestReMeterStationOta, ReStationOtaRequestError } from 'lib/onrevolt/re-stations';
import { isSolisStationType, listSolisFirmwareReleases } from 'lib/onrevolt/solis-ota';
import { writeAuditLog } from 'lib/onrevolt/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  if (!isAdminUser(access.user)) return forbidden('Tylko administrator może włączyć aktualizację firmware');

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || typeof body.station !== 'string' || typeof body.targetVersion !== 'string'
    || !body.targetVersion.trim() || body.targetVersion.length > 80) {
    return badRequest('Podaj numer stacji i wersję firmware z listy');
  }
  try {
    const station = body.station.trim();
    const targetVersion = body.targetVersion.trim();
    if (!/^(0|[1-9][0-9]{0,4})$/.test(station) || Number(station) > 65535) {
      return badRequest('Nieprawidłowy numer stacji');
    }
    const status = await readReStationDeviceStatus(station);
    if (!status) return badRequest('Nie znaleziono stacji RE');
    let result: Awaited<ReturnType<typeof requestReMeterStationOta>> | {
      before: typeof status; family: 'SOLIS'; targetVersion: string;
    };
    if (isSolisStationType(status.type)) {
      const releases = await listSolisFirmwareReleases();
      if (!releases.some((release) => release.version === targetVersion)) {
        return badRequest('Wybrana wersja nie jest dostępna w katalogu Solis');
      }
      const updated = await requestReStationOta(station, targetVersion);
      result = { before: updated.before, family: 'SOLIS', targetVersion };
    } else {
      result = await requestReMeterStationOta(station, targetVersion);
    }
    let auditLogged = true;
    try {
      await writeAuditLog({
        actorId: access.user.id,
        entityType: 'EnergyMeterStation',
        entityId: result.before.station,
        action: 'OTA_REQUEST',
        before: {
          firmwareVersion: result.before.firmwareVersion,
          firmwareTargetVersion: result.before.firmwareTargetVersion,
          otaEnabled: result.before.otaEnabled,
        },
        after: { family: result.family, firmwareTargetVersion: result.targetVersion, otaEnabled: true },
      });
    } catch (error) {
      auditLogged = false;
      console.error('Nie udało się zapisać historii zlecenia OTA stacji', error);
    }
    return jsonResponse({ ok: true, auditLogged, data: {
      station: result.before.station, firmwareTargetVersion: result.targetVersion, otaEnabled: true,
    } });
  } catch (error) {
    if (error instanceof ReStationOtaRequestError) return badRequest(error.message);
    return serverError('Nie udało się zlecić OTA stacji', error);
  }
}
