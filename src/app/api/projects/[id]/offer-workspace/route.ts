import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonResponse, notFound, readJsonObject, serverError } from 'lib/onrevolt/api';
import {
  loadProjectOfferWorkspace,
  OfferWorkspaceConflictError,
  OfferWorkspaceNotFoundError,
  OfferWorkspacePermissionError,
  saveProjectOfferWorkspaceDraft,
} from 'lib/onrevolt/offer-workspace-server';
import { authorizeStaffRequest, hasStaffPermission } from 'lib/onrevolt/staff-server';
import { parseOfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function workspaceError(error: unknown) {
  if (error instanceof OfferWorkspaceNotFoundError) return notFound(error.message);
  if (error instanceof OfferWorkspaceConflictError) return jsonResponse({ ok: false, error: error.message }, { status: 409 });
  if (error instanceof OfferWorkspacePermissionError) return forbidden(error.message);
  return serverError('Nie udało się obsłużyć workspace oferty', error);
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'offers.manage');
  if (!access.ok) return access.response;
  if (!hasStaffPermission(access.user, 'energy.manage')) return forbidden('Do workspace oferty wymagane jest uprawnienie energy.manage.');
  try {
    const { id } = await context.params;
    const now = new Date();
    const data = await loadProjectOfferWorkspace(id, access.user, now);
    return jsonResponse({ ok: true, data });
  } catch (error) {
    return workspaceError(error);
  }
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'offers.manage');
  if (!access.ok) return access.response;
  if (!hasStaffPermission(access.user, 'energy.manage')) return forbidden('Do workspace oferty wymagane jest uprawnienie energy.manage.');
  try {
    const { id } = await context.params;
    const body = await readJsonObject(req);
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
      return badRequest('expectedRevision musi być nieujemną liczbą całkowitą.');
    }
    if (typeof body.sourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.sourceRevision)) {
      return badRequest('Brak prawidłowej rewizji źródeł workspace.');
    }
    let acceptedPricingRevision: string | undefined;
    if (body.acceptedPricingRevision !== undefined) {
      if (typeof body.acceptedPricingRevision !== 'string' || !/^pricing-v1-[a-f0-9]{16}$/.test(body.acceptedPricingRevision)) {
        return badRequest('acceptedPricingRevision ma nieprawidłowy format.');
      }
      acceptedPricingRevision = body.acceptedPricingRevision;
    }
    let input;
    try {
      input = parseOfferWorkspaceDraft(body.input);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error));
    }
    const draft = await saveProjectOfferWorkspaceDraft({
      projectId: id,
      user: access.user,
      expectedRevision: body.expectedRevision,
      sourceRevision: body.sourceRevision,
      input,
      acceptedPricingRevision,
      now: new Date(),
    });
    return jsonResponse({ ok: true, data: draft });
  } catch (error) {
    return workspaceError(error);
  }
}
