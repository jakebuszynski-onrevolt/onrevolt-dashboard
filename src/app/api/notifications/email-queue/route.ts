import { NextRequest } from 'next/server';
import { jsonResponse, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { processEmailQueue, queueAndSendEmail } from 'lib/onrevolt/email';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'synchronization.manage');
  if (!access.ok) return access.response;
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
  const access = await authorizeStaffRequest(req, 'synchronization.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const delivery = await queueAndSendEmail({
      to: requireString(body, 'to'),
      subject: requireString(body, 'subject'),
      body: requireString(body, 'body'),
      scheduledAt: parseDate(body.scheduledAt),
    });
    return jsonResponse({ ok: true, data: delivery }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać emaila w kolejce', error);
  }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'synchronization.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const results = await processEmailQueue(Number(body.limit || 50));
    return jsonResponse({
      ok: true,
      data: {
        processed: results.length,
        sent: results.filter((item) => item.status === 'SENT').length,
        failed: results.filter((item) => item.status === 'FAILED').length,
        results,
      },
    });
  } catch (error) {
    return serverError('Nie udało się przetworzyć kolejki email', error);
  }
}
