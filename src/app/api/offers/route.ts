import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

export async function GET() {
  try {
    const offers = await prisma.offer.findMany({
      include: { project: { include: { client: true } }, configuration: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return jsonResponse({ ok: true, data: offers });
  } catch (error) {
    return serverError('Nie udało się pobrać ofert', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const offer = await prisma.offer.create({
      data: {
        projectId: requireString(body, 'projectId'),
        configurationId: optionalString(body, 'configurationId'),
        number: optionalString(body, 'number'),
        status: body.status || 'DRAFT',
        totalNet: Number(body.totalNet ?? 0),
        totalGross: Number(body.totalGross ?? 0),
        validUntil: parseDate(body.validUntil),
        notes: optionalString(body, 'notes'),
      },
    });
    return jsonResponse({ ok: true, data: offer }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać oferty', error);
  }
}

