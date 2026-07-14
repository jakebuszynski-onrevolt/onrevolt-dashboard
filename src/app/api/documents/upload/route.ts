import { createHash, randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { NextRequest } from 'next/server';
import { jsonResponse, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { requireStaffUser, staffAuthorizationResponse } from 'lib/onrevolt/staff-server';

const maxUploadBytes = 25 * 1024 * 1024;
const allowedDocumentTypes = new Set([
  'FAKTURA_PRAD', 'ENEA_ZUZYCIE', 'ENEA_PRODUKCJA', 'OFERTA', 'UMOWA',
  'PROTOKOL', 'ZDJECIE_MONTAZU', 'DOKUMENT_OSD', 'RE_DOKUMENT', 'INNE',
]);
const allowedExtensions = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.xlsx', '.xls', '.ods',
  '.docx', '.doc', '.csv', '.txt',
]);

function formDate(form: FormData, key: string) {
  const value = String(form.get(key) || '').trim();
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Nieprawidłowa data: ${key}`);
  return date;
}

function formNumber(form: FormData, key: string) {
  const value = String(form.get(key) || '').trim();
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Nieprawidłowa liczba: ${key}`);
  return number;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireStaffUser(req, 'documents.manage');
    const uploadDir = process.env.ONREVOLT_UPLOAD_DIR;
    if (!uploadDir) throw new Error('Missing ONREVOLT_UPLOAD_DIR');

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('Brak pliku w polu file');
    if (file.size <= 0) throw new Error('Plik jest pusty');
    if (file.size > maxUploadBytes) throw new Error('Plik przekracza limit 25 MB');

    const type = String(form.get('type') || '').trim();
    const title = String(form.get('title') || '').trim();
    if (!allowedDocumentTypes.has(type)) throw new Error('Nieprawidłowy typ dokumentu');
    if (!title) throw new Error('Upload wymaga pola title');
    const billingPeriodFrom = formDate(form, 'billingPeriodFrom');
    const billingPeriodTo = formDate(form, 'billingPeriodTo');
    const billingCycleMonths = formNumber(form, 'billingCycleMonths');
    if (type === 'FAKTURA_PRAD' && (!billingPeriodFrom || !billingPeriodTo)) {
      throw new Error('Faktura wymaga początku i końca okresu rozliczeniowego');
    }
    if (billingPeriodFrom && billingPeriodTo && billingPeriodFrom > billingPeriodTo) {
      throw new Error('Początek okresu faktury nie może być późniejszy niż koniec');
    }

    const extension = path.extname(file.name).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      throw new Error(`Niedozwolony format pliku: ${extension || 'brak rozszerzenia'}`);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const month = new Date().toISOString().slice(0, 7);
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, '_');
    const relativePath = path.join(type.toLowerCase(), month, `${randomUUID()}-${safeName}`);
    const uploadRoot = path.resolve(uploadDir);
    const absolutePath = path.resolve(uploadRoot, relativePath);
    if (!absolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
      throw new Error('Nieprawidłowa ścieżka dokumentu');
    }

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes, { flag: 'wx' });

    let document;
    try {
      document = await prisma.document.create({
        data: {
          type: type as any,
          title,
          fileName: file.name,
          mimeType: file.type || undefined,
          sizeBytes: bytes.length,
          sha256,
          storagePath: relativePath,
          clientId: String(form.get('clientId') || '') || undefined,
          projectId: String(form.get('projectId') || '') || undefined,
          offerId: String(form.get('offerId') || '') || undefined,
          contractId: String(form.get('contractId') || '') || undefined,
          installationId: String(form.get('installationId') || '') || undefined,
          installedDeviceId: String(form.get('installedDeviceId') || '') || undefined,
          odsCaseId: String(form.get('odsCaseId') || '') || undefined,
          serviceTicketId: String(form.get('serviceTicketId') || '') || undefined,
          uploadedById: user.id,
          visibleToClient: String(form.get('visibleToClient') || '') === 'true',
          documentDate: formDate(form, 'documentDate'),
          tags: String(form.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
          billingPeriodFrom,
          billingPeriodTo,
          billingCycleMonths,
          invoiceNumber: String(form.get('invoiceNumber') || '').trim() || undefined,
          amountGross: formNumber(form, 'amountGross'),
          notes: String(form.get('notes') || '') || undefined,
        },
      });
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }

    await writeAuditLog({
      actorId: user.id,
      clientId: document.clientId,
      entityType: 'Document',
      entityId: document.id,
      action: 'UPLOAD',
      after: document,
    });

    return jsonResponse({ ok: true, data: document }, { status: 201 });
  } catch (error) {
    const authorizationResponse = staffAuthorizationResponse(error);
    if (authorizationResponse) return authorizationResponse;
    return serverError('Nie udało się wysłać dokumentu', error);
  }
}
