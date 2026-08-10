import { Prisma, PrismaClient } from '@prisma/client';
import { vatBreakdown } from 'lib/onrevolt/configuration-vat';

type OfferCreateInput = {
  projectId: string;
  configurationId?: string;
  configurationIds?: string[];
  energyScenarioId?: string;
  title?: string;
  validUntil?: Date;
  subsidyGross?: number;
  thermoReliefGross?: number;
  currentAnnualBillGross?: number;
  projectedAnnualBillGross?: number;
  tariffBefore?: string;
  tariffAfter?: string;
  settlementBefore?: string;
  settlementAfter?: string;
  descriptionBefore?: string;
  descriptionAfter?: string;
  notes?: string;
};

function money(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) throw new Error(`Nieprawidłowa wartość kwoty: ${value}`);
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function optionalMoney(value: unknown) {
  if (value == null || value === '') return 0;
  return money(value);
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value == null) return 0;
  return money(value);
}

function optionalText(value?: string) {
  const text = value?.trim();
  return text || undefined;
}

export function toOfferNumber(date = new Date(), sequence = 1) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `ONR/${year}/${month}/${String(sequence).padStart(4, '0')}`;
}

export async function nextOfferNumber(prisma: PrismaClient) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const count = await prisma.offer.count({ where: { createdAt: { gte: startOfMonth } } });
  return toOfferNumber(now, count + 1);
}

export async function nextOfferVersion(prisma: PrismaClient, projectId: string) {
  const count = await prisma.offer.count({ where: { projectId } });
  return count + 1;
}

export function normalizeOfferConfigurationIds(configurationIds?: string[], configurationId?: string) {
  const values = [configurationId, ...(configurationIds || [])]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(values));
}

function projectSnapshot(project: any) {
  const client = project.client || {};
  const contact = client.contacts?.[0] || {};
  const site = project.investmentSite || client.investmentSites?.[0] || {};

  return {
    clientId: client.id,
    projectId: project.id,
    clientName: client.displayName || '',
    clientType: project.clientType || client.clientType || 'UNKNOWN',
    projectTitle: project.title || '',
    phone: contact.phone || '',
    email: contact.email || '',
    addressLine: contact.addressLine || '',
    postalCode: contact.postalCode || '',
    city: contact.city || '',
    investmentAddress: site.fullAddress || site.addressLine || project.locationAddress || contact.investmentAddress || '',
  };
}

export function mergeConfigurationLineItems(configurations: any[]) {
  return configurations.flatMap((configuration) => (
    (configuration.items || [])
      .slice()
      .sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0))
      .map((item: any, index: number) => ({
        sourceConfigurationId: configuration.id,
        sourceConfigurationName: configuration.name,
        sourceConfigurationKind: configuration.kind,
        sourcePosition: Number(item.position || index + 1),
        productId: item.productId || null,
        sku: item.product?.sku || null,
        name: item.product?.name || item.description || `Pozycja ${index + 1}`,
        description: item.description || item.product?.name || `Pozycja ${index + 1}`,
        model: item.product?.supplierSku || item.product?.sku || item.product?.producer || '',
        producer: item.product?.producer || '',
        category: item.product?.category || '',
        quantity: decimalToNumber(item.quantity),
        unitPurchaseNet: decimalToNumber(item.unitPurchaseNet),
        saleNet: decimalToNumber(item.saleNet),
        saleGross: decimalToNumber(item.saleGross),
        saleVatRate: decimalToNumber(item.saleVatRate),
        profitNet: decimalToNumber(item.profitNet),
        supplyMode: item.supplyMode || 'ONREVOLT_SUPPLIED',
        role: item.role || 'OTHER',
        isOptional: Boolean(item.isOptional),
        requiresReview: Boolean(item.requiresReview),
        notes: item.notes || '',
      }))
  )).map((item, index) => ({ ...item, position: index + 1 }));
}

function calculationSnapshot(input: OfferCreateInput, lineItems: any[], scenario?: any) {
  const totalNet = lineItems.reduce((sum, item) => sum + decimalToNumber(item.saleNet), 0);
  const totalGross = lineItems.reduce((sum, item) => sum + decimalToNumber(item.saleGross), 0);
  const subsidyGross = optionalMoney(input.subsidyGross);
  const thermoReliefGross = optionalMoney(input.thermoReliefGross);
  const totalAfterSupportGross = Math.max(0, money(totalGross - subsidyGross - thermoReliefGross));
  const result = scenario?.resultSnapshot || {};
  const currentAnnualBillGross = scenario
    ? optionalMoney(result.baselineAnnualCostGross)
    : optionalMoney(input.currentAnnualBillGross);
  const projectedAnnualBillGross = scenario
    ? optionalMoney(result.scenarioAnnualCostGross)
    : optionalMoney(input.projectedAnnualBillGross);
  const annualSavingsGross = Math.max(0, money(currentAnnualBillGross - projectedAnnualBillGross));
  const paybackYears = annualSavingsGross > 0 ? money(totalAfterSupportGross / annualSavingsGross) : null;
  const saleVatBreakdown = vatBreakdown(lineItems.map((item) => ({
    saleNet: decimalToNumber(item.saleNet),
    saleGross: decimalToNumber(item.saleGross),
    saleVatRate: decimalToNumber(item.saleVatRate),
  })));

  return {
    totalNet: money(totalNet),
    totalGross: money(totalGross),
    totalVat: money(totalGross - totalNet),
    vatBreakdown: saleVatBreakdown,
    subsidyGross,
    thermoReliefGross,
    totalAfterSupportGross,
    currentAnnualBillGross,
    projectedAnnualBillGross,
    annualSavingsGross,
    paybackYears,
    savingsPercent: currentAnnualBillGross > 0
      ? Math.round((annualSavingsGross / currentAnnualBillGross) * 1000) / 10
      : 0,
    energyScenarioId: scenario?.id || null,
    energyEngineVersion: scenario?.engineVersion || null,
  };
}

function energySnapshot(project: any, scenario?: any) {
  const files = project.energyMeasurementFiles || [];
  const downloaded = files.filter((file: any) => file.status === 'DOWNLOADED');
  const months = Array.from(new Set<string>(downloaded.map((file: any) => `${file.periodYear}-${String(file.periodMonth).padStart(2, '0')}`)))
    .sort();

  return {
    operatorAccounts: (project.energyPortalAccounts || []).map((account: any) => ({
      operator: account.operator,
      tariff: account.tariff,
      ppeNumber: account.ppeNumber,
      meterNumber: account.meterNumber,
      lastSyncAt: account.lastSyncAt,
    })),
    measurementMonths: months,
    measurementFiles: downloaded.length,
    scenario: scenario ? {
      id: scenario.id,
      name: scenario.name,
      engineVersion: scenario.engineVersion,
      pvPowerKw: decimalToNumber(scenario.pvPowerKw),
      batteryCapacityKwh: decimalToNumber(scenario.batteryCapacityKwh),
      investmentGross: decimalToNumber(scenario.investmentGross),
      input: scenario.inputSnapshot,
      result: scenario.resultSnapshot,
      createdAt: scenario.createdAt,
    } : null,
  };
}

export async function buildOfferDraft(prisma: PrismaClient, input: OfferCreateInput) {
  const configurationIds = normalizeOfferConfigurationIds(input.configurationIds, input.configurationId);
  const [project, configurationRecords, selectedScenario] = await Promise.all([
    prisma.project.findUnique({
      where: { id: input.projectId },
      include: {
        client: { include: { contacts: true, investmentSites: { orderBy: { updatedAt: 'desc' } } } },
        investmentSite: true,
        energyPortalAccounts: true,
        energyMeasurementFiles: {
          orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
          take: 40,
        },
      },
    }),
    configurationIds.length
      ? prisma.configuration.findMany({
        where: { id: { in: configurationIds } },
        include: {
          template: true,
          items: { include: { product: true }, orderBy: { position: 'asc' } },
        },
      })
      : Promise.resolve([]),
    input.energyScenarioId
      ? prisma.energyScenario.findUnique({
        where: { id: input.energyScenarioId },
        include: { audit: { select: { projectId: true } } },
      })
      : prisma.energyScenario.findFirst({
        where: { audit: { projectId: input.projectId }, recommended: true },
        include: { audit: { select: { projectId: true } } },
        orderBy: { createdAt: 'desc' },
      }),
  ]);

  if (!project) throw new Error('Nie znaleziono projektu dla oferty');
  if (configurationRecords.length !== configurationIds.length) {
    throw new Error('Nie znaleziono jednej z konfiguracji wybranych do oferty');
  }
  const configurationById = new Map(configurationRecords.map((configuration) => [configuration.id, configuration]));
  const configurations = configurationIds.map((id) => configurationById.get(id)!);
  if (configurations.some((configuration) => configuration.projectId !== project.id)) {
    throw new Error('Wszystkie konfiguracje muszą należeć do wybranego projektu');
  }
  if (configurations.some((configuration) => configuration.status === 'ARCHIVED')) {
    throw new Error('Nie można utworzyć nowej oferty z archiwalnej konfiguracji');
  }
  if (input.energyScenarioId && !selectedScenario) throw new Error('Nie znaleziono wariantu energetycznego');
  if (selectedScenario && selectedScenario.audit.projectId !== project.id) {
    throw new Error('Wariant energetyczny nie należy do wybranego projektu');
  }

  const lineItems = mergeConfigurationLineItems(configurations);
  const calculation = calculationSnapshot(input, lineItems, selectedScenario);
  const client = projectSnapshot(project);
  const title = optionalText(input.title)
    || configurations.map((configuration) => configuration.name).join(' + ')
    || `Oferta dla ${client.clientName || project.title}`;
  const primaryConfiguration = configurations[0];

  return {
    project,
    configuration: primaryConfiguration,
    configurations,
    data: {
      projectId: project.id,
      configurationId: primaryConfiguration?.id,
      configurationIds,
      energyScenarioId: selectedScenario?.id,
      title,
      version: await nextOfferVersion(prisma, project.id),
      status: 'DRAFT' as const,
      currency: 'PLN',
      totalNet: calculation.totalNet,
      totalGross: calculation.totalGross,
      subsidyGross: calculation.subsidyGross,
      thermoReliefGross: calculation.thermoReliefGross,
      totalAfterSupportGross: calculation.totalAfterSupportGross,
      currentAnnualBillGross: calculation.currentAnnualBillGross,
      projectedAnnualBillGross: calculation.projectedAnnualBillGross,
      annualSavingsGross: calculation.annualSavingsGross,
      paybackYears: calculation.paybackYears,
      tariffBefore: optionalText(input.tariffBefore),
      tariffAfter: optionalText(input.tariffAfter),
      settlementBefore: optionalText(input.settlementBefore),
      settlementAfter: optionalText(input.settlementAfter),
      descriptionBefore: optionalText(input.descriptionBefore),
      descriptionAfter: optionalText(input.descriptionAfter),
      lineItemsSnapshot: lineItems,
      energySnapshot: energySnapshot(project, selectedScenario),
      calculationSnapshot: calculation,
      clientSnapshot: client,
      validUntil: input.validUntil,
      notes: optionalText(input.notes),
    },
  };
}

export async function createOfferFromConfiguration(prisma: PrismaClient, input: OfferCreateInput) {
  const draft = await buildOfferDraft(prisma, input);
  const number = await nextOfferNumber(prisma);
  const { projectId, configurationId, configurationIds, energyScenarioId, ...offerData } = draft.data;

  return prisma.$transaction(async (tx) => {
    const created = await tx.offer.create({
      data: {
        ...offerData,
        number,
        lineItemsSnapshot: offerData.lineItemsSnapshot as Prisma.InputJsonValue,
        energySnapshot: offerData.energySnapshot as Prisma.InputJsonValue,
        calculationSnapshot: offerData.calculationSnapshot as Prisma.InputJsonValue,
        clientSnapshot: offerData.clientSnapshot as Prisma.InputJsonValue,
        project: { connect: { id: projectId } },
        configuration: configurationId ? { connect: { id: configurationId } } : undefined,
        configurations: configurationIds.length ? {
          create: configurationIds.map((id, sortOrder) => ({
            configuration: { connect: { id } },
            sortOrder,
          })),
        } : undefined,
        energyScenario: energyScenarioId ? { connect: { id: energyScenarioId } } : undefined,
      },
    });

    await tx.project.update({
      where: { id: input.projectId },
      data: { status: 'OFERTA_PRZYGOTOWANA' },
    });
    if (configurationIds.length) {
      await tx.configuration.updateMany({
        where: { id: { in: configurationIds }, status: { in: ['DRAFT', 'READY'] } },
        data: { status: 'OFFERED' },
      });
    }

    return tx.offer.findUniqueOrThrow({ where: { id: created.id }, include: offerInclude });
  });
}

export const offerInclude = {
  project: { include: { client: true, investmentSite: true } },
  configuration: {
    include: {
      items: { include: { product: true }, orderBy: { position: 'asc' as const } },
    },
  },
  configurations: {
    include: {
      configuration: {
        include: {
          items: { include: { product: true }, orderBy: { position: 'asc' as const } },
        },
      },
    },
    orderBy: { sortOrder: 'asc' as const },
  },
  energyScenario: true,
  contracts: true,
  documents: { orderBy: { createdAt: 'desc' as const } },
};

export function offerDeleteBlockReason(input: {
  contracts: number;
  installations: number;
  purchaseOrders: number;
}) {
  if (input.contracts > 0) return 'Nie można usunąć oferty, do której utworzono umowę';
  if (input.installations > 0) return 'Nie można usunąć oferty przekazanej do montażu';
  if (input.purchaseOrders > 0) return 'Nie można usunąć oferty powiązanej z zamówieniem';
  return null;
}

export function offerStatusDateUpdate(status: string) {
  if (status === 'SENT') return { sentAt: new Date() };
  if (status === 'ACCEPTED') return { acceptedAt: new Date() };
  return {};
}
