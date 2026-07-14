import { NextRequest } from 'next/server';
import { jsonResponse, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { operationalPipelineStageCodes } from 'lib/onrevolt/pipeline-stages';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const q = (req.nextUrl.searchParams.get('q') || '').trim();
    const ownerId = req.nextUrl.searchParams.get('ownerId') || undefined;
    const baseWhere: any = {
      ownerId,
      ...(q ? {
        OR: [
          { title: { contains: q } },
          { client: { displayName: { contains: q } } },
          { client: { contacts: { some: { OR: [{ phone: { contains: q } }, { email: { contains: q } }] } } } },
        ],
      } : {}),
    };
    const stages = await prisma.pipelineStage.findMany({
      where: { isActive: true, code: { in: operationalPipelineStageCodes } },
      orderBy: { sortOrder: 'asc' },
    });
    const columns = await Promise.all(stages.map(async (stage) => {
      const where = { ...baseWhere, stageId: stage.id };
      const [count, projects] = await Promise.all([
        prisma.project.count({ where }),
        prisma.project.findMany({
          where,
          include: {
            client: { include: { contacts: { take: 1 } } },
            owner: { select: { id: true, name: true, avatarUrl: true } },
          },
          orderBy: [{ nextActionAt: 'asc' }, { updatedAt: 'desc' }],
          take: 50,
        }),
      ]);
      return { stage, count, projects };
    }));
    const users = await prisma.staffUser.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return jsonResponse({ ok: true, data: { columns, users } });
  } catch (error) {
    return serverError('Nie udało się pobrać lejka', error);
  }
}
