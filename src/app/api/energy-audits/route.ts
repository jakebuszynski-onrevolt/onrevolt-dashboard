import { NextRequest } from 'next/server';
import { EnergyAuditStatus, EnergyProfileSource } from '@prisma/client';
import { badRequest, jsonResponse, notFound, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';
import { shouldSyncReConsumptionDeclaration, syncProjectReConsumptionDeclaration } from 'lib/onrevolt/re-consumption-declaration';

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
      phaseCount: optionalNumber(body.phaseCount),
      mainFuseA: optionalNumber(body.mainFuseA),
      roofType: typeof body.roofType === 'string' && body.roofType ? body.roofType as any : undefined,
      roofAreaM2: optionalNumber(body.roofAreaM2),
      roofOrientation: optionalString(body, 'roofOrientation'),
      roofTiltDeg: optionalNumber(body.roofTiltDeg),
      shadingNotes: optionalString(body, 'shadingNotes'),
      existingPvKw: optionalNumber(body.existingPvKw),
      existingInverter: optionalString(body, 'existingInverter'),
      existingBatteryKwh: optionalNumber(body.existingBatteryKwh),
      notes: optionalString(body, 'notes'),
    };
    const saved = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Project WHERE id = ${projectId} FOR UPDATE`;
      if (!rows.length) return { error: 'Nie znaleziono projektu' } as const;
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { clientId: true } });
      const before = id
        ? await tx.energyAudit.findUnique({ where: { id } })
        : await tx.energyAudit.findUnique({ where: { projectId } });
      if (id && (!before || before.projectId !== projectId)) return { error: 'Nie znaleziono audytu tego projektu' } as const;
      if (body.retryReDeclaration === true && (!before || before.annualConsumptionKwh == null || Number(before.annualConsumptionKwh) !== annual)) {
        return { error: 'Deklaracja zmieniła się od poprzedniej próby. Odśwież audyt przed ponowieniem.', conflict: true } as const;
      }
      const audit = before
        ? await tx.energyAudit.update({ where: { id: before.id, projectId }, data, include: { scenarios: { orderBy: { createdAt: 'desc' } } } })
        : await tx.energyAudit.create({ data, include: { scenarios: true } });
      return { before, audit, clientId: project.clientId };
    }, { maxWait: 120_000, timeout: 30_000 });
    if ('error' in saved) return 'conflict' in saved
      ? jsonResponse({ ok: false, error: saved.error }, { status: 409 }) : notFound(saved.error);
    const { before, audit, clientId } = saved;
    const shouldSync = shouldSyncReConsumptionDeclaration({ annualWasProvided,
      previousAnnual: before?.annualConsumptionKwh == null ? null : Number(before.annualConsumptionKwh),
      annual: audit.annualConsumptionKwh == null ? null : Number(audit.annualConsumptionKwh),
      profileSource: audit.profileSource, retry: body.retryReDeclaration === true });
    try {
      await writeAuditLog({
        actorId: access.user.id,
        clientId,
        entityType: 'EnergyAudit',
        entityId: audit.id,
        action: before ? 'UPDATE' : 'CREATE',
        before,
        after: audit,
      });
    } catch (error) {
      return jsonResponse({ ok: false, auditSaved: true, data: audit,
        error: 'Audyt zapisano w CRM, ale zapis historii nie powiódł się. Nie przekazano deklaracji do RE.',
        reDeclarationSync: { status: 'failed', station: null, retryAllowed: shouldSync, message: 'Nie zapisano historii audytu; RE nie zostało zmienione.' },
      }, { status: 500 });
    }
    const reDeclarationSync = shouldSync
      ? await syncProjectReConsumptionDeclaration({ clientId, projectId, auditId: audit.id,
        annualConsumptionKwh: Number(audit.annualConsumptionKwh), actorId: access.user.id })
      : { status: 'skipped' as const, station: null, retryAllowed: false,
        message: 'Nie przekazano deklaracji do RE: brak jawnej zmiany rocznego zużycia albo profil godzinowy OSD.' };
    return jsonResponse({ ok: reDeclarationSync.status !== 'failed', auditSaved: true, data: audit, reDeclarationSync,
      ...(reDeclarationSync.status === 'failed' ? { error: reDeclarationSync.message } : {}),
    }, { status: reDeclarationSync.status === 'failed' ? 502 : before ? 200 : 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać audytu', error);
  }
}
