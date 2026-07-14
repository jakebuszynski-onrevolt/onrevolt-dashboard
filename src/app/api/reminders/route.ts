import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
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
  const access = await authorizeStaffRequest(req, 'crm.write');
  if (!access.ok) return access.response;
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
