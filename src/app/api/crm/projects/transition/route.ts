import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { isOperationalPipelineStageCode } from 'lib/onrevolt/pipeline-stages';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'crm.write');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const projectId = requireString(body, 'projectId');
    const stageId = requireString(body, 'stageId');
    const [project, stage] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, include: { stage: true, client: true } }),
      prisma.pipelineStage.findUnique({ where: { id: stageId }, include: { workflowRules: { where: { active: true } } } }),
    ]);
    if (!project) return badRequest('Nie znaleziono projektu');
    if (!stage || !stage.isActive || !isOperationalPipelineStageCode(stage.code)) return badRequest('Nie znaleziono aktywnego etapu');

    const ownerId = typeof body.ownerId === 'string' && body.ownerId.trim()
      ? body.ownerId.trim()
      : project.ownerId || access.user.id;
    const nextActionTitle = typeof body.nextActionTitle === 'string'
      ? body.nextActionTitle.trim()
      : project.nextActionTitle || '';
    const nextActionAt = body.nextActionAt !== undefined
      ? parseDate(body.nextActionAt)
      : project.nextActionAt || undefined;

    if (stage.requiresOwner && !ownerId) return badRequest('Etap wymaga właściciela projektu');
    if (stage.requiresNextAction && (!nextActionTitle || !nextActionAt)) {
      return badRequest('Etap wymaga następnego działania i terminu');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.project.update({
        where: { id: project.id },
        data: {
          stageId: stage.id,
          status: stage.status,
          ownerId,
          nextActionTitle: stage.requiresNextAction ? nextActionTitle : null,
          nextActionAt: stage.requiresNextAction ? nextActionAt : null,
          closedAt: stage.isTerminal ? new Date() : null,
        },
        include: { stage: true, owner: true, client: true },
      });

      await tx.activity.create({
        data: {
          type: 'STATUS_CHANGE',
          title: `Zmiana etapu: ${project.stage?.name || 'brak'} → ${stage.name}`,
          clientId: project.clientId,
          projectId: project.id,
          actorId: access.user.id,
          nextActionAt: stage.requiresNextAction ? nextActionAt : undefined,
          metadata: { fromStageId: project.stageId, toStageId: stage.id },
        },
      });

      for (const rule of stage.workflowRules) {
        const existingTask = await tx.task.findFirst({
          where: { projectId: project.id, title: rule.taskTitle, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        });
        if (existingTask) continue;
        const dueAt = new Date();
        dueAt.setDate(dueAt.getDate() + rule.dueOffsetDays);
        const task = await tx.task.create({
          data: {
            clientId: project.clientId,
            projectId: project.id,
            title: rule.taskTitle,
            description: rule.taskDescription,
            priority: rule.taskPriority,
            dueAt,
            assignedToId: rule.assignToOwner ? ownerId : undefined,
            createdById: access.user.id,
          },
        });
        if (task.assignedToId) {
          await tx.panelNotification.create({
            data: {
              staffUserId: task.assignedToId,
              actorId: access.user.id,
              taskId: task.id,
              type: 'WORKFLOW_TASK',
              title: 'Nowe zadanie z procesu',
              message: task.title,
              href: `/admin/tasks?taskId=${encodeURIComponent(task.id)}`,
            },
          });
        }
      }
      return saved;
    });

    await writeAuditLog({
      actorId: access.user.id,
      clientId: project.clientId,
      entityType: 'Project',
      entityId: project.id,
      action: 'STAGE_CHANGE',
      before: project,
      after: updated,
    });
    return jsonResponse({ ok: true, data: updated });
  } catch (error) {
    return serverError('Nie udało się zmienić etapu projektu', error);
  }
}
