import { NextRequest, NextResponse } from 'next/server';
import { generateOfferPdf, isGeneratedOfferPdf, readArchivedOfferPdf } from 'lib/onrevolt/offer-pdf';
import { offerInclude } from 'lib/onrevolt/offers';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function response(bytes: Buffer, fileName: string, download: boolean) {
  const safeName = fileName.replace(/[\r\n"]/g, '_');
  const asciiName = safeName.replace(/[^\x20-\x7E]/g, '_');
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const offer = await prisma.offer.findUnique({ where: { id }, include: offerInclude });
    if (!offer) return NextResponse.json({ ok: false, error: 'Nie znaleziono oferty' }, { status: 404 });
    const archived = offer.documents.find((document) => isGeneratedOfferPdf(document, offer));
    const bytes = archived ? await readArchivedOfferPdf(archived.storagePath) : await generateOfferPdf(offer);
    const fileName = archived?.fileName || `oferta-${offer.number || offer.id}-v${offer.version}.pdf`;
    return response(bytes, fileName, req.nextUrl.searchParams.get('download') === '1');
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
