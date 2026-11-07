import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const fileHashes = new Map<string, { signature: string; hash: string }>();

async function sourceFilesRevision(files: string[]): Promise<string> {
  const hashes = await Promise.all(files.map(async file => {
    const absolute = path.join(process.cwd(), file);
    const metadata = await stat(absolute);
    const signature = JSON.stringify([metadata.size, metadata.mtimeMs, metadata.ctimeMs, metadata.ino]);
    const cached = fileHashes.get(absolute);
    if (cached?.signature === signature) return cached.hash;
    const hash = createHash('sha256').update(await readFile(absolute)).digest('hex');
    fileHashes.set(absolute, { signature, hash });
    return hash;
  }));
  return createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
}

/** The source and font files are deployed together with the renderer. Changing any
 * of them invalidates documents even when the offer input is unchanged. */
export async function offerDocumentRenderingRevision(): Promise<string> {
  const files = [
    'src/lib/onrevolt/offer-workspace-document.ts',
    'src/lib/onrevolt/monthly-cell-shading.ts',
    'src/lib/onrevolt/offer-svg-renderer.ts',
    'src/lib/onrevolt/offer-template-v4.ts',
    'src/lib/onrevolt/offer-workspace-pricing.ts',
    'src/lib/onrevolt/offer-workspace-commercial-pricing.ts',
    'src/lib/onrevolt/offer-workspace-configuration-edits.ts',
    'src/lib/onrevolt/offer-workspace-chart-data.ts',
    'src/lib/onrevolt/offer-workspace-savings.ts',
    'src/lib/onrevolt/configuration-templates.ts',
    'src/lib/onrevolt/offer-storage-illustration.ts',
    'assets/offer-storage/powerbrick-plus.png',
    'assets/offer-storage/stack-dimensions-blank.png',
    'assets/offer-storage/stack314.png',
    'assets/offer-storage/cabinet-bf100.png',
    ...['Regular', 'Bold', 'Italic'].map(style => `public/fonts/dm-sans/DMSans-${style}.ttf`),
    ...Array.from({ length: 10 }, (_, i) => `assets/offer-templates/REFORM_B2C/2026_10_V4/page-${String(i + 1).padStart(2, '0')}.svg`),
  ];
  return sourceFilesRevision(files);
}

export async function offerDocumentMapRevision(): Promise<string> {
  return sourceFilesRevision(['src/lib/onrevolt/offer-workspace-document-assets.ts',
    'src/lib/onrevolt/location-map-images.ts', 'src/lib/onrevolt/location-maps.ts',
    'src/lib/onrevolt/google-maps.ts', 'node_modules/sharp/package.json']);
}

export async function offerDocumentPdfRevision(): Promise<string> {
  const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  const files = ['src/lib/onrevolt/offer-pdf.ts', 'node_modules/playwright-core/browsers.json',
    'node_modules/playwright-core/package.json', 'node_modules/playwright/package.json'];
  // Playwright's default headless launch can use its separate headless-shell
  // binary. Its manifest and launcher version identify that exact distribution.
  const hash = createHash('sha256').update(JSON.stringify({ executable: executable || 'playwright-default-headless',
    platform: process.platform, arch: process.arch }));
  if (executable) {
    const binary = await stat(executable);
    hash.update(JSON.stringify({ size: binary.size, mtimeMs: binary.mtimeMs, ctimeMs: binary.ctimeMs }));
  }
  for (const file of files) hash.update(await readFile(path.join(process.cwd(), file)));
  return hash.digest('hex');
}
