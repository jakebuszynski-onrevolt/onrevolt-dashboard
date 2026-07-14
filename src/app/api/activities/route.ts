import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

const activityTypes = new Set(['CALL', 'EMAIL', 'MEETING', 'NOTE']);

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const clientId = req.nextUrl.searchParams.get('clientId') || undefined;
    const projectId = req.nextUrl.searchParams.get('projectId') || undefined;
    const activities = await prisma.activity.findMany({
      where: { clientId, projectId },
      include: { actor: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
    return jsonResponse({ ok: true, data: activities });
  } catch (error) {
    return serverError('Nie udało się pobrać aktywności', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'crm.write');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const type = requireString(body, 'type');
    if (!activityTypes.has(type)) throw new Error('Nieprawidłowy typ aktywności');
    const activity = await prisma.activity.create({
      data: {
        type: type as any,
        title: requireString(body, 'title'),
        body: optionalString(body, 'body'),
        clientId: optionalString(body, 'clientId'),
        projectId: optionalString(body, 'projectId'),
        actorId: access.user.id,
        occurredAt: parseDate(body.occurredAt) || new Date(),
        nextActionAt: parseDate(body.nextActionAt),
      },
      include: { actor: { select: { id: true, name: true, avatarUrl: true } } },
    });
    await writeAuditLog({
      actorId: access.user.id,
      clientId: activity.clientId,
      entityType: 'Activity',
      entityId: activity.id,
      action: 'CREATE',
      after: activity,
    });
    return jsonResponse({ ok: true, data: activity }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać aktywności', error);
  }
}
