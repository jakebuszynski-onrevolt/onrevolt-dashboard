import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import sharp from 'sharp';
import { prisma } from './prisma';
import { fetchLocationMapImage } from './location-map-images';
import type { OfferWorkspaceDocumentResult } from './offer-workspace-document';
import type { OfferWorkspace } from './offer-workspace-server';

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
    try {
      const project = await prisma.project.findUnique({
        where: { id: workspace.projectId },
        select: { investmentSite: { select: { latitude: true, longitude: true, mapProvider: true } } },
      });
      const site = project?.investmentSite;
      if (!site || site.latitude == null || site.longitude == null
        || Number(site.latitude) !== location.latitude || Number(site.longitude) !== location.longitude) {
        throw new Error('Lokalizacja zmieniła się podczas przygotowania dokumentu.');
      }
      const source = await fetchLocationMapImage(site.mapProvider, location.latitude, location.longitude);
      if (source.bytes.length > 12 * 1024 * 1024) throw new Error('Obraz lokalizacji jest zbyt duży.');
      const png = await sharp(source.bytes, { limitInputPixels: 16_000_000 }).png().toBuffer();
      page.svg = embedOfferWorkspaceMap(page.svg, png);
      document.sourceFieldsUsed.push('input.location', 'investmentSite.mapProvider');
      document.missingData = document.missingData.filter(item => item.idHint !== mapGroupId);
      return;
    } catch {
      reason = 'Nie udało się pobrać zdjęcia lokalizacji z wybranego źródła mapy. Ponów podgląd dokumentu.';
    }
  }
  document.missingData.push({ page: 1, fieldKeys: [], idHint: mapGroupId, reason });
}
