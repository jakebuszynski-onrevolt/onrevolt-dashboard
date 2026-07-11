import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

export async function GET() {
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
        notes: optionalString(body, 'notes'),
      },
    });
    return jsonResponse({ ok: true, data: device }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać urządzenia', error);
  }
}
