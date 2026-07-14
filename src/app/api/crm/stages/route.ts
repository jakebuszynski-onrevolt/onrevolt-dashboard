import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { operationalPipelineStageCodes } from 'lib/onrevolt/pipeline-stages';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const includeImported = req.nextUrl.searchParams.get('all') === '1';
    const stages = await prisma.pipelineStage.findMany({
      where: includeImported ? undefined : { isActive: true, code: { in: operationalPipelineStageCodes } },
      orderBy: { sortOrder: 'asc' },
    });
    return jsonResponse({ ok: true, data: stages });
  } catch (error) {
    return serverError('Nie udało się pobrać etapów', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'settings.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const name = requireString(body, 'name');
    const sortOrder = Number(body.sortOrder);
    if (!Number.isInteger(sortOrder)) return badRequest('Pole sortOrder musi być liczbą całkowitą');

    const stage = await prisma.pipelineStage.create({
      data: {
        code: typeof body.code === 'string' && body.code.trim() ? body.code.trim().toUpperCase() : undefined,
        name,
        sortOrder,
        color: typeof body.color === 'string' ? body.color : undefined,
        status: typeof body.status === 'string' ? body.status as any : 'W_TRAKCIE_OBSLUGI',
        isTerminal: Boolean(body.isTerminal),
        isActive: body.isActive !== false,
        requiresOwner: body.requiresOwner !== false,
        requiresNextAction: body.requiresNextAction !== false,
        source: 'LOCAL',
      },
    });
    return jsonResponse({ ok: true, data: stage }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać etapu', error);
  }
}
