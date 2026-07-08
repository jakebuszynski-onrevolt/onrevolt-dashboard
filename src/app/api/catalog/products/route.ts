import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, notFound, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

type ProductPriceInput = {
  purchaseNet: number;
  currentPurchaseNet?: number | null;
  purchaseVatRate: number;
  operatingCostNet: number;
  marginRate: number;
  saleVatRate: number;
  currency: string;
};

const editableStringFields = [
  'sku',
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

function normalizeNumber(value: unknown, key: string) {
  const normalized = typeof value === 'string' ? value.replace(',', '.').trim() : value;
  const number = Number(normalized);
  if (!Number.isFinite(number)) throw new Error(`Pole ${key} musi być liczbą`);
  return number;
}

function parsePriceInput(value: unknown): ProductPriceInput | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Pole price musi być obiektem');
  }

  const price = value as Record<string, unknown>;
  return {
    purchaseNet: normalizeNumber(price.purchaseNet, 'price.purchaseNet'),
    currentPurchaseNet: price.currentPurchaseNet == null || price.currentPurchaseNet === ''
      ? undefined
      : normalizeNumber(price.currentPurchaseNet, 'price.currentPurchaseNet'),
    purchaseVatRate: normalizeNumber(price.purchaseVatRate, 'price.purchaseVatRate'),
    operatingCostNet: normalizeNumber(price.operatingCostNet, 'price.operatingCostNet'),
    marginRate: normalizeNumber(price.marginRate, 'price.marginRate'),
    saleVatRate: normalizeNumber(price.saleVatRate, 'price.saleVatRate'),
    currency: typeof price.currency === 'string' && price.currency.trim() ? price.currency.trim() : 'PLN',
  };
}

function decimalNumber(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'object' && 'toString' in value) return Number(value.toString());
  return Number(value);
}

function priceChanged(current: any, next: ProductPriceInput) {
  return (
    decimalNumber(current.purchaseNet) !== next.purchaseNet ||
    decimalNumber(current.currentPurchaseNet) !== (next.currentPurchaseNet ?? null) ||
    decimalNumber(current.purchaseVatRate) !== next.purchaseVatRate ||
    decimalNumber(current.operatingCostNet) !== next.operatingCostNet ||
    decimalNumber(current.marginRate) !== next.marginRate ||
    decimalNumber(current.saleVatRate) !== next.saleVatRate ||
    current.currency !== next.currency
  );
}

function includeProductDetails() {
  return {
    prices: { orderBy: { validFrom: 'desc' as const }, take: 1 },
    media: { orderBy: { sortOrder: 'asc' as const } },
  };
}

export async function GET() {
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
  try {
    const body = await readJsonObject(req);
    const price = parsePriceInput(body.price);
    const sourceRow = parseOptionalInt(body, 'sourceRow');
    const product = await prisma.product.create({
      data: {
        sku: optionalString(body, 'sku'),
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
          create: {
            purchaseNet: price.purchaseNet,
            currentPurchaseNet: price.currentPurchaseNet ?? undefined,
            purchaseVatRate: price.purchaseVatRate,
            operatingCostNet: price.operatingCostNet,
            marginRate: price.marginRate,
            saleVatRate: price.saleVatRate,
            currency: price.currency,
          },
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
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const existing = await prisma.product.findUnique({
      where: { id },
      include: { prices: { orderBy: { validFrom: 'desc' }, take: 1 } },
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

    const price = parsePriceInput(body.price);

    const product = await prisma.$transaction(async (tx) => {
      if (Object.keys(updateData).length) {
        await tx.product.update({ where: { id }, data: updateData });
      }

      const latestPrice = existing.prices[0];
      if (price && (!latestPrice || priceChanged(latestPrice, price))) {
        await tx.productPrice.create({
          data: {
            productId: id,
            purchaseNet: price.purchaseNet,
            currentPurchaseNet: price.currentPurchaseNet ?? undefined,
            purchaseVatRate: price.purchaseVatRate,
            operatingCostNet: price.operatingCostNet,
            marginRate: price.marginRate,
            saleVatRate: price.saleVatRate,
            currency: price.currency,
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
