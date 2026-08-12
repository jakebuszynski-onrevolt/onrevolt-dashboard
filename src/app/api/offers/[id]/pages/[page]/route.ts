import { NextRequest, NextResponse } from 'next/server';
import { loadOfferCoverImageDataUrl } from 'lib/onrevolt/offer-document-files';
import { buildOfferReport } from 'lib/onrevolt/offer-report';
import { offerInclude } from 'lib/onrevolt/offers';
import { prisma } from 'lib/onrevolt/prisma';
import { renderOfferSvgPage } from 'lib/onrevolt/offer-svg-renderer';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';
import type { ReformB2cPageIndex } from 'lib/onrevolt/offer-template-manifest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string; page: string }> }) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const { id, page: rawPage } = await context.params;
    const page = Number(rawPage);
    if (!Number.isInteger(page) || page < 0 || page > 4) {
      return NextResponse.json({ ok: false, error: 'Nieprawidłowy numer strony oferty' }, { status: 400 });
    }
    const offer = await prisma.offer.findUnique({ where: { id }, include: offerInclude });
    if (!offer) return NextResponse.json({ ok: false, error: 'Nie znaleziono oferty' }, { status: 404 });
    if (buildOfferReport(offer).variant !== 'B2C') {
      return NextResponse.json({ ok: false, error: 'Szablon REFORM_B2C obsługuje wyłącznie oferty B2C' }, { status: 400 });
    }
    const coverImageDataUrl = page === 0 ? await loadOfferCoverImageDataUrl(offer) : null;
    const svg = renderOfferSvgPage(offer, page as ReformB2cPageIndex, { coverImageDataUrl });
    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': offer.status === 'DRAFT' ? 'private, no-store' : 'private, max-age=60',
        'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:",
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
