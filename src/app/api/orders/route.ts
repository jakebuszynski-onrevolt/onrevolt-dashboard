import { NextRequest } from 'next/server';
import { PurchaseOrderStatus } from '@prisma/client';
import { badRequest, jsonResponse, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

const orderInclude = {
  project: { include: { client: true } },
  offer: true,
  items: {
    include: { product: true, reservations: true },
    orderBy: { createdAt: 'asc' as const },
  },
};

function orderNumber(date: Date, sequence: number) {
  return `ZAM/${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(sequence).padStart(4, '0')}`;
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'installations.manage');
  if (!access.ok) return access.response;
  try {
    const [orders, offers] = await Promise.all([
      prisma.purchaseOrder.findMany({ include: orderInclude, orderBy: { updatedAt: 'desc' }, take: 300 }),
      prisma.offer.findMany({
        where: { status: 'ACCEPTED', configurationId: { not: null } },
        include: {
          project: { include: { client: true } },
          configuration: { include: { items: { include: { product: true }, orderBy: { position: 'asc' } } } },
          purchaseOrders: { select: { id: true, number: true, status: true } },
        },
        orderBy: { acceptedAt: 'desc' },
        take: 150,
      }),
    ]);
    return jsonResponse({ ok: true, data: { orders, offers } });
  } catch (error) {
    return serverError('Nie udało się pobrać zamówień', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'installations.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const offerId = requireString(body, 'offerId');
    const offer = await prisma.offer.findUnique({
      where: { id: offerId },
      include: {
        project: { include: { client: true } },
        configuration: { include: { items: { include: { product: true }, orderBy: { position: 'asc' } } } },
        purchaseOrders: true,
      },
    });
    if (!offer || offer.status !== 'ACCEPTED') return badRequest('Wybierz zaakceptowaną ofertę');
    if (!offer.configuration) return badRequest('Oferta nie ma konfiguracji zakupowej');
    if (offer.purchaseOrders.some((order) => order.status !== 'CANCELLED')) {
      return badRequest('Dla tej oferty istnieje już aktywne zamówienie');
    }
    const sourceItems = offer.configuration.items.filter((item) => item.supplyMode === 'ONREVOLT_SUPPLIED');
    if (!sourceItems.length) return badRequest('Konfiguracja nie zawiera towarów dostarczanych przez onRevolt');

    const groups = new Map<string, typeof sourceItems>();
    sourceItems.forEach((item) => {
      const supplier = item.product?.supplier?.trim() || 'Dostawca do ustalenia';
      groups.set(supplier, [...(groups.get(supplier) || []), item]);
    });
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const initialSequence = await prisma.purchaseOrder.count({ where: { createdAt: { gte: start } } });

    const created = await prisma.$transaction(async (tx) => {
      const result = [];
      let offset = 0;
      for (const [supplier, items] of groups) {
        offset += 1;
        const order = await tx.purchaseOrder.create({
          data: {
            number: orderNumber(now, initialSequence + offset),
            projectId: offer.projectId,
            offerId: offer.id,
            supplier,
            expectedAt: parseDate(body.expectedAt),
            notes: typeof body.notes === 'string' ? body.notes.trim() || undefined : undefined,
          },
        });
        for (const item of items) {
          const orderItem = await tx.purchaseOrderItem.create({
            data: {
              purchaseOrderId: order.id,
              productId: item.productId || undefined,
              name: item.product?.name || item.description,
              supplierSku: item.product?.supplierSku,
              quantity: item.quantity,
              unitPurchaseNet: item.unitPurchaseNet,
            },
          });
          await tx.stockReservation.create({
            data: {
              projectId: offer.projectId,
              configurationId: offer.configurationId,
              productId: item.productId || undefined,
              purchaseOrderItemId: orderItem.id,
              name: item.product?.name || item.description,
              quantity: item.quantity,
            },
          });
        }
        result.push(order.id);
      }
      await tx.activity.create({
        data: {
          type: 'SYSTEM', title: `Utworzono ${groups.size} zamówienie/zamówienia dla oferty ${offer.number}`,
          clientId: offer.project.clientId, projectId: offer.projectId, actorId: access.user.id,
          metadata: { offerId, suppliers: Array.from(groups.keys()) },
        },
      });
      return result;
    });
    const orders = await prisma.purchaseOrder.findMany({ where: { id: { in: created } }, include: orderInclude });
    await writeAuditLog({ actorId: access.user.id, clientId: offer.project.clientId, entityType: 'PurchaseOrder', entityId: created.join(','), action: 'CREATE', after: orders });
    return jsonResponse({ ok: true, data: orders }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się utworzyć zamówienia', error);
  }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'installations.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const existing = await prisma.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
    if (!existing) return badRequest('Nie znaleziono zamówienia');
    const status = typeof body.status === 'string' && Object.values(PurchaseOrderStatus).includes(body.status as PurchaseOrderStatus)
      ? body.status as PurchaseOrderStatus
      : existing.status;
    const order = await prisma.$transaction(async (tx) => {
      if (status === 'DELIVERED') {
        for (const item of existing.items) {
          await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: item.quantity } });
        }
      }
      if (status === 'CANCELLED') {
        await tx.stockReservation.updateMany({ where: { purchaseOrderItemId: { in: existing.items.map((item) => item.id) } }, data: { status: 'CANCELLED' } });
      }
      return tx.purchaseOrder.update({
        where: { id },
        data: {
          status,
          expectedAt: body.expectedAt !== undefined ? parseDate(body.expectedAt) || null : undefined,
          orderedAt: status === 'ORDERED' && !existing.orderedAt ? new Date() : undefined,
          deliveredAt: status === 'DELIVERED' && !existing.deliveredAt ? new Date() : undefined,
        },
        include: orderInclude,
      });
    });
    await writeAuditLog({ actorId: access.user.id, clientId: order.project.clientId, entityType: 'PurchaseOrder', entityId: id, action: 'UPDATE', before: existing, after: order });
    return jsonResponse({ ok: true, data: order });
  } catch (error) {
    return serverError('Nie udało się zaktualizować zamówienia', error);
  }
}
