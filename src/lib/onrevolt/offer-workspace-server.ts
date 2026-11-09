import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, type ClientType, type ConfigurationGoal, type ConfigurationKind, type ConfigurationRoofType, type EnergyProfileSource } from '@prisma/client';
import { buildOfferMeasurementSeries, type OfferMeasurementKind, type OfferMeasurementSeries } from './offer-measurements';
import { buildOfferWorkspaceDayProfiles, type OfferWorkspaceDayProfile } from './offer-workspace-chart-data';
import {
  OFFER_WORKSPACE_SCHEMA_VERSION,
  parseOfferWorkspaceDraft,
  offerWorkspaceDraftWithBatteryPresence,
  createOfferWorkspacePricingSnapshot as createPricingSnapshotFromResult,
  type OfferWorkspaceDraft,
  type OfferWorkspacePricingSnapshot,
  type SavedOfferWorkspaceDraft,
} from './offer-workspace';
import { configurationInvestmentScope } from './configuration-templates';
import {
  applyOfferWorkspaceConfigurationEdits,
  configurationEditsContainPricing,
  validateOfferWorkspaceConfigurationEdits,
} from './offer-workspace-configuration-edits';
import { prisma } from './prisma';
import { getOfferWorkspaceArtifact, putOfferWorkspaceArtifact } from './offer-workspace-artifacts';
import { rePrisma, resolveReStation } from './re-stations';
import { hasStaffPermission } from './staff-server';
import { readProjectAnalysisPeriod } from './project-analysis-period-server';
import { buildingTypeLabel, terrainTypeLabel, roofShapeLabel, connectionTypeLabel, heatSourceLabel, heatSourceDetailLabel, energySupplierLabel } from './energy-intake';
import { resolveClientEnergyBatteryPresence } from './client-energy-pv-summary';
import { readProjectReferenceProfileSelection, type ProjectReferenceProfileSelection } from './project-reference-profile';
import { readProjectGeneralTariffs } from './client-tariffs-server';
import { projectGeneralTariff } from './client-tariffs';

const maxOfferWorkspaceMeasurementFiles = 24;

export type OfferWorkspaceStaffUser = { id: string; systemRole: string };
export type OfferWorkspaceLocation = { address: string | null; latitude: number | null; longitude: number | null };
export type OfferWorkspaceInput = {
  reportDetails?: {
    email: string | null; phone: string | null;
    terrain: string | null; buildingType: string | null; roofType: string | null;
    connectionType: string | null; connectionPowerKw: number | null;
    heatingSource: string | null; heatingDetails: string | null; supplier: string | null;
    pvInstallationPlace?: string | null;
    highLoadDevices?: string | null;
    plannedHighLoadDevices?: string | null;
  };
  existingPv: { powerKw: number | null; tiltDegrees: number | null; azimuthDegrees: number | null } | null;
  roofGeometry?: { tiltDegrees: number | null; azimuthDegrees: number | null };
  existingBatteryKwh?: number | null;
  existingBatteryPresent?: boolean | null;
  location: OfferWorkspaceLocation | null;
  settlementMode: string | null;
  annualConsumptionKwh: number | null;
  energyProfileSource?: EnergyProfileSource | null;
  referenceProfile?: ProjectReferenceProfileSelection;
  issues: string[];
};
export type OfferWorkspaceMeasurements = {
  availability?: 'NO_FILES' | 'FILES_PRESENT' | 'UNKNOWN';
  periods: OfferMeasurementSeries['periods'];
  months: Array<{ period: string; importKwh: number | null; exportKwh: number | null }>;
  dayProfiles?: OfferWorkspaceDayProfile[];
  totalsImportKwh: number | null;
  totalsExportKwh: number | null;
  intervalCount: number | null;
  missingDirections: OfferMeasurementSeries['missingDirections'];
  issues: string[];
};
export type OfferWorkspaceProductPrice = {
  id?: string;
  purchaseNet: number;
  currentPurchaseNet: number | null;
  purchaseVatRate: number;
  operatingCostNet: number;
  marginRate: number;
  saleVatRate: number | null;
  currency: string;
  validFrom: string;
};
export type OfferWorkspaceTemplate = {
  id: string;
  familyKey: string;
  name: string;
  version: number;
  kind: ConfigurationKind;
  clientType: ClientType;
  roofType: ConfigurationRoofType | null;
  goal: ConfigurationGoal | null;
  powerKw: number | null;
  capacityKwh: number | null;
  sortOrder: number;
  requiresExistingPv: boolean;
  requiresExistingInverter: boolean;
  notes: string | null;
  items: Array<{
    id: string;
    position: number;
    description: string | null;
    quantity: number;
    role: string;
    supplyMode: string;
    pricingMode?: 'LEGACY' | 'CATALOG' | 'INDIVIDUAL';
    operatingCostBasis?: 'PER_LINE' | 'PER_UNIT';
    catalogPriceId?: string | null;
    unitPurchaseNet: number | null;
    unitSaleNet?: number | null;
    purchaseVatRate: number | null;
    operatingCostNet: number | null;
    marginRate: number | null;
    saleVatRate: number | null;
    isOptional: boolean;
    requiresReview: boolean;
    product: null | {
      id: string;
      name: string;
      sku: string | null;
      legacySku: string | null;
      category: string;
      producer: string | null;
      availability: string | null;
      powerCapacity: string | null;
      prices: OfferWorkspaceProductPrice[];
    };
  }>;
};
export type OfferWorkspace = {
  projectId: string;
  clientId: string;
  projectName: string;
  clientName: string;
  clientType: ClientType;
  period: { startMonth: string; endMonth: string; endDate: string; periodKeys: string[]; fromUtc: string; untilUtc: string };
  ppeNumber: string | null;
  revision: string;
  input: OfferWorkspaceInput;
  measurements: OfferWorkspaceMeasurements;
  templates: OfferWorkspaceTemplate[];
  draft: SavedOfferWorkspaceDraft | null;
  canEditConfigurationItems?: boolean;
};

export class OfferWorkspaceNotFoundError extends Error {
  constructor() { super('Nie znaleziono projektu'); this.name = 'OfferWorkspaceNotFoundError'; }
}

export class OfferWorkspaceConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'OfferWorkspaceConflictError'; }
}

export class OfferWorkspacePermissionError extends Error {
  constructor() { super('Do workspace oferty wymagane są uprawnienia offers.manage i energy.manage; do wyświetlania i zapisu indywidualnych cen wymagane jest także pricing.read.'); this.name = 'OfferWorkspacePermissionError'; }
}

export function offerWorkspaceProjectWhere(projectId: string, user: OfferWorkspaceStaffUser) {
  return {
    id: projectId,
    ...(user.systemRole === 'ADMIN' || user.systemRole === 'MODERATOR' ? {} : { ownerId: user.id }),
  };
}

function finiteOrNull(value: unknown) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value: unknown) {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function siteAuditValue(value: unknown) {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function siteAuditHighLoadDevices(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const formData = value as Record<string, unknown>;
  const entries: string[] = [];
  const heating = [siteAuditValue(formData.heating_source), siteAuditValue(formData.heating_params)].filter((part): part is string => Boolean(part));
  if (heating.length) entries.push(heating.join(' '));
  const loads = Array.isArray(formData.loads) ? formData.loads : [];
  for (const value of loads) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const load = value as Record<string, unknown>;
    const parts = [siteAuditValue(load.device), siteAuditValue(load.params)].filter((part): part is string => Boolean(part));
    const power = siteAuditValue(load.power_kw);
    if (power) parts.push(`${power} kW`);
    if (parts.length) entries.push(parts.join(', '));
  }
  return entries.length ? entries.join('; ') : null;
}

function siteAuditPvInstallationPlace(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const formData = value as Record<string, unknown>;
  if (formData.has_pv_now !== 'yes') return null;
  const places: Record<string, string> = { ROOF: 'Dach', GROUND: 'Grunt', OTHER: 'Inne' };
  return typeof formData.existing_pv_place === 'string' ? places[formData.existing_pv_place] || null : null;
}

function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function resolveOfferWorkspaceStoragePath(rootPath: string, storagePath: string) {
  if (!storagePath || path.isAbsolute(storagePath) || path.win32.isAbsolute(storagePath) || storagePath.includes(':')) {
    throw new Error('Nieprawidłowa względna ścieżka dokumentu pomiarowego');
  }
  const root = path.resolve(rootPath);
  const target = path.resolve(root, storagePath.replaceAll('\\', '/'));
  if (!inside(root, target)) throw new Error('Ścieżka dokumentu pomiarowego wychodzi poza katalog uploadów');
  return target;
}

export type OfferWorkspaceStoredMeasurement = {
  id: string;
  clientId: string;
  projectId: string | null;
  accountId: string;
  kind: OfferMeasurementKind;
  periodYear: number;
  periodMonth: number;
  aggregation: string;
  storagePath: string | null;
  fileName: string | null;
  document: null | {
    clientId: string | null;
    projectId: string | null;
    storagePath: string;
    fileName: string;
    sizeBytes: number | null;
    sha256: string | null;
  };
};

export async function readOfferWorkspaceMeasurement(file: OfferWorkspaceStoredMeasurement, uploadRoot?: string): Promise<Buffer> {
  const document = file.document;
  if (!document?.storagePath) throw new Error('Brak dokumentu XLSX powiązanego z pomiarem');
  if (file.storagePath && file.storagePath !== document.storagePath) throw new Error('Niezgodne ścieżki dokumentu i pomiaru');
  if (!/\.xlsx$/i.test(document.fileName) || (file.fileName && !/\.xlsx$/i.test(file.fileName))) {
    throw new Error('Dokument pomiarowy nie jest plikiem XLSX');
  }
  const configuredRoot = uploadRoot ?? process.env.ONREVOLT_UPLOAD_DIR?.trim();
  if (!configuredRoot) throw new Error('Brak ONREVOLT_UPLOAD_DIR dla odczytu XLSX');
  const root = path.resolve(configuredRoot);
  const target = resolveOfferWorkspaceStoragePath(root, document.storagePath);
  const realRoot = await realpath(root);
  const realTarget = await realpath(target);
  if (!inside(realRoot, realTarget)) throw new Error('Rzeczywista ścieżka dokumentu pomiarowego wychodzi poza katalog uploadów');
  const metadata = await stat(realTarget);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > 25 * 1024 * 1024) {
    throw new Error('Nieprawidłowy plik XLSX (limit 25 MB)');
  }
  const bytes = await readFile(realTarget);
  if (document.sizeBytes == null || bytes.length !== document.sizeBytes) throw new Error('Rozmiar XLSX nie zgadza się z zapisanym dokumentem');
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (!document.sha256 || !/^[a-f0-9]{64}$/i.test(document.sha256) || digest !== document.sha256.toLowerCase()) {
    throw new Error('SHA-256 XLSX nie zgadza się z zapisanym dokumentem');
  }
  return bytes;
}

function emptyOfferMeasurementMonths(periodKeys: string[]) {
  return periodKeys.map((period) => ({ period, importKwh: null, exportKwh: null }));
}

export function summarizeOfferMeasurementSeries(
  series: OfferMeasurementSeries,
  issues: string[] = [],
  expectedPeriods: string[] = series.periods.map(({ period }) => period),
): OfferWorkspaceMeasurements {
  const monthly = new Map(expectedPeriods.map((period) => [period, {
    importKwh: 0, hasImport: false, exportKwh: 0, hasExport: false,
  }]));
  for (const interval of series.intervals) {
    const period = interval.localStart.slice(0, 7);
    const totals = monthly.get(period);
    if (!totals) continue;
    if (interval.import) {
      totals.importKwh += interval.import.valueKwh;
      totals.hasImport = true;
    }
    if (interval.export) {
      totals.exportKwh += interval.export.valueKwh;
      totals.hasExport = true;
    }
  }
  const sum = (kind: OfferMeasurementKind) => {
    let total = 0;
    let found = false;
    for (const interval of series.intervals) {
      const reading = kind === 'ACTIVE_IMPORT' ? interval.import : interval.export;
      if (!reading) continue;
      total += reading.valueKwh;
      found = true;
    }
    return found ? Math.round(total * 1000) / 1000 : null;
  };
  const dayProfiles = buildOfferWorkspaceDayProfiles(series.intervals);
  return {
    periods: series.periods,
    months: expectedPeriods.map((period) => {
      const totals = monthly.get(period);
      return {
        period,
        importKwh: totals?.hasImport ? Math.round(totals.importKwh * 1000) / 1000 : null,
        exportKwh: totals?.hasExport ? Math.round(totals.exportKwh * 1000) / 1000 : null,
      };
    }),
    ...(dayProfiles.length ? { dayProfiles } : {}),
    totalsImportKwh: sum('ACTIVE_IMPORT'),
    totalsExportKwh: sum('ACTIVE_EXPORT'),
    intervalCount: series.intervals.length,
    missingDirections: series.missingDirections,
    issues: issues.slice(),
  };
}

export function serializeTemplate(template: any, includePricing: boolean): OfferWorkspaceTemplate {
  return {
    id: template.id,
    familyKey: template.familyKey,
    name: template.name,
    version: template.version,
    kind: template.kind,
    clientType: template.clientType,
    roofType: template.roofType,
    goal: template.goal,
    powerKw: finiteOrNull(template.powerKw),
    capacityKwh: finiteOrNull(template.capacityKwh),
    sortOrder: template.sortOrder,
    requiresExistingPv: template.requiresExistingPv,
    requiresExistingInverter: template.requiresExistingInverter,
    notes: template.notes,
    items: template.items.map((item: any) => ({
      id: item.id,
      position: item.position,
      description: item.description,
      quantity: Number(item.quantity),
      role: item.role,
      supplyMode: item.supplyMode,
      pricingMode: includePricing ? item.pricingMode : undefined,
      operatingCostBasis: includePricing ? item.operatingCostBasis : undefined,
      catalogPriceId: includePricing ? item.catalogPriceId : undefined,
      unitPurchaseNet: includePricing ? finiteOrNull(item.unitPurchaseNet) : null,
      ...(includePricing && item.unitSaleNet != null ? { unitSaleNet: finiteOrNull(item.unitSaleNet) } : {}),
      purchaseVatRate: includePricing ? finiteOrNull(item.purchaseVatRate) : null,
      operatingCostNet: includePricing ? finiteOrNull(item.operatingCostNet) : null,
      marginRate: includePricing ? finiteOrNull(item.marginRate) : null,
      saleVatRate: includePricing ? finiteOrNull(item.saleVatRate) : null,
      isOptional: item.isOptional,
      requiresReview: item.requiresReview,
      product: item.product ? {
        id: item.product.id,
        name: item.product.name,
        sku: item.product.sku,
        legacySku: item.product.legacySku,
        category: item.product.category,
        producer: item.product.producer,
        availability: item.product.availability,
        powerCapacity: item.product.powerCapacity,
        prices: includePricing ? (item.product.prices || []).map((price: any) => ({
          id: price.id,
          purchaseNet: Number(price.purchaseNet),
          currentPurchaseNet: finiteOrNull(price.currentPurchaseNet),
          purchaseVatRate: Number(price.purchaseVatRate),
          operatingCostNet: Number(price.operatingCostNet),
          marginRate: Number(price.marginRate),
          saleVatRate: finiteOrNull(price.saleVatRate),
          currency: price.currency,
          validFrom: price.validFrom.toISOString(),
        })) : [],
      } : null,
    })),
  };
}

async function scopedPpeAccounts(projectId: string, clientId: string, includePpe: boolean, stationRef?: string | null) {
  const select = includePpe
    ? { id: true, ppeNumber: true, projectId: true, tariff: true, updatedAt: true } as const
    : { id: true, projectId: true, updatedAt: true } as const;
  const projectAccounts = await prisma.energyPortalAccount.findMany({
    where: { projectId, clientId }, select: { ...select, operator: true }, orderBy: { updatedAt: 'desc' },
  });
  const station = includePpe && stationRef ? await resolveReStation(stationRef) : null;
  if (includePpe && stationRef && !station) throw new Error('Przypisana stacja RE nie istnieje. Popraw powiązanie w EMS.');
  const selection = includePpe ? (await readProjectGeneralTariffs({ projectId, clientId, ppe: null,
    station: station?.station || null, generalTariff: projectGeneralTariff(projectAccounts),
  })).generalTariff : null;
  let operatorKey = selection?.operator?.trim().toLowerCase() || null;
  if (selection?.osdId != null) {
    const operators = await rePrisma().$queryRawUnsafe<Array<{ slug: string }>>('SELECT slug FROM osd WHERE id = ? LIMIT 1', selection.osdId);
    if (!operators[0]?.slug) throw new Error('Wybrany operator nie istnieje w katalogu taryf RE.');
    operatorKey = operators[0].slug.toLowerCase();
  }
  const selectedAccounts = operatorKey
    ? projectAccounts.filter(account => account.operator.toLowerCase() === operatorKey) : projectAccounts;
  const operatorNames = new Set(selectedAccounts.map(account => account.operator));
  if (operatorNames.size > 1) return { accounts: [], sourceAccounts: [], ppeNumber: null,
    issue: 'Projekt ma konta różnych operatorów; wybierz aktualnego operatora w taryfach.' };
  const operatorName = selection?.operator || selectedAccounts[0]?.operator || null;
  // The current file parser supports ENEA; selecting an operator is independent of parser support.
  const candidates = selectedAccounts.filter(account => account.operator === 'ENEA');
  const ppes = includePpe
    ? Array.from(new Set(candidates.map((account) => textOrNull('ppeNumber' in account ? account.ppeNumber : null)).filter((ppe): ppe is string => Boolean(ppe))))
    : [];
  if (ppes.length > 1) return {
    accounts: candidates,
    sourceAccounts: candidates,
    ppeNumber: null,
    issue: 'Projekt ma kilka numerów PPE; wybór pomiarów wymaga rozdzielenia punktów.',
  };
  const ppeNumber = ppes[0] || null;
  return {
    accounts: ppeNumber
      ? candidates.filter((account) => 'ppeNumber' in account && textOrNull(account.ppeNumber) === ppeNumber)
      : includePpe ? candidates.slice(0, 1) : candidates,
    sourceAccounts: candidates,
    ppeNumber,
    issue: !candidates.length
      ? (includePpe ? operatorName && (operatorKey || selectedAccounts[0]?.operator.toLowerCase()) !== 'enea'
        ? `Import pomiarów godzinowych dla operatora ${operatorName} nie jest jeszcze obsługiwany.`
        : 'Nie znaleziono konta operatora przypisanego do projektu.' : null)
      : ppeNumber ? null : 'Konto ENEA nie ma zapisanego numeru PPE.',
  };
}

function roofAzimuthDegrees(value: unknown): number | null {
  const orientation = textOrNull(value)?.toUpperCase();
  const azimuths: Record<string, number> = {
    N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
  };
  return orientation ? azimuths[orientation] ?? null : null;
}

export function offerWorkspaceEffectiveClientType(projectClientType: ClientType, clientClientType: ClientType) {
  return projectClientType === 'UNKNOWN' ? clientClientType : projectClientType;
}

function compatibleTemplateClientTypes(projectClientType: ClientType, clientClientType: ClientType) {
  const clientType = offerWorkspaceEffectiveClientType(projectClientType, clientClientType);
  return Array.from(new Set([clientType, 'B2C_B2B' as const]));
}

const templateInclude = (now: Date) => ({
  items: {
    include: { product: { include: { prices: { where: { validFrom: { lte: now } }, orderBy: { validFrom: 'desc' as const }, take: 1 } } } },
    orderBy: { position: 'asc' as const },
  },
} as const);

const templateMetadataInclude = (now: Date) => ({
  items: {
    select: {
      id: true, position: true, description: true, quantity: true, role: true, supplyMode: true,
      isOptional: true, requiresReview: true,
      product: {
        select: {
          id: true, updatedAt: true, name: true, sku: true, legacySku: true, category: true, producer: true,
          availability: true, powerCapacity: true,
          prices: { where: { validFrom: { lte: now } }, select: { id: true, validFrom: true, createdAt: true }, orderBy: { validFrom: 'desc' as const }, take: 1 },
        },
      },
    },
    orderBy: { position: 'asc' as const },
  },
} as const);

function templateSourceRevision(templates: any[]) {
  return templates.map((template) => ({
    id: template.id,
    version: template.version,
    isActive: template.isActive,
    clientType: template.clientType,
    updatedAt: template.updatedAt,
    items: template.items.map((item: any) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      role: item.role,
      supplyMode: item.supplyMode,
      isOptional: item.isOptional,
      requiresReview: item.requiresReview,
      product: item.product ? {
        id: item.product.id,
        updatedAt: item.product.updatedAt,
        name: item.product.name,
        sku: item.product.sku,
        legacySku: item.product.legacySku,
        category: item.product.category,
        producer: item.product.producer,
        availability: item.product.availability,
        powerCapacity: item.product.powerCapacity,
      } : null,
      prices: (item.product?.prices || []).map((price: any) => ({ id: price.id, validFrom: price.validFrom, createdAt: price.createdAt })),
    })),
  }));
}

function sourceRevision(source: unknown) {
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

type CachedOfferWorkspaceMeasurements = {
  schemaVersion: 1;
  sourceRevision: string;
  measurements: OfferWorkspaceMeasurements;
  series: OfferMeasurementSeries;
};

function cachedOfferWorkspaceMeasurements(value: unknown, revision: string): CachedOfferWorkspaceMeasurements {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Nieprawidłowy cache pomiarów workspace oferty');
  const artifact = value as Record<string, unknown>;
  if (artifact.schemaVersion !== 1 || artifact.sourceRevision !== revision
    || !artifact.measurements || typeof artifact.measurements !== 'object' || Array.isArray(artifact.measurements)
    || !artifact.series || typeof artifact.series !== 'object' || Array.isArray(artifact.series)) {
    throw new Error('Cache pomiarów workspace oferty ma niezgodny schemat lub rewizję źródeł');
  }
  return artifact as CachedOfferWorkspaceMeasurements;
}

function parseStoredPricingSnapshot(value: unknown): OfferWorkspacePricingSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  const totals = snapshot.totals;
  if (snapshot.schemaVersion !== 1
    || typeof snapshot.revision !== 'string' || !/^pricing-v1-[a-f0-9]{16}$/.test(snapshot.revision)
    || !Array.isArray(snapshot.selectedTemplateIds) || snapshot.selectedTemplateIds.length > 2
    || !snapshot.selectedTemplateIds.every((id) => typeof id === 'string')
    || !['REDUCED_8', 'STANDARD_23', 'MIXED', 'REVIEW'].includes(String(snapshot.saleVatMode))
    || !['B2C', 'B2B'].includes(String(snapshot.clientType))
    || !totals || typeof totals !== 'object' || Array.isArray(totals)) return null;
  const parsedTotals = totals as Record<string, unknown>;
  if (![parsedTotals.net, parsedTotals.gross].every((amount) => amount === null
    || typeof amount === 'number' && Number.isFinite(amount))) return null;
  return {
    schemaVersion: 1,
    revision: snapshot.revision,
    selectedTemplateIds: [...snapshot.selectedTemplateIds] as string[],
    saleVatMode: snapshot.saleVatMode as OfferWorkspacePricingSnapshot['saleVatMode'],
    clientType: snapshot.clientType as string,
    totals: { net: parsedTotals.net as number | null, gross: parsedTotals.gross as number | null },
  };
}

export function savedDraft(
  row: { revision: number; sourceRevision: string; updatedAt: Date; input: Prisma.JsonValue },
  includePricingSnapshot = true,
): SavedOfferWorkspaceDraft {
  const storedInput = row.input && typeof row.input === 'object' && !Array.isArray(row.input)
    ? row.input as Record<string, unknown> : {};
  const pricingSnapshot = includePricingSnapshot ? parseStoredPricingSnapshot(storedInput._pricingSnapshot) : null;
  const parsedDraft = parseOfferWorkspaceDraft(row.input);
  const safeDraft = includePricingSnapshot ? parsedDraft : {
    ...parsedDraft,
    ...(parsedDraft.configurationEdits ? {
      configurationEdits: parsedDraft.configurationEdits.flatMap((edit) => {
        const items = (edit.items || []).map(({ pricing: _pricing, ...item }) => item)
          .filter((item) => item.description !== undefined || item.quantity !== undefined || item.removed !== undefined);
        if (!items.length && !edit.technical) return [];
        return [{ templateId: edit.templateId, ...(items.length ? { items } : {}), ...(edit.technical ? { technical: edit.technical } : {}) }];
      }),
    } : {}),
  };
  return {
    revision: row.revision,
    sourceRevision: row.sourceRevision,
    updatedAt: row.updatedAt.toISOString(),
    input: safeDraft,
    ...(pricingSnapshot ? { pricingSnapshot } : {}),
  };
}

export function createServerOfferWorkspacePricingSnapshot(
  input: OfferWorkspaceDraft,
  templates: any[],
  clientType: string,
): OfferWorkspacePricingSnapshot | null {
  if (!['B2C', 'B2B'].includes(clientType)
    || typeof createPricingSnapshotFromResult !== 'function'
    || templates.some((template) => !Array.isArray(template.items))) return null;
  const { priceOfferWorkspaceConfiguration } = require('./offer-workspace-pricing') as typeof import('./offer-workspace-pricing');
  const effectiveTemplates = applyOfferWorkspaceConfigurationEdits(templates, input);
  const selected = new Set(input.selectedTemplateIds);
  const pricing = priceOfferWorkspaceConfiguration(
    effectiveTemplates.filter((template) => selected.has(template.id)),
    input.saleVatMode,
    clientType,
  );
  // Automatic grouping is a policy, so an unfinished draft may save before all
  // groups exist. Calculation and document generation validate the final layout.
  if (input.commercialPricing?.schemaVersion === 1) {
    const { calculateOfferCommercialPricing } = require('./offer-workspace-commercial-pricing') as typeof import('./offer-workspace-commercial-pricing');
    try { calculateOfferCommercialPricing(pricing, effectiveTemplates.filter(template => selected.has(template.id)), input.commercialPricing, input.targetSettlement); }
    catch (error) { throw new OfferWorkspaceConflictError(error instanceof Error ? error.message : 'Nieprawidłowy podział kosztorysu oferty.'); }
  }
  return createPricingSnapshotFromResult(input, clientType, pricing, effectiveTemplates.filter((template) => selected.has(template.id)));
}

export function offerWorkspacePricingSnapshotsMatch(
  left: OfferWorkspacePricingSnapshot | null,
  right: OfferWorkspacePricingSnapshot | null,
) {
  if (!left && !right) return true;
  return Boolean(left && right && left.revision === right.revision);
}

export function offerWorkspacePricingChangeAcknowledged(
  saved: OfferWorkspacePricingSnapshot | null,
  current: OfferWorkspacePricingSnapshot | null,
  acceptedPricingRevision?: string,
) {
  if (!saved || saved.revision === current?.revision) return true;
  return Boolean(current && acceptedPricingRevision === current.revision);
}

export async function loadProjectOfferWorkspace(
  projectId: string,
  user: OfferWorkspaceStaffUser,
  now: Date,
  onMeasurementSeries?: (series: OfferMeasurementSeries) => void,
): Promise<OfferWorkspace> {
  const canReadEnergy = hasStaffPermission(user, 'energy.manage');
  const canReadDraft = canReadEnergy && hasStaffPermission(user, 'offers.manage');
  const canReadPricing = hasStaffPermission(user, 'pricing.read');
  const project = await prisma.project.findFirst({
    where: offerWorkspaceProjectWhere(projectId, user),
    select: {
      id: true, clientId: true, title: true, clientType: true, locationAddress: true, updatedAt: true,
      dashboardStation: true, dashboardStationNumber: true,
      client: { select: { displayName: true, clientType: true, updatedAt: true,
        contacts: { select: { email: true, phone: true, updatedAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1 },
      } },
      investmentSite: { select: { fullAddress: true, addressLine: true, postalCode: true, city: true, latitude: true, longitude: true, updatedAt: true } },
    },
  });
  if (!project) throw new OfferWorkspaceNotFoundError();

  const periodSource = await readProjectAnalysisPeriod(projectId, now);
  if (!periodSource) throw new OfferWorkspaceNotFoundError();
  const period = periodSource.period;
  const periodKeys = period.periodKeys;
  const templateClientTypes = compatibleTemplateClientTypes(project.clientType, project.client.clientType);
  const [energyAuditVersion, energyAudit, ppe, templates, draft, siteAudit, referenceProfile] = await Promise.all([
    prisma.energyAudit.findUnique({ where: { projectId }, select: { id: true, updatedAt: true } }),
    canReadEnergy ? prisma.energyAudit.findUnique({ where: { projectId }, select: {
      id: true, annualConsumptionKwh: true, profileSource: true, settlementSystem: true, existingPvKw: true, existingBatteryKwh: true,
      roofTiltDeg: true, roofOrientation: true, updatedAt: true,
      terrainType: true, buildingType: true, roofShape: true, connectionType: true,
      connectionPowerKw: true, heatingSource: true, heatingSourceDetail: true, energySupplier: true,
    } }) : Promise.resolve(null),
    scopedPpeAccounts(projectId, project.clientId, canReadEnergy, project.dashboardStationNumber || project.dashboardStation),
    prisma.configurationTemplate.findMany({
      where: { isActive: true, clientType: { in: templateClientTypes } },
      include: canReadPricing ? templateInclude(now) : templateMetadataInclude(now),
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    }),
    canReadDraft ? prisma.offerWorkspace.findUnique({ where: { projectId } }) : Promise.resolve(null),
    prisma.siteAudit.findFirst({
      where: { projectId },
      select: { id: true, updatedAt: true, formData: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    }),
    canReadEnergy ? readProjectReferenceProfileSelection(projectId) : Promise.resolve(null),
  ]);

  const locationAddress = textOrNull(project.investmentSite?.fullAddress)
    || [project.investmentSite?.addressLine, [project.investmentSite?.postalCode, project.investmentSite?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    || textOrNull(project.locationAddress);
  const latitude = finiteOrNull(project.investmentSite?.latitude);
  const longitude = finiteOrNull(project.investmentSite?.longitude);
  const location = locationAddress || latitude != null || longitude != null
    ? { address: locationAddress || null, latitude, longitude }
    : null;

  const inputIssues: string[] = [];
  if (!canReadEnergy) inputIssues.push('Brak uprawnienia energy.manage do odczytu danych energetycznych.');
  else if (!energyAudit) inputIssues.push('Brak audytu energetycznego projektu.');
  if (canReadEnergy && energyAudit && energyAudit.annualConsumptionKwh == null) inputIssues.push('Brak zapisanej rocznej deklaracji zużycia.');
  if (canReadEnergy && energyAudit && (energyAudit.existingPvKw == null || Number(energyAudit.existingPvKw) !== 0) && !textOrNull(energyAudit.settlementSystem)) inputIssues.push('Brak zapisanego systemu rozliczeń.');
  if (canReadEnergy && energyAudit?.existingPvKw == null) inputIssues.push('Brak potwierdzonej mocy istniejącej PV; nie przyjęto wartości domyślnej.');
  const existingBatteryPresent = canReadEnergy
    ? resolveClientEnergyBatteryPresence(energyAudit?.existingBatteryKwh)
    : null;
  const existingBatteryKwh = canReadEnergy && energyAudit
    ? finiteOrNull(energyAudit.existingBatteryKwh)
    : null;
  if (canReadEnergy && energyAudit && existingBatteryPresent === null) {
    inputIssues.push('Nieprawidłowa pojemność istniejącego magazynu w danych energetycznych; nie przyjęto obecności ani braku magazynu.');
  }
  const hasExistingPv = canReadEnergy && energyAudit?.existingPvKw != null && Number(energyAudit.existingPvKw) > 0;
  const roofTiltDegrees = hasExistingPv ? finiteOrNull(energyAudit?.roofTiltDeg) : null;
  const roofAzimuth = hasExistingPv ? roofAzimuthDegrees(energyAudit?.roofOrientation) : null;
  if (hasExistingPv && (roofTiltDegrees != null || roofAzimuth != null)) {
    inputIssues.push('Nachylenie i orientacja pochodzą z danych dachu audytu, nie z potwierdzonych parametrów istniejących modułów PV.');
    if (textOrNull(energyAudit?.roofOrientation)?.toUpperCase() === 'E_W') {
      inputIssues.push('Orientacja E_W obejmuje dwie połacie; nie przypisano jednego azymutu istniejącym modułom.');
    }
  } else if (hasExistingPv) {
    inputIssues.push('Brak geometrii istniejącej PV i rozpoznawalnej orientacji pojedynczej połaci dachu.');
  }
  if (!location) inputIssues.push('Brak zapisanej lokalizacji projektu.');
  else if (latitude == null || longitude == null) inputIssues.push('Brak pełnych współrzędnych lokalizacji projektu.');

  const existingPv = canReadEnergy && energyAudit?.existingPvKw != null ? {
    powerKw: finiteOrNull(energyAudit.existingPvKw), tiltDegrees: roofTiltDegrees, azimuthDegrees: roofAzimuth,
  } : null;
  const input: OfferWorkspaceInput = {
    roofGeometry: {
      tiltDegrees: canReadEnergy ? finiteOrNull(energyAudit?.roofTiltDeg) : null,
      azimuthDegrees: canReadEnergy ? roofAzimuthDegrees(energyAudit?.roofOrientation) : null,
    },
    reportDetails: {
      email: textOrNull(project.client.contacts?.[0]?.email),
      phone: textOrNull(project.client.contacts?.[0]?.phone),
      terrain: textOrNull(terrainTypeLabel(energyAudit?.terrainType)),
      buildingType: textOrNull(buildingTypeLabel(energyAudit?.buildingType)),
      roofType: textOrNull(roofShapeLabel(energyAudit?.roofShape)),
      connectionType: textOrNull(connectionTypeLabel(energyAudit?.connectionType)),
      connectionPowerKw: finiteOrNull(energyAudit?.connectionPowerKw),
      heatingSource: textOrNull(heatSourceLabel(energyAudit?.heatingSource)),
      heatingDetails: textOrNull(heatSourceDetailLabel(energyAudit?.heatingSource, energyAudit?.heatingSourceDetail)),
      supplier: textOrNull(energySupplierLabel(energyAudit?.energySupplier)),
      ...(siteAudit ? {
        pvInstallationPlace: canReadEnergy ? siteAuditPvInstallationPlace(siteAudit.formData) : null,
        highLoadDevices: canReadEnergy ? siteAuditHighLoadDevices(siteAudit.formData) : null,
        plannedHighLoadDevices: canReadEnergy && siteAudit.formData && typeof siteAudit.formData === 'object' && !Array.isArray(siteAudit.formData)
          ? siteAuditValue((siteAudit.formData as Record<string, unknown>).planned_demand)
          : null,
      } : {}),
    },
    existingPv,
    existingBatteryKwh,
    existingBatteryPresent,
    location,
    settlementMode: canReadEnergy ? textOrNull(energyAudit?.settlementSystem) : null,
    annualConsumptionKwh: canReadEnergy ? finiteOrNull(energyAudit?.annualConsumptionKwh) : null,
    energyProfileSource: canReadEnergy ? energyAudit?.profileSource ?? null : null,
    ...(referenceProfile ? { referenceProfile } : {}),
    issues: inputIssues,
  };

  const measurementIssues: string[] = [];
  if (!canReadEnergy) measurementIssues.push('Brak uprawnienia energy.manage do odczytu pomiarów operatora.');
  else if (ppe.issue && !(energyAudit?.profileSource === 'ANNUAL_DECLARATION' && !ppe.sourceAccounts.length)) measurementIssues.push(ppe.issue);

  let measurementFiles: Array<{
    id: string; clientId: string; projectId: string | null; accountId: string; kind: OfferMeasurementKind;
    periodYear: number; periodMonth: number; aggregation: string; storagePath: string | null; fileName: string | null;
    updatedAt: Date; document: OfferWorkspaceStoredMeasurement['document'] & { id?: string; updatedAt?: Date };
  }> = [];
  let nonDownloadedMeasurementFiles: Array<{ id: string; status: string }> = [];
  if (ppe.sourceAccounts.length) {
    const periodWhere = periodKeys.map((period) => {
      const [periodYear, periodMonth] = period.split('-').map(Number);
      return { periodYear, periodMonth };
    });
    measurementFiles = await prisma.energyMeasurementFile.findMany({
      where: {
        accountId: { in: ppe.sourceAccounts.map((account) => account.id) },
        clientId: project.clientId,
        operator: 'ENEA',
        status: 'DOWNLOADED',
        kind: { in: ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'] },
        AND: [
          { OR: periodWhere },
          { OR: [{ projectId }, { projectId: null }] },
        ],
      },
      select: {
        id: true, clientId: true, projectId: true, accountId: true, kind: true, periodYear: true, periodMonth: true,
        aggregation: true, storagePath: true, fileName: true, updatedAt: true,
        document: { select: { id: true, clientId: true, projectId: true, storagePath: true, fileName: true, sizeBytes: true, sha256: true, updatedAt: true } },
      },
      orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }, { kind: 'asc' }, { id: 'asc' }],
    });
    if (!measurementFiles.length) {
      nonDownloadedMeasurementFiles = await prisma.energyMeasurementFile.findMany({
        where: {
          accountId: { in: ppe.sourceAccounts.map((account) => account.id) },
          clientId: project.clientId,
          operator: 'ENEA',
          status: { not: 'DOWNLOADED' },
          kind: { in: ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'] },
          AND: [
            { OR: periodWhere },
            { OR: [{ projectId }, { projectId: null }] },
          ],
        },
        select: { id: true, status: true },
      });
      if (nonDownloadedMeasurementFiles.length) {
        measurementIssues.push(`Znaleziono ${nonDownloadedMeasurementFiles.length} zapisanych rekordów plików ENEA poza statusem DOWNLOADED; danych nie uznano za brak plików.`);
      }
    }
  }

  const source = {
    algorithmVersion: 'offer-workspace-v2-operator-grid-import',
    energyVisible: canReadEnergy,
    pricingVisible: canReadPricing,
    pricing: canReadPricing ? templates.map(template => serializeTemplate(template, true)) : null,
    period,
    project: {
      id: project.id, clientId: project.clientId, title: project.title, clientType: project.clientType,
      locationAddress: project.locationAddress, updatedAt: project.updatedAt,
      client: project.client, investmentSite: project.investmentSite,
    },
    energyAudit: canReadEnergy
      ? energyAudit ? { id: energyAudit.id, profileSource: energyAudit.profileSource,
        annualConsumptionKwh: energyAudit.annualConsumptionKwh, existingBatteryKwh: energyAudit.existingBatteryKwh, updatedAt: energyAudit.updatedAt } : null
      : energyAuditVersion,
    referenceProfile: canReadEnergy ? referenceProfile : null,
    siteAudit: siteAudit && { id: siteAudit.id, updatedAt: siteAudit.updatedAt, formData: siteAudit.formData },
    ppeAccounts: ppe.sourceAccounts.map((account) => ({ id: account.id, projectId: account.projectId, updatedAt: account.updatedAt })),
    measurementFiles: measurementFiles.map((file) => ({
      id: file.id, clientId: file.clientId, projectId: file.projectId, accountId: file.accountId, kind: file.kind,
      periodYear: file.periodYear, periodMonth: file.periodMonth, aggregation: file.aggregation,
      storagePath: file.storagePath, fileName: file.fileName, updatedAt: file.updatedAt,
      document: file.document && {
        id: file.document.id, clientId: file.document.clientId, projectId: file.document.projectId,
        storagePath: file.document.storagePath, fileName: file.document.fileName, sizeBytes: file.document.sizeBytes,
        sha256: file.document.sha256, updatedAt: file.document.updatedAt,
      },
    })),
    nonDownloadedMeasurementFiles,
    templates: templateSourceRevision(templates),
  };
  let revision = sourceRevision(source);

  let measurements: OfferWorkspaceMeasurements = {
    periods: [], months: emptyOfferMeasurementMonths(periodKeys), totalsImportKwh: null, totalsExportKwh: null,
    intervalCount: null, missingDirections: [], issues: measurementIssues,
  };
  if (canReadEnergy && ppe.ppeNumber) {
    const inputs: Array<{ id: string; expectedPeriod: string; expectedKind: OfferMeasurementKind; bytes: Buffer; projectId: string }> = [];
    if (measurementFiles.length > maxOfferWorkspaceMeasurementFiles) {
      measurementIssues.push(`Znaleziono więcej niż ${maxOfferWorkspaceMeasurementFiles} miesięcznych plików ENEA; pomiary nie zostały wczytane.`);
      measurements = { periods: [], months: emptyOfferMeasurementMonths(periodKeys), totalsImportKwh: null, totalsExportKwh: null, intervalCount: null, missingDirections: [], issues: measurementIssues };
    } else {
      let cacheEligible = true;
      for (const file of measurementFiles) {
        const period = `${file.periodYear}-${String(file.periodMonth).padStart(2, '0')}`;
        if (file.clientId !== project.clientId || file.projectId && file.projectId !== projectId
          || !ppe.accounts.some((account) => account.id === file.accountId)) {
          measurementIssues.push(`Plik ${file.id}: niespójne powiązanie klienta, projektu lub konta.`);
          cacheEligible = false;
          continue;
        }
        if (file.document && (file.document.clientId !== project.clientId || (file.document.projectId && file.document.projectId !== projectId))) {
          measurementIssues.push(`Plik ${file.id}: dokument nie należy do wskazanego klienta i projektu.`);
          cacheEligible = false;
          continue;
        }
        if (file.aggregation !== '60 min') {
          measurementIssues.push(`Plik ${file.id}: oczekiwana agregacja 60 min.`);
          cacheEligible = false;
          continue;
        }
        try {
          const bytes = await readOfferWorkspaceMeasurement(file);
          inputs.push({ id: file.id, expectedPeriod: period, expectedKind: file.kind, bytes, projectId });
        } catch (error) {
          measurementIssues.push(`Plik ${file.id}: ${error instanceof Error ? error.message : String(error)}`);
          cacheEligible = false;
        }
      }
      if (!measurementFiles.length) measurementIssues.push(`Brak pobranych miesięcznych plików ENEA w okresie ${period.startMonth}–${period.endMonth}.`);
      // Availability and verified bytes are part of the identity consumed by
      // energy, financial and document caches as well as the parsed-file cache.
      revision = sourceRevision({ source, verifiedMeasurements: inputs.map(input => ({
        id: input.id, sha256: createHash('sha256').update(input.bytes).digest('hex'),
      })), cacheEligible, measurementIssues });
      const artifactIdentity = {
        projectId,
        kind: 'measurements',
        key: {
          algorithmVersion: 'offer-workspace-measurements-v1',
          sourceRevision: revision,
          energyPermission: canReadEnergy,
          ppeNumber: ppe.ppeNumber,
          periodKeys,
          hasExistingPv: energyAudit?.existingPvKw == null ? null : Number(energyAudit.existingPvKw) > 0,
        },
      };
      const cachedValue = cacheEligible
        ? await getOfferWorkspaceArtifact<CachedOfferWorkspaceMeasurements>(artifactIdentity)
        : null;
      if (cachedValue) {
        const cached = cachedOfferWorkspaceMeasurements(cachedValue, revision);
        measurements = cached.measurements;
        try {
          onMeasurementSeries?.(cached.series);
        } catch (error) {
          measurementIssues.push(error instanceof Error ? error.message : String(error));
          measurements = { periods: [], months: emptyOfferMeasurementMonths(periodKeys), totalsImportKwh: null, totalsExportKwh: null, intervalCount: null, missingDirections: [], issues: measurementIssues };
          revision = sourceRevision({ sourceRevision: revision, measurementIssues });
        }
      } else {
        let series: OfferMeasurementSeries | null = null;
        let calculationSucceeded = false;
        try {
          series = buildOfferMeasurementSeries(inputs, {
            ppeNumber: ppe.ppeNumber,
            periodKeys,
            projectId,
            ...(energyAudit?.existingPvKw == null ? {} : { hasExistingPv: Number(energyAudit.existingPvKw) > 0 }),
          });
          measurements = summarizeOfferMeasurementSeries(series, measurementIssues, periodKeys);
          onMeasurementSeries?.(series);
          calculationSucceeded = true;
        } catch (error) {
          measurementIssues.push(error instanceof Error ? error.message : String(error));
          measurements = { periods: [], months: emptyOfferMeasurementMonths(periodKeys), totalsImportKwh: null, totalsExportKwh: null, intervalCount: null, missingDirections: [], issues: measurementIssues };
          revision = sourceRevision({ sourceRevision: revision, measurementIssues });
        }
        if (calculationSucceeded && cacheEligible && series) {
          await putOfferWorkspaceArtifact(artifactIdentity, {
            schemaVersion: 1,
            sourceRevision: revision,
            measurements,
            series,
          } satisfies CachedOfferWorkspaceMeasurements);
        }
      }
    }
  } else if (canReadEnergy && !ppe.ppeNumber) {
    if (!measurementFiles.length && ppe.accounts.length) measurementIssues.push(`Brak pobranych miesięcznych plików ENEA w okresie ${period.startMonth}–${period.endMonth}.`);
    measurements.issues = measurementIssues;
  }

  measurements.availability = !canReadEnergy ? 'UNKNOWN'
    : measurementFiles.length || nonDownloadedMeasurementFiles.length ? 'FILES_PRESENT' : 'NO_FILES';

  const serializedTemplates = templates.map((template) => serializeTemplate(template, canReadPricing));
  return {
    projectId: project.id,
    clientId: project.clientId,
    projectName: project.title,
    clientName: project.client.displayName,
    clientType: offerWorkspaceEffectiveClientType(project.clientType, project.client.clientType),
    period,
    ppeNumber: canReadEnergy ? ppe.ppeNumber : null,
    revision,
    input,
    measurements,
    templates: serializedTemplates,
    canEditConfigurationItems: canReadDraft && canReadPricing,
    draft: canReadDraft && draft ? (() => {
      const saved = savedDraft(draft, canReadPricing);
      return { ...saved, input: offerWorkspaceDraftWithBatteryPresence(saved.input, existingBatteryPresent) };
    })() : null,
  };
}

export async function validateOfferWorkspaceTariff(operatorId: number | null, tariffId: number | null) {
  if (operatorId == null && tariffId == null) return;
  if (operatorId == null || tariffId == null) throw new OfferWorkspaceConflictError('Wybierz jednocześnie operatora i taryfę.');
  const rows = await rePrisma().$queryRawUnsafe<Array<{ id: number }>>(
    'SELECT t.id FROM tariff t JOIN osd o ON o.id = t.osd_id WHERE t.id = ? AND o.id = ? LIMIT 1',
    tariffId,
    operatorId,
  );
  if (!rows.length) throw new OfferWorkspaceConflictError('Wybrana taryfa nie należy do operatora w aktualnym katalogu.');
}

export async function saveProjectOfferWorkspaceDraft(options: {
  projectId: string;
  user: OfferWorkspaceStaffUser;
  expectedRevision: number;
  sourceRevision: string;
  input: OfferWorkspaceDraft;
  acceptedPricingRevision?: string;
  now: Date;
}) {
  if (!hasStaffPermission(options.user, 'offers.manage') || !hasStaffPermission(options.user, 'energy.manage')) {
    throw new OfferWorkspacePermissionError();
  }
  const freshWorkspace = await loadProjectOfferWorkspace(options.projectId, options.user, options.now);
  if (freshWorkspace.revision !== options.sourceRevision) {
    throw new OfferWorkspaceConflictError('Dane projektu, pomiarów lub katalogu zmieniły się. Odśwież workspace przed zapisem.');
  }
  const canReadPricing = hasStaffPermission(options.user, 'pricing.read');
  if (!canReadPricing && (configurationEditsContainPricing(options.input.configurationEdits) || options.input.commercialPricing)) {
    throw new OfferWorkspacePermissionError();
  }
  const input = offerWorkspaceDraftWithBatteryPresence(options.input, freshWorkspace.input.existingBatteryPresent);
  try {
    validateOfferWorkspaceConfigurationEdits(freshWorkspace.templates, input);
  } catch (error) {
    throw new OfferWorkspaceConflictError(error instanceof Error ? error.message : 'Nieprawidłowe zmiany pozycji konfiguracji.');
  }
  const previewPricingSnapshot = canReadPricing
    ? createServerOfferWorkspacePricingSnapshot(input, freshWorkspace.templates, freshWorkspace.clientType)
    : null;
  await validateOfferWorkspaceTariff(input.targetOperatorId, input.targetTariffId);

  try {
    return await prisma.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: offerWorkspaceProjectWhere(options.projectId, options.user),
        select: { id: true, clientId: true, clientType: true, client: { select: { clientType: true } } },
      });
      if (!project) throw new OfferWorkspaceNotFoundError();
      const templateClientTypes = compatibleTemplateClientTypes(project.clientType, project.client.clientType);

      let activeTemplates: any[] = [];
      if (input.selectedTemplateIds.length) {
        activeTemplates = await tx.configurationTemplate.findMany({
          where: {
            id: { in: input.selectedTemplateIds },
            isActive: true,
            clientType: { in: templateClientTypes },
          },
          select: {
            id: true, name: true, kind: true, powerKw: true, capacityKwh: true,
            items: {
              select: {
                id: true, position: true, description: true, quantity: true, role: true, supplyMode: true,
                pricingMode: true, operatingCostBasis: true, catalogPriceId: true,
                productId: true, unitPurchaseNet: true, unitSaleNet: true, purchaseVatRate: true, operatingCostNet: true,
                marginRate: true, saleVatRate: true, isOptional: true, requiresReview: true,
                product: {
                  select: {
                    id: true, name: true, category: true,
                    prices: {
                      where: { validFrom: { lte: options.now } },
                      select: {
                        id: true, purchaseNet: true, currentPurchaseNet: true, purchaseVatRate: true,
                        operatingCostNet: true, marginRate: true, saleVatRate: true,
                      },
                      orderBy: { validFrom: 'desc' }, take: 1,
                    },
                  },
                },
              },
              orderBy: { position: 'asc' },
            },
          },
        });
        if (activeTemplates.length !== input.selectedTemplateIds.length) {
          throw new OfferWorkspaceConflictError('Wybrany zestaw jest nieaktywny lub niedostępny dla tego typu klienta.');
        }
        const scopes = activeTemplates.map((template) => configurationInvestmentScope(template.kind));
        if (scopes.some((scope) => scope == null) || new Set(scopes).size !== scopes.length) {
          throw new OfferWorkspaceConflictError('Wybierz najwyżej jeden szablon PV i jeden szablon magazynu energii.');
        }
        if (scopes.includes('PV') && input.pvStrategy !== 'ADD_TEMPLATE') {
          throw new OfferWorkspaceConflictError('Szablon PV wymaga strategii dodania PV.');
        }
      }

      try {
        validateOfferWorkspaceConfigurationEdits(activeTemplates, input);
      } catch (error) {
        throw new OfferWorkspaceConflictError(error instanceof Error ? error.message : 'Nieprawidłowe zmiany pozycji konfiguracji.');
      }

      const clientType = offerWorkspaceEffectiveClientType(project.clientType, project.client.clientType);
      const pricingSnapshot = createServerOfferWorkspacePricingSnapshot(input, activeTemplates, clientType);
      if (canReadPricing && !offerWorkspacePricingSnapshotsMatch(previewPricingSnapshot, pricingSnapshot)) {
        throw new OfferWorkspaceConflictError('Ceny konfiguracji zmieniły się przed zapisem. Odśwież workspace i porównaj aktualne sumy.');
      }
      const persistedInput = {
        ...input,
        ...(pricingSnapshot ? { _pricingSnapshot: pricingSnapshot } : {}),
      } as unknown as Prisma.InputJsonValue;

      const existing = await tx.offerWorkspace.findUnique({ where: { projectId: options.projectId } });
      if (options.expectedRevision === 0) {
        if (existing) throw new OfferWorkspaceConflictError('Szkic został już utworzony w innej karcie. Odśwież workspace.');
        const created = await tx.offerWorkspace.create({ data: {
          projectId: options.projectId,
          revision: 1,
          schemaVersion: OFFER_WORKSPACE_SCHEMA_VERSION,
          sourceRevision: options.sourceRevision,
          input: persistedInput,
          createdById: options.user.id,
          updatedById: options.user.id,
        } });
        await tx.auditLog.create({ data: {
          actorId: options.user.id,
          clientId: project.clientId,
          entityType: 'OfferWorkspaceDraft',
          entityId: options.projectId,
          action: 'CREATE',
          before: Prisma.JsonNull,
          after: { revision: created.revision, sourceRevision: created.sourceRevision, input: persistedInput } as Prisma.InputJsonValue,
        } });
        return savedDraft(created, hasStaffPermission(options.user, 'pricing.read'));
      }

      if (!existing || existing.revision !== options.expectedRevision) {
        throw new OfferWorkspaceConflictError('Szkic ma nowszą rewizję. Odśwież workspace przed zapisem.');
      }
      const existingInput = existing.input && typeof existing.input === 'object' && !Array.isArray(existing.input)
        ? existing.input as Record<string, unknown> : {};
      if (!canReadPricing && (configurationEditsContainPricing(parseOfferWorkspaceDraft(existing.input).configurationEdits)
        || parseOfferWorkspaceDraft(existing.input).commercialPricing)) {
        throw new OfferWorkspacePermissionError();
      }
      const existingPricingSnapshot = parseStoredPricingSnapshot(existingInput._pricingSnapshot);
      if (!offerWorkspacePricingChangeAcknowledged(
        existingPricingSnapshot,
        pricingSnapshot,
        options.acceptedPricingRevision,
      )) {
        throw new OfferWorkspaceConflictError('Potwierdź aktualne ceny po porównaniu zapisanych i bieżących sum.');
      }
      const changed = await tx.offerWorkspace.updateMany({
        where: { projectId: options.projectId, revision: options.expectedRevision },
        data: {
          revision: { increment: 1 },
          schemaVersion: OFFER_WORKSPACE_SCHEMA_VERSION,
          sourceRevision: options.sourceRevision,
          input: persistedInput,
          updatedById: options.user.id,
        },
      });
      if (changed.count !== 1) throw new OfferWorkspaceConflictError('Szkic ma nowszą rewizję. Odśwież workspace przed zapisem.');
      const updated = await tx.offerWorkspace.findUniqueOrThrow({ where: { projectId: options.projectId } });
      await tx.auditLog.create({ data: {
        actorId: options.user.id,
        clientId: project.clientId,
        entityType: 'OfferWorkspaceDraft',
        entityId: options.projectId,
        action: 'UPDATE',
        before: { revision: existing.revision, sourceRevision: existing.sourceRevision, input: existing.input as Prisma.InputJsonValue },
        after: { revision: updated.revision, sourceRevision: updated.sourceRevision, input: persistedInput } as Prisma.InputJsonValue,
      } });
      return savedDraft(updated, hasStaffPermission(options.user, 'pricing.read'));
    });
  } catch (error) {
    if (error instanceof OfferWorkspaceConflictError || error instanceof OfferWorkspaceNotFoundError) throw error;
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
      throw new OfferWorkspaceConflictError('Szkic został już utworzony w innej karcie. Odśwież workspace.');
    }
    throw error;
  }
}
