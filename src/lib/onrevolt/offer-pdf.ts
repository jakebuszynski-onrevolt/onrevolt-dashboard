import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadOfferCoverImageDataUrl } from './offer-document-files';
import { buildOfferReport } from './offer-report';
import { renderAllOfferSvgPages } from './offer-svg-renderer';
import { reformB2cTemplate } from './offer-template-manifest';

export type PreparedOfferPdf = {
  absolutePath: string;
  fileName: string;
  mimeType: 'application/pdf';
  sha256: string;
  sizeBytes: number;
  storagePath: string;
  templateKey: string;
  templateVersion: string;
};

function uploadRoot() {
  const configured = process.env.ONREVOLT_UPLOAD_DIR?.trim();
  if (!configured) throw new Error('Brak ONREVOLT_UPLOAD_DIR dla dokumentów ofert');
  return path.resolve(configured);
}

function safeFilePart(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function pdfHtml(svgPages: string[]) {
  return `<!doctype html>
  <html lang="pl"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #f1f4fa; }
    .page { width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: auto; break-after: auto; }
    .page > svg { display: block; width: 210mm; height: 297mm; }
  </style></head><body>${svgPages.map((svg) => `<section class="page">${svg}</section>`).join('')}</body></html>`;
}

export async function generateOfferPdf(offer: any) {
  if (buildOfferReport(offer).variant !== 'B2C') {
    throw new Error('Generator PDF REFORM_B2C obsługuje wyłącznie oferty B2C');
  }
  const coverImageDataUrl = await loadOfferCoverImageDataUrl(offer);
  const svgPages = renderAllOfferSvgPages(offer, { coverImageDataUrl });
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1 });
    await page.setContent(pdfHtml(svgPages), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({
      format: 'A4',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true,
      preferCSSPageSize: true,
    }));
  } finally {
    await browser.close();
  }
}

export async function prepareOfferPdfArchive(offer: any): Promise<PreparedOfferPdf> {
  const bytes = await generateOfferPdf(offer);
  const root = uploadRoot();
  const directory = path.join('offers', offer.id);
  const numberPart = safeFilePart(offer.number || offer.id) || offer.id;
  const fileName = `${numberPart}-v${offer.version}.pdf`;
  const storagePath = path.join(directory, fileName).replaceAll('\\', '/');
  const absolutePath = path.resolve(root, storagePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error('Nieprawidłowa ścieżka archiwum oferty');
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return {
    absolutePath,
    fileName,
    mimeType: 'application/pdf',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
    storagePath,
    templateKey: reformB2cTemplate.key,
    templateVersion: reformB2cTemplate.version,
  };
}

export async function removePreparedOfferPdf(prepared: PreparedOfferPdf) {
  await rm(prepared.absolutePath, { force: true });
}

export async function readArchivedOfferPdf(storagePath: string) {
  const root = uploadRoot();
  const absolutePath = path.resolve(root, storagePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error('Nieprawidłowa ścieżka archiwum oferty');
  return readFile(absolutePath);
}

export function isGeneratedOfferPdf(document: any, offer: any) {
  const tags = document?.tags && typeof document.tags === 'object' && !Array.isArray(document.tags)
    ? document.tags as Record<string, unknown>
    : {};
  return document.type === 'OFERTA'
    && tags.generated === true
    && Number(tags.offerVersion) === Number(offer.version)
    && tags.templateKey === reformB2cTemplate.key
    && tags.templateVersion === reformB2cTemplate.version;
}
