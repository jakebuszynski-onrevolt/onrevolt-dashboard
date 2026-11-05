import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { writeAuditLog } from 'lib/onrevolt/audit';
import {
  badRequest,
  forbidden,
  jsonResponse,
  notFound,
  optionalString,
  readJsonObject,
  requireString,
  serverError,
} from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest, isAdminUser } from 'lib/onrevolt/staff-server';
import { resolveTemplateItemCosts, resolveTemplateItemSaleVat } from 'lib/onrevolt/configuration-templates';

function templateInclude(asOf = new Date()) {
  return {
    items: {
      include: {
        product: {
          include: {
            prices: { where: { validFrom: { lte: asOf } }, orderBy: { validFrom: 'desc' as const }, take: 1 },
          },
        },
      },
      orderBy: { position: 'asc' as const },
    },
    _count: { select: { configs: true } },
  } as const;
}

function optionalNumber(value: unknown) {
  if (value == null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Nieprawidłowa wartość liczbowa: ${value}`);
  return number;
}

function requiredNumber(value: unknown, fieldName: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Nieprawidłowa wartość pola ${fieldName}: ${value}`);
  return number;
}

class CatalogPriceChangedError extends Error {}

async function itemData(item: Record<string, any>, index: number) {
  const productId = typeof item.productId === 'string' && item.productId ? item.productId : undefined;
  const pricingMode = item.pricingMode || (productId ? 'CATALOG' : 'INDIVIDUAL');
  const operatingCostBasis = pricingMode === 'CATALOG' ? 'PER_UNIT' : item.operatingCostBasis || 'PER_UNIT';
  if (!['CATALOG', 'INDIVIDUAL', 'LEGACY'].includes(pricingMode)) throw new Error(`Nieprawidłowe źródło ceny pozycji ${index + 1}`);
  if (!['PER_UNIT', 'PER_LINE'].includes(operatingCostBasis)) throw new Error(`Nieprawidłowy koszt realizacji pozycji ${index + 1}`);
  let priceFields: Record<string, unknown> = {};
  let catalogPriceId: string | undefined;

  if (pricingMode === 'CATALOG') {
    if (!productId) throw new Error(`Pozycja ${index + 1} wymaga produktu z katalogu`);
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { prices: { where: { validFrom: { lte: new Date() } }, orderBy: { validFrom: 'desc' }, take: 1 } },
    });
    const price = product?.prices[0];
    if (!price) throw new Error(`Brak aktualnej ceny katalogowej: ${item.description || item.name || `pozycja ${index + 1}`}`);
    const costs = resolveTemplateItemCosts({
      productId,
      product: { name: product.name, prices: [price] },
      pricingMode,
      operatingCostBasis,
      description: item.description,
    });
    catalogPriceId = costs.catalogPriceId || undefined;
    if (item._requireCurrentCatalogPrice === true && item.catalogPriceId && item.catalogPriceId !== catalogPriceId) {
      throw new CatalogPriceChangedError(`Cena katalogowa pozycji „${item.description || 'bez nazwy'}” zmieniła się. Odśwież podgląd przed zapisem.`);
    }
    priceFields = {
      unitPurchaseNet: costs.unitPurchaseNet,
      purchaseVatRate: costs.purchaseVatRate,
      operatingCostNet: costs.operatingCostNet,
      marginRate: costs.marginRate,
      saleVatRate: resolveTemplateItemSaleVat({
        productId,
        product: { name: product.name, prices: [price] },
        pricingMode,
        description: item.description,
      }),
    };
  }

  return {
    productId,
    position: Number.isInteger(Number(item.position)) ? Number(item.position) : index + 1,
    description: String(item.description || item.name || `Pozycja ${index + 1}`),
    quantity: requiredNumber(item.quantity, `items[${index}].quantity`),
    role: (typeof item.role === 'string' ? item.role : 'OTHER') as any,
    supplyMode: (typeof item.supplyMode === 'string' ? item.supplyMode : 'ONREVOLT_SUPPLIED') as any,
    ...priceFields,
    ...(pricingMode === 'CATALOG' ? {} : {
      unitPurchaseNet: optionalNumber(item.unitPurchaseNet),
      purchaseVatRate: optionalNumber(item.purchaseVatRate),
      operatingCostNet: optionalNumber(item.operatingCostNet),
      marginRate: optionalNumber(item.marginRate),
      saleVatRate: optionalNumber(item.saleVatRate),
    }),
    pricingMode,
    operatingCostBasis,
    catalogPriceId,
    isOptional: Boolean(item.isOptional),
    requiresReview: Boolean(item.requiresReview),
    sourceSheet: typeof item.sourceSheet === 'string' ? item.sourceSheet : undefined,
    sourceRow: Number.isInteger(Number(item.sourceRow)) ? Number(item.sourceRow) : undefined,
    notes: typeof item.notes === 'string' ? item.notes : undefined,
  };
}

function templateData(body: Record<string, any>) {
  return {
    name: requireString(body, 'name'),
    kind: requireString(body, 'kind') as any,
    clientType: requireString(body, 'clientType') as any,
    roofType: optionalString(body, 'roofType') as any,
    goal: optionalString(body, 'goal') as any,
    powerKw: optionalNumber(body.powerKw),
    capacityKwh: optionalNumber(body.capacityKwh),
    sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 1000,
    requiresExistingPv: Boolean(body.requiresExistingPv),
    requiresExistingInverter: Boolean(body.requiresExistingInverter),
    notes: optionalString(body, 'notes'),
  };
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'pricing.read');
  if (!access.ok) return access.response;
  try {
    const id = req.nextUrl.searchParams.get('id');
    const familyKey = req.nextUrl.searchParams.get('familyKey');
    const includeArchived = req.nextUrl.searchParams.get('includeArchived') === '1';
    if (id) {
      const template = await prisma.configurationTemplate.findUnique({ where: { id }, include: templateInclude() });
      if (!template) return notFound('Nie znaleziono szablonu konfiguracji');
      return jsonResponse({ ok: true, data: template });
    }

    const templates = await prisma.configurationTemplate.findMany({
      where: {
        ...(familyKey ? { familyKey } : {}),
        ...(!includeArchived ? { isActive: true } : {}),
      },
      include: templateInclude(),
      orderBy: [{ isActive: 'desc' }, { kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }, { clientType: 'asc' }],
    });
    return jsonResponse({ ok: true, data: templates });
  } catch (error) {
    return serverError('Nie udało się pobrać szablonów konfiguracji', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'configurations.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) throw new Error('Szablon wymaga przynajmniej jednej pozycji');

    const familyKey = optionalString(body, 'familyKey') || `template-${randomUUID()}`;
    const clientType = requireString(body, 'clientType');
    const duplicateVariant = await prisma.configurationTemplate.findFirst({
      where: { familyKey, clientType: clientType as any, isActive: true },
      select: { id: true },
    });
    if (duplicateVariant) return badRequest('Ta rodzina ma już aktywny wariant dla wybranego typu klienta');

    const now = new Date();
    const items = await Promise.all(rawItems.map(itemData));
    const template = await prisma.configurationTemplate.create({
      data: {
        familyKey,
        version: 1,
        isActive: true,
        ...templateData(body),
        sourceSheet: 'Panel konfiguratora',
        sourceRange: `custom-${now.toISOString()}-${randomUUID()}`,
        items: { create: items },
      },
      include: templateInclude(),
    });
    await writeAuditLog({
      actorId: access.user.id,
      entityType: 'ConfigurationTemplate',
      entityId: template.id,
      action: 'CREATE',
      after: template,
    });
    return jsonResponse({ ok: true, data: template }, { status: 201 });
  } catch (error) {
    if (error instanceof CatalogPriceChangedError) return badRequest(error.message);
    return serverError('Nie udało się zapisać szablonu konfiguracji', error);
  }
}

export async function PUT(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'configurations.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) throw new Error('Szablon wymaga przynajmniej jednej pozycji');

    const existing = await prisma.configurationTemplate.findUnique({ where: { id }, include: templateInclude() });
    if (!existing) return notFound('Nie znaleziono szablonu konfiguracji');

    const items = await Promise.all(rawItems.map(itemData));
    const updated = await prisma.$transaction(async (tx) => {
      const sharedName = requireString(body, 'name');
      await tx.configurationTemplate.updateMany({
        where: { familyKey: existing.familyKey },
        data: { name: sharedName },
      });
      return tx.configurationTemplate.update({
        where: { id },
        data: {
          ...templateData(body),
          version: { increment: 1 },
          items: {
            deleteMany: {},
            create: items,
          },
        },
        include: templateInclude(),
      });
    });
    await writeAuditLog({
      actorId: access.user.id,
      entityType: 'ConfigurationTemplate',
      entityId: updated.id,
      action: 'UPDATE',
      before: existing,
      after: updated,
    });
    return jsonResponse({ ok: true, data: updated });
  } catch (error) {
    if (error instanceof CatalogPriceChangedError) return badRequest(error.message);
    return serverError('Nie udało się zaktualizować szablonu konfiguracji', error);
  }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'configurations.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const id = optionalString(body, 'id');
    const familyKey = optionalString(body, 'familyKey');
    if (!id && !familyKey) return badRequest('Podaj szablon lub rodzinę szablonów');
    if (typeof body.isActive !== 'boolean') return badRequest('Podaj stan aktywności szablonu');

    const where = familyKey ? { familyKey } : { id: id! };
    const existing = await prisma.configurationTemplate.findMany({ where, include: templateInclude() });
    if (existing.length === 0) return notFound('Nie znaleziono szablonu konfiguracji');
    await prisma.configurationTemplate.updateMany({ where, data: { isActive: body.isActive } });

    await writeAuditLog({
      actorId: access.user.id,
      entityType: 'ConfigurationTemplateFamily',
      entityId: familyKey || id!,
      action: body.isActive ? 'REACTIVATE' : 'ARCHIVE',
      before: existing,
      after: { isActive: body.isActive },
    });
    const templates = await prisma.configurationTemplate.findMany({ where, include: templateInclude() });
    return jsonResponse({ ok: true, data: templates });
  } catch (error) {
    return serverError('Nie udało się zmienić aktywności szablonu', error);
  }
}

export async function DELETE(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'configurations.manage');
  if (!access.ok) return access.response;
  if (!isAdminUser(access.user)) return forbidden('Tylko administrator może trwale usuwać szablony');
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const existing = await prisma.configurationTemplate.findUnique({ where: { id }, include: templateInclude() });
    if (!existing) return notFound('Nie znaleziono szablonu konfiguracji');
    if (existing._count.configs > 0) {
      return badRequest('Szablon jest używany przez konfiguracje klientów. Zarchiwizuj go zamiast usuwać.');
    }

    await prisma.configurationTemplate.delete({ where: { id } });
    await writeAuditLog({
      actorId: access.user.id,
      entityType: 'ConfigurationTemplate',
      entityId: existing.id,
      action: 'DELETE',
      before: existing,
    });
    return jsonResponse({ ok: true, data: { id } });
  } catch (error) {
    return serverError('Nie udało się usunąć szablonu konfiguracji', error);
  }
}
