import { NextRequest } from 'next/server';
import { jsonResponse, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { operationalPipelineStageCodes } from 'lib/onrevolt/pipeline-stages';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const user = access.user;
    const seesAll = user.systemRole === 'ADMIN' || user.systemRole === 'MODERATOR';
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const activeStatuses = ['OPEN', 'IN_PROGRESS'] as const;
    const taskAccess = seesAll ? {} : { assignedToId: user.id };
    const projectAccess = seesAll ? {} : { ownerId: user.id };

    const [today, overdue, open, projects, stageGroups, dataQuality, installations] = await Promise.all([
      prisma.task.findMany({
        where: { ...taskAccess, status: { in: [...activeStatuses] }, dueAt: { gte: dayStart, lt: dayEnd } },
        include: { client: true, project: true, assignedTo: true },
        orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }],
        take: 12,
      }),
      prisma.task.findMany({
        where: { ...taskAccess, status: { in: [...activeStatuses] }, dueAt: { lt: dayStart } },
        include: { client: true, project: true, assignedTo: true },
        orderBy: { dueAt: 'asc' },
        take: 12,
      }),
      prisma.task.count({ where: { ...taskAccess, status: { in: [...activeStatuses] } } }),
      prisma.project.count({ where: { ...projectAccess, status: { notIn: ['ZAKONCZONY', 'WSTRZYMANY'] } } }),
      prisma.project.groupBy({
        by: ['stageId'],
        where: { ...projectAccess, status: { notIn: ['ZAKONCZONY', 'WSTRZYMANY'] } },
        _count: { _all: true },
      }),
      Promise.all([
        prisma.project.count({ where: { ...projectAccess, ownerId: null, status: { not: 'ZAKONCZONY' } } }),
        prisma.project.count({ where: { ...projectAccess, nextActionAt: null, status: { notIn: ['ZAKONCZONY', 'WSTRZYMANY'] } } }),
        prisma.client.count({ where: { clientType: 'UNKNOWN' } }),
      ]),
      prisma.installation.findMany({
        where: seesAll ? { status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] } } : {
          status: { in: ['PLANNED', 'CONFIRMED', 'IN_PROGRESS'] },
          OR: [{ teamLeadId: user.id }, { teamMembers: { some: { staffUserId: user.id } } }],
        },
        include: { project: { include: { client: true } }, teamLead: true },
        orderBy: { plannedAt: 'asc' },
        take: 8,
      }),
    ]);

    const stages = await prisma.pipelineStage.findMany({
      where: { isActive: true, code: { in: operationalPipelineStageCodes } },
      orderBy: { sortOrder: 'asc' },
    });
    const counts = new Map(stageGroups.map((group) => [group.stageId, group._count._all]));
    return jsonResponse({
      ok: true,
      data: {
        stats: { openTasks: open, todayTasks: today.length, overdueTasks: overdue.length, activeProjects: projects },
        today,
        overdue,
        stages: stages.map((stage) => ({ ...stage, count: counts.get(stage.id) || 0 })),
        dataQuality: { withoutOwner: dataQuality[0], withoutNextAction: dataQuality[1], unknownClientType: dataQuality[2] },
        installations,
      },
    });
  } catch (error) {
    return serverError('Nie udało się pobrać dashboardu', error);
  }
}
