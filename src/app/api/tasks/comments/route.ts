import { NextRequest } from 'next/server';
import {
  forbidden,
  jsonResponse,
  notFound,
  readJsonObject,
  requireString,
  serverError,
  unauthorized,
} from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest, getCurrentStaffUser, isAdminUser } from 'lib/onrevolt/staff-server';
import { isTaskParticipant } from 'lib/onrevolt/task-participants';

function canSeeTask(user: any, task: any) {
  return isAdminUser(user) || isTaskParticipant(task, user.id);
}

function serializeUser(user: any) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

function serializeComment(comment: any) {
  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    author: serializeUser(comment.author),
  };
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'crm.write');
  if (!access.ok) return access.response;
  try {
    const currentUser = await getCurrentStaffUser(req);
    if (!currentUser) return unauthorized();
    const body = await readJsonObject(req);
    const taskId = requireString(body, 'taskId');
    const text = requireString(body, 'body');

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assistants: { select: { staffUserId: true } } },
    });
    if (!task) return notFound('Nie znaleziono zadania');
    if (!canSeeTask(currentUser, task)) return forbidden();

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.taskComment.create({
        data: {
          taskId,
          authorId: currentUser.id,
          body: text,
        },
        include: { author: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      });

      const recipients = Array.from(new Set([
        task.assignedToId,
        task.createdById,
        ...task.assistants.map((assistant) => assistant.staffUserId),
      ].filter(Boolean)))
        .filter((staffUserId) => staffUserId !== currentUser.id) as string[];

      if (recipients.length > 0) {
        await tx.panelNotification.createMany({
          data: recipients.map((staffUserId) => ({
            staffUserId,
            actorId: currentUser.id,
            taskId,
            type: 'TASK_COMMENT',
            title: 'Nowy komentarz do zadania',
            message: task.title,
            href: `/admin/tasks?taskId=${taskId}`,
          })),
        });
      }

      return created;
    });

    return jsonResponse({ ok: true, data: serializeComment(comment) }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się dodać komentarza', error);
  }
}
