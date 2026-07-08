import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

export async function GET() {
  try {
    const contracts = await prisma.contract.findMany({
      include: { project: { include: { client: true } }, offer: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return jsonResponse({ ok: true, data: contracts });
  } catch (error) {
    return serverError('Nie udało się pobrać umów', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const contract = await prisma.contract.create({
      data: {
        projectId: requireString(body, 'projectId'),
        offerId: optionalString(body, 'offerId'),
        number: optionalString(body, 'number'),
        status: body.status || 'DRAFT',
        signedAt: parseDate(body.signedAt),
        saleGross: body.saleGross == null ? undefined : Number(body.saleGross),
        deposit: body.deposit == null ? undefined : Number(body.deposit),
        notes: optionalString(body, 'notes'),
      },
    });
    return jsonResponse({ ok: true, data: contract }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać umowy', error);
  }
}

