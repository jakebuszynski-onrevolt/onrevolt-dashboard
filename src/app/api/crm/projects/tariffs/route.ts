import { NextRequest } from 'next/server';
import { jsonResponse, readJsonObject } from 'lib/onrevolt/api';
import { authorizeStaffRequest, hasStaffPermission } from 'lib/onrevolt/staff-server';
import { callClientTariffs, clientTariffScope, readProjectGeneralTariffs, updateProjectTargetTariff, ClientTariffError } from 'lib/onrevolt/client-tariffs-server';

export const runtime = 'nodejs';

function failure(error: unknown) {
  if (error instanceof ClientTariffError) return jsonResponse({ ok: false, error: error.message }, { status: error.status });
  console.error('Client tariff operation failed', error);
  return jsonResponse({ ok: false, error: 'Nie udało się odczytać lub zapisać taryf.' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'crm.read');
  if (!access.ok) return access.response;
  try {
    const params = req.nextUrl.searchParams;
    const scope = await clientTariffScope(params.get('clientId') || '', params.get('projectId') || '');
    const action = params.get('action') === 'catalog' ? 'catalog' : 'get';
    const data = await callClientTariffs<Record<string, unknown>>({ action, scope,
      osdId: Number(params.get('osdId')), tariffId: Number(params.get('tariffId')), date: params.get('date') });
    return jsonResponse({ ok: true, data: action === 'get' ? { ...data, ...await readProjectGeneralTariffs(scope), canEdit: hasStaffPermission(access.user, 'energy.manage') } : data });
  } catch (error) { return failure(error); }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const scope = await clientTariffScope(String(body.clientId || ''), String(body.projectId || ''));
    if (body.action === 'save-target') {
      const data = await updateProjectTargetTariff(scope, Number(body.osdId), Number(body.tariffId));
      return jsonResponse({ ok: true, data });
    }
    if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw new ClientTariffError('Brak wersji edytowanego profilu.');
    if (!['save', 'preview', 'bind'].includes(body.action)) throw new ClientTariffError('Nieprawidłowa operacja.');
    if (body.action !== 'bind' && !['change', 'correct', 'confirm'].includes(body.operation)) throw new ClientTariffError('Nieprawidłowy rodzaj zmiany.');
    if (body.action !== 'bind' && body.operation === 'confirm' && typeof body.evidenceId !== 'string') throw new ClientTariffError('Wybierz zgłoszenie do potwierdzenia.');
    const data = await callClientTariffs({ action: body.action, scope, actorId: access.user.id, revision: body.revision,
      ...(body.action === 'bind' ? {} : { operation: body.operation, period: body.period, evidenceId: body.evidenceId }) });
    return jsonResponse({ ok: true, data });
  } catch (error) { return failure(error); }
}
