import { NextRequest } from 'next/server';
import { calculateConfigurationLine, sumConfiguration } from 'lib/onrevolt/calculator';
import { jsonResponse, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

const nonPricedSupplyModes = new Set(['CLIENT_OWNED_USED', 'CLIENT_SUPPLIED_NEW', 'NOT_INCLUDED']);

function optionalNumber(value: unknown) {
  if (value == null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Nieprawidłowa wartość liczbowa: ${value}`);
  return number;
}

function lineInputFromItem(item: Record<string, any>) {
  const supplyMode = typeof item.supplyMode === 'string' ? item.supplyMode : 'ONREVOLT_SUPPLIED';
  if (nonPricedSupplyModes.has(supplyMode)) {
    return {
      quantity: Number(item.quantity || 0),
      unitPurchaseNet: 0,
      purchaseVatRate: 0,
      operatingCostNet: 0,
      marginRate: 0,
      saleVatRate: 0,
      includeVatSurplus: false,
    };
  }

  return {
    quantity: Number(item.quantity),
    unitPurchaseNet: Number(item.unitPurchaseNet || 0),
    purchaseVatRate: Number(item.purchaseVatRate || 0),
    operatingCostNet: Number(item.operatingCostNet || 0),
    marginRate: Number(item.marginRate || 0),
    saleVatRate: Number(item.saleVatRate || 0),
    includeVatSurplus: item.includeVatSurplus !== false,
    forcedSaleNet: item.forcedSaleNet == null || item.forcedSaleNet === '' ? undefined : Number(item.forcedSaleNet),
  };
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const workspace = req.nextUrl.searchParams.get('workspace') === '1';
    const configurations = await prisma.configuration.findMany({
      include: { project: { include: { client: true } }, items: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    if (!workspace) return jsonResponse({ ok: true, data: configurations });

    const [templates, projects, products] = await Promise.all([
      prisma.configurationTemplate.findMany({
        include: {
          items: {
            include: { product: true },
            orderBy: { position: 'asc' },
          },
        },
        orderBy: [{ kind: 'asc' }, { clientType: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.project.findMany({
        include: {
          client: true,
          investmentSite: true,
          existingAssets: {
            orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 500,
      }),
      prisma.product.findMany({
        include: {
          prices: {
            orderBy: { validFrom: 'desc' },
            take: 1,
          },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    return jsonResponse({
      ok: true,
      data: {
        configurations,
        templates,
        projects,
        products,
      },
    });
  } catch (error) {
    return serverError('Nie udało się pobrać konfiguracji', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'configurations.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) throw new Error('Konfiguracja wymaga przynajmniej jednej pozycji');

    const lineInputs = rawItems.map((item) => lineInputFromItem(item));
    const totals = sumConfiguration(lineInputs);

    const configuration = await prisma.configuration.create({
      data: {
        projectId: requireString(body, 'projectId'),
        templateId: optionalString(body, 'templateId'),
        name: requireString(body, 'name'),
        kind: requireString(body, 'kind') as any,
        clientType: requireString(body, 'clientType') as any,
        status: body.status || 'DRAFT',
        goal: optionalString(body, 'goal') as any,
        roofType: optionalString(body, 'roofType') as any,
        targetPowerKw: optionalNumber(body.targetPowerKw),
        targetCapacityKwh: optionalNumber(body.targetCapacityKwh),
        existingAssetsSnapshot: Array.isArray(body.existingAssetsSnapshot) ? body.existingAssetsSnapshot : undefined,
        totalPurchaseNet: totals.purchaseNet,
        totalSaleGross: totals.saleGross,
        totalProfitNet: totals.profitNet,
        requiresReview: Boolean(body.requiresReview),
        reviewNotes: optionalString(body, 'reviewNotes'),
        items: {
          create: rawItems.map((item, index) => {
            const calculated = calculateConfigurationLine(lineInputs[index]);
            return {
              productId: typeof item.productId === 'string' ? item.productId : undefined,
              position: Number.isInteger(Number(item.position)) ? Number(item.position) : index + 1,
              description: String(item.description || item.name || `Pozycja ${index + 1}`),
              quantity: lineInputs[index].quantity,
              role: (typeof item.role === 'string' ? item.role : 'OTHER') as any,
              supplyMode: (typeof item.supplyMode === 'string' ? item.supplyMode : 'ONREVOLT_SUPPLIED') as any,
              unitPurchaseNet: lineInputs[index].unitPurchaseNet,
              purchaseVatRate: lineInputs[index].purchaseVatRate,
              operatingCostNet: lineInputs[index].operatingCostNet,
              marginRate: lineInputs[index].marginRate,
              saleVatRate: lineInputs[index].saleVatRate,
              saleNet: calculated.saleNet,
              saleGross: calculated.saleGross,
              profitNet: calculated.profitNet,
              vatSurplus: calculated.vatSurplus,
              isOptional: Boolean(item.isOptional),
              requiresReview: Boolean(item.requiresReview),
              sourceSheet: typeof item.sourceSheet === 'string' ? item.sourceSheet : undefined,
              sourceRow: Number.isInteger(Number(item.sourceRow)) ? Number(item.sourceRow) : undefined,
              notes: typeof item.notes === 'string' ? item.notes : undefined,
            };
          }),
        },
      },
      include: { items: true },
    });

    return jsonResponse({ ok: true, data: configuration }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać konfiguracji', error);
  }
}
