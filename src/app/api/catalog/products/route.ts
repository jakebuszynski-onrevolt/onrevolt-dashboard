import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { badRequest, forbidden, jsonResponse, notFound, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { resolveCatalogMediaPath } from 'lib/onrevolt/catalog-media';
import { prisma } from 'lib/onrevolt/prisma';
import { productDeleteBlockReason } from 'lib/onrevolt/product-lifecycle';
import {
  activeProductPriceInclude,
  parseProductPriceInput,
  productPriceChanged,
  productPriceData,
} from 'lib/onrevolt/catalog-product-pricing';
import { authorizeStaffRequest, isAdminUser } from 'lib/onrevolt/staff-server';

const editableStringFields = [
  'sku',
  'legacySku',
  'availability',
  'producer',
  'supplier',
  'supplierSku',
  'supplierUrl',
  'clientType',
  'description',
  'powerCapacity',
  'voltageKind',
  'notes',
  'sourceSheet',
] as const;

function nullableString(body: Record<string, any>, key: string) {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`Pole ${key} musi być tekstem`);
  return value.trim() || null;
}

function parseOptionalInt(body: Record<string, any>, key: string) {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`Pole ${key} musi być liczbą całkowitą`);
  return number;
}

function includeProductDetails() {
  return {
    prices: activeProductPriceInclude(),
    media: { orderBy: { sortOrder: 'asc' as const } },
  };
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const products = await prisma.product.findMany({
      include: includeProductDetails(),
      orderBy: { name: 'asc' },
      take: 500,
    });
    return jsonResponse({ ok: true, data: products });
  } catch (error) {
    return serverError('Nie udało się pobrać katalogu', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'catalog.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const price = parseProductPriceInput(body.price);
    const sourceRow = parseOptionalInt(body, 'sourceRow');
    const product = await prisma.product.create({
      data: {
        sku: optionalString(body, 'sku'),
        legacySku: optionalString(body, 'legacySku'),
        name: requireString(body, 'name'),
        availability: optionalString(body, 'availability'),
        producer: optionalString(body, 'producer'),
        supplier: optionalString(body, 'supplier'),
        supplierSku: optionalString(body, 'supplierSku'),
        supplierUrl: optionalString(body, 'supplierUrl'),
        category: requireString(body, 'category') as any,
        clientType: optionalString(body, 'clientType') as any,
        description: optionalString(body, 'description'),
        powerCapacity: optionalString(body, 'powerCapacity'),
        voltageKind: optionalString(body, 'voltageKind'),
        notes: optionalString(body, 'notes'),
        sourceSheet: optionalString(body, 'sourceSheet'),
        sourceRow: sourceRow ?? undefined,
        prices: price ? {
          create: productPriceData(price),
        } : undefined,
      },
      include: includeProductDetails(),
    });
    return jsonResponse({ ok: true, data: product }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać produktu', error);
  }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'catalog.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const existing = await prisma.product.findUnique({
      where: { id },
      include: { prices: activeProductPriceInclude() },
    });

    if (!existing) return notFound('Produkt nie istnieje');

    const updateData: Record<string, any> = {};
    if ('name' in body) updateData.name = requireString(body, 'name');
    if ('category' in body) updateData.category = requireString(body, 'category') as any;
    for (const field of editableStringFields) {
      const value = nullableString(body, field);
      if (value !== undefined) updateData[field] = value;
    }
    const sourceRow = parseOptionalInt(body, 'sourceRow');
    if (sourceRow !== undefined) updateData.sourceRow = sourceRow;

    const price = parseProductPriceInput(body.price);

    const product = await prisma.$transaction(async (tx) => {
      if (Object.keys(updateData).length) {
        await tx.product.update({ where: { id }, data: updateData });
      }

      const latestPrice = existing.prices[0];
      if (price && (!latestPrice || productPriceChanged(latestPrice, price))) {
        await tx.productPrice.create({
          data: {
            productId: id,
            ...productPriceData(price),
          },
        });
      }

      return tx.product.findUnique({
        where: { id },
        include: includeProductDetails(),
      });
    });

    return jsonResponse({ ok: true, data: product });
  } catch (error) {
    if (error instanceof Error) return badRequest(error.message);
    return serverError('Nie udało się zaktualizować produktu', error);
  }
}

export async function DELETE(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'catalog.manage');
  if (!access.ok) return access.response;
  if (!isAdminUser(access.user)) return forbidden('Tylko administrator może usuwać produkty z katalogu');

  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const existing = await prisma.product.findUnique({
      where: { id },
      include: {
        prices: { orderBy: { validFrom: 'desc' } },
        media: { orderBy: { sortOrder: 'asc' } },
        _count: {
          select: {
            templateItems: true,
            configItems: true,
            existingAssets: true,
            installationPlannedItems: true,
            installed: true,
            purchaseOrderItems: true,
            stockReservations: true,
          },
        },
      },
    });
    if (!existing) return notFound('Produkt nie istnieje');

    const blockReason = productDeleteBlockReason(existing._count);
    if (blockReason) return badRequest(blockReason);

    const mediaPaths = existing.media
      .map((media) => resolveCatalogMediaPath(media))
      .filter((filePath): filePath is string => Boolean(filePath));

    await prisma.$transaction(async (tx) => {
      await tx.product.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          actorId: access.user.id,
          entityType: 'Product',
          entityId: existing.id,
          action: 'DELETE',
          before: JSON.parse(JSON.stringify(existing)),
        },
      });
    });

    const fileResults = await Promise.allSettled(mediaPaths.map((filePath) => fs.unlink(filePath)));
    const filesDeleted = fileResults.filter((result) => result.status === 'fulfilled').length;

    return jsonResponse({ ok: true, data: { id: existing.id, filesDeleted } });
  } catch (error) {
    return serverError('Nie udało się usunąć produktu', error);
  }
}
