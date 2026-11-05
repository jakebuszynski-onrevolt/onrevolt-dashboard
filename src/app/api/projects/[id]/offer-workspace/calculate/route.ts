import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonResponse, notFound } from 'lib/onrevolt/api';
import { authorizeStaffRequest, hasStaffPermission } from 'lib/onrevolt/staff-server';
import { emptyOfferWorkspaceDraft, parseOfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import {
  loadProjectOfferWorkspace,
  OfferWorkspaceNotFoundError,
  OfferWorkspacePermissionError,
} from 'lib/onrevolt/offer-workspace-server';
import { calculateOfferWorkspaceOnServer } from 'lib/onrevolt/offer-workspace-calculation-server';
import {
  OfferWorkspaceCalculationCapacityError,
  OfferWorkspaceCalculationConflictError,
  offerWorkspaceCalculationJobs,
} from 'lib/onrevolt/offer-workspace-calculation-jobs';
import { loadOfferCalculationDependencyStamp } from 'lib/onrevolt/offer-workspace-calculation-server';
import { tariffToday } from 'lib/onrevolt/client-tariffs';
import type { OfferMeasurementSeries } from 'lib/onrevolt/offer-measurements';
import type { OfferWorkspaceCalculationJobView } from 'lib/onrevolt/offer-workspace-calculation-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 128 * 1024;

class RequestTooLargeError extends Error {}

async function currentDependencyStamp(workspace: Parameters<typeof loadOfferCalculationDependencyStamp>[0], draft: Parameters<typeof loadOfferCalculationDependencyStamp>[1]) {
  try { return await loadOfferCalculationDependencyStamp(workspace, draft); }
  catch { throw new Error('Nie udało się zweryfikować aktualności danych obliczenia.'); }
}

function noStore(body: unknown, init: ResponseInit = {}) {
  return jsonResponse(body, {
    ...init,
    headers: { ...init.headers, 'Cache-Control': 'private, no-store' },
  });
}

function publicJob(job: OfferWorkspaceCalculationJobView, stale = false) {
  const { id, status, completed, total, data, error } = job;
  const blockedReasons = stale && data?.status === 'blocked' && Array.isArray(data.reasons)
    ? [...new Set(data.reasons.filter((reason): reason is string => typeof reason === 'string')
      .map(reason => reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500))
      .filter(Boolean))].slice(0, 5)
    : [];
  return {
    id,
    status,
    completed,
    total,
    ...(!stale && data ? { data } : {}),
    ...(blockedReasons.length ? { blockedReasons } : {}),
    ...(error ? { error } : {}),
    ...(stale ? { stale: true } : {}),
  };
}

async function readRequestBody(req: NextRequest): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Brak treści żądania.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new RequestTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function authorize(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'offers.manage');
  if (!access.ok) return { response: access.response } as const;
  if (!hasStaffPermission(access.user, 'energy.manage')) {
    return { response: forbidden('Do obliczeń workspace wymagane jest uprawnienie energy.manage.') } as const;
  }
  return { user: access.user } as const;
}

function workspaceError(error: unknown) {
  if (error instanceof OfferWorkspaceNotFoundError) return notFound('Nie znaleziono projektu.');
  if (error instanceof OfferWorkspacePermissionError) return forbidden(error.message);
  return noStore({ ok: false, error: 'Nie udało się obsłużyć obliczenia workspace.' }, { status: 500 });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(req);
  if ('response' in access) return access.response;

  let body: Record<string, unknown>;
  try {
    const parsed = await readRequestBody(req);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return badRequest('Treść żądania musi być obiektem JSON.');
    body = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return noStore({ ok: false, error: 'Żądanie przekracza limit 128 KiB.' }, { status: 413 });
    }
    if (error instanceof SyntaxError) return badRequest('Nieprawidłowy JSON.');
    return badRequest(error instanceof Error ? error.message : 'Nieprawidłowa treść żądania.');
  }

  if (typeof body.sourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.sourceRevision)) {
    return badRequest('Brak prawidłowej rewizji źródeł workspace.');
  }
  if (body.mode !== 'selected' && body.mode !== 'recommend') {
    return badRequest('Tryb obliczeń musi być jawnie selected albo recommend.');
  }

  let draft;
  try {
    draft = parseOfferWorkspaceDraft(body.draft);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : 'Nieprawidłowy szkic oferty.');
  }

  try {
    const { id: projectId } = await context.params;
    let series: OfferMeasurementSeries | null = null;
    const workspace = await loadProjectOfferWorkspace(projectId, access.user, new Date(), (value) => { series = value; });
    if (body.sourceRevision !== workspace.revision) {
      return noStore({ ok: false, error: 'Dane projektu zmieniły się. Odśwież kreator przed obliczeniami.' }, { status: 409 });
    }

    const queued = offerWorkspaceCalculationJobs.enqueue({
      actorId: String(access.user.id),
      projectId,
      sourceRevision: workspace.revision,
      workspace,
      draft,
      series,
      mode: body.mode,
    }, calculateOfferWorkspaceOnServer);
    return noStore({ ok: true, job: publicJob(queued.job, queued.stale) }, { status: 202 });
  } catch (error) {
    if (error instanceof OfferWorkspaceCalculationConflictError) {
      return noStore({ ok: false, error: error.message }, { status: 409 });
    }
    if (error instanceof OfferWorkspaceCalculationCapacityError) {
      return noStore({ ok: false, error: error.message }, { status: 429, headers: { 'Retry-After': '2' } });
    }
    return workspaceError(error);
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(req);
  if ('response' in access) return access.response;

  const jobId = new URL(req.url).searchParams.get('jobId');
  if (!jobId || jobId.length > 100) return badRequest('Brak prawidłowego jobId.');

  try {
    const { id: projectId } = await context.params;
    const workspace = await loadProjectOfferWorkspace(projectId, access.user, new Date());
    const pricesAsOf = tariffToday();
    const job = await offerWorkspaceCalculationJobs.getForActorProjectPersistent(
      jobId, String(access.user.id), projectId,
      async (candidate, dependencyContext) => {
        if (candidate.sourceRevision !== workspace.revision || candidate.data?.pricesAsOf !== pricesAsOf) return null;
        const draft = { ...emptyOfferWorkspaceDraft(), ...dependencyContext };
        return {
          sourceRevision: workspace.revision,
          dependencyContext,
          pricesAsOf,
          sourceDependencyStamp: await currentDependencyStamp(workspace, draft),
        };
      },
    );
    if (!job) return notFound('Nie znaleziono zadania obliczeniowego.');
    const stale = job.sourceRevision !== workspace.revision
      || (job.status === 'completed' && (job.data?.pricesAsOf !== pricesAsOf || job.freshnessUnverified === true));
    return noStore({ ok: true, job: publicJob(job, stale) });
  } catch (error) {
    return workspaceError(error);
  }
}
