import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

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
    const data = {
      projectId,
      status: typeof body.status === 'string' ? body.status as any : 'DRAFT',
      profileSource: typeof body.profileSource === 'string' ? body.profileSource as any : 'ANNUAL_DECLARATION',
      annualConsumptionKwh: optionalNumber(body.annualConsumptionKwh),
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
    const before = id
      ? await prisma.energyAudit.findUnique({ where: { id } })
      : await prisma.energyAudit.findUnique({ where: { projectId } });
    const audit = before
      ? await prisma.energyAudit.update({ where: { id: before.id }, data, include: { scenarios: { orderBy: { createdAt: 'desc' } } } })
      : await prisma.energyAudit.create({ data, include: { scenarios: true } });
    await writeAuditLog({
      actorId: access.user.id,
      clientId: (await prisma.project.findUnique({ where: { id: projectId }, select: { clientId: true } }))?.clientId,
      entityType: 'EnergyAudit',
      entityId: audit.id,
      action: before ? 'UPDATE' : 'CREATE',
      before,
      after: audit,
    });
    return jsonResponse({ ok: true, data: audit }, { status: before ? 200 : 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać audytu', error);
  }
}
