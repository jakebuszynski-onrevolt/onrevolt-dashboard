import { NextRequest } from 'next/server';
import { ServiceTicketStatus, TaskPriority } from '@prisma/client';
import { badRequest, jsonResponse, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

const include = { client: true, project: true, installedDevice: { include: { product: true } }, assignedTo: { select: { id: true, name: true, email: true, avatarUrl: true, positionTitle: true } }, documents: true };
async function nextNumber() { const now = new Date(); const count = await prisma.serviceTicket.count({ where: { createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } } }); return `SRV/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(count + 1).padStart(4, '0')}`; }

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'service.manage'); if (!access.ok) return access.response;
  try { const [tickets, devices, users] = await Promise.all([prisma.serviceTicket.findMany({ include, orderBy: { updatedAt: 'desc' }, take: 300 }), prisma.installedDevice.findMany({ include: { installation: { include: { project: { include: { client: true } } } }, product: true }, orderBy: { updatedAt: 'desc' }, take: 300 }), prisma.staffUser.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })]); return jsonResponse({ ok: true, data: { tickets, devices, users } }); }
  catch (error) { return serverError('Nie udało się pobrać zgłoszeń serwisowych', error); }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'service.manage'); if (!access.ok) return access.response;
  try { const body = await readJsonObject(req); const deviceId = typeof body.installedDeviceId === 'string' ? body.installedDeviceId : undefined; const device = deviceId ? await prisma.installedDevice.findUnique({ where: { id: deviceId }, include: { installation: { include: { project: true } } } }) : null; const clientId = device?.installation.project.clientId || requireString(body, 'clientId'); const ticket = await prisma.serviceTicket.create({ data: { number: await nextNumber(), clientId, projectId: device?.installation.projectId || (typeof body.projectId === 'string' ? body.projectId : undefined), installedDeviceId: deviceId, assignedToId: typeof body.assignedToId === 'string' && body.assignedToId ? body.assignedToId : undefined, title: requireString(body, 'title'), description: requireString(body, 'description'), priority: Object.values(TaskPriority).includes(body.priority as TaskPriority) ? body.priority as TaskPriority : 'NORMAL', warrantyClaim: Boolean(body.warrantyClaim), dueAt: parseDate(body.dueAt) }, include }); await writeAuditLog({ actorId: access.user.id, clientId, entityType: 'ServiceTicket', entityId: ticket.id, action: 'CREATE', after: ticket }); return jsonResponse({ ok: true, data: ticket }, { status: 201 }); }
  catch (error) { return serverError('Nie udało się utworzyć zgłoszenia', error); }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'service.manage'); if (!access.ok) return access.response;
  try { const body = await readJsonObject(req); const id = requireString(body, 'id'); const existing = await prisma.serviceTicket.findUnique({ where: { id }, include }); if (!existing) return badRequest('Nie znaleziono zgłoszenia'); const status = Object.values(ServiceTicketStatus).includes(body.status as ServiceTicketStatus) ? body.status as ServiceTicketStatus : existing.status; const ticket = await prisma.serviceTicket.update({ where: { id }, data: { status, assignedToId: body.assignedToId !== undefined ? body.assignedToId || null : undefined, resolution: typeof body.resolution === 'string' ? body.resolution.trim() || null : undefined, resolvedAt: ['RESOLVED', 'CLOSED'].includes(status) && !existing.resolvedAt ? new Date() : undefined }, include }); await writeAuditLog({ actorId: access.user.id, clientId: existing.clientId, entityType: 'ServiceTicket', entityId: id, action: 'UPDATE', before: existing, after: ticket }); return jsonResponse({ ok: true, data: ticket }); }
  catch (error) { return serverError('Nie udało się zaktualizować zgłoszenia', error); }
}
