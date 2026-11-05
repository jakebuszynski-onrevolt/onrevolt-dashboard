import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonResponse, notFound, readJsonObject, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { rePrisma } from 'lib/onrevolt/re-stations';
import { authorizeStaffRequest, isAdminUser } from 'lib/onrevolt/staff-server';
import { projectDeleteBlockers, projectEnergyAccountDisposition } from 'lib/onrevolt/project-delete';

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'crm.write');
  if (!access.ok) return access.response;
  if (!isAdminUser(access.user)) return forbidden('Tylko administrator może usuwać projekty.');
  try {
    const { id } = await context.params;
    const body = await readJsonObject(req);
    if (typeof body.clientId !== 'string' || !body.clientId.trim()
      || typeof body.expectedTitle !== 'string' || !body.expectedTitle.trim()
      || typeof body.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(body.expectedUpdatedAt))
      || body.confirm !== true) return badRequest('Potwierdź usunięcie wybranego projektu.');

    return await prisma.$transaction(async (tx) => {
      // Lock the parent before checking children so FK inserts cannot race with deletion.
      await tx.$queryRaw`SELECT id FROM Project WHERE id = ${id} AND clientId = ${body.clientId} FOR UPDATE`;
      const project = await tx.project.findFirst({
        where: { id, clientId: body.clientId },
        include: {
          _count: true, offerWorkspace: { select: { projectId: true } }, odsCase: { select: { id: true } },
          energyAudits: { include: { _count: true } },
          energyPortalAccounts: { include: { measurementFiles: {
            select: { projectId: true, clientId: true, project: { select: { clientId: true } } },
          } } },
        },
      });
      if (!project) return notFound('Nie znaleziono projektu tego klienta.');
      if (project.title !== body.expectedTitle || project.updatedAt.toISOString() !== body.expectedUpdatedAt) {
        return jsonResponse({ ok: false, error: 'Projekt został zmieniony. Odśwież dane i ponownie potwierdź usunięcie.' }, { status: 409 });
      }
      const tariffs = await rePrisma().$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT id FROM pricing_client_profile WHERE project_id = ? LIMIT 1', id,
      );
      const blockers = projectDeleteBlockers(project, tariffs.length > 0);
      if (blockers.length) return jsonResponse({
        ok: false, error: `Nie można usunąć projektu z powiązaniami: ${blockers.join('; ')}.`, blockers,
      }, { status: 409 });

      const { _count, offerWorkspace, odsCase, energyAudits, energyPortalAccounts, ...snapshot } = project;
      // Preserve accounts whose measurements belong to another project of this client.
      for (const account of energyPortalAccounts) {
        const disposition = projectEnergyAccountDisposition(account, project);
        if (disposition.kind === 'block') throw new Error('Konto operatora wymaga weryfikacji.');
        await tx.auditLog.create({ data: {
          actorId: access.user.id, clientId: project.clientId, entityType: 'EnergyPortalAccount', entityId: account.id,
          action: disposition.kind === 'reassign' ? 'UPDATE' : 'DELETE',
          before: { projectId: id },
          after: disposition.kind === 'reassign' ? { projectId: disposition.projectId } : undefined,
        } });
        if (disposition.kind === 'reassign') {
          await tx.energyPortalAccount.update({ where: { id: account.id }, data: { projectId: disposition.projectId } });
        } else {
          await tx.energyPortalAccount.delete({ where: { id: account.id } });
        }
      }
      await tx.auditLog.create({ data: {
        actorId: access.user.id, clientId: project.clientId, entityType: 'Project', entityId: id,
        action: 'DELETE', before: JSON.parse(JSON.stringify({ ...snapshot, energyAudits })),
      } });
      await tx.project.delete({ where: { id } });
      return jsonResponse({ ok: true, data: { id, clientId: project.clientId } });
    }, { isolationLevel: 'Serializable', timeout: 15000 });
  } catch (error) {
    return serverError('Nie udało się usunąć projektu', error);
  }
}
