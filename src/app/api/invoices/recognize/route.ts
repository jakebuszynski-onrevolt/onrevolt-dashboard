import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { badRequest, jsonResponse } from 'lib/onrevolt/api';
import { recognizeInvoicePdf } from 'lib/onrevolt/invoice-recognition';
import { prisma } from 'lib/onrevolt/prisma';
import { requireStaffUser, staffAuthorizationResponse } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';

const maxInvoiceBytes = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    await requireStaffUser(req, 'documents.manage');
    const form = await req.formData();
    const file = form.get('file');
    const clientId = String(form.get('clientId') || '').trim();
    if (!(file instanceof File)) throw new Error('Wybierz fakturę PDF');
    if (!clientId) throw new Error('Brak klienta, dla którego dodawana jest faktura');
    if (file.size <= 0) throw new Error('Plik jest pusty');
    if (file.size > maxInvoiceBytes) throw new Error('Plik przekracza limit 25 MB');
    if (file.type && file.type !== 'application/pdf') throw new Error('Rozpoznawanie obsługuje obecnie tylko pliki PDF');
    if (!file.name.toLowerCase().endsWith('.pdf')) throw new Error('Rozpoznawanie obsługuje obecnie tylko pliki PDF');

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('Wybrany plik nie jest prawidłowym dokumentem PDF');
    }

    const result = await recognizeInvoicePdf(bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const invoiceNumber = result.fields.invoiceNumber?.trim();
    const candidates = await prisma.document.findMany({
      where: {
        clientId,
        type: 'FAKTURA_PRAD',
        OR: [
          { sha256 },
          ...(invoiceNumber ? [{ invoiceNumber }] : []),
        ],
      },
      select: {
        id: true,
        title: true,
        fileName: true,
        sha256: true,
        invoiceNumber: true,
        documentDate: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    const identical = candidates.find((document) => document.sha256 === sha256);
    const sameNumber = invoiceNumber
      ? candidates.find((document) => document.invoiceNumber?.trim() === invoiceNumber)
      : undefined;
    const duplicate = identical
      ? { kind: 'IDENTICAL' as const, document: identical }
      : sameNumber
        ? { kind: 'INVOICE_NUMBER' as const, document: sameNumber }
        : null;

    return jsonResponse({
      ok: true,
      data: {
        recognition: result,
        duplicate,
      },
    });
  } catch (error) {
    const authorizationResponse = staffAuthorizationResponse(error);
    if (authorizationResponse) return authorizationResponse;
    return badRequest(error instanceof Error ? error.message : 'Nie udało się rozpoznać faktury');
  }
}
