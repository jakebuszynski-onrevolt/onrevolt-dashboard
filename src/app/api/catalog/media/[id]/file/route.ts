import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { resolveCatalogMediaPath } from 'lib/onrevolt/catalog-media';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';

const mimeTypes: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function originalFileName(storagePath: string | null, url: string | null, altText: string | null) {
  const source = storagePath || url || altText || 'załącznik';
  const decoded = decodeURIComponent(source);
  const baseName = path.basename(decoded).replace(/^[0-9a-f-]{36}-/i, '');
  return baseName || 'załącznik';
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;

  try {
    const { id } = await context.params;
    const media = await prisma.productMedia.findUnique({ where: { id } });
    if (!media) {
      return NextResponse.json({ ok: false, error: 'Nie znaleziono załącznika produktu' }, { status: 404 });
    }

    const filePath = resolveCatalogMediaPath(media);
    if (!filePath) {
      return NextResponse.json({ ok: false, error: 'Załącznik nie ma zapisanego pliku' }, { status: 404 });
    }

    const bytes = await readFile(filePath);
    const fileName = originalFileName(media.storagePath, media.url, media.altText);
    const extension = path.extname(fileName).toLowerCase() || path.extname(filePath).toLowerCase();
    const disposition = req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline';
    const safeName = fileName.replace(/[\r\n"]/g, '_');
    const asciiName = safeName.replace(/[^\x20-\x7E]/g, '_');

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': mimeTypes[extension] || 'application/octet-stream',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : null;
    const status = code === 'ENOENT' ? 404 : 500;
    const message = status === 404
      ? 'Pliku załącznika nie ma w magazynie danych'
      : error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
