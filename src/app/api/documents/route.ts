import { NextRequest } from 'next/server';
import path from 'path';
import { unlink } from 'fs/promises';
import { badRequest, jsonResponse, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const clientId = req.nextUrl.searchParams.get('clientId') || undefined;
    const projectId = req.nextUrl.searchParams.get('projectId') || undefined;
    const documents = await prisma.document.findMany({
      where: { ...(clientId ? { clientId } : {}), ...(projectId ? { projectId } : {}) },
      include: { client: true, project: true, uploadedBy: { select: { id: true, name: true } }, odsCase: true, serviceTicket: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return jsonResponse({ ok: true, data: documents });
  } catch (error) {
    return serverError('Nie udało się pobrać dokumentów', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'documents.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const document = await prisma.document.create({
      data: {
        type: requireString(body, 'type') as any,
        title: requireString(body, 'title'),
        fileName: requireString(body, 'fileName'),
        mimeType: optionalString(body, 'mimeType'),
        sizeBytes: Number.isInteger(Number(body.sizeBytes)) ? Number(body.sizeBytes) : undefined,
        sha256: optionalString(body, 'sha256'),
        storagePath: requireString(body, 'storagePath'),
        clientId: optionalString(body, 'clientId'),
        projectId: optionalString(body, 'projectId'),
        offerId: optionalString(body, 'offerId'),
        contractId: optionalString(body, 'contractId'),
        installationId: optionalString(body, 'installationId'),
        installedDeviceId: optionalString(body, 'installedDeviceId'),
        uploadedById: access.user.id,
        odsCaseId: optionalString(body, 'odsCaseId'),
        serviceTicketId: optionalString(body, 'serviceTicketId'),
        visibleToClient: Boolean(body.visibleToClient),
        documentDate: parseDate(body.documentDate),
        tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())).map((tag) => tag.trim()) : undefined,
        billingPeriodFrom: parseDate(body.billingPeriodFrom),
        billingPeriodTo: parseDate(body.billingPeriodTo),
        billingCycleMonths: Number.isInteger(Number(body.billingCycleMonths)) ? Number(body.billingCycleMonths) : undefined,
        invoiceNumber: optionalString(body, 'invoiceNumber'),
        amountGross: body.amountGross == null || body.amountGross === '' ? undefined : Number(body.amountGross),
        notes: optionalString(body, 'notes'),
      },
    });
    return jsonResponse({ ok: true, data: document }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać dokumentu', error);
  }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'documents.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const existing = await prisma.document.findUnique({ where: { id } });
    if (!existing) return badRequest('Nie znaleziono dokumentu');
    const cycle = body.billingCycleMonths === '' || body.billingCycleMonths == null ? null : Number(body.billingCycleMonths);
    if (cycle != null && (!Number.isInteger(cycle) || cycle < 1 || cycle > 24)) return badRequest('Okres faktury musi mieć od 1 do 24 miesięcy');
    const nextPeriodFrom = body.billingPeriodFrom === undefined ? existing.billingPeriodFrom : parseDate(body.billingPeriodFrom) || null;
    const nextPeriodTo = body.billingPeriodTo === undefined ? existing.billingPeriodTo : parseDate(body.billingPeriodTo) || null;
    if (existing.type === 'FAKTURA_PRAD' && (!nextPeriodFrom || !nextPeriodTo)) return badRequest('Faktura wymaga początku i końca okresu rozliczeniowego');
    if (nextPeriodFrom && nextPeriodTo && nextPeriodFrom > nextPeriodTo) return badRequest('Początek okresu faktury nie może być późniejszy niż koniec');
    const storedRecognition = existing.invoiceRecognition && typeof existing.invoiceRecognition === 'object' && !Array.isArray(existing.invoiceRecognition)
      ? existing.invoiceRecognition as Record<string, any>
      : null;
    const recognitionFields = storedRecognition?.fields && typeof storedRecognition.fields === 'object'
      ? storedRecognition.fields as Record<string, any>
      : null;
    const recognitionConsumption = recognitionFields?.consumption && typeof recognitionFields.consumption === 'object'
      ? recognitionFields.consumption as Record<string, any>
      : null;
    const invoiceRecognition = storedRecognition && recognitionFields
      ? {
          ...storedRecognition,
          fields: {
            ...recognitionFields,
            invoiceNumber: body.invoiceNumber === undefined ? recognitionFields.invoiceNumber : optionalString(body, 'invoiceNumber'),
            issueDate: body.documentDate === undefined ? recognitionFields.issueDate : body.documentDate || undefined,
            periodFrom: body.billingPeriodFrom === undefined ? recognitionFields.periodFrom : body.billingPeriodFrom || undefined,
            periodTo: body.billingPeriodTo === undefined ? recognitionFields.periodTo : body.billingPeriodTo || undefined,
            billingCycleMonths: body.billingCycleMonths === undefined ? recognitionFields.billingCycleMonths : cycle || undefined,
            amountGross: body.amountGross === undefined ? recognitionFields.amountGross : body.amountGross === '' ? undefined : Number(body.amountGross),
            amountDue: body.amountDue === undefined ? recognitionFields.amountDue : body.amountDue === '' ? undefined : Number(body.amountDue),
            ppeNumber: body.invoicePpeNumber === undefined ? recognitionFields.ppeNumber : optionalString(body, 'invoicePpeNumber'),
            tariff: body.invoiceTariff === undefined ? recognitionFields.tariff : optionalString(body, 'invoiceTariff'),
            consumption: recognitionConsumption
              ? {
                  ...recognitionConsumption,
                  totalAfterBalancingKwh: body.energyConsumptionKwh === undefined
                    ? recognitionConsumption.totalAfterBalancingKwh
                    : body.energyConsumptionKwh === '' ? undefined : Number(body.energyConsumptionKwh),
                }
              : recognitionFields.consumption,
          },
          confirmation: {
            ...(storedRecognition.confirmation && typeof storedRecognition.confirmation === 'object'
              ? storedRecognition.confirmation as Record<string, any>
              : {}),
            correctedAt: new Date().toISOString(),
            correctedById: access.user.id,
          },
        }
      : undefined;
    const updated = await prisma.document.update({
      where: { id },
      data: {
        title: body.title !== undefined ? requireString(body, 'title') : undefined,
        type: body.type !== undefined ? requireString(body, 'type') as any : undefined,
        visibleToClient: body.visibleToClient === undefined ? undefined : Boolean(body.visibleToClient),
        documentDate: body.documentDate === undefined ? undefined : parseDate(body.documentDate) || null,
        tags: body.tags === undefined ? undefined : Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())).map((tag) => tag.trim()) : [],
        billingPeriodFrom: body.billingPeriodFrom === undefined ? undefined : nextPeriodFrom,
        billingPeriodTo: body.billingPeriodTo === undefined ? undefined : nextPeriodTo,
        billingCycleMonths: body.billingCycleMonths === undefined ? undefined : cycle,
        invoiceNumber: body.invoiceNumber === undefined ? undefined : optionalString(body, 'invoiceNumber') || null,
        amountGross: body.amountGross === undefined ? undefined : body.amountGross === '' || body.amountGross == null ? null : Number(body.amountGross),
        amountDue: body.amountDue === undefined ? undefined : body.amountDue === '' || body.amountDue == null ? null : Number(body.amountDue),
        invoicePpeNumber: body.invoicePpeNumber === undefined ? undefined : optionalString(body, 'invoicePpeNumber') || null,
        invoiceTariff: body.invoiceTariff === undefined ? undefined : optionalString(body, 'invoiceTariff') || null,
        energyConsumptionKwh: body.energyConsumptionKwh === undefined
          ? undefined
          : body.energyConsumptionKwh === '' || body.energyConsumptionKwh == null ? null : Number(body.energyConsumptionKwh),
        invoiceRecognition,
        notes: body.notes === undefined ? undefined : optionalString(body, 'notes') || null,
      },
    });
    await writeAuditLog({ actorId: access.user.id, clientId: existing.clientId, entityType: 'Document', entityId: id, action: 'UPDATE', before: existing, after: updated });
    return jsonResponse({ ok: true, data: updated });
  } catch (error) {
    return serverError('Nie udało się zaktualizować dokumentu', error);
  }
}

export async function DELETE(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'documents.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const existing = await prisma.document.findUnique({ where: { id } });
    if (!existing) return badRequest('Nie znaleziono dokumentu');
    const uploadDir = process.env.ONREVOLT_UPLOAD_DIR?.trim();
    if (!uploadDir) return badRequest('Brak katalogu dokumentów');
    const root = path.resolve(uploadDir);
    const target = path.resolve(root, existing.storagePath);
    if (!target.startsWith(`${root}${path.sep}`)) return badRequest('Nieprawidłowa ścieżka dokumentu');
    await prisma.document.delete({ where: { id } });
    await unlink(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    await writeAuditLog({ actorId: access.user.id, clientId: existing.clientId, entityType: 'Document', entityId: id, action: 'DELETE', before: existing });
    return jsonResponse({ ok: true, data: { id } });
  } catch (error) {
    return serverError('Nie udało się usunąć dokumentu', error);
  }
}
