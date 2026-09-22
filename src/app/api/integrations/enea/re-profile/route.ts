import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, notFound, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { listReConsumptionMeasurements, ReStationRequiredError, requireProjectReStation, syncEnergyMeasurementToRe } from 'lib/onrevolt/re-consumption-sync';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  let input: { clientId: string; projectId?: string; measurementId?: string; replaceExisting: boolean };
  try {
    const body = await readJsonObject(req);
    if (body.replaceExisting !== undefined && typeof body.replaceExisting !== 'boolean') {
      return badRequest('replaceExisting musi być wartością logiczną');
    }
    input = {
      clientId: requireString(body, 'clientId'),
      projectId: optionalString(body, 'projectId'),
      measurementId: optionalString(body, 'measurementId'),
      replaceExisting: body.replaceExisting === true,
    };
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : String(error));
  }

  try {
    await requireProjectReStation(input.clientId, input.projectId);
    const { project, measurements } = await listReConsumptionMeasurements(input.clientId, input.projectId);
    const selected = input.measurementId ? measurements.filter((file) => file.id === input.measurementId) : measurements;
    if (input.measurementId && !selected.length) {
      return notFound('Nie znaleziono pobranego XLSX tego klienta i projektu w ostatnich 12 zamkniętych miesiącach');
    }
    const results = [];
    for (const measurement of selected) {
      const result = await syncEnergyMeasurementToRe(measurement.id, {
        clientId: input.clientId, projectId: project.id, actorId: access.user.id, replaceExisting: input.replaceExisting,
      });
      results.push({ measurementId: measurement.id, kind: measurement.kind, periodYear: measurement.periodYear, periodMonth: measurement.periodMonth, ...result });
    }
    const counts = {
      synced: results.filter((result) => result.status === 'synced').length,
      existing: results.filter((result) => result.status === 'existing').length,
      failed: results.filter((result) => result.status === 'failed').length,
    };
    const message = results.length
      ? `RE: zapisano ${counts.synced}, pominięto istniejące ${counts.existing}, błędy ${counts.failed}.`
      : 'Brak pobranych plików poboru/oddania do synchronizacji w ostatnich 12 zamkniętych miesiącach.';
    return jsonResponse({
      ok: counts.failed === 0,
      ...(counts.failed ? { error: message } : {}),
      data: { clientId: input.clientId, projectId: project.id, results, counts, message },
    }, { status: counts.failed ? 502 : 200 });
  } catch (error) {
    if (error instanceof ReStationRequiredError) return badRequest(error.message);
    return serverError('Nie udało się zsynchronizować zapisanych XLSX z RE; pliki CRM pozostają zachowane', error);
  }
}
