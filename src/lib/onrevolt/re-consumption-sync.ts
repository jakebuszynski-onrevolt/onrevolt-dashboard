import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { writeAuditLog } from './audit';
import { type EnergyMeasurementWorkbookInfo } from './energy-measurement-document';
import { prisma } from './prisma';
import {
  inspectReConsumptionWorkbook,
  preflightReConsumptionWorkbook,
  ReConsumptionConflictError,
  uploadReConsumptionWorkbook,
  validateReConsumptionPeriod,
  type ReConsumptionPreflight,
} from './re-consumption-api';
import { resolveReStation, type ResolvedReStation } from './re-stations';
import { readProjectAnalysisPeriod } from './project-analysis-period-server';
import { readProjectReferenceProfileSelection, resolveSelectedReferenceProfile } from './project-reference-profile';
import { syncProjectReferenceLoadProfile, type ReReferenceProfileSyncResult } from './re-reference-profile';

export type ReConsumptionSyncResult = {
  status: 'synced' | 'existing' | 'failed';
  station: string | null;
  message: string;
};
export type ReConsumptionSyncOptions = {
  clientId?: string;
  projectId?: string;
  actorId?: string | null;
  replaceExisting?: boolean;
};

/** Replays the current CRM selection when a dashboard station link becomes available. */
export async function syncProjectReferenceProfileAfterLink(input: {
  clientId: string;
  projectId: string;
  actorId?: string | null;
  crmDb?: Prisma.TransactionClient;
}): Promise<ReReferenceProfileSyncResult | null> {
  try {
    const db = input.crmDb ?? prisma;
    const selection = await readProjectReferenceProfileSelection(input.projectId, db);
    if (selection.revision <= 0) return null;
    const referenceProfile = await resolveSelectedReferenceProfile(selection);
    const audit = await db.energyAudit.findFirst({
      where: { projectId: input.projectId, profileSource: 'ANNUAL_DECLARATION', annualConsumptionKwh: { not: null } },
      orderBy: { updatedAt: 'desc' },
      select: { annualConsumptionKwh: true },
    });
    if (!audit || audit.annualConsumptionKwh === null) {
      return { status: 'skipped', station: null, retryAllowed: false,
        message: 'Brak rocznej deklaracji zużycia w projekcie; profil RE zostanie zsynchronizowany po jej zapisaniu.' };
    }
    return await syncProjectReferenceLoadProfile({
      projectId: input.projectId,
      clientId: input.clientId,
      actorId: input.actorId,
      annualKwh: Number(audit.annualConsumptionKwh),
      referenceProfile,
      crmDb: db,
    });
  } catch (error) {
    return { status: 'failed', station: null, retryAllowed: true,
      message: `Nie udało się odtworzyć wybranego profilu po przypisaniu stacji RE: ${error instanceof Error ? error.message : String(error)}.` };
  }
}

const reErrorPrefix = '[RE] ';
export class ReStationRequiredError extends Error {
  constructor() {
    super('Brak przypisanej stacji RE. Najpierw przypisz stację w zakładce EMS, a następnie ponów import danych pomiarowych.');
    this.name = 'ReStationRequiredError';
  }
}
const transactionOptions = { maxWait: 120_000, timeout: 120_000 };
const projectSelect = { id: true, clientId: true, dashboardStation: true, dashboardStationNumber: true } as const;
type ProjectLink = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

async function findProject(clientId: string, projectId?: string) {
  if (!clientId.trim()) throw new Error('Brak identyfikatora klienta');
  const projects = await prisma.project.findMany({
    where: { clientId, ...(projectId ? { id: projectId } : {}) },
    select: projectSelect,
    take: 2,
  });
  if (!projects.length) throw new Error('Nie znaleziono projektu klienta; najpierw utwórz projekt');
  if (projects.length !== 1) throw new Error('Klient ma kilka projektów; wskaż projectId dla profilu RE');
  return projects[0];
}

async function lockProject(tx: Prisma.TransactionClient, clientId: string, projectId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM Project WHERE id = ${projectId} AND clientId = ${clientId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new Error('Nie znaleziono projektu tego klienta');
  return tx.project.findUniqueOrThrow({ where: { id: projectId }, select: projectSelect });
}

/** Lock and compare the pre-link station snapshot before changing a CRM association. */
export async function assertProjectStationSnapshot(
  tx: Prisma.TransactionClient,
  input: { clientId: string; projectId: string; expected: { dashboardStation: string | null; dashboardStationNumber: string | null } },
) {
  const project = await lockProject(tx, input.clientId, input.projectId);
  if ((project.dashboardStation ?? null) !== input.expected.dashboardStation
    || (project.dashboardStationNumber ?? null) !== input.expected.dashboardStationNumber) {
    throw new Error('Powiązanie stacji RE zmieniło się podczas zapisu; odśwież projekt i ponów operację');
  }
  return project;
}

/** Reacquire the project lock after a committed link, verify its exact target, then replay the latest selection. */
export async function replayProjectReferenceProfileForLinkedStation(input: {
  clientId: string;
  projectId: string;
  stationHash: string | null;
  stationNumber: string | null;
  actorId?: string | null;
}): Promise<ReReferenceProfileSyncResult | null> {
  return prisma.$transaction(async tx => {
    const project = await lockProject(tx, input.clientId, input.projectId);
    if ((project.dashboardStation ?? null) !== input.stationHash || (project.dashboardStationNumber ?? null) !== input.stationNumber) {
      throw new Error('Powiązanie stacji RE zmieniło się przed odtworzeniem profilu; sprawdź projekt i ponów operację');
    }
    if (!input.stationHash && !input.stationNumber) return null;
    return syncProjectReferenceProfileAfterLink({ ...input, crmDb: tx });
  }, transactionOptions);
}

/** Commit a station link before opening a second locked transaction for RE replay. */
export async function commitProjectStationLinkAndReplay(input: {
  clientId: string;
  projectId: string;
  expected: { dashboardStation: string | null; dashboardStationNumber: string | null };
  station: { stationHash: string; station: string; weatherStation: string | null };
  actorId?: string | null;
}) {
  const updatedProject = await prisma.$transaction(async tx => {
    await assertProjectStationSnapshot(tx, { clientId: input.clientId, projectId: input.projectId, expected: input.expected });
    return tx.project.update({
      where: { id: input.projectId },
      data: {
        dashboardStation: input.station.stationHash,
        dashboardStationNumber: input.station.station,
        weatherStationNumber: input.station.weatherStation,
      },
    });
  }, transactionOptions);
  let referenceProfileSync: ReReferenceProfileSyncResult | null;
  try {
    referenceProfileSync = await replayProjectReferenceProfileForLinkedStation({
      clientId: input.clientId,
      projectId: input.projectId,
      stationHash: input.station.stationHash,
      stationNumber: input.station.station,
      actorId: input.actorId,
    });
  } catch (error) {
    referenceProfileSync = {
      status: 'failed', station: input.station.station, retryAllowed: true,
      message: `Stację zapisano w CRM, ale nie udało się odtworzyć wybranego profilu RE: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }
  return { updatedProject, referenceProfileSync };
}

async function resolveProjectStation(project: ProjectLink): Promise<ResolvedReStation | null> {
  const ref = project.dashboardStation?.trim() || project.dashboardStationNumber?.trim();
  if (!ref) return null;
  const station = await resolveReStation(ref);
  if (!station) throw new Error('Powiązana stacja RE nie istnieje; popraw powiązanie projektu');
  if (project.dashboardStationNumber && project.dashboardStationNumber.trim() !== station.station) {
    throw new Error('Numer i token stacji RE w projekcie wskazują różne stacje');
  }
  return station;
}

export async function requireProjectReStation(clientId: string, projectId?: string): Promise<ResolvedReStation> {
  const project = await findProject(clientId, projectId);
  const station = await resolveProjectStation(project);
  if (!station) throw new ReStationRequiredError();
  return station;
}

export async function ensureProjectReStation(clientId: string, projectId: string): Promise<ResolvedReStation> {
  if (!projectId?.trim()) throw new Error('Brak projectId dla powiązania stacji RE');
  return prisma.$transaction(async (tx) => {
    const project = await lockProject(tx, clientId, projectId);
    const station = await resolveProjectStation(project);
    if (!station) throw new ReStationRequiredError();
    if (project.dashboardStation !== station.stationHash || project.dashboardStationNumber !== station.station) {
      await tx.project.update({
        where: { id: projectId },
        data: { dashboardStation: station.stationHash, dashboardStationNumber: station.station },
      });
    }
    return station;
  }, transactionOptions);
}

// No station is created here. The legacy RE GET can rebuild a missing hourly profile.
export async function preflightProjectReConsumption(input: {
  clientId: string;
  projectId?: string;
  workbook: EnergyMeasurementWorkbookInfo;
  replaceExisting?: boolean;
}): Promise<ReConsumptionPreflight> {
  const project = await findProject(input.clientId, input.projectId);
  const periodResult = await readProjectAnalysisPeriod(project.id);
  if (!periodResult) throw new Error('Nie znaleziono projektu dla okresu analizy RE');
  validateReConsumptionPeriod(input.workbook, new Date(), periodResult?.period.periodKeys);
  const station = await requireProjectReStation(input.clientId, project.id);
  return preflightReConsumptionWorkbook({ ...input, station: station.station }, { periodKeys: periodResult.period.periodKeys });
}

const measurementInclude = {
  document: true,
  account: { select: { clientId: true, projectId: true } },
} as const;
type StoredMeasurement = Prisma.EnergyMeasurementFileGetPayload<{ include: typeof measurementInclude }>;

function checkScope(measurement: StoredMeasurement, options: ReConsumptionSyncOptions) {
  if (options.clientId && measurement.clientId !== options.clientId) throw new Error('Plik nie należy do wskazanego klienta');
  if (measurement.account.clientId !== measurement.clientId
    || (measurement.document && measurement.document.clientId !== measurement.clientId)) {
    throw new Error('Niespójne powiązanie klienta w danych pomiarowych');
  }
  const projectIds = [measurement.projectId, measurement.account.projectId, measurement.document?.projectId, options.projectId].filter(Boolean);
  if (new Set(projectIds).size > 1) throw new Error('Plik nie należy do wskazanego projektu lub ma niespójne powiązania');
  return projectIds[0];
}

function assertInside(root: string, target: string) {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Ścieżka dokumentu wychodzi poza katalog plików CRM');
  }
}

async function inspectStoredMeasurement(measurement: StoredMeasurement, now = new Date(), periodKeys?: readonly string[]) {
  if (!['ACTIVE_IMPORT', 'ACTIVE_EXPORT'].includes(measurement.kind) || measurement.status !== 'DOWNLOADED') {
    throw new Error('RE wymaga pobranego pliku DOWNLOADED energii czynnej pobranej lub oddanej');
  }
  const document = measurement.document;
  if (!document?.storagePath) throw new Error('Brak dokumentu XLSX powiązanego z pomiarem');
  if (measurement.storagePath && measurement.storagePath !== document.storagePath) throw new Error('Niezgodne ścieżki dokumentu i pomiaru');
  if (!/\.xlsx$/i.test(document.fileName)) throw new Error('Dokument pomiarowy nie jest plikiem XLSX');
  const uploadDir = process.env.ONREVOLT_UPLOAD_DIR?.trim();
  if (!uploadDir) throw new Error('Brak ONREVOLT_UPLOAD_DIR dla odczytu XLSX');
  if (path.isAbsolute(document.storagePath) || path.win32.isAbsolute(document.storagePath)
    || document.storagePath.includes(':')) throw new Error('Nieprawidłowa względna ścieżka dokumentu');
  const root = path.resolve(uploadDir);
  const target = path.resolve(root, document.storagePath);
  assertInside(root, target);
  const realRoot = await realpath(root);
  const realTarget = await realpath(target);
  assertInside(realRoot, realTarget);
  const metadata = await stat(realTarget);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > 25 * 1024 * 1024) throw new Error('Nieprawidłowy plik XLSX (limit 25 MB)');
  const bytes = await readFile(realTarget);
  if (bytes.length !== document.sizeBytes) throw new Error('Rozmiar XLSX nie zgadza się z zapisanym dokumentem');
  if (!document.sha256 || createHash('sha256').update(bytes).digest('hex') !== document.sha256.toLowerCase()) {
    throw new Error('SHA-256 XLSX nie zgadza się z zapisanym dokumentem');
  }
  const workbook = inspectReConsumptionWorkbook(bytes, now, periodKeys);
  if (workbook.kind !== measurement.kind || workbook.periodYear !== measurement.periodYear || workbook.periodMonth !== measurement.periodMonth) {
    throw new Error('Kierunek lub miesiąc XLSX nie zgadza się z rekordem pomiaru CRM');
  }
  return { bytes, workbook, fileName: document.fileName };
}

// Read-only CRM/filesystem validation, also used by CLI dry-run. Never calls RE.
export async function inspectStoredEnergyMeasurementForRe(measurementId: string, options: ReConsumptionSyncOptions = {}) {
  const measurement = await prisma.energyMeasurementFile.findUniqueOrThrow({ where: { id: measurementId }, include: measurementInclude });
  const projectId = checkScope(measurement, options);
  const project = await findProject(measurement.clientId, projectId);
  const periodResult = await readProjectAnalysisPeriod(project.id);
  if (!periodResult) throw new Error('Nie znaleziono projektu dla okresu analizy RE');
  return { measurement, project, ...await inspectStoredMeasurement(measurement, new Date(), periodResult.period.periodKeys) };
}

export async function listReConsumptionMeasurements(clientId: string, projectId?: string) {
  const project = await findProject(clientId, projectId);
  const periodResult = await readProjectAnalysisPeriod(project.id);
  if (!periodResult) throw new Error('Nie znaleziono projektu dla okresu analizy RE');
  const selectedPeriods = periodResult.period.periodKeys;
  const periods = selectedPeriods.map((period) => {
    const [periodYear, periodMonth] = period.split('-').map(Number);
    return { periodYear, periodMonth };
  });
  const measurements = await prisma.energyMeasurementFile.findMany({
    where: {
      clientId,
      kind: { in: ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'] },
      status: 'DOWNLOADED',
      AND: [
        { OR: periods },
        { OR: [{ projectId: project.id }, { projectId: null }] },
        { account: { clientId, OR: [{ projectId: project.id }, { projectId: null }] } },
        { OR: [{ document: null }, { document: { clientId, OR: [{ projectId: project.id }, { projectId: null }] } }] },
      ],
    },
    select: { id: true, kind: true, periodYear: true, periodMonth: true, fileName: true, error: true },
    orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }, { kind: 'asc' }, { id: 'asc' }],
  });
  return { project, measurements };
}

export async function syncEnergyMeasurementToRe(measurementId: string, options: ReConsumptionSyncOptions = {}): Promise<ReConsumptionSyncResult> {
  let station: string | null = null;
  let measurement: StoredMeasurement | undefined;
  let errorVersion: Date | undefined;
  try {
    const loaded = await prisma.energyMeasurementFile.findUniqueOrThrow({ where: { id: measurementId }, include: measurementInclude });
    const projectId = checkScope(loaded, options);
    // Only an authorized, scope-checked record may receive an error message.
    measurement = loaded;
    errorVersion = loaded.updatedAt;
    const project = await findProject(loaded.clientId, projectId);
    const analysisPeriodResult = await readProjectAnalysisPeriod(project.id);
    if (!analysisPeriodResult) throw new Error('Nie znaleziono projektu dla okresu analizy RE');
    await inspectStoredMeasurement(loaded, new Date(), analysisPeriodResult.period.periodKeys);
    const linkedStation = await ensureProjectReStation(loaded.clientId, project.id);
    station = linkedStation.station;

    return await prisma.$transaction(async (tx) => {
      const locked = await lockProject(tx, loaded.clientId, project.id);
      if (locked.dashboardStationNumber !== station || locked.dashboardStation !== linkedStation.stationHash) {
        throw new Error('Powiązanie RE zmieniło się podczas synchronizacji; ponów po sprawdzeniu projektu');
      }
      const lockedPeriodResult = await readProjectAnalysisPeriod(project.id);
      if (!lockedPeriodResult) throw new Error('Nie znaleziono projektu dla okresu analizy RE');
      const current = await prisma.energyMeasurementFile.findUniqueOrThrow({ where: { id: measurementId }, include: measurementInclude });
      checkScope(current, { ...options, clientId: loaded.clientId, projectId: project.id });
      if (current.documentId !== loaded.documentId) throw new Error('Dokument pomiaru zmienił się podczas synchronizacji');
      measurement = current;
      errorVersion = current.updatedAt;
      const { bytes, workbook, fileName } = await inspectStoredMeasurement(current, new Date(), lockedPeriodResult.period.periodKeys);
      const preflight = await preflightReConsumptionWorkbook({ station, workbook, replaceExisting: options.replaceExisting }, { periodKeys: lockedPeriodResult.period.periodKeys });
      if (preflight.status === 'existing') {
        if (current.error?.startsWith(reErrorPrefix)) throw new Error('Poprzednia synchronizacja wymaga weryfikacji. Potwierdź zastąpienie profilu w RE.');
        return { status: 'existing', station, message: preflight.message };
      }

      // Commit a pending marker before HTTP, independently of the project lock transaction.
      const pending = `${reErrorPrefix}Oczekiwanie na potwierdzenie importu. Przy ponowieniu potwierdź zastąpienie profilu w RE.`;
      const marked = await prisma.energyMeasurementFile.update({
        where: { id: measurementId, documentId: current.documentId, updatedAt: current.updatedAt, status: 'DOWNLOADED' },
        data: { error: pending },
      });
      errorVersion = marked.updatedAt;
      try {
        const result = await uploadReConsumptionWorkbook({ station, bytes, fileName, replaceExisting: options.replaceExisting }, { periodKeys: lockedPeriodResult.period.periodKeys });
        await writeAuditLog({
          actorId: options.actorId, clientId: current.clientId,
          entityType: 'EnergyMeasurementFile', entityId: measurementId, action: 'SYNC_RE_CONSUMPTION_XLSX',
          after: { station, projectId: project.id, documentId: current.documentId, sha256: current.document.sha256, workbook: result.workbook, replaceExisting: options.replaceExisting === true },
        });
        const updated = await prisma.energyMeasurementFile.updateMany({
          where: { id: measurementId, documentId: current.documentId, status: 'DOWNLOADED', error: pending, updatedAt: marked.updatedAt },
          data: { error: current.error?.startsWith(reErrorPrefix) ? null : current.error },
        });
        if (updated.count !== 1) throw new Error('RE potwierdziło import, ale rekord CRM zmienił się; sprawdź powiązany plik');
        return { status: 'synced', station, message: `RE: zapisano ${workbook.kind === 'ACTIVE_IMPORT' ? 'pobór' : 'oddanie'} ${workbook.periodYear}-${String(workbook.periodMonth).padStart(2, '0')} (${workbook.totalKwh} kWh)` };
      } catch (error) {
        if (error instanceof ReConsumptionConflictError && !current.error?.startsWith(reErrorPrefix)) {
          const restored = await prisma.energyMeasurementFile.updateMany({
            where: { id: measurementId, documentId: current.documentId, error: pending, updatedAt: marked.updatedAt }, data: { error: current.error },
          });
          if (restored.count !== 1) throw new Error('Konflikt RE oraz zmiana rekordu CRM; sprawdź plik');
          return { status: 'existing', station, message: error.message };
        }
        throw error;
      }
    }, transactionOptions);
  } catch (error) {
    let message = `${reErrorPrefix}${error instanceof Error ? error.message : String(error)}`;
    if (measurement) {
      try {
        const updated = await prisma.energyMeasurementFile.updateMany({
          where: { id: measurement.id, clientId: measurement.clientId, documentId: measurement.documentId, updatedAt: errorVersion },
          data: { error: message },
        });
        if (updated.count !== 1) message += ' Nie zapisano błędu: dokument CRM został zmieniony lub usunięty.';
      } catch {
        message += ' Nie udało się zapisać błędu w CRM.';
      }
    }
    return { status: 'failed', station, message };
  }
}
