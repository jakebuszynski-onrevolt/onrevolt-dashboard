import { NextRequest } from 'next/server';
import { EnergyAuditStatus, EnergyProfileSource, Prisma } from '@prisma/client';
import { badRequest, jsonResponse, notFound, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';
import { shouldSyncReConsumptionDeclaration, syncProjectReConsumptionDeclaration } from 'lib/onrevolt/re-consumption-declaration';
import { clientTariffScope, readProjectGeneralTariffs, syncClientTariffContext } from 'lib/onrevolt/client-tariffs-server';
import { optionalNullableEnergyNumber } from 'lib/onrevolt/energy-audit-values';
import { OFFER_WORKSPACE_SCHEMA_VERSION } from 'lib/onrevolt/offer-workspace';
import {
  loadProjectOfferWorkspace,
  OfferWorkspaceNotFoundError,
  offerWorkspaceProjectWhere,
} from 'lib/onrevolt/offer-workspace-server';
import {
  mergeProjectPvSettingsIntoDraft,
  parseNullableProjectPvPower,
  parseProjectPvSettingsPatch,
  projectPvSettingsPowerFromDraft,
  seedProjectPvWorkspaceDraft,
} from 'lib/onrevolt/project-pv-settings';

class PvDraftRevisionConflict extends Error {}

function auditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function optionalNumber(value: unknown) {
  if (value == null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Nieprawidłowa wartość liczbowa: ${value}`);
  return number;
}

function optionalBoolean(body: Record<string, unknown>, key: string) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined;
  const value = body[key];
  if (value == null) return null;
  if (typeof value !== 'boolean') throw new Error(`Nieprawidłowa wartość logiczna: ${key}`);
  return value;
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  try {
    const projectId = req.nextUrl.searchParams.get('projectId') || undefined;
    const [projects, audits] = await Promise.all([
      prisma.project.findMany({
        where: projectId ? { id: projectId } : undefined,
        include: { client: { include: { contacts: { take: 1 } } }, owner: true, stage: true },
        orderBy: { updatedAt: 'desc' },
        take: 1000,
      }),
      prisma.energyAudit.findMany({
        where: projectId ? { projectId } : undefined,
        include: { scenarios: { orderBy: { createdAt: 'desc' } } },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    return jsonResponse({ ok: true, data: { projects, audits } });
  } catch (error) {
    return serverError('Nie udało się pobrać audytów', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const id = optionalString(body, 'id');
    const projectId = requireString(body, 'projectId');
    if (body.retryReDeclaration !== undefined && typeof body.retryReDeclaration !== 'boolean') return badRequest('Potwierdzenie ponowienia musi być wartością logiczną');
    if (body.profileSource !== undefined && !Object.values(EnergyProfileSource).includes(body.profileSource)) return badRequest('Nieprawidłowe źródło profilu');
    if (body.status !== undefined && !Object.values(EnergyAuditStatus).includes(body.status)) return badRequest('Nieprawidłowy status audytu');
    if (body.annualConsumptionKwh != null && !['number', 'string'].includes(typeof body.annualConsumptionKwh)) return badRequest('Roczne zużycie musi być liczbą');
    let annual: number | undefined;
    try { annual = optionalNumber(typeof body.annualConsumptionKwh === 'string' ? body.annualConsumptionKwh.trim() : body.annualConsumptionKwh); }
    catch (error) { return badRequest(error instanceof Error ? error.message : String(error)); }
    const annualWasProvided = Object.prototype.hasOwnProperty.call(body, 'annualConsumptionKwh') && annual !== undefined;
    if (body.retryReDeclaration === true && !annualWasProvided) return badRequest('Ponowienie wymaga jawnego podania aktualnej rocznej deklaracji');
    let pvSettings: ReturnType<typeof parseProjectPvSettingsPatch> | null = null;
    if (Object.prototype.hasOwnProperty.call(body, 'pvSettings')) {
      try { pvSettings = parseProjectPvSettingsPatch(body.pvSettings); }
      catch (error) { return badRequest(error instanceof Error ? error.message : String(error)); }
    }
    let equipmentValues: { existingPvKw?: number | null; existingBatteryKwh?: number | null; phaseCount?: number | null };
    try {
      equipmentValues = {
        existingPvKw: optionalNullableEnergyNumber(body.existingPvKw),
        existingBatteryKwh: optionalNullableEnergyNumber(body.existingBatteryKwh),
        phaseCount: optionalNullableEnergyNumber(body.phaseCount),
      };
      if (equipmentValues.phaseCount != null && ![1, 3].includes(equipmentValues.phaseCount)) {
        return badRequest('Liczba faz musi wynosić 1 lub 3');
      }
    } catch (error) { return badRequest(error instanceof Error ? error.message : String(error)); }
    if (pvSettings) {
      try {
        if (equipmentValues.existingPvKw !== undefined) {
          parseNullableProjectPvPower(equipmentValues.existingPvKw);
        }
      } catch (error) {
        return badRequest(error instanceof Error ? error.message : String(error));
      }
    }
    let initialPvSourceRevision: string | null = null;
    let initialPvTargetTariff: { osdId: number; tariffId: number } | null = null;
    if (pvSettings?.expectedRevision === 0) {
      const workspace = await loadProjectOfferWorkspace(projectId, access.user, new Date());
      initialPvSourceRevision = workspace.revision;
      const tariffScope = await clientTariffScope(workspace.clientId, projectId);
      const tariffs = await readProjectGeneralTariffs(tariffScope);
      initialPvTargetTariff = tariffs.targetTariff?.osdId != null && tariffs.targetTariff?.tariffId != null
        ? { osdId: tariffs.targetTariff.osdId, tariffId: tariffs.targetTariff.tariffId }
        : null;
    }
    const data = {
      projectId,
      status: body.status as EnergyAuditStatus | undefined,
      profileSource: body.profileSource as EnergyProfileSource | undefined,
      annualConsumptionKwh: annual,
      hasOperatorData: optionalBoolean(body, 'hasOperatorData'),
      hasEnergyInvoices: optionalBoolean(body, 'hasEnergyInvoices'),
      terrainType: optionalString(body, 'terrainType'),
      buildingType: optionalString(body, 'buildingType'),
      roofShape: optionalString(body, 'roofShape'),
      settlementSystem: optionalString(body, 'settlementSystem'),
      energySupplier: optionalString(body, 'energySupplier'),
      connectionType: optionalString(body, 'connectionType'),
      heatingSource: optionalString(body, 'heatingSource'),
      heatingSourceDetail: optionalString(body, 'heatingSourceDetail'),
      connectionPowerKw: optionalNumber(body.connectionPowerKw),
      phaseCount: equipmentValues.phaseCount,
      mainFuseA: optionalNumber(body.mainFuseA),
      roofType: typeof body.roofType === 'string' && body.roofType ? body.roofType as any : undefined,
      roofAreaM2: optionalNumber(body.roofAreaM2),
      roofOrientation: optionalString(body, 'roofOrientation'),
      roofTiltDeg: optionalNumber(body.roofTiltDeg),
      shadingNotes: optionalString(body, 'shadingNotes'),
      existingPvKw: equipmentValues.existingPvKw,
      existingInverter: optionalString(body, 'existingInverter'),
      existingBatteryKwh: equipmentValues.existingBatteryKwh,
      notes: optionalString(body, 'notes'),
    };
    const saved = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Project WHERE id = ${projectId} FOR UPDATE`;
      if (!rows.length) return { error: 'Nie znaleziono projektu' } as const;
      const project = pvSettings
        ? await tx.project.findFirst({
          where: offerWorkspaceProjectWhere(projectId, access.user),
          select: { id: true, clientId: true },
        })
        : await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { clientId: true } });
      if (!project) return { error: 'Nie znaleziono projektu' } as const;
      const before = id
        ? await tx.energyAudit.findUnique({ where: { id } })
        : await tx.energyAudit.findUnique({ where: { projectId } });
      if (id && (!before || before.projectId !== projectId)) return { error: 'Nie znaleziono audytu tego projektu' } as const;
      if (body.retryReDeclaration === true && (!before || before.annualConsumptionKwh == null || Number(before.annualConsumptionKwh) !== annual)) {
        return { error: 'Deklaracja zmieniła się od poprzedniej próby. Odśwież audyt przed ponowieniem.', conflict: true } as const;
      }
      let pvRevision: number | undefined;
      if (pvSettings) {
        const currentWorkspace = await tx.offerWorkspace.findUnique({ where: { projectId } });
        if ((currentWorkspace?.revision ?? 0) !== pvSettings.expectedRevision) {
          throw new PvDraftRevisionConflict('Parametry PV zostały zmienione w innej karcie. Odśwież dane PV.');
        }
        const auditSeed = before
          ? { ...before, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) }
          : data;
        const powerKw = equipmentValues.existingPvKw !== undefined
          ? parseNullableProjectPvPower(equipmentValues.existingPvKw)
          : currentWorkspace
            ? projectPvSettingsPowerFromDraft(currentWorkspace.input)
            : before?.existingPvKw == null ? null : parseNullableProjectPvPower(Number(before.existingPvKw));
        const baseInput = currentWorkspace?.input ?? seedProjectPvWorkspaceDraft(auditSeed, initialPvTargetTariff);
        const input = mergeProjectPvSettingsIntoDraft(baseInput, powerKw, pvSettings);

        if (currentWorkspace) {
          const changed = await tx.offerWorkspace.updateMany({
            where: { projectId, revision: pvSettings.expectedRevision },
            data: {
              revision: { increment: 1 },
              schemaVersion: OFFER_WORKSPACE_SCHEMA_VERSION,
              input: input as Prisma.InputJsonValue,
              updatedById: access.user.id,
            },
          });
          if (changed.count !== 1) {
            throw new PvDraftRevisionConflict('Parametry PV zostały zmienione w innej karcie. Odśwież dane PV.');
          }
          const updatedWorkspace = await tx.offerWorkspace.findUniqueOrThrow({ where: { projectId } });
          pvRevision = updatedWorkspace.revision;
          await tx.auditLog.create({ data: {
            actorId: access.user.id,
            clientId: project.clientId,
            entityType: 'OfferWorkspaceDraft',
            entityId: projectId,
            action: 'UPDATE',
            before: auditJson({
              revision: currentWorkspace.revision,
              sourceRevision: currentWorkspace.sourceRevision,
              input: currentWorkspace.input,
            }),
            after: auditJson({
              revision: updatedWorkspace.revision,
              sourceRevision: updatedWorkspace.sourceRevision,
              input: updatedWorkspace.input,
            }),
          } });
        } else {
          if (!initialPvSourceRevision) throw new Error('Brak rewizji źródeł do utworzenia szkicu PV.');
          let createdWorkspace;
          try {
            createdWorkspace = await tx.offerWorkspace.create({ data: {
              projectId,
              revision: 1,
              schemaVersion: OFFER_WORKSPACE_SCHEMA_VERSION,
              sourceRevision: initialPvSourceRevision,
              input: input as Prisma.InputJsonValue,
              createdById: access.user.id,
              updatedById: access.user.id,
            } });
          } catch (error) {
            if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
              throw new PvDraftRevisionConflict('Szkic został już utworzony w innej karcie. Odśwież dane PV.');
            }
            throw error;
          }
          pvRevision = createdWorkspace.revision;
          await tx.auditLog.create({ data: {
            actorId: access.user.id,
            clientId: project.clientId,
            entityType: 'OfferWorkspaceDraft',
            entityId: projectId,
            action: 'CREATE',
            before: Prisma.JsonNull,
            after: auditJson({
              revision: createdWorkspace.revision,
              sourceRevision: createdWorkspace.sourceRevision,
              input: createdWorkspace.input,
            }),
          } });
        }
      }
      const audit = before
        ? await tx.energyAudit.update({ where: { id: before.id, projectId }, data, include: { scenarios: { orderBy: { createdAt: 'desc' } } } })
        : await tx.energyAudit.create({ data, include: { scenarios: true } });
      if (pvSettings) {
        await tx.auditLog.create({ data: {
          actorId: access.user.id,
          clientId: project.clientId,
          entityType: 'EnergyAudit',
          entityId: audit.id,
          action: before ? 'UPDATE' : 'CREATE',
          before: before ? auditJson(before) : Prisma.JsonNull,
          after: auditJson(audit),
        } });
      }
      return { before, audit, clientId: project.clientId, pvRevision };
    }, { maxWait: 120_000, timeout: 30_000 });
    if ('error' in saved) return 'conflict' in saved
      ? jsonResponse({ ok: false, error: saved.error }, { status: 409 }) : notFound(saved.error);
    const { before, audit, clientId, pvRevision } = saved;
    const shouldSyncTariffContext = Object.prototype.hasOwnProperty.call(body, 'connectionPowerKw')
      && (before?.connectionPowerKw?.toString() !== audit.connectionPowerKw?.toString()
        || before?.annualConsumptionKwh?.toString() !== audit.annualConsumptionKwh?.toString());
    const shouldSync = shouldSyncReConsumptionDeclaration({ annualWasProvided,
      previousAnnual: before?.annualConsumptionKwh == null ? null : Number(before.annualConsumptionKwh),
      annual: audit.annualConsumptionKwh == null ? null : Number(audit.annualConsumptionKwh),
      profileSource: audit.profileSource, retry: body.retryReDeclaration === true });
    if (!pvSettings) {
      try {
        await writeAuditLog({ actorId: access.user.id, clientId, entityType: 'EnergyAudit', entityId: audit.id,
          action: before ? 'UPDATE' : 'CREATE', before, after: audit });
      } catch {
        return jsonResponse({ ok: false, auditSaved: true, data: audit,
          error: 'Audyt zapisano w CRM, ale zapis historii nie powiódł się. Nie przekazano deklaracji do RE.',
          reDeclarationSync: { status: 'failed', station: null, retryAllowed: shouldSync, message: 'Nie zapisano historii audytu; RE nie zostało zmienione.' },
        }, { status: 500 });
      }
    }
    const reTariffContextSync = shouldSyncTariffContext
      ? await syncClientTariffContext(clientId, projectId, access.user.id).catch(error => ({
        status: 'failed' as const,
        station: null,
        retryAllowed: true,
        message: error instanceof Error ? error.message : 'Nie udało się przekazać danych do obliczeń taryfowych RE.',
      }))
      : { status: 'skipped' as const, station: null, retryAllowed: false,
        message: 'Dane do obliczeń taryfowych nie zmieniły się.' };
    const reDeclarationSync = shouldSync
      ? await syncProjectReConsumptionDeclaration({ clientId, projectId, auditId: audit.id,
        annualConsumptionKwh: Number(audit.annualConsumptionKwh), actorId: access.user.id })
      : { status: 'skipped' as const, station: null, retryAllowed: false,
        message: 'Nie przekazano deklaracji do RE: brak jawnej zmiany rocznego zużycia albo profil godzinowy OSD.' };
    const syncFailed = reDeclarationSync.status === 'failed' || reTariffContextSync.status === 'failed';
    const syncError = reTariffContextSync.status === 'failed' ? reTariffContextSync.message : reDeclarationSync.message;
    return jsonResponse({ ok: !syncFailed, auditSaved: true, data: audit,
      ...(pvRevision === undefined ? {} : { pvRevision }), reDeclarationSync, reTariffContextSync,
      ...(syncFailed ? { error: syncError } : {}),
    }, { status: syncFailed ? 502 : before ? 200 : 201 });
  } catch (error) {
    if (error instanceof PvDraftRevisionConflict) return jsonResponse({ ok: false, error: error.message }, { status: 409 });
    if (error instanceof OfferWorkspaceNotFoundError) return notFound(error.message);
    return serverError('Nie udało się zapisać audytu', error);
  }
}
