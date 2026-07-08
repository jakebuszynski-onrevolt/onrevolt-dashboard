import { NextRequest } from 'next/server';
import { jsonResponse, readJsonObject, serverError, unauthorized } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { getCurrentStaffUser } from 'lib/onrevolt/staff-server';

function dayRange(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function serializeNotification(notification: any) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    href: notification.href,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
    actor: notification.actor
      ? {
          id: notification.actor.id,
          name: notification.actor.name,
          email: notification.actor.email,
          avatarUrl: notification.actor.avatarUrl,
        }
      : null,
    task: notification.task
      ? {
          id: notification.task.id,
          title: notification.task.title,
          status: notification.task.status,
          dueAt: notification.task.dueAt,
        }
      : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const currentUser = await getCurrentStaffUser(req);
    if (!currentUser) return unauthorized();
    const { start, end } = dayRange();

    const [notifications, unreadCount, todayCount, overdueCount] = await Promise.all([
      prisma.panelNotification.findMany({
        where: { staffUserId: currentUser.id },
        include: {
          actor: { select: { id: true, name: true, email: true, avatarUrl: true } },
          task: { select: { id: true, title: true, status: true, dueAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.panelNotification.count({ where: { staffUserId: currentUser.id, readAt: null } }),
      prisma.task.count({
        where: {
          assignedToId: currentUser.id,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          dueAt: { gte: start, lt: end },
        },
      }),
      prisma.task.count({
        where: {
          assignedToId: currentUser.id,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          dueAt: { lt: start },
        },
      }),
    ]);

    return jsonResponse({
      ok: true,
      data: {
        items: notifications.map(serializeNotification),
        unreadCount,
        todayCount,
        overdueCount,
      },
    });
  } catch (error) {
    return serverError('Nie udało się pobrać powiadomień', error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const currentUser = await getCurrentStaffUser(req);
    if (!currentUser) return unauthorized();
    const body = await readJsonObject(req);
    const now = new Date();

    if (body.all === true) {
      await prisma.panelNotification.updateMany({
        where: { staffUserId: currentUser.id, readAt: null },
        data: { readAt: now },
      });
      return jsonResponse({ ok: true });
    }

    if (typeof body.id === 'string' && body.id.trim() !== '') {
      await prisma.panelNotification.updateMany({
        where: { id: body.id, staffUserId: currentUser.id },
        data: { readAt: now },
      });
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    return serverError('Nie udało się zaktualizować powiadomień', error);
  }
}
