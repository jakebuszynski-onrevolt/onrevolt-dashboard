import { prisma } from './prisma';
import { resolveProjectAnalysisPeriod, type ProjectAnalysisPeriod } from './project-analysis-period';

export type ReadProjectAnalysisPeriod = {
  projectId: string;
  storedStartMonth: string | null;
  period: ProjectAnalysisPeriod;
};

export async function readProjectAnalysisPeriod(
  projectId: string,
  now?: Date,
): Promise<ReadProjectAnalysisPeriod | null> {
  const rows = await prisma.$queryRaw<Array<{ analysisStartMonth: string | null }>>`
    SELECT analysisStartMonth FROM Project WHERE id = ${projectId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (row.analysisStartMonth !== null && typeof row.analysisStartMonth !== 'string') {
    throw new Error('Nieprawidłowa zapisana data początku analizy.');
  }

  return {
    projectId,
    storedStartMonth: row.analysisStartMonth,
    period: resolveProjectAnalysisPeriod(row.analysisStartMonth, now),
  };
}
