import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildOfferReport } from './offer-report';
import { fetchLocationMapImage } from './location-map-images';
import { prisma } from './prisma';

export async function loadOfferCoverImageDataUrl(offer: any) {
  const report = buildOfferReport(offer);
  const liveSite = offer.status === 'DRAFT' ? offer.project?.investmentSite : null;
  const latitude = liveSite?.latitude == null ? report.client.latitude : Number(liveSite.latitude);
  const longitude = liveSite?.longitude == null ? report.client.longitude : Number(liveSite.longitude);
  if (latitude != null && longitude != null) {
    const mapProvider = liveSite?.mapProvider || report.client.mapProvider;
    const image = await fetchLocationMapImage(mapProvider, latitude, longitude);
    return `data:${image.contentType};base64,${image.bytes.toString('base64')}`;
  }

  const documentId = report.client.coverImageDocumentId;
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
