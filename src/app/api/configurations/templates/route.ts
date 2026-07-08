import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

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

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) throw new Error('Szablon wymaga przynajmniej jednej pozycji');

    const now = new Date();
    const template = await prisma.configurationTemplate.create({
      data: {
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
        sourceSheet: 'Panel konfiguratora',
        sourceRange: `custom-${now.toISOString()}`,
        notes: optionalString(body, 'notes') || 'Szablon dodany ręcznie w panelu.',
        items: {
          create: rawItems.map((item, index) => ({
            productId: typeof item.productId === 'string' && item.productId ? item.productId : undefined,
            position: Number.isInteger(Number(item.position)) ? Number(item.position) : index + 1,
            description: String(item.description || item.name || `Pozycja ${index + 1}`),
            quantity: requiredNumber(item.quantity, `items[${index}].quantity`),
            role: (typeof item.role === 'string' ? item.role : 'OTHER') as any,
            supplyMode: (typeof item.supplyMode === 'string' ? item.supplyMode : 'ONREVOLT_SUPPLIED') as any,
            unitPurchaseNet: optionalNumber(item.unitPurchaseNet),
            purchaseVatRate: optionalNumber(item.purchaseVatRate),
            operatingCostNet: optionalNumber(item.operatingCostNet),
            marginRate: optionalNumber(item.marginRate),
            saleVatRate: optionalNumber(item.saleVatRate),
            isOptional: Boolean(item.isOptional),
            requiresReview: Boolean(item.requiresReview),
            sourceSheet: typeof item.sourceSheet === 'string' ? item.sourceSheet : undefined,
            sourceRow: Number.isInteger(Number(item.sourceRow)) ? Number(item.sourceRow) : undefined,
            notes: typeof item.notes === 'string' ? item.notes : undefined,
          })),
        },
      },
      include: {
        items: {
          include: { product: true },
          orderBy: { position: 'asc' },
        },
      },
    });

    return jsonResponse({ ok: true, data: template }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać szablonu konfiguracji', error);
  }
}
