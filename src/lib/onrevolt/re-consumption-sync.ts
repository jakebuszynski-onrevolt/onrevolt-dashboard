import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { writeAuditLog } from './audit';
import { closedMeasurementPeriodKeys, type EnergyMeasurementWorkbookInfo } from './energy-measurement-document';
import { prisma } from './prisma';
import {
  inspectReConsumptionWorkbook,
  preflightReConsumptionWorkbook,
  ReConsumptionConflictError,
  uploadReConsumptionWorkbook,
  validateReConsumptionPeriod,
  type ReConsumptionPreflight,
} from './re-consumption-api';
import { createReStation, resolveReStation, type ResolvedReStation } from './re-stations';

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

const reErrorPrefix = '[RE] ';
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

export async function ensureProjectReStation(clientId: string, projectId: string): Promise<ResolvedReStation> {
  if (!projectId?.trim()) throw new Error('Brak projectId dla tworzenia stacji RE');
  return prisma.$transaction(async (tx) => {
    const project = await lockProject(tx, clientId, projectId);
    let station = await resolveProjectStation(project);
    if (!station) {
      const context = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        select: {
          client: { select: { displayName: true } },
          investmentSite: { select: { latitude: true, longitude: true } },
          energyAudits: { select: { profileSource: true, annualConsumptionKwh: true, existingPvKw: true }, take: 1 },
        },
      });
      const audit = context.energyAudits[0];
      const site = context.investmentSite;
      const initialProfile = {
        displayName: context.client.displayName,
        ...(audit && audit.profileSource !== 'OPERATOR_HOURLY' && audit.annualConsumptionKwh != null
          ? { annualUsageKwh: Number(audit.annualConsumptionKwh) } : {}),
        ...(audit?.existingPvKw != null ? { pvSizeKwp: Number(audit.existingPvKw) } : {}),
        ...(site?.latitude != null && site.longitude != null ? { lat: Number(site.latitude), lon: Number(site.longitude) } : {}),
        simulationStartDate: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)),
      };
      station = await createReStation(initialProfile);
    }
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
  validateReConsumptionPeriod(input.workbook);
  const project = await findProject(input.clientId, input.projectId);
  const station = await resolveProjectStation(project);
  if (!station) return { status: 'ready', station: null, message: 'Stacja RE zostanie utworzona przy synchronizacji pierwszego XLSX' };
  return preflightReConsumptionWorkbook({ ...input, station: station.station });
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

async function inspectStoredMeasurement(measurement: StoredMeasurement, now = new Date()) {
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
  const workbook = inspectReConsumptionWorkbook(bytes, now);
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
  return { measurement, project, ...await inspectStoredMeasurement(measurement) };
}

export async function listReConsumptionMeasurements(clientId: string, projectId?: string) {
  const project = await findProject(clientId, projectId);
  const periods = Array.from(closedMeasurementPeriodKeys()).map((period) => {
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
    await inspectStoredMeasurement(loaded);
    const linkedStation = await ensureProjectReStation(loaded.clientId, project.id);
    station = linkedStation.station;

    return await prisma.$transaction(async (tx) => {
      const locked = await lockProject(tx, loaded.clientId, project.id);
      if (locked.dashboardStationNumber !== station || locked.dashboardStation !== linkedStation.stationHash) {
        throw new Error('Powiązanie RE zmieniło się podczas synchronizacji; ponów po sprawdzeniu projektu');
      }
      const current = await prisma.energyMeasurementFile.findUniqueOrThrow({ where: { id: measurementId }, include: measurementInclude });
      checkScope(current, { ...options, clientId: loaded.clientId, projectId: project.id });
      if (current.documentId !== loaded.documentId) throw new Error('Dokument pomiaru zmienił się podczas synchronizacji');
      measurement = current;
      errorVersion = current.updatedAt;
      const { bytes, workbook, fileName } = await inspectStoredMeasurement(current);
      const preflight = await preflightReConsumptionWorkbook({ station, workbook, replaceExisting: options.replaceExisting });
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
        const result = await uploadReConsumptionWorkbook({ station, bytes, fileName, replaceExisting: options.replaceExisting });
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
