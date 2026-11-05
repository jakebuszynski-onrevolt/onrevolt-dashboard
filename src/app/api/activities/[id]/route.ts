import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, notFound, readJsonObject, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

const legacyClientNoteId = 'legacy-client-note';

function auditSnapshot(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function conflict(message: string) {
  return jsonResponse({ ok: false, error: message }, { status: 409 });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'crm.write');
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const body = await readJsonObject(req);
    const clientId = req.nextUrl.searchParams.get('clientId')?.trim();
    if (!clientId) return badRequest('Brak clientId');
    if (typeof body.body !== 'string' || !body.body.trim()) return badRequest('Wpisz treść notatki');
    if (typeof body.expectedBody !== 'string' && body.expectedBody !== null) return badRequest('Brak poprzedniej treści notatki');
    const text = body.body.trim();
    if (id === legacyClientNoteId) {
      return await prisma.$transaction(async tx => {
        const client = await tx.client.findUnique({ where: { id: clientId }, select: { id: true, notes: true } });
        if (!client) return notFound('Nie znaleziono klienta');
        if (client.notes !== body.expectedBody) return conflict('Notatka została zmieniona. Odśwież dane przed ponowną edycją.');
        const updated = await tx.client.updateMany({ where: { id: clientId, notes: body.expectedBody }, data: { notes: text } });
        if (updated.count !== 1) return conflict('Notatka została zmieniona. Odśwież dane przed ponowną edycją.');
        await tx.auditLog.create({ data: {
          actorId: access.user.id, clientId, entityType: 'Client', entityId: clientId, action: 'UPDATE',
          before: auditSnapshot(client), after: { id: clientId, notes: text },
        } });
        return jsonResponse({ ok: true, data: { id, title: 'Notatka ogólna', body: text } });
      });
    }
    if (typeof body.title !== 'string' || body.title.trim().length > 200) return badRequest('Tytuł może mieć maksymalnie 200 znaków');
    if (typeof body.expectedTitle !== 'string') return badRequest('Brak poprzedniego tytułu notatki');
    const title = body.title.trim() || 'Notatka';
    return await prisma.$transaction(async tx => {
      const note = await tx.activity.findUnique({ where: { id } });
      if (!note || note.clientId !== clientId) return notFound('Nie znaleziono notatki klienta');
      if (note.type !== 'NOTE') return badRequest('Można edytować wyłącznie notatki');
      if (note.projectId && !await tx.project.findFirst({ where: { id: note.projectId, clientId }, select: { id: true } })) {
        return notFound('Nie znaleziono projektu klienta');
      }
      if (note.title !== body.expectedTitle || note.body !== body.expectedBody) return conflict('Notatka została zmieniona. Odśwież dane przed ponowną edycją.');
      const updated = await tx.activity.updateMany({
        where: { id, clientId, type: 'NOTE', projectId: note.projectId, title: body.expectedTitle, body: body.expectedBody },
        data: { title, body: text },
      });
      if (updated.count !== 1) return conflict('Notatka została zmieniona. Odśwież dane przed ponowną edycją.');
      await tx.auditLog.create({ data: {
        actorId: access.user.id, clientId, entityType: 'Activity', entityId: id, action: 'UPDATE',
        before: auditSnapshot(note), after: auditSnapshot({ ...note, title, body: text }),
      } });
      const data = await tx.activity.findUnique({ where: { id }, include: { actor: { select: { id: true, name: true, avatarUrl: true } } } });
      return jsonResponse({ ok: true, data });
    });
  } catch (error) { return serverError('Nie udało się zapisać notatki', error); }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'crm.write');
  if (!access.ok) return access.response;

  try {
    const { id } = await context.params;
    const body = req.body ? await readJsonObject(req) : {};

    if (id === legacyClientNoteId) {
      const clientId = req.nextUrl.searchParams.get('clientId');
      if (!clientId?.trim()) return badRequest('Brak clientId');
      if (typeof body.expectedBody !== 'string') return badRequest('Pole expectedBody musi być tekstem');

      return await prisma.$transaction(async (tx) => {
        const client = await tx.client.findUnique({
          where: { id: clientId.trim() },
          select: { id: true, notes: true },
        });
        if (!client) return notFound('Nie znaleziono klienta');
        if (client.notes !== body.expectedBody) return conflict('Notatka klienta została zmieniona');

        const cleared = await tx.client.updateMany({
          where: { id: client.id, notes: body.expectedBody },
          data: { notes: null },
        });
        if (cleared.count !== 1) return conflict('Notatka klienta została zmieniona');

        await tx.auditLog.create({
          data: {
            actorId: access.user.id,
            clientId: client.id,
            entityType: 'Client',
            entityId: client.id,
            action: 'UPDATE',
            before: auditSnapshot(client),
            after: { id: client.id, notes: null },
          },
        });

        return jsonResponse({ ok: true, data: { id: legacyClientNoteId, clientId: client.id } });
      });
    }

    const rawExpectedClientId = req.nextUrl.searchParams.get('expectedClientId')
      ?? req.nextUrl.searchParams.get('clientId')
      ?? body.expectedClientId;
    if (typeof rawExpectedClientId !== 'string' || !rawExpectedClientId.trim()) {
      return badRequest('Brak wymaganego pola expectedClientId');
    }
    const expectedClientId = rawExpectedClientId.trim();

    return await prisma.$transaction(async (tx) => {
      const activity = await tx.activity.findUnique({ where: { id } });
      if (!activity) return notFound('Nie znaleziono aktywności');
      if (activity.type !== 'NOTE') return badRequest('Można usuwać wyłącznie notatki');
      if (!activity.clientId || activity.clientId !== expectedClientId) {
        return notFound('Nie znaleziono aktywności klienta');
      }

      if (activity.projectId) {
        const project = await tx.project.findFirst({
          where: {
            id: activity.projectId,
            clientId: expectedClientId,
          },
          select: { id: true },
        });
        if (!project) return notFound('Nie znaleziono projektu klienta');
      } else {
        const client = await tx.client.findUnique({ where: { id: expectedClientId }, select: { id: true } });
        if (!client) return notFound('Nie znaleziono klienta');
      }

      const deleted = await tx.activity.deleteMany({
        where: { id, type: 'NOTE', clientId: expectedClientId, projectId: activity.projectId },
      });
      if (deleted.count !== 1) return conflict('Aktywność została zmieniona');

      await tx.auditLog.create({
        data: {
          actorId: access.user.id,
          clientId: expectedClientId,
          entityType: 'Activity',
          entityId: activity.id,
          action: 'DELETE',
          before: auditSnapshot(activity),
        },
      });

      return jsonResponse({ ok: true, data: { id: activity.id } });
    });
  } catch (error) {
    return serverError('Nie udało się usunąć notatki', error);
  }
}
