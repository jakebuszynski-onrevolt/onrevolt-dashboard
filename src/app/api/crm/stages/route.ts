import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

export async function GET() {
  try {
    const stages = await prisma.pipelineStage.findMany({ orderBy: { sortOrder: 'asc' } });
    return jsonResponse({ ok: true, data: stages });
  } catch (error) {
    return serverError('Nie udało się pobrać etapów', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const name = requireString(body, 'name');
    const sortOrder = Number(body.sortOrder);
    if (!Number.isInteger(sortOrder)) return badRequest('Pole sortOrder musi być liczbą całkowitą');

    const stage = await prisma.pipelineStage.create({
      data: {
        name,
        sortOrder,
        color: typeof body.color === 'string' ? body.color : undefined,
        isTerminal: Boolean(body.isTerminal),
      },
    });
    return jsonResponse({ ok: true, data: stage }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać etapu', error);
  }
}

