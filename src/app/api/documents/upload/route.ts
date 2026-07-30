import { createHash, randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { NextRequest } from 'next/server';
import { jsonResponse, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prepareDocumentFile } from 'lib/onrevolt/document-image';
import { recognizeInvoicePdf } from 'lib/onrevolt/invoice-recognition';
import type { InvoiceRecognitionResult } from 'lib/onrevolt/invoice-recognition';
import { prisma } from 'lib/onrevolt/prisma';
import { requireStaffUser, staffAuthorizationResponse } from 'lib/onrevolt/staff-server';

const maxUploadBytes = 25 * 1024 * 1024;
const allowedDocumentTypes = new Set([
  'FAKTURA_PRAD', 'ENEA_ZUZYCIE', 'ENEA_PRODUKCJA', 'OFERTA', 'UMOWA',
  'PROTOKOL', 'ZDJECIE_MONTAZU', 'DOKUMENT_OSD', 'RE_DOKUMENT', 'INNE',
]);
const allowedExtensions = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif', '.xlsx', '.xls', '.ods',
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

function invoiceRecognition(form: FormData) {
  const value = String(form.get('invoiceRecognition') || '').trim();
  if (!value) return undefined;
  let parsed: InvoiceRecognitionResult;
  try {
    parsed = JSON.parse(value) as InvoiceRecognitionResult;
  } catch {
    throw new Error('Nieprawidłowy zapis rozpoznania faktury');
  }
  if (
    parsed?.schemaVersion !== 1
    || parsed.provider !== 'ENEA'
    || typeof parsed.parser?.id !== 'string'
    || typeof parsed.parser?.version !== 'string'
    || !parsed.fields
  ) {
    throw new Error('Nieobsługiwana wersja rozpoznania faktury');
  }
  return parsed;
}

function normalizedPpe(value?: string | null) {
  return String(value || '').replace(/\s/g, '');
}

function duplicateDocument(document: {
  id: string;
  title: string;
  fileName: string;
  invoiceNumber: string | null;
  documentDate: Date | null;
}) {
  return {
    id: document.id,
    title: document.title,
    fileName: document.fileName,
    invoiceNumber: document.invoiceNumber,
    documentDate: document.documentDate,
  };
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
    const submittedRecognition = invoiceRecognition(form);
    if (type === 'FAKTURA_PRAD' && (!billingPeriodFrom || !billingPeriodTo)) {
      throw new Error('Faktura wymaga początku i końca okresu rozliczeniowego');
    }
    if (type === 'FAKTURA_PRAD' && !submittedRecognition) {
      throw new Error('Faktura ENEA wymaga wcześniejszego rozpoznania');
    }
    if (billingPeriodFrom && billingPeriodTo && billingPeriodFrom > billingPeriodTo) {
      throw new Error('Początek okresu faktury nie może być późniejszy niż koniec');
    }

    const extension = path.extname(file.name).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      throw new Error(`Niedozwolony format pliku: ${extension || 'brak rozszerzenia'}`);
    }

    const originalBytes = Buffer.from(await file.arrayBuffer());
    let recognition = submittedRecognition;
    if (type === 'FAKTURA_PRAD') {
      if (extension !== '.pdf' || originalBytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
        throw new Error('Faktura ENEA musi być prawidłowym plikiem PDF');
      }
      const verifiedRecognition = await recognizeInvoicePdf(originalBytes);
      if (
        submittedRecognition?.parser.id !== verifiedRecognition.parser.id
        || submittedRecognition.parser.version !== verifiedRecognition.parser.version
      ) {
        throw new Error('Wynik rozpoznania nie odpowiada przesłanemu plikowi PDF');
      }
      recognition = verifiedRecognition;
    }
    const preparedFile = await prepareDocumentFile({
      bytes: originalBytes,
      fileName: file.name,
      mimeType: file.type || undefined,
    });
    if (preparedFile.bytes.length > maxUploadBytes) {
      throw new Error('Plik po konwersji przekracza limit 25 MB');
    }
    const { bytes } = preparedFile;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const clientId = String(form.get('clientId') || '').trim() || undefined;
    const projectId = String(form.get('projectId') || '').trim() || undefined;
    if (type === 'FAKTURA_PRAD' && !clientId) {
      throw new Error('Faktura musi być przypisana do klienta');
    }

    const effectiveInvoiceNumber = String(form.get('invoiceNumber') || '').trim()
      || recognition?.fields.invoiceNumber?.trim()
      || undefined;
    const replaceDocumentId = String(form.get('replaceDocumentId') || '').trim() || undefined;
    const replaceExistingInvoice = String(form.get('replaceExistingInvoice') || '') === 'true';
    const identicalInvoice = type === 'FAKTURA_PRAD'
      ? await prisma.document.findFirst({
        where: { clientId, type: 'FAKTURA_PRAD', sha256 },
        orderBy: { updatedAt: 'desc' },
      })
      : null;
    if (identicalInvoice) {
      return jsonResponse({
        ok: false,
        code: 'INVOICE_IDENTICAL',
        error: `Ta sama faktura jest już zapisana jako „${identicalInvoice.title}”. Nie dodano drugiej kopii.`,
        data: { duplicate: duplicateDocument(identicalInvoice) },
      }, { status: 409 });
    }

    const existingInvoice = type === 'FAKTURA_PRAD' && effectiveInvoiceNumber
      ? await prisma.document.findFirst({
        where: { clientId, type: 'FAKTURA_PRAD', invoiceNumber: effectiveInvoiceNumber },
        orderBy: { updatedAt: 'desc' },
      })
      : null;
    if (existingInvoice && (
      existingInvoice.id !== replaceDocumentId
      || !replaceExistingInvoice
    )) {
      return jsonResponse({
        ok: false,
        code: 'INVOICE_NUMBER_EXISTS',
        error: `Faktura nr ${effectiveInvoiceNumber} już istnieje. Potwierdź zastąpienie istniejącej faktury.`,
        data: { duplicate: duplicateDocument(existingInvoice) },
      }, { status: 409 });
    }
    if (replaceDocumentId && (!existingInvoice || existingInvoice.id !== replaceDocumentId)) {
      return jsonResponse({
        ok: false,
        code: 'INVOICE_REPLACEMENT_INVALID',
        error: 'Nie można zastąpić wskazanej faktury. Odśwież dane i spróbuj ponownie.',
      }, { status: 409 });
    }

    const projectAccount = projectId
      ? await prisma.energyPortalAccount.findFirst({ where: { clientId, projectId } })
      : null;
    const expectedAccount = projectAccount || (clientId
      ? await prisma.energyPortalAccount.findFirst({
        where: { clientId, projectId: null },
        orderBy: { updatedAt: 'desc' },
      })
      : null);
    const detectedPpe = normalizedPpe(recognition?.fields.ppeNumber);
    const expectedPpe = normalizedPpe(expectedAccount?.ppeNumber);
    const detectedTariff = recognition?.fields.tariff?.trim() || '';
    const expectedTariff = expectedAccount?.tariff?.trim() || '';
    const ppeMismatch = Boolean(expectedPpe && detectedPpe && expectedPpe !== detectedPpe);
    const tariffMismatch = Boolean(expectedTariff && detectedTariff && expectedTariff !== detectedTariff);
    if ((ppeMismatch || tariffMismatch) && String(form.get('assignmentMismatchConfirmed') || '') !== 'true') {
      throw new Error('PPE lub grupa taryfowa na fakturze różni się od danych klienta. Wymagane jest świadome potwierdzenie.');
    }

    const confirmedRecognition = recognition ? {
      ...recognition,
      fields: {
        ...recognition.fields,
        invoiceNumber: effectiveInvoiceNumber,
        issueDate: formDate(form, 'documentDate')?.toISOString().slice(0, 10) || recognition.fields.issueDate,
        periodFrom: billingPeriodFrom?.toISOString().slice(0, 10) || recognition.fields.periodFrom,
        periodTo: billingPeriodTo?.toISOString().slice(0, 10) || recognition.fields.periodTo,
        billingCycleMonths,
        amountGross: formNumber(form, 'amountGross'),
        amountDue: formNumber(form, 'amountDue'),
        ppeNumber: String(form.get('invoicePpeNumber') || '').trim() || recognition.fields.ppeNumber,
        tariff: String(form.get('invoiceTariff') || '').trim() || recognition.fields.tariff,
      },
      confirmation: {
        confirmedAt: new Date().toISOString(),
        confirmedById: user.id,
        assignmentMismatchConfirmed: ppeMismatch || tariffMismatch,
      },
    } : undefined;

    const month = new Date().toISOString().slice(0, 7);
    const safeName = preparedFile.fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_');
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
      const documentData = {
        type: type as any,
        title,
        fileName: preparedFile.fileName,
        mimeType: preparedFile.mimeType,
        sizeBytes: bytes.length,
        sha256,
        storagePath: relativePath,
        clientId,
        projectId,
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
        invoiceNumber: effectiveInvoiceNumber,
        amountGross: formNumber(form, 'amountGross'),
        amountDue: formNumber(form, 'amountDue'),
        invoiceProvider: recognition?.provider,
        invoiceParserId: recognition?.parser.id,
        invoiceParserVersion: recognition?.parser.version,
        invoiceConfidence: recognition?.confidence,
        invoicePpeNumber: String(form.get('invoicePpeNumber') || '').trim() || undefined,
        invoiceTariff: String(form.get('invoiceTariff') || '').trim() || undefined,
        energyConsumptionKwh: formNumber(form, 'energyConsumptionKwh'),
        invoiceRecognition: confirmedRecognition,
        notes: String(form.get('notes') || '') || undefined,
      };
      document = existingInvoice
        ? await prisma.document.update({
          where: { id: existingInvoice.id },
          data: documentData,
        })
        : await prisma.document.create({ data: documentData });
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }

    await writeAuditLog({
      actorId: user.id,
      clientId: document.clientId,
      entityType: 'Document',
      entityId: document.id,
      action: existingInvoice ? 'REPLACE' : 'UPLOAD',
      before: existingInvoice || undefined,
      after: document,
    });

    if (existingInvoice?.storagePath && existingInvoice.storagePath !== relativePath) {
      const oldAbsolutePath = path.resolve(uploadRoot, existingInvoice.storagePath);
      if (oldAbsolutePath.startsWith(`${uploadRoot}${path.sep}`)) {
        await unlink(oldAbsolutePath).catch(() => undefined);
      }
    }

    return jsonResponse({ ok: true, data: document }, { status: 201 });
  } catch (error) {
    const authorizationResponse = staffAuthorizationResponse(error);
    if (authorizationResponse) return authorizationResponse;
    return serverError('Nie udało się wysłać dokumentu', error);
  }
}
