import { prisma } from './prisma';
import { writeAuditLog } from './audit';
import { resolveReStation } from './re-stations';
import {
  readReConsumptionProfile,
  saveReConsumptionProfile,
  type ReConsumptionProfile,
  type ReConsumptionSource,
} from './re-consumption-api';

export type ReDeclarationSyncResult = {
  status: 'synced' | 'skipped' | 'failed';
  station: string | null;
  message: string;
  retryAllowed: boolean;
  changedMonths?: number[];
  profileAnnualUsageKwh?: number | null;
};

const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function shouldSyncReConsumptionDeclaration(input: {
  annualWasProvided: boolean;
  previousAnnual: number | null;
  annual: number | null;
  profileSource: string;
  retry?: boolean;
}) {
  return input.annualWasProvided && input.annual !== null && Number.isFinite(input.annual) && input.annual >= 0
    && input.profileSource !== 'OPERATOR_HOURLY'
    && (input.retry === true || input.previousAnnual !== input.annual);
}

export function mergeReConsumptionDeclaration(profile: ReConsumptionProfile, annual: number) {
  if (!Number.isFinite(annual) || annual < 0) throw new Error('Nieprawidłowa roczna deklaracja zużycia');
  const validSources = (value: ReConsumptionSource[] | null) => value === null || (
    Array.isArray(value) && value.length === 12 && value.every(source => ['standard', 'manual', 'xlsx'].includes(source))
  );
  if (!validSources(profile.sources) || !validSources(profile.exportSources)
    || (profile.months === null) !== (profile.sources === null)
    || (profile.months === null) !== (profile.exportSources === null)
    || (profile.months !== null && (!Array.isArray(profile.months) || profile.months.length !== 12
      || profile.months.some(value => !Number.isFinite(value) || value < 0)))) {
    throw new Error('Nieprawidłowy profil źródłowy RE; deklaracja nie została zastosowana');
  }
  const months = profile.months ? [...profile.months] : Array<number>(12).fill(0);
  const sources: ReConsumptionSource[] = profile.sources ? [...profile.sources] : Array(12).fill('standard');
  const changedMonths: number[] = [];
  for (let index = 0; index < 12; index++) {
    if (sources[index] !== 'standard') continue;
    // RE stores a 365-day pattern; do not redistribute protected months to force an annual total.
    const declared = Math.round(annual * monthDays[index] / 365 * 1000) / 1000;
    if (profile.months === null || months[index] !== declared) changedMonths.push(index + 1);
    months[index] = declared;
  }
  return { months, sources, changedMonths };
}

export async function syncProjectReConsumptionDeclaration(input: {
  clientId: string;
  projectId: string;
  auditId: string;
  annualConsumptionKwh: number;
  actorId?: string | null;
}): Promise<ReDeclarationSyncResult> {
  let station: string | null = null;
  let scopeVerified = false;
  let retryAllowed = true;
  let requestId: string | undefined;
  const skipped = (message: string): ReDeclarationSyncResult => ({ status: 'skipped', station, message, retryAllowed: false });
  try {
    if (!Number.isFinite(input.annualConsumptionKwh) || input.annualConsumptionKwh < 0) {
      retryAllowed = false;
      throw new Error('Nieprawidłowa roczna deklaracja zużycia');
    }
    return await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM Project WHERE id = ${input.projectId} AND clientId = ${input.clientId} FOR UPDATE
      `;
      if (rows.length !== 1) { retryAllowed = false; throw new Error('Nie znaleziono projektu tego klienta'); }
      const project = await tx.project.findUniqueOrThrow({ where: { id: input.projectId },
        select: { dashboardStation: true, dashboardStationNumber: true } });
      const audit = await tx.energyAudit.findUnique({ where: { id: input.auditId },
        select: { projectId: true, annualConsumptionKwh: true, profileSource: true } });
      if (!audit || audit.projectId !== input.projectId) { retryAllowed = false; throw new Error('Audyt nie należy do wskazanego projektu'); }
      scopeVerified = true;
      if (audit.profileSource === 'OPERATOR_HOURLY' || audit.annualConsumptionKwh === null
        || Number(audit.annualConsumptionKwh) !== input.annualConsumptionKwh) {
        return skipped('Deklaracja została zastąpiona nowszym zapisem audytu; nie zmieniono RE.');
      }
      const ref = project.dashboardStation?.trim() || project.dashboardStationNumber?.trim();
      if (!ref) return skipped('Deklarację zapisano w CRM. Projekt nie ma powiązanej stacji RE.');
      const resolved = await resolveReStation(ref);
      if (!resolved || (project.dashboardStationNumber && project.dashboardStationNumber.trim() !== resolved.station)) {
        throw new Error('Nieprawidłowe powiązanie stacji RE w projekcie');
      }
      station = resolved.station;
      const before = await readReConsumptionProfile(station);
      const merged = mergeReConsumptionDeclaration(before, input.annualConsumptionKwh);
      if (!merged.changedMonths.length) {
        await writeAuditLog({ actorId: input.actorId, clientId: input.clientId, entityType: 'EnergyAudit', entityId: input.auditId,
          action: 'RE_DECLARATION_VERIFIED', after: { projectId: input.projectId, station,
            declaredAnnualKwh: input.annualConsumptionKwh, profileAnnualUsageKwh: before.annualUsageKwh } });
        return skipped('Nie zmieniono RE: miesiące standard są aktualne albo profil zawiera wyłącznie chronione miesiące.');
      }

      const request = await writeAuditLog({
        actorId: input.actorId, clientId: input.clientId, entityType: 'EnergyAudit', entityId: input.auditId,
        action: 'RE_DECLARATION_REQUEST',
        before: { months: before.months, sources: before.sources, exportSources: before.exportSources, annualUsageKwh: before.annualUsageKwh },
        after: { projectId: input.projectId, station, declaredAnnualKwh: input.annualConsumptionKwh, ...merged },
      });
      requestId = request.id;
      const after = await saveReConsumptionProfile(station, merged.months, merged.sources);
      const expectedExport = before.exportSources ?? Array(12).fill('standard');
      if (JSON.stringify(after.exportSources) !== JSON.stringify(expectedExport)) {
        throw new Error('Podczas zapisu zmieniły się źródła energii oddanej w RE; sprawdź profil przed ponowieniem');
      }
      await writeAuditLog({
        actorId: input.actorId, clientId: input.clientId, entityType: 'EnergyAudit', entityId: input.auditId,
        action: 'RE_DECLARATION_SYNCED', after: { requestId, projectId: input.projectId, station,
          declaredAnnualKwh: input.annualConsumptionKwh, profileAnnualUsageKwh: after.annualUsageKwh, changedMonths: merged.changedMonths },
      });
      return { status: 'synced', station, retryAllowed: false, changedMonths: merged.changedMonths,
        profileAnnualUsageKwh: after.annualUsageKwh,
        message: 'Zaktualizowano standardowe miesiące RE. Zachowano miesiące XLSX, ręczne, energię oddaną i pomiary rzeczywiste.' };
    }, { maxWait: 120_000, timeout: 120_000 });
  } catch (error) {
    let message = `Nie potwierdzono zapisu deklaracji w RE: ${error instanceof Error ? error.message : String(error)}. Deklaracja CRM pozostaje zapisana.`;
    if (scopeVerified) {
      try {
        await writeAuditLog({ actorId: input.actorId, clientId: input.clientId, entityType: 'EnergyAudit', entityId: input.auditId,
          action: 'RE_DECLARATION_FAILED', after: { requestId, projectId: input.projectId, station,
            declaredAnnualKwh: input.annualConsumptionKwh, message } });
      } catch {
        message += ' Nie udało się również zapisać historii błędu.';
      }
    }
    return { status: 'failed', station, message, retryAllowed };
  }
}
