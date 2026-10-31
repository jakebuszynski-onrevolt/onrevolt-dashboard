import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { injectFonts } from 'lib/onrevolt/offer-svg-renderer';

export async function GET(_request: Request, context: { params: Promise<{ page: string }> }) {
  if (process.env.NODE_ENV !== 'development') return new Response(null, { status: 404 });
  const { page } = await context.params;
  if (!/^(?:[1-9]|10)$/.test(page)) return new Response(null, { status: 404 });
  const svg = await readFile(path.join(process.cwd(), 'assets', 'offer-templates', 'REFORM_B2C', '2026_10_V3', `page-${page.padStart(2, '0')}.svg`), 'utf8');
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  injectFonts(document);
  return new Response(new XMLSerializer().serializeToString(document), { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; sandbox" } });
}
