import convertHeic from 'heic-convert';
import path from 'path';
import sharp from 'sharp';

const heicExtensions = new Set(['.heic', '.heif']);

type DocumentFile = {
  bytes: Buffer;
  fileName: string;
  mimeType?: string;
};

type HeicConverter = (options: {
  buffer: Buffer | Uint8Array;
  format: 'JPEG';
  quality: number;
}) => Promise<Buffer | Uint8Array>;

export function isHeicFileName(fileName: string) {
  return heicExtensions.has(path.extname(fileName).toLowerCase());
}

export async function prepareDocumentFile(
  file: DocumentFile,
  convert: HeicConverter = convertHeic,
): Promise<DocumentFile> {
  if (!isHeicFileName(file.fileName)) return file;

  try {
    const bytes = Buffer.from(await convert({
      buffer: file.bytes,
      format: 'JPEG',
      quality: 0.9,
    }));
    const metadata = await sharp(bytes, {
      failOn: 'error',
      limitInputPixels: 100_000_000,
    }).metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 100_000_000) {
      throw new Error('Nieprawidłowe wymiary obrazu');
    }
    const extension = path.extname(file.fileName);
    const baseName = path.basename(file.fileName, extension) || 'zdjecie';

    return {
      bytes,
      fileName: `${baseName}.jpg`,
      mimeType: 'image/jpeg',
    };
  } catch {
    throw new Error('Nie udało się odczytać zdjęcia HEIC/HEIF. Sprawdź plik i spróbuj ponownie.');
  }
}
