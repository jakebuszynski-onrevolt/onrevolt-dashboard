import { NextRequest } from 'next/server';
import { calculateConfigurationLine, sumConfiguration } from 'lib/onrevolt/calculator';
import {
  ConfigurationVatMode,
  configurationVatModes,
  defaultSaleVatRateForMode,
  defaultVatModeForClientType,
  resolveSaleVatRate,
} from 'lib/onrevolt/configuration-vat';
import { configurationDeleteBlockReason, configurationEditBlockReason } from 'lib/onrevolt/configuration-lifecycle';
import {
  configurationInvestmentScope,
  resolveTemplateItemCosts,
  resolveTemplateItemSaleVat,
} from 'lib/onrevolt/configuration-templates';
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

const nonPricedSupplyModes = new Set(['CLIENT_OWNED_USED', 'CLIENT_SUPPLIED_NEW', 'NOT_INCLUDED']);

const configurationInclude = {
  project: { include: { client: true } },
  template: true,
  items: {
    include: { product: true },
    orderBy: { position: 'asc' as const },
  },
  _count: { select: { offers: true, offerLinks: true, installations: true, stockReservations: true } },
} as const;

function templateWorkspaceInclude(asOf = new Date()) {
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

function lineInputFromItem(item: Record<string, any>, saleVatMode: ConfigurationVatMode) {
  const supplyMode = typeof item.supplyMode === 'string' ? item.supplyMode : 'ONREVOLT_SUPPLIED';
  if (nonPricedSupplyModes.has(supplyMode)) {
    return {
      quantity: Number(item.quantity || 0),
      unitPurchaseNet: 0,
      purchaseVatRate: 0,
      operatingCostNet: 0,
      marginRate: 0,
      saleVatRate: 0,
      unitSaleNet: undefined,
      includeVatSurplus: false,
    };
  }

  return {
    quantity: Number(item.quantity),
    unitPurchaseNet: Number(item.unitPurchaseNet || 0),
    purchaseVatRate: Number(item.purchaseVatRate || 0),
    operatingCostNet: Number(item.operatingCostNet || 0),
    marginRate: Number(item.marginRate || 0),
    saleVatRate: resolveSaleVatRate(saleVatMode, Number(item.saleVatRate || 0)),
    operatingCostBasis: item.operatingCostBasis || (item.pricingMode === 'LEGACY' ? 'PER_LINE' : 'PER_UNIT'),
    includeVatSurplus: item.includeVatSurplus !== false,
    unitSaleNet: item.unitSaleNet == null || item.unitSaleNet === '' ? undefined : Number(item.unitSaleNet),
    forcedSaleNet: item.forcedSaleNet == null || item.forcedSaleNet === '' ? undefined : Number(item.forcedSaleNet),
  } as Parameters<typeof calculateConfigurationLine>[0] & { operatingCostBasis?: string };
}

class CatalogPriceChangedError extends Error {}

function pricingModeForItem(item: Record<string, any>) {
  const mode = item.pricingMode || (item.productId ? 'CATALOG' : 'INDIVIDUAL');
  if (!['CATALOG', 'INDIVIDUAL', 'LEGACY'].includes(mode)) throw new Error('Nieprawidłowe źródło ceny pozycji');
  return mode;
}

function operatingCostBasisForItem(item: Record<string, any>, pricingMode = pricingModeForItem(item)) {
  if (pricingMode === 'CATALOG') return 'PER_UNIT';
  return item.operatingCostBasis || (pricingMode === 'LEGACY' ? 'PER_LINE' : 'PER_UNIT');
}

function costsFromCatalog(item: Record<string, any>, product: any, inheritItemSaleVat = true) {
  const price = product?.prices?.[0];
  const label = item.description || product?.name || 'pozycja bez nazwy';
  if (!product || !price) throw new Error(`Brak aktualnej ceny katalogowej: ${label}`);
  const resolved = resolveTemplateItemCosts({
    ...item,
    product,
    productId: product.id,
    pricingMode: 'CATALOG',
    operatingCostBasis: 'PER_UNIT',
  });
  return {
    ...resolved,
    saleVatRate: inheritItemSaleVat
      ? resolveTemplateItemSaleVat({ ...item, product, productId: product.id, pricingMode: 'CATALOG' })
      : Number(item.saleVatRate || 0),
  };
}

function costsFromTemplate(item: Record<string, any>, saleVatMode: ConfigurationVatMode) {
  const pricingMode = pricingModeForItem(item);
  const operatingCostBasis = operatingCostBasisForItem(item, pricingMode);
  const costs = pricingMode === 'CATALOG'
    ? costsFromCatalog(item, item.product, saleVatMode === 'MIXED')
    : resolveTemplateItemCosts({ ...item, pricingMode, operatingCostBasis });
  return {
    ...item,
    ...costs,
    pricingMode,
    operatingCostBasis: costs.operatingCostBasis || operatingCostBasis,
    saleVatRate: saleVatMode === 'MIXED'
      ? resolveTemplateItemSaleVat({ ...item, pricingMode })
      : item.saleVatRate,
  };
}

async function resolveConfigurationItemPricing(
  rawItems: Record<string, any>[],
  existingItems: Array<Record<string, any>> = [],
  saleVatMode: ConfigurationVatMode = 'MIXED',
) {
  const productIds = Array.from(new Set(rawItems
    .filter((item) => pricingModeForItem(item) === 'CATALOG' && typeof item.productId === 'string' && item.productId)
    .map((item) => item.productId as string)));
  const products = productIds.length
    ? await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { prices: { where: { validFrom: { lte: new Date() } }, orderBy: { validFrom: 'desc' }, take: 1 } },
    })
    : [];
  const productsById = new Map(products.map((product) => [product.id, product]));
  const existingById = new Map(existingItems.map((item) => [item.id, item]));

  return rawItems.map((item) => {
    const pricingMode = pricingModeForItem(item);
    const operatingCostBasis = operatingCostBasisForItem(item, pricingMode);
    const existing = typeof item.id === 'string' ? existingById.get(item.id) : undefined;
    const unitSaleNet = Object.prototype.hasOwnProperty.call(item, 'unitSaleNet')
      ? optionalNumber(item.unitSaleNet) ?? null
      : existing?.unitSaleNet ?? null;
    if (pricingMode !== 'CATALOG') {
      return { ...item, unitSaleNet, pricingMode, operatingCostBasis, catalogPriceId: null };
    }

    const canPreserveSavedPrice = existing
      && existing.productId === item.productId
      && existing.pricingMode === 'CATALOG'
      && item._recalculateCatalogPrice !== true;
    if (canPreserveSavedPrice) {
      let saleVatRate = existing.saleVatRate;
      if (saleVatMode === 'MIXED' && item._previewCatalogSaleVat === true) {
        const product = productsById.get(item.productId);
        const currentPriceId = product?.prices?.[0]?.id;
        if (!currentPriceId || currentPriceId !== existing.catalogPriceId) {
          throw new CatalogPriceChangedError(`Cena katalogowa pozycji „${item.description || 'bez nazwy'}” zmieniła się. Odśwież podgląd przed zapisem.`);
        }
        saleVatRate = resolveTemplateItemSaleVat({ ...item, product, pricingMode: 'CATALOG' });
      }
      return {
        ...item,
        unitPurchaseNet: existing.unitPurchaseNet,
        purchaseVatRate: existing.purchaseVatRate,
        operatingCostNet: existing.operatingCostNet,
        marginRate: existing.marginRate,
        saleVatRate,
        unitSaleNet,
        pricingMode: 'CATALOG',
        operatingCostBasis: existing.operatingCostBasis,
        catalogPriceId: existing.catalogPriceId,
      };
    }

    const costs = costsFromCatalog(item, productsById.get(item.productId), saleVatMode === 'MIXED');
    if (item._requireCurrentCatalogPrice === true && item.catalogPriceId && item.catalogPriceId !== costs.catalogPriceId) {
      throw new CatalogPriceChangedError(`Cena katalogowa pozycji „${item.description || 'bez nazwy'}” zmieniła się. Odśwież podgląd przed zapisem.`);
    }
    return {
      ...item,
      ...costs,
      unitSaleNet: existing ? null : costs.unitSaleNet ?? null,
      pricingMode: 'CATALOG',
      operatingCostBasis,
    };
  });
}

function defaultVatBasis(mode: ConfigurationVatMode) {
  if (mode === 'REDUCED_8') return 'RESIDENTIAL_INSTALLATION';
  if (mode === 'STANDARD_23') return 'STANDARD_RATE';
  if (mode === 'MIXED') return 'MIXED_RATES';
  return undefined;
}

function copiedItem(item: any, index: number) {
  return {
    productId: item.productId || undefined,
    position: item.position || index + 1,
    description: item.description,
    quantity: Number(item.quantity),
    role: item.role,
    supplyMode: item.supplyMode,
    unitPurchaseNet: Number(item.unitPurchaseNet),
    unitSaleNet: item.unitSaleNet ?? null,
    purchaseVatRate: Number(item.purchaseVatRate),
    operatingCostNet: Number(item.operatingCostNet),
    marginRate: Number(item.marginRate),
    saleVatRate: Number(item.saleVatRate),
    pricingMode: item.pricingMode || (item.productId ? 'CATALOG' : 'INDIVIDUAL'),
    operatingCostBasis: item.operatingCostBasis || (item.pricingMode === 'LEGACY' ? 'PER_LINE' : 'PER_UNIT'),
    catalogPriceId: item.catalogPriceId || undefined,
    saleNet: Number(item.saleNet),
    saleGross: Number(item.saleGross),
    profitNet: Number(item.profitNet),
    vatSurplus: Number(item.vatSurplus),
    isOptional: Boolean(item.isOptional),
    requiresReview: Boolean(item.requiresReview),
    sourceSheet: item.sourceSheet || undefined,
    sourceRow: item.sourceRow || undefined,
    notes: item.notes || undefined,
  };
}

function calculatedItemData(item: Record<string, any>, index: number, lineInput: ReturnType<typeof lineInputFromItem>) {
  const calculated = calculateConfigurationLine(lineInput);
  return {
    productId: typeof item.productId === 'string' && item.productId ? item.productId : undefined,
    position: Number.isInteger(Number(item.position)) ? Number(item.position) : index + 1,
    description: String(item.description || item.name || `Pozycja ${index + 1}`),
    quantity: lineInput.quantity,
    role: (typeof item.role === 'string' ? item.role : 'OTHER') as any,
    supplyMode: (typeof item.supplyMode === 'string' ? item.supplyMode : 'ONREVOLT_SUPPLIED') as any,
    unitPurchaseNet: lineInput.unitPurchaseNet,
    unitSaleNet: lineInput.unitSaleNet ?? null,
    purchaseVatRate: lineInput.purchaseVatRate,
    operatingCostNet: lineInput.operatingCostNet,
    marginRate: lineInput.marginRate,
    saleVatRate: lineInput.saleVatRate,
    pricingMode: pricingModeForItem(item) as any,
    operatingCostBasis: operatingCostBasisForItem(item, pricingModeForItem(item)) as any,
    catalogPriceId: item.catalogPriceId || undefined,
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
}

function validateConfigurationInput(rawItems: Record<string, any>[], saleVatMode: ConfigurationVatMode, vatBasis?: string) {
  if (rawItems.length === 0) throw new Error('Konfiguracja wymaga przynajmniej jednej pozycji');
  if (!configurationVatModes.includes(saleVatMode)) throw new Error('Nieprawidłowy tryb VAT konfiguracji');
  if (saleVatMode === 'REVIEW') throw new Error('Wybierz stawkę VAT sprzedaży przed zapisem konfiguracji');
  if (saleVatMode === 'REDUCED_8' && !vatBasis) throw new Error('Stawka VAT 8% wymaga wskazania podstawy');
  if (saleVatMode === 'MIXED') {
    const invalidIndex = rawItems.findIndex((item) => {
      const supplyMode = typeof item.supplyMode === 'string' ? item.supplyMode : 'ONREVOLT_SUPPLIED';
      if (nonPricedSupplyModes.has(supplyMode)) return false;
      return ![0.08, 0.23].includes(Number(item.saleVatRate));
    });
    if (invalidIndex >= 0) throw new Error(`Pozycja ${invalidIndex + 1} wymaga stawki VAT 8% albo 23%`);
  }
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'pricing.read');
  if (!access.ok) return access.response;
  try {
    const workspace = req.nextUrl.searchParams.get('workspace') === '1';
    const projectId = req.nextUrl.searchParams.get('projectId') || undefined;
    const configurations = await prisma.configuration.findMany({
      where: projectId ? { projectId } : undefined,
      include: configurationInclude,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    if (!workspace) return jsonResponse({ ok: true, data: configurations });

    const [templates, projects, products] = await Promise.all([
      prisma.configurationTemplate.findMany({
        where: projectId ? { isActive: true } : undefined,
        include: templateWorkspaceInclude(),
        orderBy: [{ isActive: 'desc' }, { kind: 'asc' }, { clientType: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      }),
      projectId
        ? prisma.project.findMany({
          where: { id: projectId },
          include: {
            client: true,
            investmentSite: true,
            existingAssets: { orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] },
          },
          take: 1,
        })
        : Promise.resolve([]),
      prisma.product.findMany({
        include: { prices: { where: { validFrom: { lte: new Date() } }, orderBy: { validFrom: 'desc' }, take: 1 } },
        orderBy: { name: 'asc' },
      }),
    ]);

    return jsonResponse({ ok: true, data: { configurations, templates, projects, products } });
  } catch (error) {
    return serverError('Nie udało się pobrać konfiguracji', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'configurations.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    if (body.action === 'SET_PROJECT_CLIENT_TYPE') {
      const projectId = requireString(body, 'projectId');
      const clientType = requireString(body, 'clientType');
      if (!['B2C', 'B2B'].includes(clientType)) return badRequest('Wybierz typ B2C albo B2B');

      const project = await prisma.project.findUnique({ where: { id: projectId }, include: { client: true } });
      if (!project) return notFound('Nie znaleziono projektu');
      const updated = await prisma.$transaction(async (tx) => {
        if (project.client.clientType === 'UNKNOWN') {
          await tx.client.update({ where: { id: project.clientId }, data: { clientType: clientType as any } });
        }
        return tx.project.update({ where: { id: projectId }, data: { clientType: clientType as any }, include: { client: true } });
      });
      await writeAuditLog({
        actorId: access.user.id,
        clientId: project.clientId,
        entityType: 'Project',
        entityId: project.id,
        action: 'SET_CLIENT_TYPE',
        before: { clientType: project.clientType },
        after: { clientType },
      });
      return jsonResponse({ ok: true, data: updated });
    }

    if (body.action === 'CREATE_FROM_TEMPLATES') {
      const projectId = requireString(body, 'projectId');
      const templateIds = Array.from(new Set(
        (Array.isArray(body.templateIds) ? body.templateIds : [])
          .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
          .map((value) => value.trim()),
      ));
      if (templateIds.length === 0) return badRequest('Wybierz przynajmniej jedną konfigurację inwestycji');
      if (templateIds.length > 2) return badRequest('Można jednocześnie utworzyć konfigurację magazynu energii i instalacji PV');

      const [project, foundTemplates] = await Promise.all([
        prisma.project.findUnique({ where: { id: projectId }, include: { client: true, existingAssets: true } }),
        prisma.configurationTemplate.findMany({
          where: { id: { in: templateIds } },
          include: templateWorkspaceInclude(),
        }),
      ]);
      if (!project) return notFound('Nie znaleziono projektu');
      if (foundTemplates.length !== templateIds.length) return notFound('Nie znaleziono jednej z wybranych konfiguracji');

      const clientType = project.clientType === 'UNKNOWN' ? project.client.clientType : project.clientType;
      if (!['B2C', 'B2B'].includes(clientType)) {
        return badRequest('Przed wyborem szablonu określ typ klienta jako B2C albo B2B');
      }

      const orderedTemplates = templateIds.map((id) => foundTemplates.find((template) => template.id === id)!);
      const scopes = orderedTemplates.map((template) => configurationInvestmentScope(template.kind));
      if (scopes.some((scope) => !scope)) {
        return badRequest('Wybierz konfigurację magazynu energii albo instalacji PV');
      }
      if (new Set(scopes).size !== scopes.length) {
        return badRequest('Dla jednego rodzaju inwestycji można wybrać tylko jedną konfigurację');
      }

      const saleVatMode = defaultVatModeForClientType(clientType) as ConfigurationVatMode;
      const saleVatRate = defaultSaleVatRateForMode(saleVatMode) || 0;
      const prepared = orderedTemplates.map((template) => {
        if (!template.isActive) throw new Error(`Szablon „${template.name}” jest archiwalny`);
        if (![clientType, 'B2C_B2B'].includes(template.clientType)) {
          throw new Error(`Szablon ${template.clientType} nie pasuje do projektu ${clientType}`);
        }

        const rawItems = template.items.map((item) => ({ ...costsFromTemplate(item, saleVatMode), saleVatRate }));
        const vatBasis = defaultVatBasis(saleVatMode);
        validateConfigurationInput(rawItems, saleVatMode, vatBasis);
        const lineInputs = rawItems.map((item) => lineInputFromItem(item, saleVatMode));
        const totals = sumConfiguration(lineInputs);
        const requiresReview = template.items.some((item) => item.requiresReview);

        return {
          template,
          data: {
            projectId,
            templateId: template.id,
            sourceTemplateVersion: template.version,
            name: `${project.title} - ${template.name}`,
            kind: template.kind,
            clientType: clientType as any,
            status: 'DRAFT' as const,
            goal: template.goal,
            roofType: template.roofType,
            targetPowerKw: template.powerKw,
            targetCapacityKwh: template.capacityKwh,
            existingAssetsSnapshot: project.existingAssets as any,
            saleVatMode: saleVatMode as any,
            defaultSaleVatRate: defaultSaleVatRateForMode(saleVatMode) ?? undefined,
            vatBasis,
            totalPurchaseNet: totals.purchaseNet,
            totalSaleGross: totals.saleGross,
            totalProfitNet: totals.profitNet,
            requiresReview,
            reviewNotes: requiresReview ? 'Szablon zawiera pozycje do weryfikacji' : undefined,
            items: {
              create: rawItems.map((item, index) => calculatedItemData(item, index, lineInputs[index])),
            },
          },
        };
      });

      const configurations = await prisma.$transaction(async (tx) => {
        const created = [];
        for (const entry of prepared) {
          created.push(await tx.configuration.create({
            data: entry.data,
            include: configurationInclude,
          }));
        }
        return created;
      });

      for (const configuration of configurations) {
        await writeAuditLog({
          actorId: access.user.id,
          clientId: project.client.id,
          entityType: 'Configuration',
          entityId: configuration.id,
          action: 'CREATE',
          after: configuration,
        });
      }

      return jsonResponse({ ok: true, data: configurations }, { status: 201 });
    }

    const copyFromConfigurationId = optionalString(body, 'copyFromConfigurationId');
    if (copyFromConfigurationId) {
      const source = await prisma.configuration.findUnique({ where: { id: copyFromConfigurationId }, include: configurationInclude });
      if (!source) return notFound('Nie znaleziono konfiguracji źródłowej');
      if (source.status === 'ARCHIVED') return badRequest('Nie można utworzyć wariantu z archiwalnej konfiguracji');

      const copy = await prisma.configuration.create({
        data: {
          projectId: source.projectId,
          templateId: source.templateId || undefined,
          sourceTemplateVersion: source.sourceTemplateVersion,
          name: optionalString(body, 'name') || `${source.name} - wariant`,
          kind: source.kind,
          status: 'DRAFT',
          clientType: source.clientType,
          goal: source.goal,
          roofType: source.roofType,
          targetPowerKw: source.targetPowerKw,
          targetCapacityKwh: source.targetCapacityKwh,
          existingAssetsSnapshot: source.existingAssetsSnapshot as any,
          saleVatMode: source.saleVatMode,
          defaultSaleVatRate: source.defaultSaleVatRate,
          vatBasis: source.vatBasis,
          totalPurchaseNet: source.totalPurchaseNet,
          totalSaleGross: source.totalSaleGross,
          totalProfitNet: source.totalProfitNet,
          requiresReview: source.requiresReview,
          reviewNotes: source.reviewNotes,
          items: { create: source.items.map(copiedItem) },
        },
        include: configurationInclude,
      });
      await writeAuditLog({
        actorId: access.user.id,
        clientId: source.project.client.id,
        entityType: 'Configuration',
        entityId: copy.id,
        action: 'CREATE_VARIANT',
        before: source,
        after: copy,
      });
      return jsonResponse({ ok: true, data: copy }, { status: 201 });
    }

    const projectId = requireString(body, 'projectId');
    const templateId = optionalString(body, 'templateId');
    let effectiveBody = body;
    let templateVersion: number | undefined;

    if (templateId) {
      const template = await prisma.configurationTemplate.findUnique({ where: { id: templateId }, include: templateWorkspaceInclude() });
      if (!template) return notFound('Nie znaleziono szablonu konfiguracji');
      if (!template.isActive) return badRequest('Wybrany szablon jest archiwalny');
      templateVersion = template.version;

      if (body.createFromTemplate) {
        const project = await prisma.project.findUnique({ where: { id: projectId }, include: { client: true, existingAssets: true } });
        if (!project) return notFound('Nie znaleziono projektu');
        const clientType = project.clientType === 'UNKNOWN' ? project.client.clientType : project.clientType;
        if (!['B2C', 'B2B'].includes(clientType)) {
          return badRequest('Przed wyborem szablonu określ typ klienta jako B2C albo B2B');
        }
        if (![clientType, 'B2C_B2B'].includes(template.clientType)) {
          return badRequest(`Szablon ${template.clientType} nie pasuje do projektu ${clientType}`);
        }

        const saleVatMode = defaultVatModeForClientType(clientType) as ConfigurationVatMode;
        const saleVatRate = defaultSaleVatRateForMode(saleVatMode) || 0;
        effectiveBody = {
          ...body,
          name: optionalString(body, 'name') || `${project.title} - ${template.name}`,
          kind: template.kind,
          clientType,
          goal: template.goal,
          roofType: template.roofType,
          targetPowerKw: template.powerKw,
          targetCapacityKwh: template.capacityKwh,
          existingAssetsSnapshot: project.existingAssets,
          saleVatMode,
          vatBasis: defaultVatBasis(saleVatMode),
          requiresReview: template.items.some((item) => item.requiresReview),
          reviewNotes: template.items.some((item) => item.requiresReview) ? 'Szablon zawiera pozycje do weryfikacji' : undefined,
          items: template.items.map((item) => ({ ...costsFromTemplate(item, saleVatMode), saleVatRate })),
        };
      }
    }

    const saleVatMode = requireString(effectiveBody, 'saleVatMode') as ConfigurationVatMode;
    const rawItems = await resolveConfigurationItemPricing(
      Array.isArray(effectiveBody.items) ? effectiveBody.items : [],
      [],
      saleVatMode,
    );
    const vatBasis = optionalString(effectiveBody, 'vatBasis');
    validateConfigurationInput(rawItems, saleVatMode, vatBasis);
    const lineInputs = rawItems.map((item) => lineInputFromItem(item, saleVatMode));
    const totals = sumConfiguration(lineInputs);

    const configuration = await prisma.configuration.create({
      data: {
        projectId,
        templateId,
        sourceTemplateVersion: templateVersion,
        name: requireString(effectiveBody, 'name'),
        kind: requireString(effectiveBody, 'kind') as any,
        clientType: requireString(effectiveBody, 'clientType') as any,
        status: effectiveBody.status || 'DRAFT',
        goal: optionalString(effectiveBody, 'goal') as any,
        roofType: optionalString(effectiveBody, 'roofType') as any,
        targetPowerKw: optionalNumber(effectiveBody.targetPowerKw),
        targetCapacityKwh: optionalNumber(effectiveBody.targetCapacityKwh),
        existingAssetsSnapshot: Array.isArray(effectiveBody.existingAssetsSnapshot) ? effectiveBody.existingAssetsSnapshot : undefined,
        saleVatMode: saleVatMode as any,
        defaultSaleVatRate: defaultSaleVatRateForMode(saleVatMode) ?? undefined,
        vatBasis,
        totalPurchaseNet: totals.purchaseNet,
        totalSaleGross: totals.saleGross,
        totalProfitNet: totals.profitNet,
        requiresReview: Boolean(effectiveBody.requiresReview),
        reviewNotes: optionalString(effectiveBody, 'reviewNotes'),
        items: { create: rawItems.map((item, index) => calculatedItemData(item, index, lineInputs[index])) },
      },
      include: configurationInclude,
    });
    await writeAuditLog({
      actorId: access.user.id,
      clientId: configuration.project.client.id,
      entityType: 'Configuration',
      entityId: configuration.id,
      action: 'CREATE',
      after: configuration,
    });

    return jsonResponse({ ok: true, data: configuration }, { status: 201 });
  } catch (error) {
    if (error instanceof CatalogPriceChangedError) return badRequest(error.message);
    return serverError('Nie udało się zapisać konfiguracji', error);
  }
}

export async function PUT(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'configurations.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const existing = await prisma.configuration.findUnique({ where: { id }, include: configurationInclude });
    if (!existing) return notFound('Nie znaleziono konfiguracji');

    const blockReason = configurationEditBlockReason({
      status: existing.status,
      offers: Math.max(existing._count.offers, existing._count.offerLinks),
      installations: existing._count.installations,
      stockReservations: existing._count.stockReservations,
    });
    if (blockReason) return badRequest(blockReason);

    const saleVatMode = requireString(body, 'saleVatMode') as ConfigurationVatMode;
    const rawItems = await resolveConfigurationItemPricing(
      Array.isArray(body.items) ? body.items : [],
      existing.items as unknown as Array<Record<string, any>>,
      saleVatMode,
    );
    const vatBasis = optionalString(body, 'vatBasis');
    validateConfigurationInput(rawItems, saleVatMode, vatBasis);
    const lineInputs = rawItems.map((item) => lineInputFromItem(item, saleVatMode));
    const totals = sumConfiguration(lineInputs);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.configurationItem.deleteMany({ where: { configurationId: id } });
      return tx.configuration.update({
        where: { id },
        data: {
          name: requireString(body, 'name'),
          kind: requireString(body, 'kind') as any,
          clientType: requireString(body, 'clientType') as any,
          goal: optionalString(body, 'goal') as any,
          roofType: optionalString(body, 'roofType') as any,
          targetPowerKw: optionalNumber(body.targetPowerKw),
          targetCapacityKwh: optionalNumber(body.targetCapacityKwh),
          existingAssetsSnapshot: Array.isArray(body.existingAssetsSnapshot) ? body.existingAssetsSnapshot : undefined,
          saleVatMode: saleVatMode as any,
          defaultSaleVatRate: defaultSaleVatRateForMode(saleVatMode) ?? undefined,
          vatBasis,
          totalPurchaseNet: totals.purchaseNet,
          totalSaleGross: totals.saleGross,
          totalProfitNet: totals.profitNet,
          requiresReview: Boolean(body.requiresReview),
          reviewNotes: optionalString(body, 'reviewNotes'),
          items: { create: rawItems.map((item, index) => calculatedItemData(item, index, lineInputs[index])) },
        },
        include: configurationInclude,
      });
    });
    await writeAuditLog({
      actorId: access.user.id,
      clientId: existing.project.client.id,
      entityType: 'Configuration',
      entityId: id,
      action: 'UPDATE',
      before: existing,
      after: updated,
    });
    return jsonResponse({ ok: true, data: updated });
  } catch (error) {
    if (error instanceof CatalogPriceChangedError) return badRequest(error.message);
    return serverError('Nie udało się zaktualizować konfiguracji', error);
  }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'configurations.manage');
  if (!access.ok) return access.response;
  if (!isAdminUser(access.user)) return forbidden('Tylko administrator może archiwizować konfiguracje');

  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    if (body.status !== 'ARCHIVED') return badRequest('Dozwolone jest wyłącznie archiwizowanie konfiguracji');

    const existing = await prisma.configuration.findUnique({
      where: { id },
      include: {
        project: { select: { clientId: true } },
        _count: { select: { offers: true, offerLinks: true, installations: true, stockReservations: true } },
      },
    });
    if (!existing) return notFound('Nie znaleziono konfiguracji');
    if (existing.status === 'ARCHIVED') return jsonResponse({ ok: true, data: existing });
    if (!['DRAFT', 'READY'].includes(existing.status)
      || existing._count.offers > 0
      || existing._count.offerLinks > 0
      || existing._count.installations > 0
      || existing._count.stockReservations > 0) {
      return badRequest('Można archiwizować wyłącznie nieużywaną konfigurację roboczą lub gotową');
    }

    const configuration = await prisma.configuration.update({
      where: { id },
      data: { status: 'ARCHIVED' },
      include: {
        project: { select: { clientId: true } },
        _count: { select: { offers: true, offerLinks: true, installations: true, stockReservations: true } },
      },
    });

    await writeAuditLog({
      actorId: access.user.id,
      clientId: existing.project.clientId,
      entityType: 'Configuration',
      entityId: existing.id,
      action: 'ARCHIVE',
      before: existing,
      after: configuration,
    });
    return jsonResponse({ ok: true, data: configuration });
  } catch (error) {
    return serverError('Nie udało się zarchiwizować konfiguracji', error);
  }
}

export async function DELETE(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'configurations.manage');
  if (!access.ok) return access.response;
  if (!isAdminUser(access.user)) return forbidden('Tylko administrator może usuwać konfiguracje');

  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const existing = await prisma.configuration.findUnique({
      where: { id },
      include: {
        project: { select: { clientId: true } },
        _count: { select: { offers: true, offerLinks: true, installations: true, stockReservations: true } },
      },
    });
    if (!existing) return notFound('Nie znaleziono konfiguracji');

    const blockReason = configurationDeleteBlockReason({
      status: existing.status,
      offers: Math.max(existing._count.offers, existing._count.offerLinks),
      installations: existing._count.installations,
      stockReservations: existing._count.stockReservations,
    });
    if (blockReason) return badRequest(blockReason);

    await prisma.configuration.delete({ where: { id } });
    await writeAuditLog({
      actorId: access.user.id,
      clientId: existing.project.clientId,
      entityType: 'Configuration',
      entityId: existing.id,
      action: 'DELETE',
      before: existing,
    });
    return jsonResponse({ ok: true, data: { id: existing.id } });
  } catch (error) {
    return serverError('Nie udało się usunąć konfiguracji', error);
  }
}
