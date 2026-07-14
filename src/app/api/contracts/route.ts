import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

const contractStatuses = new Set(['DRAFT', 'SIGNED', 'CANCELLED', 'COMPLETED']);

async function nextContractNumber() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const count = await prisma.contract.count({ where: { createdAt: { gte: start } } });
  return `UM/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(count + 1).padStart(4, '0')}`;
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const contracts = await prisma.contract.findMany({
      include: { project: { include: { client: true } }, offer: true, documents: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return jsonResponse({ ok: true, data: contracts });
  } catch (error) {
    return serverError('Nie udało się pobrać umów', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'offers.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const projectId = requireString(body, 'projectId');
    const offerId = requireString(body, 'offerId');
    const depositPercent = Number(body.depositPercent);
    if (!Number.isFinite(depositPercent) || depositPercent < 0 || depositPercent > 100) {
      return badRequest('Podaj procent zaliczki od 0 do 100');
    }
    const offer = await prisma.offer.findUnique({
      where: { id: offerId },
      include: { project: { include: { client: true } } },
    });
    if (!offer || offer.projectId !== projectId) return badRequest('Oferta nie należy do wybranego projektu');
    if (offer.status !== 'ACCEPTED') return badRequest('Umowę można utworzyć dopiero z zaakceptowanej oferty');
    const existing = await prisma.contract.findFirst({ where: { offerId } });
    if (existing) return badRequest('Dla tej oferty istnieje już umowa');
    const saleGross = Number(offer.totalGross);
    const deposit = Math.round(saleGross * depositPercent) / 100;
    const paymentSchedule = [
      { name: 'Zaliczka', percent: depositPercent, amountGross: deposit, due: 'Po podpisaniu umowy' },
      { name: 'Płatność końcowa', percent: 100 - depositPercent, amountGross: Math.round((saleGross - deposit) * 100) / 100, due: 'Po zakończeniu montażu' },
    ];
    const contract = await prisma.contract.create({
      data: {
        projectId,
        offerId,
        number: optionalString(body, 'number') || await nextContractNumber(),
        status: 'DRAFT',
        signedAt: parseDate(body.signedAt),
        saleGross,
        deposit,
        depositPercent,
        paymentSchedule,
        commercialSnapshot: {
          offerId: offer.id,
          offerNumber: offer.number,
          offerVersion: offer.version,
          clientName: offer.project.client.displayName,
          saleGross,
          depositPercent,
          paymentSchedule,
        },
        notes: optionalString(body, 'notes'),
      },
      include: { project: { include: { client: true } }, offer: true },
    });
    await prisma.activity.create({
      data: {
        type: 'SYSTEM', title: `Utworzono umowę ${contract.number}`,
        clientId: offer.project.clientId, projectId, actorId: access.user.id,
        metadata: { contractId: contract.id, offerId, depositPercent, deposit },
      },
    });
    await writeAuditLog({ actorId: access.user.id, clientId: offer.project.clientId, entityType: 'Contract', entityId: contract.id, action: 'CREATE', after: contract });
    return jsonResponse({ ok: true, data: contract }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać umowy', error);
  }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'offers.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const status = requireString(body, 'status');
    if (!contractStatuses.has(status)) return badRequest('Nieprawidłowy status umowy');
    const existing = await prisma.contract.findUnique({ where: { id }, include: { project: true } });
    if (!existing) return badRequest('Nie znaleziono umowy');
    const contract = await prisma.contract.update({
      where: { id },
      data: { status: status as any, signedAt: status === 'SIGNED' ? parseDate(body.signedAt) || new Date() : existing.signedAt },
      include: { project: { include: { client: true } }, offer: true },
    });
    if (status === 'SIGNED') {
      const stage = await prisma.pipelineStage.findFirst({ where: { code: 'CRM_ZALICZKA_MONTAZ', isActive: true } });
      await prisma.project.update({ where: { id: contract.projectId }, data: { status: 'ZALICZKA_MONTAZ', ...(stage ? { stageId: stage.id } : {}) } });
    }
    await writeAuditLog({ actorId: access.user.id, clientId: existing.project.clientId, entityType: 'Contract', entityId: id, action: 'UPDATE', before: existing, after: contract });
    return jsonResponse({ ok: true, data: contract });
  } catch (error) {
    return serverError('Nie udało się zaktualizować umowy', error);
  }
}
