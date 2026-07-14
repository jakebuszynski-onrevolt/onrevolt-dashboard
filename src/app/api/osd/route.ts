import { NextRequest } from 'next/server';
import { OdsCaseStatus } from '@prisma/client';
import { badRequest, jsonResponse, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

const checklist = ['Schemat instalacji', 'Dane falownika i magazynu', 'Certyfikaty urządzeń', 'Pełnomocnictwo klienta', 'Protokół uruchomienia', 'Zdjęcia i numery seryjne', 'Formularz zgłoszenia OSD'];
const include = { project: { include: { client: true, energyPortalAccounts: { select: { id: true, operator: true, tariff: true, ppeNumber: true, portalPpeId: true, lastSyncAt: true } }, installations: true } }, checklistItems: { orderBy: { sortOrder: 'asc' as const } }, documents: true };

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'installations.manage'); if (!access.ok) return access.response;
  try {
    const [cases, projects] = await Promise.all([
      prisma.odsCase.findMany({ include, orderBy: { updatedAt: 'desc' }, take: 250 }),
      prisma.project.findMany({ where: { installations: { some: {} } }, include: { client: true, energyPortalAccounts: { select: { id: true, operator: true, tariff: true, ppeNumber: true, portalPpeId: true } }, odsCase: true }, orderBy: { updatedAt: 'desc' }, take: 250 }),
    ]);
    return jsonResponse({ ok: true, data: { cases, projects } });
  } catch (error) { return serverError('Nie udało się pobrać spraw OSD', error); }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'installations.manage'); if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req); const projectId = requireString(body, 'projectId');
    const project = await prisma.project.findUnique({ where: { id: projectId }, include: { client: true, energyPortalAccounts: { select: { id: true, operator: true, tariff: true, ppeNumber: true, portalPpeId: true } }, odsCase: true } });
    if (!project) return badRequest('Nie znaleziono projektu');
    if (project.odsCase) return badRequest('Projekt ma już sprawę OSD');
    const account = project.energyPortalAccounts[0];
    const created = await prisma.odsCase.create({ data: { projectId, operator: (body.operator || account?.operator || 'INNY') as any, ppeNumber: body.ppeNumber || account?.ppeNumber || undefined, deadlineAt: parseDate(body.deadlineAt), checklistItems: { create: checklist.map((title, index) => ({ title, sortOrder: index + 1 })) } }, include });
    await writeAuditLog({ actorId: access.user.id, clientId: project.clientId, entityType: 'OdsCase', entityId: created.id, action: 'CREATE', after: created });
    return jsonResponse({ ok: true, data: created }, { status: 201 });
  } catch (error) { return serverError('Nie udało się utworzyć sprawy OSD', error); }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'installations.manage'); if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req); const id = requireString(body, 'id');
    const existing = await prisma.odsCase.findUnique({ where: { id }, include }); if (!existing) return badRequest('Nie znaleziono sprawy OSD');
    const status = typeof body.status === 'string' && Object.values(OdsCaseStatus).includes(body.status as OdsCaseStatus) ? body.status as OdsCaseStatus : existing.status;
    const updated = await prisma.$transaction(async (tx) => {
      if (Array.isArray(body.checklistItems)) for (const item of body.checklistItems) if (item?.id) await tx.odsChecklistItem.update({ where: { id: item.id }, data: { completed: Boolean(item.completed), completedAt: item.completed ? new Date() : null } });
      const result = await tx.odsCase.update({ where: { id }, data: { status, applicationNumber: typeof body.applicationNumber === 'string' ? body.applicationNumber.trim() || null : undefined, deadlineAt: body.deadlineAt !== undefined ? parseDate(body.deadlineAt) || null : undefined, submittedAt: status === 'SUBMITTED' && !existing.submittedAt ? new Date() : undefined, acceptedAt: status === 'ACCEPTED' && !existing.acceptedAt ? new Date() : undefined, completedAt: status === 'COMPLETED' && !existing.completedAt ? new Date() : undefined }, include });
      if (status === 'COMPLETED') { const stage = await tx.pipelineStage.findFirst({ where: { code: 'CRM_ZAKONCZONY', isActive: true } }); await tx.project.update({ where: { id: existing.projectId }, data: { status: 'ODBIOR', ...(stage ? { stageId: stage.id } : {}) } }); }
      return result;
    });
    await writeAuditLog({ actorId: access.user.id, clientId: existing.project.clientId, entityType: 'OdsCase', entityId: id, action: 'UPDATE', before: existing, after: updated });
    return jsonResponse({ ok: true, data: updated });
  } catch (error) { return serverError('Nie udało się zaktualizować sprawy OSD', error); }
}
