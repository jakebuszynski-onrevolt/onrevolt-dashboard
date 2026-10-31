import { prisma } from './prisma';
import { readProjectAnalysisPeriod } from './project-analysis-period-server';

export async function readAnalysisAccountMeasurements(accountId: string, projectId: string) {
  const selected = await readProjectAnalysisPeriod(projectId);
  if (!selected) throw new Error('Nie znaleziono projektu okresu analizy.');
  const files = await prisma.energyMeasurementFile.findMany({
    where: {
      accountId,
      account: { projectId },
      AND: [
        { OR: selected.period.periodKeys.map(key => {
          const [periodYear, periodMonth] = key.split('-').map(Number);
          return { periodYear, periodMonth };
        }) },
        { OR: [{ projectId }, { projectId: null }] },
      ],
    },
    include: { document: true },
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { kind: 'asc' }],
  });
  return { files, period: selected.period };
}
