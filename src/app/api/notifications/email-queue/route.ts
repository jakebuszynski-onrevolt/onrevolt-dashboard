import { NextRequest } from 'next/server';
import { jsonResponse, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

export async function GET() {
  try {
    const messages = await prisma.emailMessage.findMany({
      orderBy: [{ status: 'asc' }, { scheduledAt: 'asc' }],
      take: 300,
    });
    return jsonResponse({ ok: true, data: messages });
  } catch (error) {
    return serverError('Nie udało się pobrać kolejki email', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const message = await prisma.emailMessage.create({
      data: {
        to: requireString(body, 'to'),
        subject: requireString(body, 'subject'),
        body: requireString(body, 'body'),
        scheduledAt: parseDate(body.scheduledAt),
      },
    });
    return jsonResponse({ ok: true, data: message }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać emaila w kolejce', error);
  }
}

