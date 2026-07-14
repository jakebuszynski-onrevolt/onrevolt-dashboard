import { PrismaClient, ProjectStatus } from '@prisma/client';
import { config } from 'dotenv';
import {
  operationalPipelineStages,
  projectStatusStageCode,
} from '../src/lib/onrevolt/pipeline-stages';

config({ path: '.env.local' });
config();

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const stageIds = new Map<string, string>();

    for (const definition of operationalPipelineStages) {
      const existing = await tx.pipelineStage.findFirst({
        where: { OR: [{ code: definition.code }, { name: definition.name }] },
        orderBy: { createdAt: 'asc' },
      });
      const data = {
        ...definition,
        isTerminal: definition.isTerminal ?? false,
        requiresOwner: definition.requiresOwner ?? true,
        requiresNextAction: definition.requiresNextAction ?? true,
        isActive: true,
        source: 'LOCAL',
      };
      const saved = existing
        ? await tx.pipelineStage.update({ where: { id: existing.id }, data })
        : await tx.pipelineStage.create({ data });
      stageIds.set(definition.code, saved.id);
    }

    await tx.pipelineStage.updateMany({
      where: { pipedriveStageId: { not: null } },
      data: { source: 'PIPEDRIVE', isActive: false },
    });

    const remapped: Record<string, number> = {};
    for (const [status, code] of Object.entries(projectStatusStageCode)) {
      const stageId = stageIds.get(code);
      if (!stageId) throw new Error(`Brak etapu operacyjnego ${code}`);
      const update = await tx.project.updateMany({
        where: { status: status as ProjectStatus },
        data: { stageId },
      });
      remapped[status] = update.count;
    }

    const ruleTargets: Record<string, string> = {
      'Dane do audytu': 'CRM_CZEKA_NA_KALKULACJE',
      'Kontakt po ofercie': 'CRM_OFERTA_PRZYGOTOWANA',
      'Umowa i zaliczka': 'CRM_OFERTA_ZAAKCEPTOWANA',
      'Termin montażu': 'CRM_ZALICZKA_MONTAZ',
      'Dokumenty OSD': 'CRM_PROCEDURA_OSD',
    };
    for (const [name, code] of Object.entries(ruleTargets)) {
      const triggerStageId = stageIds.get(code);
      if (triggerStageId) await tx.workflowRule.updateMany({ where: { name }, data: { triggerStageId } });
    }

    return { stageIds: Object.fromEntries(stageIds), remapped };
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
