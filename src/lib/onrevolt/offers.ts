import { Prisma, PrismaClient } from '@prisma/client';
import { vatBreakdown } from 'lib/onrevolt/configuration-vat';
import { buildEnergyUsageProfile, type EnergyUsageProfile } from 'lib/onrevolt/energy-profile';
import {
  calculateEnergyScenario,
  defaultHourlyLoadProfile,
  distributeAnnualConsumption,
  energyScenarioEngineVersion,
  type EnergyScenarioInput,
  polishPvHourlyProfiles,
  polishPvMonthlyDistribution,
} from 'lib/onrevolt/energy-scenario';
import { loadEnergyTariffSnapshots } from 'lib/onrevolt/energy-tariff-pricing';
import { randomUUID } from 'node:crypto';

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

function optionalDecimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  return value == null ? null : decimalToNumber(value);
}

function optionalText(value?: string) {
  const text = value?.trim();
  return text || undefined;
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const defaultScenarioAssumptions = {
  pvSpecificYieldKwhPerKw: 950,
  batteryRoundTripEfficiency: 0.9,
  initialBatterySocPercent: 0.2,
  energyBuyGrossPerKwh: 0.62,
  distributionGrossPerKwh: 0.48,
  exportGrossPerKwh: 0.45,
  fixedMonthlyGross: 30,
  depositPayoutRate: 0.2,
};

type OfferScenarioInputOptions = {
  annualConsumptionKwh: number;
  profileSource?: string | null;
  usageProfile?: EnergyUsageProfile | null;
  configurations: any[];
  existingPvKw?: unknown;
  existingBatteryKwh?: unknown;
  existingInput?: unknown;
  investmentGross: number;
  currentTariff?: EnergyScenarioInput['currentTariff'];
  targetTariff?: EnergyScenarioInput['targetTariff'];
};

function sumConfigurationTarget(configurations: any[], field: 'targetPowerKw' | 'targetCapacityKwh') {
  return configurations.reduce((sum, configuration) => sum + finiteNumber(configuration[field]), 0);
}

function requireConfigurationTarget(
  configurations: any[],
  field: 'targetPowerKw' | 'targetCapacityKwh',
  label: string,
) {
  const missing = configurations.find((configuration) => !(finiteNumber(configuration[field]) > 0));
  if (missing) {
    throw new OfferRecalculationError(`Konfiguracja „${missing.name}” nie ma uzupełnionego pola: ${label}.`);
  }
}

function usageProfileInputs(profileSource: string | null | undefined, annualConsumptionKwh: number, usageProfile?: EnergyUsageProfile | null) {
  if (profileSource !== 'OPERATOR_HOURLY') {
    return {
      monthlyConsumptionKwh: distributeAnnualConsumption(annualConsumptionKwh),
      hourlyLoadProfile: defaultHourlyLoadProfile,
    };
  }

  if (!usageProfile?.months?.length) {
    throw new OfferRecalculationError('Wybrano dane godzinowe operatora, ale nie ma wczytanego profilu zużycia.');
  }
  const monthlyConsumptionKwh = Array.from({ length: 12 }, (_, index) => usageProfile.months
    .filter((month) => month.month === index + 1)
    .reduce((sum, month) => sum + finiteNumber(month.totalKwh), 0));
  const hourlyTotals = Array.from({ length: 24 }, (_, hour) => usageProfile.months
    .reduce((sum, month) => sum + finiteNumber(month.hourly?.[hour]), 0));
  const monthlyHourlyLoadProfiles = Array.from({ length: 12 }, (_, monthIndex) => {
    const values = Array.from({ length: 24 }, (_, hour) => usageProfile.months
      .filter((month) => month.month === monthIndex + 1)
      .reduce((sum, month) => sum + finiteNumber(month.hourly?.[hour]), 0));
    return values.some((value) => value > 0) ? values : defaultHourlyLoadProfile;
  });
  if (!monthlyConsumptionKwh.some((value) => value > 0)) {
    throw new OfferRecalculationError('Profil operatora nie zawiera dodatniego zużycia energii.');
  }
  return {
    monthlyConsumptionKwh,
    hourlyLoadProfile: hourlyTotals.some((value) => value > 0) ? hourlyTotals : defaultHourlyLoadProfile,
    monthlyHourlyLoadProfiles,
  };
}

export class OfferRecalculationError extends Error {}

export function buildOfferScenarioInput(options: OfferScenarioInputOptions): EnergyScenarioInput {
  if (!(options.annualConsumptionKwh > 0)) {
    throw new OfferRecalculationError('Uzupełnij roczne zużycie energii w zakładce „Dane energetyczne”.');
  }

  const existingInput = objectValue(options.existingInput);
  const pvConfigurations = options.configurations.filter((configuration) => (
    ['PV_DACH_PLASKI', 'PV_DACH_SKOSNY', 'MIXED'].includes(configuration.kind)
  ));
  const batteryConfigurations = options.configurations.filter((configuration) => (
    ['MAGAZYN', 'MIXED'].includes(configuration.kind)
  ));
  requireConfigurationTarget(pvConfigurations, 'targetPowerKw', 'moc docelowa PV');
  requireConfigurationTarget(batteryConfigurations, 'targetPowerKw', 'moc falownika / magazynu');
  requireConfigurationTarget(batteryConfigurations, 'targetCapacityKwh', 'pojemność magazynu');

  const existingPvKw = finiteNumber(options.existingPvKw);
  const existingBatteryKwh = finiteNumber(options.existingBatteryKwh);
  const addedPvKw = sumConfigurationTarget(pvConfigurations, 'targetPowerKw');
  const addedBatteryKwh = sumConfigurationTarget(batteryConfigurations, 'targetCapacityKwh');
  const batteryPowerKw = sumConfigurationTarget(batteryConfigurations, 'targetPowerKw');
  const batteryCapacityKwh = existingBatteryKwh + addedBatteryKwh;
  const profile = usageProfileInputs(options.profileSource, options.annualConsumptionKwh, options.usageProfile);
  const setting = (key: keyof typeof defaultScenarioAssumptions) => finiteNumber(
    existingInput[key],
    defaultScenarioAssumptions[key],
  );

  return {
    ...profile,
    pvPowerKw: existingPvKw + addedPvKw,
    pvSpecificYieldKwhPerKw: setting('pvSpecificYieldKwhPerKw'),
    pvMonthlyDistribution: polishPvMonthlyDistribution,
    pvHourlyProfiles: polishPvHourlyProfiles,
    batteryCapacityKwh,
    batteryMaxChargeKw: batteryCapacityKwh > 0
      ? batteryPowerKw || finiteNumber(existingInput.batteryMaxChargeKw, 5)
      : 0,
    batteryMaxDischargeKw: batteryCapacityKwh > 0
      ? batteryPowerKw || finiteNumber(existingInput.batteryMaxDischargeKw, 5)
      : 0,
    batteryRoundTripEfficiency: setting('batteryRoundTripEfficiency'),
    initialBatterySocPercent: setting('initialBatterySocPercent'),
    energyBuyGrossPerKwh: setting('energyBuyGrossPerKwh'),
    distributionGrossPerKwh: setting('distributionGrossPerKwh'),
    exportGrossPerKwh: setting('exportGrossPerKwh'),
    fixedMonthlyGross: setting('fixedMonthlyGross'),
    currentTariff: options.currentTariff,
    targetTariff: options.targetTariff,
    depositPayoutRate: setting('depositPayoutRate'),
    investmentGross: options.investmentGross,
  };
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
    taxId: client.taxId || '',
    phone: contact.phone || '',
    email: contact.email || '',
    addressLine: contact.addressLine || '',
    postalCode: contact.postalCode || '',
    city: contact.city || '',
    investmentAddress: site.fullAddress || site.addressLine || project.locationAddress || contact.investmentAddress || '',
    latitude: optionalDecimalToNumber(site.latitude || contact.latitude),
    longitude: optionalDecimalToNumber(site.longitude || contact.longitude),
    clientProblem: client.clientProblem || '',
    expectedResult: client.expectedResult || '',
    ownerName: project.owner?.name || '',
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

async function energySnapshot(project: any, scenario?: any) {
  const files = project.energyMeasurementFiles || [];
  const downloaded = files.filter((file: any) => file.status === 'DOWNLOADED');
  const months = Array.from(new Set<string>(downloaded.map((file: any) => `${file.periodYear}-${String(file.periodMonth).padStart(2, '0')}`)))
    .sort();
  const importFiles = downloaded.filter((file: any) => file.kind === 'ACTIVE_IMPORT');
  const usageProfile = await buildEnergyUsageProfile(importFiles);
  const siteAudit = project.siteAudits?.[0];
  const energyAudit = scenario?.audit || project.energyAudits?.[0] || null;
  const auditImages = (siteAudit?.documents || []).filter((document: any) => document.mimeType?.startsWith('image/'));
  const coverImage = auditImages.find((document: any) => document.auditFieldKey === 'building.rear')
    || auditImages.find((document: any) => document.auditFieldKey?.startsWith('building.'))
    || auditImages[0];

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
    usageProfile,
    siteAudit: siteAudit ? {
      id: siteAudit.id,
      title: siteAudit.title,
      status: siteAudit.status,
      visitDate: siteAudit.visitDate,
      progressPercent: siteAudit.progressPercent,
      formData: siteAudit.formData,
      auditorName: siteAudit.auditor?.name || '',
      coverImageDocumentId: coverImage?.id || null,
      coverImageTitle: coverImage?.title || null,
    } : null,
    audit: energyAudit ? {
      profileSource: energyAudit.profileSource,
      annualConsumptionKwh: optionalDecimalToNumber(energyAudit.annualConsumptionKwh),
      terrainType: energyAudit.terrainType,
      buildingType: energyAudit.buildingType,
      roofShape: energyAudit.roofShape,
      settlementSystem: energyAudit.settlementSystem,
      energySupplier: energyAudit.energySupplier,
      connectionType: energyAudit.connectionType,
      heatingSource: energyAudit.heatingSource,
      heatingSourceDetail: energyAudit.heatingSourceDetail,
      connectionPowerKw: optionalDecimalToNumber(energyAudit.connectionPowerKw),
      phaseCount: energyAudit.phaseCount,
      mainFuseA: energyAudit.mainFuseA,
      roofType: energyAudit.roofType,
      roofAreaM2: optionalDecimalToNumber(energyAudit.roofAreaM2),
      roofOrientation: energyAudit.roofOrientation,
      roofTiltDeg: optionalDecimalToNumber(energyAudit.roofTiltDeg),
      existingPvKw: optionalDecimalToNumber(energyAudit.existingPvKw),
      existingInverter: energyAudit.existingInverter,
      existingBatteryKwh: optionalDecimalToNumber(energyAudit.existingBatteryKwh),
      notes: energyAudit.notes,
    } : null,
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

type BuildOfferDraftOptions = {
  scenarioOverride?: any;
};

export async function buildOfferDraft(prisma: PrismaClient, input: OfferCreateInput, options: BuildOfferDraftOptions = {}) {
  const configurationIds = normalizeOfferConfigurationIds(input.configurationIds, input.configurationId);
  const [project, configurationRecords, selectedScenario] = await Promise.all([
    prisma.project.findUnique({
      where: { id: input.projectId },
      include: {
        client: { include: { contacts: true, investmentSites: { orderBy: { updatedAt: 'desc' } } } },
        investmentSite: true,
        owner: { select: { id: true, name: true, email: true } },
        energyPortalAccounts: true,
        energyMeasurementFiles: {
          include: { document: true },
          orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
          take: 40,
        },
        energyAudits: { orderBy: { updatedAt: 'desc' }, take: 1 },
        siteAudits: {
          include: {
            auditor: { select: { name: true } },
            documents: { orderBy: { createdAt: 'desc' }, take: 40 },
          },
          orderBy: { updatedAt: 'desc' },
          take: 1,
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
    options.scenarioOverride
      ? Promise.resolve(options.scenarioOverride)
      : input.energyScenarioId
      ? prisma.energyScenario.findUnique({
        where: { id: input.energyScenarioId },
        include: { audit: true },
      })
      : prisma.energyScenario.findFirst({
        where: { audit: { projectId: input.projectId }, recommended: true },
        include: { audit: true },
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
      energySnapshot: await energySnapshot(project, selectedScenario),
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

export async function recalculateOfferFromCurrentData(prisma: PrismaClient, offerId: string, actorId?: string | null) {
  const existing = await prisma.offer.findUnique({ where: { id: offerId }, include: offerInclude });
  if (!existing) throw new OfferRecalculationError('Nie znaleziono oferty.');
  if (existing.status === 'ACCEPTED') {
    throw new OfferRecalculationError('Zaakceptowana oferta jest zamrożona. Utwórz nowy wariant oferty.');
  }

  const configurations = existing.configurations.length
    ? existing.configurations.map((entry) => entry.configuration)
    : existing.configuration ? [existing.configuration] : [];
  if (!configurations.length) {
    throw new OfferRecalculationError('Oferta nie ma powiązanej konfiguracji do ponownego przeliczenia.');
  }

  const [audit, baseScenario, energyAccount, invoiceWithCycle] = await Promise.all([
    prisma.energyAudit.findUnique({ where: { projectId: existing.projectId } }),
    existing.energyScenarioId
      ? prisma.energyScenario.findUnique({ where: { id: existing.energyScenarioId }, include: { audit: true } })
      : prisma.energyScenario.findFirst({
        where: { audit: { projectId: existing.projectId }, recommended: true },
        include: { audit: true },
        orderBy: { createdAt: 'desc' },
      }),
    prisma.energyPortalAccount.findFirst({
      where: { projectId: existing.projectId },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.document.findFirst({
      where: {
        projectId: existing.projectId,
        type: 'FAKTURA_PRAD',
        billingCycleMonths: { not: null },
      },
      select: { billingCycleMonths: true },
      orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
    }),
  ]);
  if (!audit) {
    throw new OfferRecalculationError('Najpierw zapisz dane zużycia w zakładce „Dane energetyczne”.');
  }

  const annualConsumptionKwh = finiteNumber(audit.annualConsumptionKwh);
  let usageProfile: EnergyUsageProfile | null = null;
  if (audit.profileSource === 'OPERATOR_HOURLY') {
    const measurementFiles = await prisma.energyMeasurementFile.findMany({
      where: {
        projectId: existing.projectId,
        kind: 'ACTIVE_IMPORT',
        status: 'DOWNLOADED',
      },
      include: { document: true },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
      take: 12,
    });
    usageProfile = await buildEnergyUsageProfile(measurementFiles);
  }

  const lineItems = mergeConfigurationLineItems(configurations);
  const currentTotalGross = money(lineItems.reduce((sum, item) => sum + finiteNumber(item.saleGross), 0));
  const operator = String(energyAccount?.operator || 'ENEA');
  const tariffBefore = energyAccount?.tariff || existing.tariffBefore;
  const tariffAfter = existing.tariffAfter;
  if (!tariffBefore || !tariffAfter) {
    throw new OfferRecalculationError('Oferta nie ma wybranej taryfy przed i po modernizacji.');
  }
  let tariffSnapshots: Awaited<ReturnType<typeof loadEnergyTariffSnapshots>>;
  try {
    tariffSnapshots = await loadEnergyTariffSnapshots({
      operator,
      tariffCodes: [tariffBefore, tariffAfter],
      annualUsageKwh: annualConsumptionKwh,
      billingCycleMonths: invoiceWithCycle?.billingCycleMonths || 1,
      connectionPowerKw: finiteNumber(audit.connectionPowerKw),
    });
  } catch (error) {
    throw new OfferRecalculationError(
      `Nie udało się pobrać aktualnych taryf z RE: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const scenarioInput = buildOfferScenarioInput({
    annualConsumptionKwh,
    profileSource: audit.profileSource,
    usageProfile,
    configurations,
    existingPvKw: audit.existingPvKw,
    existingBatteryKwh: audit.existingBatteryKwh,
    existingInput: baseScenario?.inputSnapshot,
    investmentGross: currentTotalGross,
    currentTariff: tariffSnapshots[tariffBefore],
    targetTariff: tariffSnapshots[tariffAfter],
  });
  const scenarioResult = calculateEnergyScenario(scenarioInput);
  const scenarioId = randomUUID();
  const recommended = baseScenario?.recommended ?? true;
  const scenarioName = `Przeliczenie oferty ${existing.number || existing.title}`;
  const scenarioOverride = {
    id: scenarioId,
    auditId: audit.id,
    audit,
    name: scenarioName,
    engineVersion: energyScenarioEngineVersion,
    inputSnapshot: scenarioInput,
    resultSnapshot: scenarioResult,
    pvPowerKw: scenarioInput.pvPowerKw,
    batteryCapacityKwh: scenarioInput.batteryCapacityKwh,
    investmentGross: scenarioInput.investmentGross,
    recommended,
    createdById: actorId || null,
    createdAt: new Date(),
  };
  const configurationIds = configurations.map((configuration) => configuration.id);
  const draft = await buildOfferDraft(prisma, {
    projectId: existing.projectId,
    configurationIds,
    energyScenarioId: scenarioId,
    title: existing.title,
    validUntil: existing.validUntil || undefined,
    subsidyGross: decimalToNumber(existing.subsidyGross),
    thermoReliefGross: decimalToNumber(existing.thermoReliefGross),
    currentAnnualBillGross: decimalToNumber(existing.currentAnnualBillGross),
    projectedAnnualBillGross: decimalToNumber(existing.projectedAnnualBillGross),
    tariffBefore,
    tariffAfter: existing.tariffAfter || undefined,
    settlementBefore: audit.settlementSystem || existing.settlementBefore || undefined,
    settlementAfter: existing.settlementAfter || undefined,
    descriptionBefore: existing.descriptionBefore || undefined,
    descriptionAfter: existing.descriptionAfter || undefined,
    notes: existing.notes || undefined,
  }, { scenarioOverride });
  const { data } = draft;

  const updated = await prisma.$transaction(async (tx) => {
    if (recommended) {
      await tx.energyScenario.updateMany({ where: { auditId: audit.id }, data: { recommended: false } });
    }
    await tx.energyScenario.create({
      data: {
        id: scenarioId,
        auditId: audit.id,
        name: scenarioName,
        engineVersion: energyScenarioEngineVersion,
        inputSnapshot: scenarioInput as unknown as Prisma.InputJsonValue,
        resultSnapshot: scenarioResult as unknown as Prisma.InputJsonValue,
        pvPowerKw: scenarioInput.pvPowerKw,
        batteryCapacityKwh: scenarioInput.batteryCapacityKwh,
        investmentGross: scenarioInput.investmentGross,
        recommended,
        createdById: actorId || undefined,
      },
    });
    await tx.energyAudit.update({
      where: { id: audit.id },
      data: { status: 'READY', annualConsumptionKwh: scenarioResult.annualConsumptionKwh },
    });
    return tx.offer.update({
      where: { id: existing.id },
      data: {
        energyScenarioId: scenarioId,
        totalNet: data.totalNet,
        totalGross: data.totalGross,
        subsidyGross: data.subsidyGross,
        thermoReliefGross: data.thermoReliefGross,
        totalAfterSupportGross: data.totalAfterSupportGross,
        currentAnnualBillGross: data.currentAnnualBillGross,
        projectedAnnualBillGross: data.projectedAnnualBillGross,
        annualSavingsGross: data.annualSavingsGross,
        paybackYears: data.paybackYears,
        tariffBefore: data.tariffBefore,
        settlementBefore: data.settlementBefore,
        lineItemsSnapshot: data.lineItemsSnapshot as Prisma.InputJsonValue,
        energySnapshot: data.energySnapshot as Prisma.InputJsonValue,
        calculationSnapshot: data.calculationSnapshot as Prisma.InputJsonValue,
        clientSnapshot: data.clientSnapshot as Prisma.InputJsonValue,
      },
      include: offerInclude,
    });
  });

  return { offer: updated, scenarioId, annualConsumptionKwh: scenarioResult.annualConsumptionKwh };
}

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
