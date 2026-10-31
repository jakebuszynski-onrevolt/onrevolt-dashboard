import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonResponse, notFound, serverError } from 'lib/onrevolt/api';
import {
  loadProjectOfferWorkspace,
  OfferWorkspaceConflictError,
  OfferWorkspaceNotFoundError,
  OfferWorkspacePermissionError,
} from 'lib/onrevolt/offer-workspace-server';
import { parseOfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import { renderOfferWorkspaceDocument } from 'lib/onrevolt/offer-workspace-document';
import { calculateOfferWorkspaceEnergy } from 'lib/onrevolt/offer-workspace-energy-server';
import { findCompletedOfferCalculationPersistent } from 'lib/onrevolt/offer-workspace-calculation-jobs';
import { loadOfferCalculationDependencyStamp } from 'lib/onrevolt/offer-workspace-calculation-server';
import { tariffToday } from 'lib/onrevolt/client-tariffs';
import type { OfferMeasurementSeries } from 'lib/onrevolt/offer-measurements';
import { generateSvgPagesPdf } from 'lib/onrevolt/offer-pdf';
import { authorizeStaffRequest, hasStaffPermission } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const maxRequestBytes = 128 * 1024;

class RequestTooLargeError extends Error {}

async function currentDependencyStamp(workspace: Parameters<typeof loadOfferCalculationDependencyStamp>[0], draft: Parameters<typeof loadOfferCalculationDependencyStamp>[1]) {
  try { return await loadOfferCalculationDependencyStamp(workspace, draft); }
  catch { throw new Error('Nie udało się zweryfikować aktualności danych obliczenia.'); }
}

async function readBoundedJsonObject(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) throw new SyntaxError('Oczekiwano obiektu JSON.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxRequestBytes) {
      await reader.cancel();
      throw new RequestTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SyntaxError('Oczekiwano obiektu JSON.');
  return body as Record<string, unknown>;
}

function workspaceError(error: unknown) {
  if (error instanceof RequestTooLargeError) return jsonResponse({ ok: false, error: 'Żądanie przekracza limit 128 KiB.' }, { status: 413 });
  if (error instanceof OfferWorkspaceNotFoundError) return notFound(error.message);
  if (error instanceof OfferWorkspaceConflictError) return jsonResponse({ ok: false, error: error.message }, { status: 409 });
  if (error instanceof OfferWorkspacePermissionError) return forbidden(error.message);
  if (error instanceof SyntaxError) return badRequest('Nieprawidłowy JSON.');
  return serverError('Nie udało się wyrenderować szkicu oferty', error);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'offers.manage');
  if (!access.ok) return access.response;
  if (!hasStaffPermission(access.user, 'energy.manage')) return forbidden('Do workspace oferty wymagane jest uprawnienie energy.manage.');
  try {
    const { id } = await context.params;
    const body = await readBoundedJsonObject(req);
    let draft;
    try {
      draft = parseOfferWorkspaceDraft(body.draft);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error));
    }
    let series: OfferMeasurementSeries | null = null;
    const workspace = await loadProjectOfferWorkspace(id, access.user, new Date(), value => { series = value; });
    if ((body.format === 'pdf-draft' || body.sourceRevision != null) && body.sourceRevision !== workspace.revision) {
      return jsonResponse({ ok: false, error: 'Dane projektu zmieniły się. Odśwież podgląd dokumentu.' }, { status: 409 });
    }
    let energy = null;
    let energyIssue = '';
    try { energy = await calculateOfferWorkspaceEnergy(workspace, draft, series); }
    catch (error) { energyIssue = error instanceof Error ? error.message : 'Brak obliczeń energii.'; }
    const pricesAsOf = tariffToday();
    const sourceDependencyStamp = await currentDependencyStamp(workspace, draft);
    const calculation = await findCompletedOfferCalculationPersistent({
      actorId: String(access.user.id), projectId: id, sourceRevision: workspace.revision, draft, pricesAsOf, sourceDependencyStamp,
    });
    const document = renderOfferWorkspaceDocument({ ...workspace, energy, calculation: calculation ?? undefined }, draft,
      { templateKey: 'REFORM_B2C/2026_10_V4' });
    if (energyIssue) document.limitations.push(energyIssue);
    if (body.format === 'pdf-draft') {
      if (energyIssue) return jsonResponse({ ok: false, error: `Nie można przygotować PDF: ${energyIssue}` }, { status: 422 });
      const fresh = await loadProjectOfferWorkspace(id, access.user, new Date());
      const freshDependencyStamp = await currentDependencyStamp(fresh, draft);
      if (fresh.revision !== workspace.revision || tariffToday() !== pricesAsOf || freshDependencyStamp !== sourceDependencyStamp) {
        return jsonResponse({ ok: false, error: 'Dane projektu lub data cennika zmieniły się podczas obliczeń. Odśwież podgląd dokumentu.' }, { status: 409 });
      }
      const bytes = await generateSvgPagesPdf(document.pages.map(page => page.svg));
      return new Response(new Uint8Array(bytes), { headers: {
        'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="oferta-robocza-${id}.pdf"`,
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      } });
    }
    return jsonResponse({ ok: true, document });
  } catch (error) {
    return workspaceError(error);
  }
}
