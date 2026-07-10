import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { badRequest, jsonResponse, notFound, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

export const runtime = 'nodejs';

const allowedMimeTypes = new Map([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const allowedKinds = new Set(['datasheet', 'manual', 'certificate', 'warranty', 'document', 'image']);
const maxUploadBytes = 30 * 1024 * 1024;

function formString(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeFileName(fileName: string) {
  return fileName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function publicUrlFor(productId: string, fileName: string) {
  return `/uploads/catalog/products/${encodeURIComponent(productId)}/${encodeURIComponent(fileName)}`;
}

function uploadsRoot() {
  return path.resolve(process.cwd(), 'public', 'uploads', 'catalog', 'products');
}

function isInsideDirectory(filePath: string, rootPath: string) {
  const relative = path.relative(rootPath, filePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function nullableBodyString(body: Record<string, any>, key: string) {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`Pole ${key} musi być tekstem`);
  return value.trim() || null;
}

function optionalBodyInt(body: Record<string, any>, key: string) {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`Pole ${key} musi być liczbą całkowitą`);
  return number;
}

async function createUploadedMedia(req: NextRequest) {
  const form = await req.formData();
  const productId = formString(form, 'productId');
  const requestedKind = formString(form, 'kind');
  const altText = formString(form, 'altText');
  const file = form.get('file');

  if (!productId) return badRequest('Brak wymaganego pola productId');
  if (!allowedKinds.has(requestedKind)) return badRequest('Nieprawidłowy typ medium produktu');
  if (!(file instanceof File)) return badRequest('Brak pliku do zapisania');
  if (file.size <= 0) return badRequest('Plik jest pusty');
  if (file.size > maxUploadBytes) return badRequest('Plik przekracza limit 30 MB');

  const extension = allowedMimeTypes.get(file.type);
  if (!extension) return badRequest('Dozwolone są tylko pliki PDF oraz obrazy JPG, PNG i WEBP');
  if (requestedKind === 'image' && !file.type.startsWith('image/')) {
    return badRequest('Medium typu image wymaga pliku graficznego');
  }
  if (requestedKind !== 'image' && file.type !== 'application/pdf') {
    return badRequest('Medium dokumentowe wymaga pliku PDF');
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return badRequest('Produkt nie istnieje');

  const originalName = sanitizeFileName(file.name || `produkt.${extension}`);
  const storedName = `${randomUUID()}-${originalName || `produkt.${extension}`}`;
  const productDir = path.join(process.cwd(), 'public', 'uploads', 'catalog', 'products', productId);
  const storagePath = path.join(productDir, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());

  await fs.mkdir(productDir, { recursive: true });
  await fs.writeFile(storagePath, buffer);

  const media = await prisma.productMedia.create({
    data: {
      productId,
      kind: requestedKind,
      url: publicUrlFor(productId, storedName),
      storagePath,
      altText: altText || originalName,
      sortOrder: Number.isInteger(Number(form.get('sortOrder'))) ? Number(form.get('sortOrder')) : 0,
    },
  });

  return jsonResponse({ ok: true, data: media }, { status: 201 });
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      return createUploadedMedia(req);
    }

    const body = await readJsonObject(req);
    const kind = requireString(body, 'kind');
    if (!allowedKinds.has(kind)) {
      return badRequest('Nieprawidłowy typ medium produktu');
    }

    const media = await prisma.productMedia.create({
      data: {
        productId: requireString(body, 'productId'),
        kind,
        url: optionalString(body, 'url'),
        storagePath: optionalString(body, 'storagePath'),
        altText: optionalString(body, 'altText'),
        sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
      },
    });
    return jsonResponse({ ok: true, data: media }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać medium produktu', error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const media = await prisma.productMedia.findUnique({ where: { id } });
    if (!media) return notFound('Załącznik produktu nie istnieje');

    const updateData: Record<string, any> = {};
    const sortOrder = optionalBodyInt(body, 'sortOrder');
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    if ('kind' in body) {
      const kind = requireString(body, 'kind');
      if (!allowedKinds.has(kind)) return badRequest('Nieprawidłowy typ medium produktu');
      updateData.kind = kind;
    }
    const altText = nullableBodyString(body, 'altText');
    if (altText !== undefined) updateData.altText = altText;

    if (!Object.keys(updateData).length) return badRequest('Brak pól medium do aktualizacji');

    const updated = await prisma.productMedia.update({
      where: { id },
      data: updateData,
    });
    return jsonResponse({ ok: true, data: updated });
  } catch (error) {
    if (error instanceof Error) return badRequest(error.message);
    return serverError('Nie udało się zaktualizować medium produktu', error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const media = await prisma.productMedia.findUnique({ where: { id } });
    if (!media) return notFound('Załącznik produktu nie istnieje');

    const rootPath = uploadsRoot();
    const filePath = media.storagePath ? path.resolve(media.storagePath) : '';
    if (filePath && !isInsideDirectory(filePath, rootPath)) {
      return badRequest('Plik załącznika jest poza katalogiem uploads; usuń go ręcznie po weryfikacji ścieżki');
    }

    await prisma.productMedia.delete({ where: { id } });

    let fileDeleted = false;
    if (filePath) {
      try {
        await fs.unlink(filePath);
        fileDeleted = true;
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    return jsonResponse({ ok: true, data: { id, fileDeleted } });
  } catch (error) {
    if (error instanceof Error) return badRequest(error.message);
    return serverError('Nie udało się usunąć medium produktu', error);
  }
}
