import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOfferReport } from './offer-report';
import { prisma } from './prisma';

export async function loadOfferCoverImageDataUrl(offer: any) {
  const documentId = buildOfferReport(offer).client.coverImageDocumentId;
  if (!documentId) return null;
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      OR: [
        { projectId: offer.projectId },
        { clientId: offer.project?.clientId },
      ],
      mimeType: { startsWith: 'image/' },
    },
    select: { storagePath: true, mimeType: true },
  });
  if (!document) return null;
  const uploadDir = process.env.ONREVOLT_UPLOAD_DIR?.trim();
  if (!uploadDir) throw new Error('Brak ONREVOLT_UPLOAD_DIR dla zdjęcia oferty');
  const root = path.resolve(uploadDir);
  const target = path.resolve(root, document.storagePath);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Nieprawidłowa ścieżka zdjęcia oferty');
  const bytes = await readFile(target);
  return `data:${document.mimeType};base64,${bytes.toString('base64')}`;
}
