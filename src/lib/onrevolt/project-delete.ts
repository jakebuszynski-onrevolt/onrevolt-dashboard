export const projectDeleteRelationLabels = {
  tasks: 'zadania', reminders: 'przypomnienia', existingAssets: 'urządzenia klienta',
  configurations: 'konfiguracje', offers: 'oferty', offerCalculationSnapshots: 'wyniki kalkulacji',
  contracts: 'umowy', installations: 'montaże', documents: 'dokumenty',
  energyPortalAccounts: 'konta operatora / PPE', energyMeasurementFiles: 'pliki pomiarowe',
  activities: 'aktywności i notatki', energyAudits: 'dane energetyczne', siteAudits: 'wizje lokalne',
  purchaseOrders: 'zamówienia', stockReservations: 'rezerwacje magazynowe', serviceTickets: 'zgłoszenia serwisowe',
} as const;

// Values seeded by the empty energy form are not evidence of a completed audit.
const emptyAuditDefaults: Record<string, unknown> = {
  status: 'DRAFT', profileSource: 'ANNUAL_DECLARATION', phaseCount: 3,
  roofType: 'UNKNOWN', roofOrientation: 'S',
};

export function isEmptyProjectEnergyAudit(audit: Record<string, any>): boolean {
  if (!audit._count || audit._count.scenarios !== 0) return false;
  return Object.entries(audit).every(([key, value]) => {
    if (['id', 'projectId', 'createdAt', 'updatedAt', '_count'].includes(key)) return true;
    if (key in emptyAuditDefaults && value === emptyAuditDefaults[key]) return true;
    return value == null || value === '';
  });
}

export function projectEnergyAccountDisposition(account: Record<string, any>, project: { id: string; clientId: string }) {
  const files: Array<{ projectId: string | null; clientId: string; project: { clientId: string } | null }> | undefined = account.measurementFiles;
  if (!files || account.clientId !== project.clientId) return { kind: 'block' as const };
  if (files.length) {
    const target = files[0].projectId;
    if (target && target !== project.id && files.every(file => file.projectId === target
      && file.clientId === project.clientId && file.project?.clientId === project.clientId)) {
      return { kind: 'reassign' as const, projectId: target };
    }
    return { kind: 'block' as const };
  }
  const metadata = ['id', 'clientId', 'projectId', 'operator', 'createdAt', 'updatedAt', 'measurementFiles'];
  const empty = Object.entries(account).every(([key, value]) => metadata.includes(key) || value == null || value === '');
  return { kind: empty ? 'delete' as const : 'block' as const };
}

export function projectDeleteBlockers(project: {
  _count: Partial<Record<keyof typeof projectDeleteRelationLabels, number>>;
  offerWorkspace?: unknown; odsCase?: unknown;
  dashboardStation?: string | null; dashboardStationNumber?: string | null;
  weatherStationNumber?: string | null; pipedriveDealId?: string | null;
  id?: string; clientId?: string;
  energyAudits?: Array<Record<string, any>>;
  energyPortalAccounts?: Array<Record<string, any>>;
}, hasTariffProfile: boolean): string[] {
  const counts = { ...project._count };
  if (project.energyAudits?.length === counts.energyAudits) {
    counts.energyAudits = project.energyAudits.filter(audit => !isEmptyProjectEnergyAudit(audit)).length;
  }
  if (project.id && project.clientId && project.energyPortalAccounts?.length === counts.energyPortalAccounts) {
    counts.energyPortalAccounts = project.energyPortalAccounts.filter(account =>
      projectEnergyAccountDisposition(account, { id: project.id!, clientId: project.clientId! }).kind === 'block').length;
  }
  const blockers = Object.entries(projectDeleteRelationLabels)
    .filter(([key]) => Number(counts[key]) > 0)
    .map(([key, label]) => `${label}: ${counts[key]}`);
  if (project.offerWorkspace) blockers.push('szkic kreatora oferty');
  if (project.odsCase) blockers.push('formalności OSD');
  if (project.dashboardStation || project.dashboardStationNumber) blockers.push('powiązanie EMS / RE');
  if (project.weatherStationNumber) blockers.push('stacja pogody');
  if (project.pipedriveDealId) blockers.push('powiązanie Pipedrive');
  if (hasTariffProfile) blockers.push('profil taryfowy RE');
  return blockers;
}
