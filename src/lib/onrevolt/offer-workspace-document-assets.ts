import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import sharp from 'sharp';
import { prisma } from './prisma';
import { fetchLocationMapImage } from './location-map-images';
import type { OfferWorkspaceDocumentResult } from './offer-workspace-document';
import type { OfferWorkspace } from './offer-workspace-server';
import { getOfferWorkspaceArtifact, putOfferWorkspaceArtifact } from './offer-workspace-artifacts';
import { offerDocumentMapRevision } from './offer-workspace-document-cache';

const mapGroupId = 'grafika / zdjecie_satelitarne';
const svgNamespace = 'http://www.w3.org/2000/svg';

export function embedOfferWorkspaceMap(svg: string, png: Buffer): string {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Nieprawidłowy obraz lokalizacji.');
  }
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const groups = Array.from(doc.getElementsByTagName('g'));
  const group = groups.find(element => element.getAttribute('id') === mapGroupId);
  const box = group?.getElementsByTagName('rect')[0];
  if (!group || !box) throw new Error('Brak pola zdjęcia lokalizacji w szablonie.');
  const clip = doc.createElementNS(svgNamespace, 'clipPath');
  clip.setAttribute('id', 'workspace-location-map-clip');
  clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
  clip.appendChild(box.cloneNode(false));
  const image = doc.createElementNS(svgNamespace, 'image');
  for (const attribute of ['x', 'y', 'width', 'height']) {
    image.setAttribute(attribute, box.getAttribute(attribute) || '0');
  }
  // Keep the complete CRM frame, including its provider attribution.
  image.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  image.setAttribute('clip-path', 'url(#workspace-location-map-clip)');
  image.setAttribute('href', `data:image/png;base64,${png.toString('base64')}`);
  while (group.firstChild) group.removeChild(group.firstChild);
  group.appendChild(clip);
  group.appendChild(image);
  return new XMLSerializer().serializeToString(doc);
}

/** Call only after loadProjectOfferWorkspace has authorized access to this project. */
export async function attachOfferWorkspaceDocumentMap(
  document: OfferWorkspaceDocumentResult,
  workspace: Pick<OfferWorkspace, 'projectId' | 'input'>,
) {
  const page = document.pages.find(item => item.page === 1);
  if (!page) return;
  const location = workspace.input.location;
  let reason = 'Brak współrzędnych lokalizacji projektu.';
  if (location?.latitude != null && location.longitude != null) {
    let site: { latitude: unknown; longitude: unknown; mapProvider: string } | null = null;
    try {
      const project = await prisma.project.findUnique({
        where: { id: workspace.projectId },
        select: { investmentSite: { select: { latitude: true, longitude: true, mapProvider: true } } },
      });
      site = project?.investmentSite || null;
      if (!site || site.latitude == null || site.longitude == null
        || Number(site.latitude) !== location.latitude || Number(site.longitude) !== location.longitude) {
        site = null;
        reason = 'Nie udało się pobrać zdjęcia lokalizacji z wybranego źródła mapy. Ponów podgląd dokumentu.';
      }
    } catch {
      reason = 'Nie udało się pobrać zdjęcia lokalizacji z wybranego źródła mapy. Ponów podgląd dokumentu.';
    }

    if (site) {
      const identity = { projectId: workspace.projectId, kind: 'document-map', key: {
        renderer: await offerDocumentMapRevision(), provider: site.mapProvider,
        latitude: location.latitude, longitude: location.longitude,
      } };
      // Artifact reads and writes are durable database operations. Keep them
      // outside the provider error handling so a database failure is visible.
      const stored = await getOfferWorkspaceArtifact<{ png: string }>(identity);
      let png: Buffer;
      if (stored) png = Buffer.from(stored.png, 'base64');
      else {
        try {
          const source = await fetchLocationMapImage(site.mapProvider, location.latitude, location.longitude);
          if (source.bytes.length > 12 * 1024 * 1024) throw new Error('Obraz lokalizacji jest zbyt duży.');
          png = await sharp(source.bytes, { limitInputPixels: 16_000_000 }).png().toBuffer();
        } catch {
          reason = 'Nie udało się pobrać zdjęcia lokalizacji z wybranego źródła mapy. Ponów podgląd dokumentu.';
          document.missingData.push({ page: 1, fieldKeys: [], idHint: mapGroupId, reason });
          return;
        }
        await putOfferWorkspaceArtifact(identity, { png: png.toString('base64') });
      }
      page.svg = embedOfferWorkspaceMap(page.svg, png);
      document.sourceFieldsUsed.push('input.location', 'investmentSite.mapProvider');
      document.missingData = document.missingData.filter(item => item.idHint !== mapGroupId);
      return;
    }
  }
  document.missingData.push({ page: 1, fieldKeys: [], idHint: mapGroupId, reason });
}
