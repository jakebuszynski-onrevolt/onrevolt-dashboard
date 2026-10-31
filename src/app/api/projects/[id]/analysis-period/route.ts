import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, notFound, readJsonObject, serverError } from 'lib/onrevolt/api';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';
import { prisma } from 'lib/onrevolt/prisma';
import { offerWorkspaceProjectWhere } from 'lib/onrevolt/offer-workspace-server';
import { readProjectAnalysisPeriod } from 'lib/onrevolt/project-analysis-period-server';
import { resolveProjectAnalysisPeriod } from 'lib/onrevolt/project-analysis-period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;

function validExpectedStartMonth(value: unknown, now: Date): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  const match = monthPattern.exec(value);
  if (!match || Number(match[1]) < 2000) return false;
  try {
    resolveProjectAnalysisPeriod(value, now);
    return true;
  } catch {
    return false;
  }
}

function responseData(projectId: string, storedStartMonth: string | null, now: Date) {
  return {
    projectId,
    storedStartMonth,
    period: resolveProjectAnalysisPeriod(storedStartMonth, now),
  };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'crm.read');
  if (!access.ok) return access.response;

  try {
    const { id } = await context.params;
    const project = await prisma.project.findFirst({
      where: offerWorkspaceProjectWhere(id, access.user),
      select: { id: true },
    });
    if (!project) return notFound('Nie znaleziono projektu');

    const result = await readProjectAnalysisPeriod(id);
    if (!result) return notFound('Nie znaleziono projektu');
    return jsonResponse({ ok: true, data: result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return serverError('Nie udało się odczytać okresu analizy projektu.', error);
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(req);
  } catch (error) {
    if (error instanceof SyntaxError) return badRequest('Nieprawidłowy JSON.');
    return badRequest('Oczekiwano obiektu JSON.');
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'startMonth')
    || !Object.prototype.hasOwnProperty.call(body, 'expectedStartMonth')) {
    return badRequest('Wymagane pola startMonth i expectedStartMonth.');
  }
  const now = new Date();
  if (!validExpectedStartMonth(body.expectedStartMonth, now)) {
    return badRequest('expectedStartMonth musi mieć format RRRR-MM albo null.');
  }
  const expectedStartMonth = body.expectedStartMonth as string | null;

  let requestedStartMonth: string | null;
  try {
    if (body.startMonth !== null && typeof body.startMonth !== 'string') {
      throw new Error('startMonth musi mieć format RRRR-MM albo null.');
    }
    requestedStartMonth = body.startMonth as string | null;
    resolveProjectAnalysisPeriod(requestedStartMonth, now);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : 'Nieprawidłowy okres analizy.');
  }

  try {
    const { id } = await context.params;
    const isPrivileged = access.user.systemRole === 'ADMIN' || access.user.systemRole === 'MODERATOR';
    const result = await prisma.$transaction(async (tx) => {
      const where = offerWorkspaceProjectWhere(id, access.user);
      const project = await tx.project.findFirst({ where, select: { id: true, clientId: true } });
      if (!project) return { status: 'not-found' as const };

      const changed = isPrivileged
        ? await tx.$executeRaw`
            UPDATE Project
            SET analysisStartMonth = ${requestedStartMonth}, updatedAt = CURRENT_TIMESTAMP(3)
            WHERE id = ${id} AND analysisStartMonth <=> ${expectedStartMonth}
          `
        : await tx.$executeRaw`
            UPDATE Project
            SET analysisStartMonth = ${requestedStartMonth}, updatedAt = CURRENT_TIMESTAMP(3)
            WHERE id = ${id} AND ownerId = ${access.user.id}
              AND analysisStartMonth <=> ${expectedStartMonth}
          `;

      if (changed !== 1) {
        const stillVisible = await tx.project.findFirst({ where, select: { id: true } });
        return stillVisible ? { status: 'conflict' as const } : { status: 'not-found' as const };
      }

      const data = responseData(id, requestedStartMonth, now);
      await tx.auditLog.create({ data: {
        actorId: access.user.id,
        clientId: project.clientId,
        entityType: 'Project',
        entityId: id,
        action: 'ANALYSIS_PERIOD_UPDATE',
        before: { analysisStartMonth: expectedStartMonth },
        after: { analysisStartMonth: requestedStartMonth, period: data.period },
      } });

      return {
        status: 'saved' as const,
        data,
      };
    });

    if (result.status === 'not-found') return notFound('Nie znaleziono projektu');
    if (result.status === 'conflict') {
      return jsonResponse({ ok: false, error: 'Okres analizy zmienił się w innej karcie. Odśwież dane projektu.' }, { status: 409 });
    }
    return jsonResponse({ ok: true, data: result.data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return serverError('Nie udało się zapisać okresu analizy projektu.', error);
  }
}
