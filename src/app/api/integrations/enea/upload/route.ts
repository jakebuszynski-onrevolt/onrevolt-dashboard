import { createHash, randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, notFound, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { closedMeasurementPeriodKeys, inspectEnergyMeasurementWorkbook } from 'lib/onrevolt/energy-measurement-document';
import { prisma } from 'lib/onrevolt/prisma';
import { preflightProjectReConsumption, syncEnergyMeasurementToRe } from 'lib/onrevolt/re-consumption-sync';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';

const maxUploadBytes = 25 * 1024 * 1024;
const xlsxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function uploadRoot() {
  const uploadDir = process.env.ONREVOLT_UPLOAD_DIR?.trim();
  if (!uploadDir) throw new Error('Brak ONREVOLT_UPLOAD_DIR dla zapisu pliku XLSX');
  return path.resolve(uploadDir);
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_');
}

function normalizedPpe(value?: string | null) {
  return String(value || '').replace(/\s/g, '');
}

class ConcurrentMeasurementError extends Error {}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;

  try {
    const form = await req.formData();
    const file = form.get('file');
    const clientId = String(form.get('clientId') || '').trim();
    const projectId = String(form.get('projectId') || '').trim() || undefined;
    const mismatchConfirmed = String(form.get('ppeMismatchConfirmed') || '') === 'true';
    const replaceExisting = String(form.get('replaceExisting') || '') === 'true';
    const replaceReProfile = String(form.get('replaceReProfile') || '') === 'true';

    if (!(file instanceof File)) return badRequest('Brak pliku w polu file');
    if (!clientId) return badRequest('Brak klienta dla pliku XLSX');
    if (path.extname(file.name).toLowerCase() !== '.xlsx') return badRequest('Wybierz plik w formacie XLSX');
    if (file.size <= 0) return badRequest('Plik XLSX jest pusty');
    if (file.size > maxUploadBytes) return badRequest('Plik XLSX przekracza limit 25 MB');

    const [client, project] = await Promise.all([
      prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }),
      projectId ? prisma.project.findFirst({ where: { id: projectId, clientId }, select: { id: true } }) : Promise.resolve(null),
    ]);
    if (!client) return notFound('Nie znaleziono klienta');
    if (projectId && !project) return notFound('Nie znaleziono projektu tego klienta');

    const bytes = Buffer.from(await file.arrayBuffer());
    let info;
    try {
      info = inspectEnergyMeasurementWorkbook(bytes);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error));
    }

    const periodKey = `${info.periodYear}-${String(info.periodMonth).padStart(2, '0')}`;
    if (!closedMeasurementPeriodKeys().has(periodKey)) {
      return badRequest(`Miesiąc ${periodKey} jest poza zakresem ostatnich 12 zamkniętych miesięcy`);
    }

    let account = await prisma.energyPortalAccount.findFirst({
      where: { clientId, operator: 'ENEA', projectId: projectId || null },
      orderBy: { updatedAt: 'desc' },
    });
    const expectedPpe = normalizedPpe(account?.ppeNumber);
    const detectedPpe = normalizedPpe(info.ppeNumber);
    if (expectedPpe && expectedPpe !== detectedPpe && !mismatchConfirmed) {
      return jsonResponse({
        ok: false,
        code: 'ENERGY_PPE_MISMATCH',
        error: `PPE w pliku (${detectedPpe}) różni się od PPE klienta (${expectedPpe}).`,
        data: { expectedPpe, detectedPpe },
      }, { status: 409 });
    }

    if (!account) {
      account = await prisma.energyPortalAccount.create({
        data: { clientId, projectId, operator: 'ENEA', ppeNumber: detectedPpe },
      });
    } else if (!account.ppeNumber) {
      account = await prisma.energyPortalAccount.update({ where: { id: account.id }, data: { ppeNumber: detectedPpe } });
    }

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const documentType = info.kind === 'ACTIVE_IMPORT' ? 'ENEA_ZUZYCIE' : 'ENEA_PRODUKCJA';
    const identical = await prisma.document.findFirst({
      where: { clientId, type: documentType, sha256 },
      select: { id: true, title: true, fileName: true },
    });
    if (identical) {
      return jsonResponse({ ok: false, code: 'ENERGY_FILE_IDENTICAL', error: `Ten sam plik jest już zapisany jako „${identical.title}”.` }, { status: 409 });
    }

    const existingMeasurement = await prisma.energyMeasurementFile.findUnique({
      where: {
        accountId_kind_periodYear_periodMonth: {
          accountId: account.id,
          kind: info.kind,
          periodYear: info.periodYear,
          periodMonth: info.periodMonth,
        },
      },
      include: { document: true },
    });
    if (existingMeasurement && !replaceExisting) {
      return jsonResponse({
        ok: false,
        code: 'ENERGY_MONTH_EXISTS',
        error: `${info.kind === 'ACTIVE_IMPORT' ? 'Zużycie' : 'Energia oddana'} za ${periodKey} jest już zapisane.`,
        data: { period: periodKey, existingFileName: existingMeasurement.fileName },
      }, { status: 409 });
    }

    const rePreflight = await preflightProjectReConsumption({ clientId, projectId, workbook: info, replaceExisting: replaceReProfile });
    if (rePreflight.status === 'existing') {
      return jsonResponse({ ok: false, code: 'ENERGY_RE_MONTH_EXISTS', error: 'Ten miesiąc ma już profil XLSX w RE. Czy zastąpić go danymi z tego pliku?' }, { status: 409 });
    }

    const relativePath = path.join('enea', clientId, 'manual', periodKey, `${randomUUID()}-${safeFileName(file.name)}`);
    const root = uploadRoot();
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) return badRequest('Nieprawidłowa ścieżka dokumentu');
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes, { flag: 'wx' });

    const kindLabel = info.kind === 'ACTIVE_IMPORT' ? 'Zużycie energii' : 'Energia oddana';
    const notes = `Miesięczny plik godzinowy XLSX przekazany przez klienta. PPE: ${info.ppeNumber}. Zakres: ${info.periodFrom} - ${info.periodTo}. Agregacja: ${info.aggregation}. Suma: ${info.totalKwh} kWh.`;
    let document;
    let measurementId: string;
    try {
      document = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM EnergyPortalAccount WHERE id = ${account.id} FOR UPDATE`;
        const current = await tx.energyMeasurementFile.findUnique({ where: {
          accountId_kind_periodYear_periodMonth: { accountId: account.id, kind: info.kind,
            periodYear: info.periodYear, periodMonth: info.periodMonth },
        } });
        if ((current?.documentId || null) !== (existingMeasurement?.documentId || null)) {
          throw new ConcurrentMeasurementError('W tym czasie zapisano inny plik tego miesiąca. Sprawdź go przed ponownym importem.');
        }
        const createdDocument = await tx.document.create({
          data: {
            type: documentType,
            title: `${kindLabel} ENEA ${periodKey}`,
            fileName: file.name,
            mimeType: file.type || xlsxMimeType,
            sizeBytes: bytes.length,
            sha256,
            storagePath: relativePath,
            clientId,
            projectId,
            uploadedById: access.user.id,
            visibleToClient: false,
            billingPeriodFrom: new Date(`${info.periodFrom}T00:00:00Z`),
            billingPeriodTo: new Date(`${info.periodTo}T00:00:00Z`),
            energyConsumptionKwh: info.kind === 'ACTIVE_IMPORT' ? info.totalKwh : undefined,
            notes,
          },
        });
        const measurement = await tx.energyMeasurementFile.upsert({
          where: {
            accountId_kind_periodYear_periodMonth: {
              accountId: account.id,
              kind: info.kind,
              periodYear: info.periodYear,
              periodMonth: info.periodMonth,
            },
          },
          update: {
            documentId: createdDocument.id,
            storagePath: relativePath,
            fileName: file.name,
            aggregation: info.aggregation,
            dataSource: 'Plik XLSX od klienta',
            status: 'DOWNLOADED',
            error: null,
            downloadedAt: new Date(),
          },
          create: {
            accountId: account.id,
            clientId,
            projectId,
            operator: 'ENEA',
            kind: info.kind,
            periodYear: info.periodYear,
            periodMonth: info.periodMonth,
            aggregation: info.aggregation,
            dataSource: 'Plik XLSX od klienta',
            documentId: createdDocument.id,
            storagePath: relativePath,
            fileName: file.name,
            status: 'DOWNLOADED',
            downloadedAt: new Date(),
          },
        });
        measurementId = measurement.id;
        return createdDocument;
      });
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      if (error instanceof ConcurrentMeasurementError) {
        return jsonResponse({ ok: false, code: 'ENERGY_MONTH_CHANGED', error: error.message }, { status: 409 });
      }
      throw error;
    }

    await writeAuditLog({
      actorId: access.user.id,
      clientId,
      entityType: 'EnergyMeasurementFile',
      entityId: document.id,
      action: existingMeasurement ? 'REPLACE_XLSX' : 'UPLOAD_XLSX',
      before: existingMeasurement || undefined,
      after: { document, workbook: info },
    });

    const reSync = await syncEnergyMeasurementToRe(measurementId, { clientId, projectId, actorId: access.user.id, replaceExisting: replaceReProfile });
    return jsonResponse({ ok: true, data: { document, workbook: info, reSync } }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się dodać danych pomiarowych XLSX', error);
  }
}
