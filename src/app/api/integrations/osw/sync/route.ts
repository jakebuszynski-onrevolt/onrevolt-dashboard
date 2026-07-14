import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, readJsonObject, serverError } from 'lib/onrevolt/api';
import { getOswSyncStatus, syncOswProducts } from 'lib/onrevolt/osw-sync';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'synchronization.manage');
  if (!access.ok) return access.response;
  try {
    const data = await getOswSyncStatus();
    return jsonResponse({ ok: true, data });
  } catch (error) {
    return serverError('Nie udało się pobrać statusu synchronizacji OSW', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'synchronization.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const apply = body.dryRun === false;

    if (apply && body.confirm !== 'OSW_SYNC_TO_LOCAL') {
      return badRequest('Zapis OSW do bazy wymaga potwierdzenia OSW_SYNC_TO_LOCAL');
    }

    const data = await syncOswProducts({ apply });
    return jsonResponse({
      ok: true,
      mode: apply ? 'sync-to-local' : 'dry-run',
      data,
    });
  } catch (error) {
    if (error instanceof Error && (
      error.message.startsWith('Brak OSW_') ||
      error.message.startsWith('OSW ') ||
      error.message.includes('OSW_PRODUCTS_URL')
    )) {
      return badRequest(error.message);
    }
    return serverError('Nie udało się wykonać synchronizacji OSW', error);
  }
}
