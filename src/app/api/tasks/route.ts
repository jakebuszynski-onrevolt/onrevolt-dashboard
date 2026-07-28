import { NextRequest } from 'next/server';
import { TaskPriority, TaskStatus } from '@prisma/client';
import {
  badRequest,
  forbidden,
  jsonResponse,
  notFound,
  optionalString,
  parseDate,
  readJsonObject,
  requireString,
  serverError,
  unauthorized,
} from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest, getCurrentStaffUser, isAdminUser, serializeStaffUser } from 'lib/onrevolt/staff-server';

const activeStatuses = [TaskStatus.OPEN, TaskStatus.IN_PROGRESS];
const taskStatuses = Object.values(TaskStatus) as string[];
const taskPriorities = Object.values(TaskPriority) as string[];

const taskInclude = {
  client: { select: { id: true, displayName: true, clientType: true } },
  project: { select: { id: true, title: true, status: true, clientId: true } },
  installation: { select: { id: true, status: true, plannedAt: true, projectId: true } },
  assignedTo: { select: { id: true, name: true, email: true, avatarUrl: true, positionTitle: true } },
  createdBy: { select: { id: true, name: true, email: true, avatarUrl: true, positionTitle: true } },
  comments: {
    include: { author: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' as const },
    take: 80,
  },
  _count: { select: { comments: true, reminders: true } },
};

function normalizeEnum(value: unknown, allowed: string[], fallback: string) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

function optionalNullableString(body: Record<string, any>, key: string) {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`Pole ${key} musi być tekstem`);
  return value.trim();
}

function dayRange(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function serializeUser(user: any) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    positionTitle: user.positionTitle,
  };
}

function serializeTask(task: any) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
    clientId: task.clientId,
    projectId: task.projectId,
    installationId: task.installationId,
    assignedToId: task.assignedToId,
    createdById: task.createdById,
    client: task.client,
    project: task.project,
    installation: task.installation,
    assignedTo: serializeUser(task.assignedTo),
    createdBy: serializeUser(task.createdBy),
    comments: (task.comments || []).map((comment: any) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      author: serializeUser(comment.author),
    })),
    commentsCount: task._count?.comments ?? task.comments?.length ?? 0,
    remindersCount: task._count?.reminders ?? 0,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function canSeeTask(user: any, task: any) {
  return isAdminUser(user) || task.assignedToId === user.id || task.createdById === user.id;
}

function canManageTask(user: any, task: any) {
  return isAdminUser(user) || task.createdById === user.id;
}

function createNotificationData(params: {
  staffUserId?: string | null;
  actorId?: string | null;
  taskId: string;
  title: string;
  message?: string | null;
  type: string;
}) {
  if (!params.staffUserId || params.staffUserId === params.actorId) return null;
  return {
    staffUserId: params.staffUserId,
    actorId: params.actorId || null,
    taskId: params.taskId,
    type: params.type,
    title: params.title,
    message: params.message || null,
    href: `/admin/tasks?taskId=${params.taskId}`,
  };
}

function buildAccessWhere(user: any, admin: boolean) {
  return admin ? {} : { OR: [{ assignedToId: user.id }, { createdById: user.id }] };
}

function buildSearchWhere(query: string) {
  const text = query.trim();
  if (!text) return {};
  return {
    OR: [
      { title: { contains: text } },
      { description: { contains: text } },
      { client: { displayName: { contains: text } } },
      { project: { title: { contains: text } } },
      { assignedTo: { name: { contains: text } } },
      { assignedTo: { email: { contains: text } } },
    ],
  };
}

function buildListWhere(req: NextRequest, user: any, admin: boolean) {
  const { searchParams } = new URL(req.url);
  const { start, end } = dayRange();
  const and: any[] = [buildAccessWhere(user, admin)];
  const query = searchParams.get('q') || '';
  const scope = searchParams.get('scope') || (admin ? 'all' : 'mine');
  const status = searchParams.get('status') || '';
  const priority = searchParams.get('priority') || '';
  const assignedToId = searchParams.get('assignedToId') || '';
  const clientId = searchParams.get('clientId') || '';
  const projectId = searchParams.get('projectId') || '';
  const installationId = searchParams.get('installationId') || '';

  const searchWhere = buildSearchWhere(query);
  if (Object.keys(searchWhere).length > 0) and.push(searchWhere);
  if (taskStatuses.includes(status)) and.push({ status });
  if (taskPriorities.includes(priority)) and.push({ priority });
  if (clientId) and.push({ clientId });
  if (projectId) and.push({ projectId });
  if (installationId) and.push({ installationId });
  if (assignedToId && admin) and.push({ assignedToId });

  if (scope === 'mine') and.push({ OR: [{ assignedToId: user.id }, { createdById: user.id }] });
  if (scope === 'assigned') and.push({ assignedToId: user.id });
  if (scope === 'created') and.push({ createdById: user.id });
  if (scope === 'new') and.push({ status: 'OPEN' });
  if (scope === 'in_progress') and.push({ status: 'IN_PROGRESS' });
  if (scope === 'done') and.push({ status: 'DONE' });
  if (scope === 'cancelled') and.push({ status: 'CANCELLED' });
  if (scope === 'today') and.push({ status: { in: activeStatuses }, dueAt: { gte: start, lt: end } });
  if (scope === 'overdue') and.push({ status: { in: activeStatuses }, dueAt: { lt: start } });

  return { AND: and };
}

async function loadMeta() {
  const [users, clients, projects] = await Promise.all([
    prisma.staffUser.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true, avatarUrl: true, positionTitle: true, systemRole: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    }),
    prisma.client.findMany({
      select: { id: true, displayName: true, clientType: true },
      orderBy: { displayName: 'asc' },
      take: 1000,
    }),
    prisma.project.findMany({
      select: { id: true, clientId: true, title: true, status: true },
      orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
      take: 1000,
    }),
  ]);

  return { users, clients, projects };
}

async function loadStats(user: any, admin: boolean) {
  const { start, end } = dayRange();
  const baseWhere = buildAccessWhere(user, admin);
  const [total, open, inProgress, today, overdue, done] = await Promise.all([
    prisma.task.count({ where: baseWhere }),
    prisma.task.count({ where: { AND: [baseWhere, { status: 'OPEN' }] } }),
    prisma.task.count({ where: { AND: [baseWhere, { status: 'IN_PROGRESS' }] } }),
    prisma.task.count({ where: { AND: [baseWhere, { status: { in: activeStatuses }, dueAt: { gte: start, lt: end } }] } }),
    prisma.task.count({ where: { AND: [baseWhere, { status: { in: activeStatuses }, dueAt: { lt: start } }] } }),
    prisma.task.count({ where: { AND: [baseWhere, { status: 'DONE' }] } }),
  ]);

  return { total, open, inProgress, today, overdue, done };
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const currentUser = await getCurrentStaffUser(req);
    if (!currentUser) return unauthorized();
    const admin = isAdminUser(currentUser);
    const { searchParams } = new URL(req.url);
    const selectedTaskId = searchParams.get('taskId') || '';

    const [tasks, stats, meta] = await Promise.all([
      prisma.task.findMany({
        where: buildListWhere(req, currentUser, admin),
        include: taskInclude,
        orderBy: [
          { status: 'asc' },
          { dueAt: 'asc' },
          { priority: 'desc' },
          { updatedAt: 'desc' },
        ],
        take: 300,
      }),
      loadStats(currentUser, admin),
      loadMeta(),
    ]);

    let selectedTask = null;
    if (selectedTaskId && !tasks.some((task) => task.id === selectedTaskId)) {
      const task = await prisma.task.findUnique({ where: { id: selectedTaskId }, include: taskInclude });
      if (task && canSeeTask(currentUser, task)) selectedTask = serializeTask(task);
    }

    return jsonResponse({
      ok: true,
      data: {
        currentUser: serializeStaffUser(currentUser),
        isAdmin: admin,
        tasks: tasks.map(serializeTask),
        selectedTask,
        stats,
        meta,
      },
    });
  } catch (error) {
    return serverError('Nie udało się pobrać zadań', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'crm.write');
  if (!access.ok) return access.response;
  try {
    const currentUser = await getCurrentStaffUser(req);
    if (!currentUser) return unauthorized();
    const body = await readJsonObject(req);

    const title = requireString(body, 'title');
    const assignedToId = optionalString(body, 'assignedToId');

    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          title,
          description: optionalString(body, 'description'),
          status: normalizeEnum(body.status, taskStatuses, 'OPEN') as any,
          priority: normalizeEnum(body.priority, taskPriorities, 'NORMAL') as any,
          dueAt: parseDate(body.dueAt),
          clientId: optionalString(body, 'clientId'),
          projectId: optionalString(body, 'projectId'),
          installationId: optionalString(body, 'installationId'),
          assignedToId,
          createdById: currentUser.id,
        },
        include: taskInclude,
      });

      const notification = createNotificationData({
        staffUserId: assignedToId,
        actorId: currentUser.id,
        taskId: created.id,
        type: 'TASK_ASSIGNED',
        title: 'Nowe zadanie',
        message: created.title,
      });
      if (notification) await tx.panelNotification.create({ data: notification });

      return created;
    });

    await writeAuditLog({
      actorId: access.user.id,
      clientId: task.clientId,
      entityType: 'Task',
      entityId: task.id,
      action: 'CREATE',
      after: task,
    });
    return jsonResponse({ ok: true, data: serializeTask(task) }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać zadania', error);
  }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'crm.write');
  if (!access.ok) return access.response;
  try {
    const currentUser = await getCurrentStaffUser(req);
    if (!currentUser) return unauthorized();
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');

    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) return notFound('Nie znaleziono zadania');
    if (!canSeeTask(currentUser, existing)) return forbidden();

    const canManage = canManageTask(currentUser, existing);
    const updateData: Record<string, any> = {};

    if ('status' in body) {
      const nextStatus = normalizeEnum(body.status, taskStatuses, existing.status);
      updateData.status = nextStatus;
      updateData.completedAt = nextStatus === 'DONE' ? new Date() : null;
    }

    if (canManage) {
      if ('title' in body) updateData.title = requireString(body, 'title');
      if ('description' in body) updateData.description = optionalNullableString(body, 'description');
      if ('priority' in body) updateData.priority = normalizeEnum(body.priority, taskPriorities, existing.priority);
      if ('dueAt' in body) updateData.dueAt = body.dueAt ? parseDate(body.dueAt) : null;
      if ('clientId' in body) updateData.clientId = optionalNullableString(body, 'clientId');
      if ('projectId' in body) updateData.projectId = optionalNullableString(body, 'projectId');
      if ('installationId' in body) updateData.installationId = optionalNullableString(body, 'installationId');
      if ('assignedToId' in body) updateData.assignedToId = optionalNullableString(body, 'assignedToId');
    }

    if (Object.keys(updateData).length === 0) {
      return badRequest('Brak zmian do zapisania');
    }

    const task = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({ where: { id }, data: updateData, include: taskInclude });
      if (
        canManage
        && 'assignedToId' in updateData
        && updateData.assignedToId
        && updateData.assignedToId !== existing.assignedToId
      ) {
        const notification = createNotificationData({
          staffUserId: updateData.assignedToId,
          actorId: currentUser.id,
          taskId: updated.id,
          type: 'TASK_REASSIGNED',
          title: 'Przypisano Ci zadanie',
          message: updated.title,
        });
        if (notification) await tx.panelNotification.create({ data: notification });
      }
      return updated;
    });

    await writeAuditLog({
      actorId: access.user.id,
      clientId: task.clientId,
      entityType: 'Task',
      entityId: task.id,
      action: 'UPDATE',
      before: existing,
      after: task,
    });
    return jsonResponse({ ok: true, data: serializeTask(task) });
  } catch (error) {
    return serverError('Nie udało się zaktualizować zadania', error);
  }
}

export async function DELETE(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'crm.write');
  if (!access.ok) return access.response;
  try {
    const currentUser = await getCurrentStaffUser(req);
    if (!currentUser) return unauthorized();
    if (!isAdminUser(currentUser)) return forbidden('Tylko administrator może usunąć zadanie');

    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) return notFound('Nie znaleziono zadania');
    await prisma.task.delete({ where: { id } });

    await writeAuditLog({
      actorId: access.user.id,
      clientId: existing.clientId,
      entityType: 'Task',
      entityId: existing.id,
      action: 'DELETE',
      before: existing,
    });
    return jsonResponse({ ok: true, data: { id: existing.id } });
  } catch (error) {
    return serverError('Nie udało się usunąć zadania', error);
  }
}
