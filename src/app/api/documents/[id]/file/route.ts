import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) return NextResponse.json({ ok: false, error: 'Nie znaleziono dokumentu' }, { status: 404 });
    const uploadDir = process.env.ONREVOLT_UPLOAD_DIR?.trim();
    if (!uploadDir) return NextResponse.json({ ok: false, error: 'Brak katalogu dokumentów' }, { status: 500 });
    const root = path.resolve(uploadDir);
    const target = path.resolve(root, document.storagePath);
    if (!target.startsWith(`${root}${path.sep}`)) return NextResponse.json({ ok: false, error: 'Nieprawidłowa ścieżka dokumentu' }, { status: 400 });
    const bytes = await readFile(target);
    const disposition = req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline';
    const safeName = document.fileName.replace(/[\r\n"]/g, '_');
    const asciiName = safeName.replace(/[^\x20-\x7E]/g, '_');
    return new NextResponse(new Uint8Array(bytes), { headers: { 'Content-Type': document.mimeType || 'application/octet-stream', 'Content-Length': String(bytes.length), 'Content-Disposition': `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`, 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
