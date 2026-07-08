import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, readJsonObject, serverError } from 'lib/onrevolt/api';
import { importPipedriveToLocal } from 'lib/onrevolt/pipedrive-import';

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    if (body.dryRun === false) {
      return badRequest('Zapis do lokalnej bazy wymaga endpointu /api/integrations/pipedrive/sync i confirm=SYNC_TO_LOCAL');
    }

    const result = await importPipedriveToLocal({
      apply: false,
    });

    return jsonResponse({ ok: true, mode: 'dry-run', data: result });
  } catch (error) {
    return serverError('Import Pipedrive nie powiódł się', error);
  }
}
