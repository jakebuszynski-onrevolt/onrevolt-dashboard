import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonResponse, notFound, serverError } from 'lib/onrevolt/api';
import {
  loadProjectOfferWorkspace,
  createServerOfferWorkspacePricingSnapshot,
  OfferWorkspaceConflictError,
  OfferWorkspaceNotFoundError,
  OfferWorkspacePermissionError,
} from 'lib/onrevolt/offer-workspace-server';
import { offerWorkspaceDraftWithBatteryPresence, parseOfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import { renderOfferWorkspaceDocument } from 'lib/onrevolt/offer-workspace-document';
import { attachOfferWorkspaceDocumentMap } from 'lib/onrevolt/offer-workspace-document-assets';
import { loadOfferDocumentTariffLabels } from 'lib/onrevolt/offer-workspace-document-context';
import { calculateOfferWorkspaceEnergy, getOfferWorkspaceEnergySourceRevision } from 'lib/onrevolt/offer-workspace-energy-server';
import { overlayOfferWorkspaceMeasurements } from 'lib/onrevolt/offer-workspace-energy';
import { getOfferPvSourceRevision } from 'lib/onrevolt/offer-pv-source-revision';
import { findSavedOfferCalculation } from 'lib/onrevolt/offer-workspace-calculation-jobs';
import { loadOfferCalculationDependencyStamp } from 'lib/onrevolt/offer-workspace-calculation-server';
import { tariffToday } from 'lib/onrevolt/client-tariffs';
import type { OfferMeasurementSeries } from 'lib/onrevolt/offer-measurements';
import { generateSvgPagesPdf } from 'lib/onrevolt/offer-pdf';
import { authorizeStaffRequest, hasStaffPermission } from 'lib/onrevolt/staff-server';
import { getOfferWorkspaceArtifact, putOfferWorkspaceArtifact } from 'lib/onrevolt/offer-workspace-artifacts';
import { offerCalculationDependencyHash } from 'lib/onrevolt/offer-workspace-calculation-dependencies';
import { offerDocumentRenderingRevision, offerDocumentPdfRevision } from 'lib/onrevolt/offer-workspace-document-cache';
import type { OfferWorkspaceDocumentResult } from 'lib/onrevolt/offer-workspace-document';
import { configurationEditsContainPricing, validateOfferWorkspaceConfigurationEdits } from 'lib/onrevolt/offer-workspace-configuration-edits';

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
    if (body.knownDocumentKey !== undefined
      && (typeof body.knownDocumentKey !== 'string' || !/^[a-f0-9]{64}$/.test(body.knownDocumentKey))) {
      return badRequest('Nieprawidłowy klucz zapisanego dokumentu.');
    }
    let draft;
    try {
      draft = parseOfferWorkspaceDraft(body.draft);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error));
    }
    if ((configurationEditsContainPricing(draft.configurationEdits) || draft.commercialPricing)
      && !hasStaffPermission(access.user, 'pricing.read')) {
      return forbidden('Do podglądu cen konfiguracji wymagane jest uprawnienie pricing.read.');
    }
    let series: OfferMeasurementSeries | null = null;
    const workspace = await loadProjectOfferWorkspace(id, access.user, new Date(), value => { series = value; });
    if ((body.format === 'pdf-draft' || body.sourceRevision != null) && body.sourceRevision !== workspace.revision) {
      return jsonResponse({ ok: false, error: 'Dane projektu zmieniły się. Odśwież podgląd dokumentu.' }, { status: 409 });
    }
    draft = offerWorkspaceDraftWithBatteryPresence(draft, workspace.input.existingBatteryPresent ?? null);
    try {
      validateOfferWorkspaceConfigurationEdits(workspace.templates, draft);
      if (draft.commercialPricing) createServerOfferWorkspacePricingSnapshot(draft, workspace.templates, workspace.clientType);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Nieprawidłowe zmiany pozycji konfiguracji.');
    }
    let energy = null;
    let energyIssue = '';
    try { energy = await calculateOfferWorkspaceEnergy(workspace, draft, series); }
    catch (error) { energyIssue = error instanceof Error ? error.message : 'Brak obliczeń energii.'; }
    const usesExistingPv = Boolean(energy?.intervals?.length && (draft.existingPv.powerKw ?? 0) > 0);
    const energyPvRevision = usesExistingPv && energy ? getOfferWorkspaceEnergySourceRevision(energy) : null;
    const verifyEnergySource = () => {
      if (!usesExistingPv) return;
      const location = workspace.input.location;
      if (!energyPvRevision || location?.latitude == null || location.longitude == null
        || getOfferPvSourceRevision(location) !== energyPvRevision) {
        throw new OfferWorkspaceConflictError('Źródło PV zmieniło się podczas przygotowania dokumentu. Odśwież podgląd.');
      }
    };
    const pricesAsOf = tariffToday();
    const sourceDependencyStamp = await currentDependencyStamp(workspace, draft);
    verifyEnergySource();
    const calculation = await findSavedOfferCalculation({
      actorId: String(access.user.id), projectId: id, draft,
    });
    let tariffLabels;
    let tariffLabelIssue = '';
    try { tariffLabels = await loadOfferDocumentTariffLabels(workspace, draft); }
    catch { tariffLabelIssue = 'Nie udało się odczytać nazw taryf. Ponów podgląd dokumentu.'; }
    const { draft: _savedDraft, ...documentWorkspace } = workspace;
    const { step: _step, ...documentDraft } = draft;
    const artifact = { projectId: id, kind: 'document-svg', key: {
      renderer: await offerDocumentRenderingRevision(), actorId: String(access.user.id),
      pricing: hasStaffPermission(access.user, 'pricing.read'),
      input: offerCalculationDependencyHash({ workspace: documentWorkspace, draft: documentDraft, energy, calculation, tariffLabels }),
    } };
    // Cache only the deterministic pages. The map is loaded separately on every
    // request, so temporary provider failures cannot become a stored document.
    let document = !energyIssue && !tariffLabelIssue ? await getOfferWorkspaceArtifact<OfferWorkspaceDocumentResult>(artifact) : null;
    const cached = document !== null;
    if (!document) {
      document = renderOfferWorkspaceDocument({ ...workspace, measurements: overlayOfferWorkspaceMeasurements(workspace.measurements, energy), energy, calculation: calculation ?? undefined }, draft,
        { templateKey: 'REFORM_B2C/2026_10_V4', tariffLabels });
      verifyEnergySource();
      if (!energyIssue && !tariffLabelIssue) await putOfferWorkspaceArtifact(artifact, document);
    }
    await attachOfferWorkspaceDocumentMap(document, workspace);
    if (tariffLabelIssue) document.limitations.push(tariffLabelIssue);
    if (energyIssue) document.limitations.push(energyIssue);
    verifyEnergySource();
    if (body.format === 'pdf-draft') {
      if (energyIssue) return jsonResponse({ ok: false, error: `Nie można przygotować PDF: ${energyIssue}` }, { status: 422 });
      const fresh = await loadProjectOfferWorkspace(id, access.user, new Date());
      const freshDependencyStamp = await currentDependencyStamp(fresh, draft);
      if (fresh.revision !== workspace.revision || tariffToday() !== pricesAsOf || freshDependencyStamp !== sourceDependencyStamp) {
        return jsonResponse({ ok: false, error: 'Dane projektu lub data cennika zmieniły się podczas obliczeń. Odśwież podgląd dokumentu.' }, { status: 409 });
      }
      const pdfArtifact = { projectId: id, kind: 'document-pdf', key: {
        generator: await offerDocumentPdfRevision(), pages: offerCalculationDependencyHash(document.pages),
      } };
      const storedPdf = await getOfferWorkspaceArtifact<{ base64: string }>(pdfArtifact);
      const bytes = storedPdf ? Buffer.from(storedPdf.base64, 'base64') : await generateSvgPagesPdf(document.pages.map(page => page.svg));
      verifyEnergySource();
      if (!storedPdf) await putOfferWorkspaceArtifact(pdfArtifact, { base64: bytes.toString('base64') });
      const clientName = workspace.clientName.normalize('NFC').trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '-');
      const filename = `oferta-robocza-${clientName}_${pricesAsOf.split('-').reverse().join('_')}.pdf`;
      const asciiFilename = filename.replace(/[^\x20-\x7e]/g, '_');
      const encodedFilename = encodeURIComponent(filename).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      return new Response(new Uint8Array(bytes), { headers: {
        'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      } });
    }
    const documentKey = offerCalculationDependencyHash(document);
    return jsonResponse(body.knownDocumentKey === documentKey
      ? { ok: true, notModified: true, documentKey }
      : { ok: true, document, cached, documentKey }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return workspaceError(error);
  }
}
