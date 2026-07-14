import { ProjectStatus } from '@prisma/client';

export const operationalPipelineStages = [
  { code: 'CRM_LEAD', name: 'Lead', sortOrder: 10, color: '#7C3AED', status: 'LEAD', isTerminal: false, requiresOwner: false, requiresNextAction: true },
  { code: 'CRM_CZEKA_NA_KALKULACJE', name: 'Czeka na kalkulację', sortOrder: 20, color: '#2563EB', status: 'CZEKA_NA_KALKULACJE', isTerminal: false, requiresOwner: true, requiresNextAction: true },
  { code: 'CRM_W_TRAKCIE_OBSLUGI', name: 'W trakcie obsługi', sortOrder: 30, color: '#0EA5E9', status: 'W_TRAKCIE_OBSLUGI', isTerminal: false, requiresOwner: true, requiresNextAction: true },
  { code: 'CRM_OFERTA_PRZYGOTOWANA', name: 'Oferta przygotowana', sortOrder: 40, color: '#F59E0B', status: 'OFERTA_PRZYGOTOWANA', isTerminal: false, requiresOwner: true, requiresNextAction: true },
  { code: 'CRM_OFERTA_ZAAKCEPTOWANA', name: 'Zaakceptowano ofertę', sortOrder: 50, color: '#16A34A', status: 'OFERTA_ZAAKCEPTOWANA', isTerminal: false, requiresOwner: true, requiresNextAction: true },
  { code: 'CRM_ZALICZKA_MONTAZ', name: 'Wpłacono zaliczkę / montaż', sortOrder: 60, color: '#059669', status: 'ZALICZKA_MONTAZ', isTerminal: false, requiresOwner: true, requiresNextAction: true },
  { code: 'CRM_PROCEDURA_OSD', name: 'Zamontowano / procedura OSD', sortOrder: 70, color: '#0284C7', status: 'PROCEDURA_OSD', isTerminal: false, requiresOwner: true, requiresNextAction: true },
  { code: 'CRM_ZAKONCZONY', name: 'Protokół odbioru / zakończono', sortOrder: 80, color: '#15803D', status: 'ZAKONCZONY', isTerminal: true, requiresOwner: true, requiresNextAction: false },
  { code: 'CRM_SERWIS', name: 'Serwis', sortOrder: 90, color: '#DC2626', status: 'SERWIS', isTerminal: false, requiresOwner: true, requiresNextAction: true },
] as const satisfies ReadonlyArray<{
  code: string;
  name: string;
  sortOrder: number;
  color: string;
  status: ProjectStatus;
  isTerminal?: boolean;
  requiresOwner?: boolean;
  requiresNextAction?: boolean;
}>;

export type OperationalPipelineStageCode = typeof operationalPipelineStages[number]['code'];

export const operationalPipelineStageCodes = operationalPipelineStages.map((stage) => stage.code);

export const projectStatusStageCode: Partial<Record<ProjectStatus, OperationalPipelineStageCode>> = {
  LEAD: 'CRM_LEAD',
  CZEKA_NA_KALKULACJE: 'CRM_CZEKA_NA_KALKULACJE',
  W_TRAKCIE_OBSLUGI: 'CRM_W_TRAKCIE_OBSLUGI',
  OFERTA_PRZYGOTOWANA: 'CRM_OFERTA_PRZYGOTOWANA',
  OFERTA_ZAAKCEPTOWANA: 'CRM_OFERTA_ZAAKCEPTOWANA',
  ZALICZKA_MONTAZ: 'CRM_ZALICZKA_MONTAZ',
  PROCEDURA_OSD: 'CRM_PROCEDURA_OSD',
  ODBIOR: 'CRM_ZAKONCZONY',
  ZAKONCZONY: 'CRM_ZAKONCZONY',
  SERWIS: 'CRM_SERWIS',
};

export function isOperationalPipelineStageCode(code: string | null | undefined): code is OperationalPipelineStageCode {
  return Boolean(code && operationalPipelineStageCodes.includes(code as OperationalPipelineStageCode));
}
