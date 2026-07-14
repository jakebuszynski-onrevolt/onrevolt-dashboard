import { NextRequest } from 'next/server';
import { jsonResponse, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'reports.read'); if (!access.ok) return access.response;
  try {
    const now = new Date();
    const [projects, offers, installations, tasksOverdue, osdOpen, serviceOpen, sales, profit] = await Promise.all([
      prisma.project.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.offer.groupBy({ by: ['status'], _count: { _all: true }, _sum: { totalGross: true } }),
      prisma.installation.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.task.count({ where: { dueAt: { lt: now }, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      prisma.odsCase.count({ where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
      prisma.serviceTicket.count({ where: { status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
      prisma.offer.aggregate({ where: { status: 'ACCEPTED' }, _sum: { totalGross: true }, _count: { _all: true } }),
      prisma.configuration.aggregate({ where: { status: { in: ['ACCEPTED', 'OFFERED', 'READY'] } }, _sum: { totalProfitNet: true } }),
    ]);
    return jsonResponse({ ok: true, data: { generatedAt: now, projects, offers, installations, tasksOverdue, osdOpen, serviceOpen, acceptedSalesGross: sales._sum.totalGross || 0, acceptedOffers: sales._count._all, expectedProfitNet: profit._sum.totalProfitNet || 0 } });
  } catch (error) { return serverError('Nie udało się przygotować raportu', error); }
}
