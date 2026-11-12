import { prisma } from './prisma';
import { selectOfferMeasurementFilesForPeriod } from './offer-measurement-month-reuse';
import { readProjectAnalysisPeriod } from './project-analysis-period-server';

export async function readAnalysisAccountMeasurements(
  accountId: string,
  projectId: string,
  options: { includeReusable?: boolean } = {},
) {
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
  const coverageFiles = options.includeReusable
    ? selectOfferMeasurementFilesForPeriod(await prisma.energyMeasurementFile.findMany({
      where: {
        accountId,
        account: { projectId },
        status: 'DOWNLOADED',
        operator: 'ENEA',
        kind: { in: ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'] },
        AND: [{ OR: [{ projectId }, { projectId: null }] }],
      },
      select: { kind: true, status: true, periodYear: true, periodMonth: true, dataSource: true },
      orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }, { kind: 'asc' }, { id: 'asc' }],
    }), selected.period.periodKeys)
    : undefined;

  return {
    files,
    period: selected.period,
    ...(coverageFiles ? { coverageFiles } : {}),
  };
}
