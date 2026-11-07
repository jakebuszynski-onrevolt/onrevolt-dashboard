import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { badRequest, jsonResponse, notFound } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';
import { offerWorkspaceProjectWhere } from 'lib/onrevolt/offer-workspace-server';
import { readProjectReferenceProfileSelection, referenceProfileForKey } from 'lib/onrevolt/project-reference-profile';
import { syncProjectReferenceLoadProfile } from 'lib/onrevolt/re-reference-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
class Conflict extends Error {}

async function readData(projectId: string, db: Prisma.TransactionClient = prisma) {
  const [selection, audit] = await Promise.all([
    readProjectReferenceProfileSelection(projectId, db),
    db.energyAudit.findUnique({ where: { projectId }, select: { id: true, annualConsumptionKwh: true, updatedAt: true, profileSource: true } }),
  ]);
  return { selection, annualConsumptionKwh: audit?.annualConsumptionKwh == null ? null : Number(audit.annualConsumptionKwh),
    auditId: audit?.id ?? null, auditUpdatedAt: audit?.updatedAt.toISOString() ?? null, profileSource: audit?.profileSource ?? null };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  try {
    const { id: projectId } = await context.params;
    const project = await prisma.project.findFirst({ where: offerWorkspaceProjectWhere(projectId, access.user), select: { id: true } });
    if (!project) return notFound('Nie znaleziono projektu');
    const data = await prisma.$transaction(tx => readData(projectId, tx));
    return jsonResponse({ ok: true, data }, { headers });
  } catch (error) {
    console.error('[project-reference-profile:get]', error instanceof Error ? error.message : 'read error');
    return jsonResponse({ ok: false, error: 'Nie udało się odczytać zapisanego profilu projektu.' }, { status: 500, headers });
  }
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  let body: { profileKey: string | null; annualKwh: number; expectedRevision: number; expectedAuditUpdatedAt: string | null };
  try {
    body = await req.json();
    if (!body || !(body.profileKey === null || typeof body.profileKey === 'string' && body.profileKey.length > 0 && body.profileKey.length <= 191)) throw new Error('Wybierz profil lub profil domyślny.');
    if (typeof body.annualKwh !== 'number' || !Number.isFinite(body.annualKwh) || body.annualKwh <= 0 || body.annualKwh > 999999999.999
      || Math.abs(body.annualKwh * 1000 - Math.round(body.annualKwh * 1000)) > 0.0001) throw new Error('Podaj dodatnie zużycie roczne, maksymalnie z trzema miejscami po przecinku.');
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw new Error('Brak poprawnej wersji zapisanego profilu. Odśwież dane.');
    if (!(body.expectedAuditUpdatedAt === null || typeof body.expectedAuditUpdatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(body.expectedAuditUpdatedAt)
      && Number.isFinite(Date.parse(body.expectedAuditUpdatedAt)))) throw new Error('Brak poprawnej wersji danych energetycznych. Odśwież dane.');
  } catch (error) { return badRequest(error instanceof Error ? error.message : 'Nieprawidłowe dane profilu.'); }

  try {
    const { id: projectId } = await context.params;
    const project = await prisma.project.findFirst({ where: offerWorkspaceProjectWhere(projectId, access.user), select: { id: true, clientId: true } });
    if (!project) return notFound('Nie znaleziono projektu');
    let referenceProfile: Awaited<ReturnType<typeof referenceProfileForKey>> | null;
    try { referenceProfile = body.profileKey === null ? null : await referenceProfileForKey(body.profileKey); }
    catch (error) { return badRequest(error instanceof Error ? error.message : 'Nieprawidłowy profil.'); }
    const savedData = await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Project WHERE id = ${projectId} FOR UPDATE`;
      if (!locked.length || !await tx.project.findFirst({ where: offerWorkspaceProjectWhere(projectId, access.user), select: { id: true } })) throw new Conflict('Projekt jest już niedostępny. Odśwież dane.');
      const before = await readData(projectId, tx);
      if (before.selection.revision !== body.expectedRevision || before.auditUpdatedAt !== body.expectedAuditUpdatedAt) throw new Conflict('Profil lub dane energetyczne zmieniły się w innej karcie. Odśwież dane przed zapisem.');
      const audit = await tx.energyAudit.findUnique({ where: { projectId }, select: { profileSource: true } });
      if (audit && audit.profileSource !== 'ANNUAL_DECLARATION') throw new Conflict('Najpierw zapisz „Deklarację klienta” jako źródło zużycia w danych energetycznych.');
      await tx.energyAudit.upsert({ where: { projectId }, create: { projectId, annualConsumptionKwh: body.annualKwh, profileSource: 'ANNUAL_DECLARATION' }, update: { annualConsumptionKwh: body.annualKwh } });
      const revision = before.selection.revision + 1;
      const contentHash = referenceProfile?.contentHash ?? null;
      const profileName = referenceProfile?.profile.name ?? null;
      await tx.$executeRaw`
        INSERT INTO ProjectReferenceLoadProfile (projectId, profileKey, contentHash, profileName, revision, projectionVersion, selectedById, updatedAt)
        VALUES (${projectId}, ${body.profileKey}, ${contentHash}, ${profileName}, ${revision}, 1, ${access.user.id}, ${new Date()})
        ON DUPLICATE KEY UPDATE profileKey = VALUES(profileKey), contentHash = VALUES(contentHash), profileName = VALUES(profileName),
          revision = VALUES(revision), projectionVersion = 1, selectedById = VALUES(selectedById), updatedAt = VALUES(updatedAt)
      `;
      const data = await readData(projectId, tx);
      await tx.auditLog.create({ data: { actorId: access.user.id, clientId: project.clientId, entityType: 'ProjectReferenceLoadProfile', entityId: projectId,
        action: 'UPDATE', before: JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(data)) } });
      return data;
    }, { timeout: 30_000, maxWait: 15_000 });
    // Publish only a committed CRM selection. A second lock prevents a delayed
    // older request from overwriting a newer annual declaration in RE.
    let result: { data: typeof savedData; reSync: Awaited<ReturnType<typeof syncProjectReferenceLoadProfile>> };
    try {
      result = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM Project WHERE id = ${projectId} FOR UPDATE`;
        const current = await readData(projectId, tx);
        if (current.selection.revision !== savedData.selection.revision || current.annualConsumptionKwh !== savedData.annualConsumptionKwh
          || current.profileSource !== 'ANNUAL_DECLARATION') {
          return { data: current, reSync: { status: 'skipped' as const, station: null, retryAllowed: false,
            message: 'W międzyczasie zapisano nowsze dane. Wczytano aktualny zapis; starsza wersja nie została wysłana do RE.' } };
        }
        const reSync = await syncProjectReferenceLoadProfile({ projectId, clientId: project.clientId, actorId: access.user.id,
          annualKwh: body.annualKwh, referenceProfile, crmDb: tx });
        return { data: current, reSync };
      }, { timeout: 120_000, maxWait: 15_000 });
    } catch (error) {
      console.error('[project-reference-profile:sync]', error instanceof Error ? error.message : 'sync error');
      result = { data: savedData, reSync: { status: 'failed', station: null, retryAllowed: true,
        message: 'Zapis CRM jest potwierdzony, ale nie udało się potwierdzić synchronizacji RE. Ponów zapis profilu.' } };
    }
    const failed = result.reSync.status === 'failed';
    return jsonResponse({ ok: !failed, saved: true, ...result, ...(failed ? { error: result.reSync.message } : {}) }, { status: failed ? 502 : 200, headers });
  } catch (error) {
    if (error instanceof Conflict) return jsonResponse({ ok: false, error: error.message }, { status: 409, headers });
    console.error('[project-reference-profile:put]', error instanceof Error ? error.message : 'save error');
    return jsonResponse({ ok: false, error: 'Nie udało się zapisać profilu. Odśwież dane i sprawdź stan przed ponowieniem.' }, { status: 500, headers });
  }
}
