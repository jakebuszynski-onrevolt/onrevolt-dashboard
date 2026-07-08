import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, readJsonObject, serverError } from 'lib/onrevolt/api';
import { importPipedriveToLocal } from 'lib/onrevolt/pipedrive-import';

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    if (body.confirm !== 'SYNC_TO_LOCAL') {
      return badRequest('Synchronizacja z zapisem wymaga confirm=SYNC_TO_LOCAL');
    }

    const result = await importPipedriveToLocal({
      apply: true,
    });

    return jsonResponse({ ok: true, mode: 'sync-to-local', data: result });
  } catch (error) {
    return serverError('Synchronizacja Pipedrive nie powiodła się', error);
  }
}
