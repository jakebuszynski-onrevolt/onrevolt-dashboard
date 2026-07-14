import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const devices = await prisma.installedDevice.findMany({
      include: {
        installation: { include: { project: { include: { client: true } } } },
        product: true,
        plannedItem: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });
    return jsonResponse({ ok: true, data: devices });
  } catch (error) {
    return serverError('Nie udało się pobrać urządzeń', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'installations.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const device = await prisma.installedDevice.create({
      data: {
        installationId: requireString(body, 'installationId'),
        plannedItemId: optionalString(body, 'plannedItemId'),
        productId: optionalString(body, 'productId'),
        name: requireString(body, 'name'),
        serialNumber: optionalString(body, 'serialNumber'),
        parameters: body.parameters && typeof body.parameters === 'object' ? body.parameters : undefined,
        installedAt: parseDate(body.installedAt),
        commissionedAt: parseDate(body.commissionedAt),
        warrantyMonths: Number.isInteger(Number(body.warrantyMonths)) ? Number(body.warrantyMonths) : undefined,
        warrantyUntil: parseDate(body.warrantyUntil),
        notes: optionalString(body, 'notes'),
      },
    });
    return jsonResponse({ ok: true, data: device }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać urządzenia', error);
  }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'service.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const device = await prisma.installedDevice.update({ where: { id }, data: { serialNumber: body.serialNumber !== undefined ? optionalString(body, 'serialNumber') || null : undefined, commissionedAt: body.commissionedAt !== undefined ? parseDate(body.commissionedAt) || null : undefined, warrantyMonths: body.warrantyMonths !== undefined ? Number(body.warrantyMonths) || null : undefined, warrantyUntil: body.warrantyUntil !== undefined ? parseDate(body.warrantyUntil) || null : undefined, notes: body.notes !== undefined ? optionalString(body, 'notes') || null : undefined }, include: { installation: { include: { project: { include: { client: true } } } }, product: true } });
    return jsonResponse({ ok: true, data: device });
  } catch (error) { return serverError('Nie udało się zaktualizować urządzenia', error); }
}
