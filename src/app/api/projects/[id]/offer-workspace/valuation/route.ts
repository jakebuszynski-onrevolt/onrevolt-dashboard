import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonResponse, notFound } from 'lib/onrevolt/api';
import { authorizeStaffRequest, hasStaffPermission } from 'lib/onrevolt/staff-server';
import { parseOfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import { loadProjectOfferWorkspace, OfferWorkspaceNotFoundError } from 'lib/onrevolt/offer-workspace-server';
import { calculateOfferWorkspaceValuationOnServer } from 'lib/onrevolt/offer-workspace-valuation-server';
import type { OfferMeasurementSeries } from 'lib/onrevolt/offer-measurements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'offers.manage');
  if (!access.ok) return access.response;
  if (!hasStaffPermission(access.user, 'energy.manage')) return forbidden('Wymagane uprawnienie energy.manage.');
  try {
    const reader = req.body?.getReader();
    if (!reader) return badRequest('Brak szkicu wyceny.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128 * 1024) {
        await reader.cancel();
        return jsonResponse({ ok: false, error: 'Żądanie przekracza limit 128 KiB.' }, { status: 413 });
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const draft = parseOfferWorkspaceDraft(body?.draft);
    const { id } = await context.params;
    let series: OfferMeasurementSeries | null = null;
    const workspace = await loadProjectOfferWorkspace(id, access.user, new Date(), value => { series = value; });
    if (body.sourceRevision !== workspace.revision) {
      return jsonResponse({ ok: false, error: 'Dane projektu zmieniły się. Odśwież kreator przed wyceną.' }, { status: 409 });
    }
    const data = await calculateOfferWorkspaceValuationOnServer(workspace, draft, series);
    const fresh = await loadProjectOfferWorkspace(id, access.user, new Date());
    if (fresh.revision !== workspace.revision) {
      return jsonResponse({ ok: false, error: 'Dane zmieniły się podczas wyceny. Odśwież kreator.' }, { status: 409 });
    }
    return jsonResponse({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof OfferWorkspaceNotFoundError) return notFound(error.message);
    if (error instanceof SyntaxError) return badRequest('Nieprawidłowy JSON.');
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : 'Nie udało się wycenić pomiarów.' }, { status: 422 });
  }
}
