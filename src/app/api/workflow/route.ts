import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { operationalPipelineStageCodes } from 'lib/onrevolt/pipeline-stages';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'settings.manage'); if (!access.ok) return access.response;
  try { const stages = await prisma.pipelineStage.findMany({ where: { code: { in: operationalPipelineStageCodes } }, include: { workflowRules: { orderBy: { createdAt: 'asc' } } }, orderBy: { sortOrder: 'asc' } }); return jsonResponse({ ok: true, data: stages }); }
  catch (error) { return serverError('Nie udało się pobrać workflow', error); }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'settings.manage'); if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req); const kind = requireString(body, 'kind'); const id = requireString(body, 'id');
    if (kind === 'stage') {
      const before = await prisma.pipelineStage.findUnique({ where: { id } }); if (!before) return badRequest('Nie znaleziono etapu');
      const after = await prisma.pipelineStage.update({ where: { id }, data: { isActive: body.isActive === undefined ? undefined : Boolean(body.isActive), requiresOwner: body.requiresOwner === undefined ? undefined : Boolean(body.requiresOwner), requiresNextAction: body.requiresNextAction === undefined ? undefined : Boolean(body.requiresNextAction) } });
      await writeAuditLog({ actorId: access.user.id, entityType: 'PipelineStage', entityId: id, action: 'UPDATE', before, after });
    } else if (kind === 'rule') {
      const before = await prisma.workflowRule.findUnique({ where: { id } }); if (!before) return badRequest('Nie znaleziono reguły');
      const dueOffsetDays = Number(body.dueOffsetDays); const after = await prisma.workflowRule.update({ where: { id }, data: { active: body.active === undefined ? undefined : Boolean(body.active), dueOffsetDays: Number.isInteger(dueOffsetDays) && dueOffsetDays >= 0 ? dueOffsetDays : undefined } });
      await writeAuditLog({ actorId: access.user.id, entityType: 'WorkflowRule', entityId: id, action: 'UPDATE', before, after });
    } else return badRequest('Nieprawidłowy typ elementu workflow');
    const stages = await prisma.pipelineStage.findMany({ where: { code: { in: operationalPipelineStageCodes } }, include: { workflowRules: { orderBy: { createdAt: 'asc' } } }, orderBy: { sortOrder: 'asc' } }); return jsonResponse({ ok: true, data: stages });
  } catch (error) { return serverError('Nie udało się zapisać workflow', error); }
}
