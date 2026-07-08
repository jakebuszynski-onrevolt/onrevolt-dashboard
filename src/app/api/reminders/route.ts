import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

export async function GET() {
  try {
    const reminders = await prisma.reminder.findMany({
      include: { client: true, project: true, staffUser: true, task: true },
      orderBy: { remindAt: 'asc' },
      take: 300,
    });
    return jsonResponse({ ok: true, data: reminders });
  } catch (error) {
    return serverError('Nie udało się pobrać przypomnień', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const reminder = await prisma.reminder.create({
      data: {
        title: requireString(body, 'title'),
        message: optionalString(body, 'message'),
        remindAt: parseDate(body.remindAt)!,
        channel: body.channel || 'PANEL',
        taskId: optionalString(body, 'taskId'),
        clientId: optionalString(body, 'clientId'),
        projectId: optionalString(body, 'projectId'),
        staffUserId: optionalString(body, 'staffUserId'),
      },
    });
    return jsonResponse({ ok: true, data: reminder }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać przypomnienia', error);
  }
}

