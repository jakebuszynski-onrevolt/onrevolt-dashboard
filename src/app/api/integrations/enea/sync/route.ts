import { createHash, randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, notFound, optionalString, readJsonObject, serverError } from 'lib/onrevolt/api';
import { decryptCredential } from 'lib/onrevolt/credentials';
import {
  downloadEneaMeasurementXlsx,
  eneaMeasurementLabel,
  EneaMeasurementKind,
  getClosedMonths,
  listEneaPpes,
  loginEneaPortal,
  selectEneaPpe,
} from 'lib/onrevolt/enea-portal';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';

const eneaKinds: EneaMeasurementKind[] = ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'];

function syncErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function uploadRoot() {
  const uploadDir = process.env.ONREVOLT_UPLOAD_DIR?.trim();
  if (!uploadDir) throw new Error('Brak ONREVOLT_UPLOAD_DIR dla zapisu plików ENEA');
  return path.resolve(uploadDir);
}

function isInsideDirectory(filePath: string, directory: string) {
  const relative = path.relative(directory, filePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_');
}

function documentType(kind: EneaMeasurementKind) {
  return kind === 'ACTIVE_IMPORT' ? 'ENEA_ZUZYCIE' : 'ENEA_PRODUKCJA';
}

async function storeMeasurementFile(clientId: string, fileName: string, bytes: Buffer) {
  const relativePath = path.join(
    'enea',
    clientId,
    new Date().toISOString().slice(0, 7),
    `${randomUUID()}-${safeFileName(fileName)}`,
  );
  const absolutePath = path.join(uploadRoot(), relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);

  return {
    relativePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function markAccountSync(accountId: string, status: string, message: string) {
  await prisma.energyPortalAccount.update({
    where: { id: accountId },
    data: {
      lastSyncAt: new Date(),
      lastSyncStatus: status,
      lastSyncMessage: message,
    },
  });
}

function requestedMonths(body: Record<string, any>) {
  const periodYear = Number(body.periodYear);
  const periodMonth = Number(body.periodMonth);
  if (Number.isInteger(periodYear) && Number.isInteger(periodMonth) && periodMonth >= 1 && periodMonth <= 12) {
    const lastDay = new Date(Date.UTC(periodYear, periodMonth, 0)).getUTCDate();
    return [{
      year: periodYear,
      month: periodMonth,
      dateFrom: `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`,
      dateTo: `${periodYear}-${String(periodMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    }];
  }

  const monthsRaw = Number(body.months || 12);
  const months = Number.isFinite(monthsRaw) ? Math.min(Math.max(Math.floor(monthsRaw), 1), 24) : 12;
  return getClosedMonths(months);
}

async function existingDownloaded(accountId: string, kind: EneaMeasurementKind, year: number, month: number) {
  const existing = await prisma.energyMeasurementFile.findUnique({
    where: {
      accountId_kind_periodYear_periodMonth: {
        accountId,
        kind: kind as any,
        periodYear: year,
        periodMonth: month,
      },
    },
    include: { document: true },
  });

  return existing?.status === 'DOWNLOADED' && Boolean(existing.documentId || existing.document);
}

async function deleteFileIfLocal(storagePath?: string | null) {
  if (!storagePath) return false;

  const root = uploadRoot();
  const filePath = path.resolve(root, storagePath);
  if (!isInsideDirectory(filePath, root)) {
    throw new Error('Plik ENEA jest poza katalogiem uploadów; usuń go ręcznie po weryfikacji ścieżki');
  }

  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function deleteMeasurementFiles(accountId: string, year: number, month: number) {
  const files = await prisma.energyMeasurementFile.findMany({
    where: { accountId, periodYear: year, periodMonth: month },
    include: { document: true },
  });

  let deletedFiles = 0;
  for (const file of files) {
    const storagePath = file.document?.storagePath || file.storagePath;
    if (await deleteFileIfLocal(storagePath)) deletedFiles += 1;
  }

  const documentIds = files
    .map((file) => file.documentId)
    .filter((id): id is string => Boolean(id));

  await prisma.energyMeasurementFile.deleteMany({
    where: { accountId, periodYear: year, periodMonth: month },
  });

  if (documentIds.length) {
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
  }

  return { records: files.length, files: deletedFiles };
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  let accountId: string | undefined;

  try {
    const body = await readJsonObject(req);
    accountId = optionalString(body, 'accountId');
    const clientId = optionalString(body, 'clientId');
    const force = body.force === true;
    const months = requestedMonths(body);

    const account = accountId
      ? await prisma.energyPortalAccount.findUnique({ where: { id: accountId } })
      : clientId
        ? await prisma.energyPortalAccount.findFirst({
          where: { clientId, operator: 'ENEA' },
          orderBy: { updatedAt: 'desc' },
        })
        : null;

    if (!account) return notFound('Nie znaleziono konta ENEA do synchronizacji');
    if (account.operator !== 'ENEA') return badRequest('Automatyczna synchronizacja jest teraz dostępna tylko dla ENEA');
    if (!account.login || !account.encryptedPassword) {
      return badRequest('Konto ENEA wymaga loginu i zapisanego hasła');
    }

    const password = decryptCredential(account.encryptedPassword);
    const session = await loginEneaPortal(account.login, password);
    const ppes = await listEneaPpes(session);
    const ppe = selectEneaPpe(account, ppes);

    await prisma.energyPortalAccount.update({
      where: { id: account.id },
      data: {
        portalPpeId: String(ppe.id),
        ppeNumber: ppe.ppeNumber || ppe.code || ppe.name || account.ppeNumber,
        meterNumber: ppe.meterNumber || account.meterNumber,
      },
    });

    const downloaded: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];

    for (const month of months) {
      for (const kind of eneaKinds) {
        try {
          if (!force && await existingDownloaded(account.id, kind, month.year, month.month)) {
            skipped.push({
              kind,
              label: eneaMeasurementLabel(kind),
              period: `${month.year}-${String(month.month).padStart(2, '0')}`,
            });
            continue;
          }

          if (force) {
            await prisma.energyMeasurementFile.findUnique({
              where: {
                accountId_kind_periodYear_periodMonth: {
                  accountId: account.id,
                  kind: kind as any,
                  periodYear: month.year,
                  periodMonth: month.month,
                },
              },
              select: { id: true },
            }).then(async (existing) => {
              if (existing) {
                const existingRecord = await prisma.energyMeasurementFile.findUnique({
                  where: { id: existing.id },
                  include: { document: true },
                });
                if (existingRecord) {
                  await deleteFileIfLocal(existingRecord.document?.storagePath || existingRecord.storagePath);
                  await prisma.energyMeasurementFile.delete({ where: { id: existingRecord.id } });
                  if (existingRecord.documentId) {
                    await prisma.document.deleteMany({ where: { id: existingRecord.documentId } });
                  }
                }
              }
            });
          }

          const measurement = await downloadEneaMeasurementXlsx(session, ppe, month, kind);
          const stored = await storeMeasurementFile(account.clientId, measurement.fileName, measurement.bytes);
          const title = `ENEA ${eneaMeasurementLabel(kind)} ${month.year}-${String(month.month).padStart(2, '0')}`;
          const document = await prisma.document.create({
            data: {
              type: documentType(kind) as any,
              title,
              fileName: measurement.fileName,
              mimeType: measurement.mimeType,
              sizeBytes: measurement.bytes.length,
              sha256: stored.sha256,
              storagePath: stored.relativePath,
              clientId: account.clientId,
              projectId: account.projectId,
              notes: `PPE ${ppe.ppeNumber || ppe.code || ppe.name || ppe.id}; Dane po bilansowaniu; agregacja 60 min`,
            },
          });

          await prisma.energyMeasurementFile.upsert({
            where: {
              accountId_kind_periodYear_periodMonth: {
                accountId: account.id,
                kind: kind as any,
                periodYear: month.year,
                periodMonth: month.month,
              },
            },
            update: {
              operator: 'ENEA',
              clientId: account.clientId,
              projectId: account.projectId,
              documentId: document.id,
              storagePath: stored.relativePath,
              fileName: measurement.fileName,
              status: 'DOWNLOADED',
              error: null,
              downloadedAt: new Date(),
            },
            create: {
              accountId: account.id,
              clientId: account.clientId,
              projectId: account.projectId,
              operator: 'ENEA',
              kind: kind as any,
              periodYear: month.year,
              periodMonth: month.month,
              documentId: document.id,
              storagePath: stored.relativePath,
              fileName: measurement.fileName,
              status: 'DOWNLOADED',
              downloadedAt: new Date(),
            },
          });

          downloaded.push({
            kind,
            label: eneaMeasurementLabel(kind),
            period: `${month.year}-${String(month.month).padStart(2, '0')}`,
            documentId: document.id,
            fileName: measurement.fileName,
          });
        } catch (error) {
          const message = syncErrorMessage(error);
          failed.push({
            kind,
            label: eneaMeasurementLabel(kind),
            period: `${month.year}-${String(month.month).padStart(2, '0')}`,
            message,
          });

          await prisma.energyMeasurementFile.upsert({
            where: {
              accountId_kind_periodYear_periodMonth: {
                accountId: account.id,
                kind: kind as any,
                periodYear: month.year,
                periodMonth: month.month,
              },
            },
            update: {
              status: 'FAILED',
              error: message,
              downloadedAt: null,
            },
            create: {
              accountId: account.id,
              clientId: account.clientId,
              projectId: account.projectId,
              operator: 'ENEA',
              kind: kind as any,
              periodYear: month.year,
              periodMonth: month.month,
              status: 'FAILED',
              error: message,
            },
          });
        }
      }
    }

    const status = failed.length ? 'PARTIAL' : 'OK';
    const message = !downloaded.length && skipped.length && !failed.length
      ? `Brak brakujących plików (${skipped.length} już pobranych)`
      : [
        downloaded.length ? `pobrano ${downloaded.length}` : null,
        skipped.length ? `pominięto ${skipped.length} istniejących` : null,
        failed.length ? `błędy ${failed.length}` : null,
      ].filter(Boolean).join(', ') || 'Brak brakujących plików';
    await markAccountSync(account.id, status, message);

    return jsonResponse({
      ok: true,
      data: {
        status,
        message,
        ppe,
        downloaded,
        skipped,
        failed,
      },
    });
  } catch (error) {
    if (accountId) {
      await markAccountSync(accountId, 'FAILED', syncErrorMessage(error)).catch(() => undefined);
    }
    return serverError('Synchronizacja ENEA nie powiodła się', error);
  }
}

export async function DELETE(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const accountId = optionalString(body, 'accountId');
    const periodYear = Number(body.periodYear);
    const periodMonth = Number(body.periodMonth);

    if (!accountId) return badRequest('Brak accountId');
    if (!Number.isInteger(periodYear) || !Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) {
      return badRequest('Podaj poprawny miesiąc do usunięcia');
    }

    const account = await prisma.energyPortalAccount.findUnique({ where: { id: accountId } });
    if (!account) return notFound('Nie znaleziono konta ENEA');

    const deleted = await deleteMeasurementFiles(accountId, periodYear, periodMonth);
    await markAccountSync(accountId, 'OK', `Usunięto ${deleted.records} rekordy pomiarowe dla ${periodYear}-${String(periodMonth).padStart(2, '0')}`);

    return jsonResponse({ ok: true, data: deleted });
  } catch (error) {
    return serverError('Nie udało się usunąć miesiąca ENEA', error);
  }
}
