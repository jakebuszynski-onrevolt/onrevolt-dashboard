import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

export async function GET() {
  try {
    const tasks = await prisma.task.findMany({
      include: { client: true, project: true, assignedTo: true },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: 300,
    });
    return jsonResponse({ ok: true, data: tasks });
  } catch (error) {
    return serverError('Nie udało się pobrać zadań', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const task = await prisma.task.create({
      data: {
        title: requireString(body, 'title'),
        description: optionalString(body, 'description'),
        status: body.status || 'OPEN',
        priority: body.priority || 'NORMAL',
        dueAt: parseDate(body.dueAt),
        clientId: optionalString(body, 'clientId'),
        projectId: optionalString(body, 'projectId'),
        assignedToId: optionalString(body, 'assignedToId'),
        createdById: optionalString(body, 'createdById'),
      },
    });
    return jsonResponse({ ok: true, data: task }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać zadania', error);
  }
}

