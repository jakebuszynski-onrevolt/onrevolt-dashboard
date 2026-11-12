import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from 'lib/onrevolt/prisma';
import {
  authorizeSiteVisitRequest,
  isSiteVisitOnlyUser,
  staffAuthorizationResponse,
} from 'lib/onrevolt/staff-server';
import { requireSiteVisitProject } from 'lib/onrevolt/site-visit-access';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeSiteVisitRequest(req, 'documents.manage');
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const restricted = isSiteVisitOnlyUser(access.user);
    let scopedProjectId: string | undefined;
    let scopedSiteAuditId: string | undefined;
    if (restricted) {
      const scopedDocument = await prisma.document.findUnique({
        where: { id },
        select: {
          id: true,
          type: true,
          siteAuditId: true,
          siteAudit: { select: { projectId: true } },
        },
      });
      if (!scopedDocument?.siteAuditId || !scopedDocument.siteAudit?.projectId
        || !['INNE', 'ZDJECIE_MONTAZU'].includes(scopedDocument.type)) {
        return NextResponse.json({ ok: false, error: 'Nie znaleziono załącznika wizji lokalnej' }, { status: 404 });
      }
      scopedProjectId = scopedDocument.siteAudit.projectId;
      scopedSiteAuditId = scopedDocument.siteAuditId;
      await requireSiteVisitProject(access.user, scopedProjectId);
    }
    const document = await prisma.document.findUnique({
      where: { id },
      ...(restricted ? { include: { siteAudit: { select: { projectId: true } } } } : {}),
    });
    if (!document) return NextResponse.json({ ok: false, error: 'Nie znaleziono dokumentu' }, { status: 404 });
    if (restricted) {
      const linkedDocument = document as unknown as {
        siteAuditId: string | null;
        siteAudit: { projectId: string } | null;
        type: string;
      };
      if (linkedDocument.siteAuditId !== scopedSiteAuditId
        || linkedDocument.siteAudit?.projectId !== scopedProjectId
        || !['INNE', 'ZDJECIE_MONTAZU'].includes(linkedDocument.type)) {
        return NextResponse.json({ ok: false, error: 'Nie znaleziono załącznika wizji lokalnej' }, { status: 404 });
      }
      await requireSiteVisitProject(access.user, scopedProjectId!);
    }
    const uploadDir = process.env.ONREVOLT_UPLOAD_DIR?.trim();
    if (!uploadDir) return NextResponse.json({ ok: false, error: 'Brak katalogu dokumentów' }, { status: 500 });
    const root = path.resolve(uploadDir);
    const target = path.resolve(root, document.storagePath);
    if (!target.startsWith(`${root}${path.sep}`)) return NextResponse.json({ ok: false, error: 'Nieprawidłowa ścieżka dokumentu' }, { status: 400 });
    const bytes = await readFile(target);
    const disposition = req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline';
    const safeName = document.fileName.replace(/[\r\n"]/g, '_');
    const asciiName = safeName.replace(/[^\x20-\x7E]/g, '_');
    return new NextResponse(new Uint8Array(bytes), { headers: { 'Content-Type': document.mimeType || 'application/octet-stream', 'Content-Length': String(bytes.length), 'Content-Disposition': `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`, 'Cache-Control': restricted ? 'private, no-store' : 'private, max-age=60' } });
  } catch (error) {
    const authorizationResponse = staffAuthorizationResponse(error);
    if (authorizationResponse) return authorizationResponse;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
