import { configurationInvestmentScope } from './configuration-templates';
import type { OfferWorkspacePricingResult, OfferWorkspacePricingTemplate } from './offer-workspace-pricing';
import { parseOfferWorkspaceConfigurationEdits, type OfferWorkspaceConfigurationEdit } from './offer-workspace-configuration-edits';
import { automaticOfferCommercialBreakdown, parseOfferWorkspaceCommercialBreakdown, type OfferWorkspaceCommercialBreakdown } from './offer-workspace-commercial-pricing';

export const OFFER_WORKSPACE_SCHEMA_VERSION = 1;
export const DEFAULT_OFFER_BILLING_CYCLE_MONTHS = 2;
export const DEFAULT_OFFER_TAX_RATE_PERCENT = 12;
export const OFFER_WORKSPACE_STEPS = ['SYSTEM', 'CONFIGURATION', 'SAVINGS', 'DESCRIPTION', 'SUMMARY'] as const;
export type OfferWorkspaceStep = typeof OFFER_WORKSPACE_STEPS[number];

export type OfferWorkspaceInitialCreditLot = {
  kwh: number;
  creditedMonth: string;
  expiresMonth: string;
};

export type OfferWorkspaceInitialDepositLot = {
  amountPln: number;
  creditedMonth: string;
  expiresMonth: string;
  refundCapPln: number;
};

export type OfferCalculationAssumptions = {
  pvReconstructionAccepted?: boolean;
  taxEstimateAccepted?: boolean;
  taxDetailedCalculation?: boolean;
  billingCycleMonths: number | null;
  billingCycleStartMonth?: string | null;
  initialCreditKwh: number | null;
  initialCreditLots?: OfferWorkspaceInitialCreditLot[];
  initialDepositPln: number | null;
  initialDepositLots?: OfferWorkspaceInitialDepositLot[];
  batteryReservePercent: number;
  chargeEfficiencyPercent: number;
  dischargeEfficiencyPercent: number;
  addedPvTiltDegrees: number | null;
  addedPvAzimuthDegrees: number | null;
  taxRatePercent: number | null;
  taxRemainingLimitPln: number | null;
  taxEligibleCostPln: number | null;
  taxBasePln: number | null;
};

export function defaultOfferCalculationAssumptions(): OfferCalculationAssumptions {
  return {
    pvReconstructionAccepted: false, taxEstimateAccepted: false,
    billingCycleMonths: null, initialCreditKwh: null, initialDepositPln: null,
    billingCycleStartMonth: null, initialCreditLots: [], initialDepositLots: [],
    batteryReservePercent: 10, chargeEfficiencyPercent: 95, dischargeEfficiencyPercent: 95,
    addedPvTiltDegrees: null, addedPvAzimuthDegrees: null,
    taxRatePercent: null, taxRemainingLimitPln: null, taxEligibleCostPln: null, taxBasePln: null,
  };
}

export function usesOfferTaxEstimate(settings: OfferCalculationAssumptions): boolean {
  if (settings.taxDetailedCalculation != null) return !settings.taxDetailedCalculation;
  // Starsze szkice z kompletem danych zachowują dokładną symulację.
  return settings.taxEstimateAccepted === true
    || [settings.taxBasePln, settings.taxRemainingLimitPln, settings.taxEligibleCostPln].some(value => value == null);
}

export type OfferWorkspaceDraft = {
  schemaVersion: 1;
  step: OfferWorkspaceStep;
  objective: 'SHORTEST_PAYBACK';
  existingBatteryPresent?: boolean | null;
  existingPv: {
    powerKw: number | null;
    tiltDegrees: number | null;
    azimuthDegrees: number | null;
    lossPercent: number | null;
  };
  pvStrategy: 'KEEP_EXISTING' | 'ADD_TEMPLATE';
  includeStorage?: boolean;
  currentSettlement: 'NET_METERING' | 'NET_BILLING' | null;
  targetSettlement: 'NET_METERING' | 'NET_BILLING' | null;
  targetOperatorId: number | null;
  targetTariffId: number | null;
  saleVatMode: 'REDUCED_8' | 'STANDARD_23' | 'MIXED' | 'REVIEW';
  selectedTemplateIds: string[];
  configurationEdits?: OfferWorkspaceConfigurationEdit[];
  commercialPricing?: OfferWorkspaceCommercialBreakdown;
  financing: { considerGrant: boolean; considerTaxRelief: boolean };
  calculation?: OfferCalculationAssumptions;
  description: { before: string; after: string };
};

export type OfferCalculationAssumptionKey = Exclude<
  keyof OfferCalculationAssumptions,
  'billingCycleStartMonth' | 'initialCreditLots' | 'initialDepositLots' | 'pvReconstructionAccepted' | 'taxEstimateAccepted' | 'taxDetailedCalculation'
>;

export function offerWorkspaceDraftWithCalculationValue(
  draft: OfferWorkspaceDraft,
  key: OfferCalculationAssumptionKey,
  value: number | null,
): OfferWorkspaceDraft {
  return {
    ...draft,
    calculation: {
      ...defaultOfferCalculationAssumptions(),
      ...(draft.calculation || {}),
      [key]: value,
    } as OfferCalculationAssumptions,
  };
}

export type SavedOfferWorkspaceDraft = {
  revision: number;
  sourceRevision: string;
  updatedAt: string;
  input: OfferWorkspaceDraft;
  pricingSnapshot?: OfferWorkspacePricingSnapshot;
};

export type OfferWorkspacePricingSnapshot = {
  schemaVersion: 1;
  revision: string;
  selectedTemplateIds: string[];
  saleVatMode: OfferWorkspaceDraft['saleVatMode'];
  clientType: string;
  totals: { net: number | null; gross: number | null };
};

export type OfferWorkspacePricingFreshness = 'NO_BASELINE' | 'CURRENT' | 'STALE' | 'UNAVAILABLE';

function compareStableIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pricingRevisionHash(serialized: string) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  left ^= left >>> 16;
  left = Math.imul(left, 0x85ebca6b);
  left ^= left >>> 13;
  right ^= right >>> 16;
  right = Math.imul(right, 0xc2b2ae35);
  right ^= right >>> 13;
  return `pricing-v1-${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

export function createOfferWorkspacePricingSnapshot(
  draft: Pick<OfferWorkspaceDraft, 'selectedTemplateIds' | 'saleVatMode' | 'commercialPricing'>,
  clientType: string,
  pricing: OfferWorkspacePricingResult,
  templates: OfferWorkspacePricingTemplate[] = [],
): OfferWorkspacePricingSnapshot {
  const selectedTemplateIds = [...draft.selectedTemplateIds].sort();
  const selectedIds = new Set(selectedTemplateIds);
  const revisionTemplates = templates.filter((template) => selectedIds.has(template.id))
    .map((template) => ({
      id: template.id,
      items: template.items.map((item) => {
        const price = item.product?.prices?.[0];
        const number = (value: unknown) => {
          if (value == null) return null;
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : null;
        };
        const unitSaleNet = number(item.unitSaleNet);
        return {
          id: item.id,
          quantity: number(item.quantity),
          supplyMode: item.supplyMode,
          pricingMode: item.pricingMode ?? 'LEGACY',
          operatingCostBasis: item.operatingCostBasis ?? 'PER_LINE',
          catalogPriceId: item.catalogPriceId ?? null,
          productId: item.product?.id ?? item.productId ?? null,
          unitPurchaseNet: number(item.unitPurchaseNet),
          ...(unitSaleNet === null ? {} : { unitSaleNet }),
          purchaseVatRate: number(item.purchaseVatRate),
          operatingCostNet: number(item.operatingCostNet),
          marginRate: number(item.marginRate),
          saleVatRate: number(item.saleVatRate),
          isOptional: item.isOptional,
          requiresReview: item.requiresReview,
          currentPrice: price ? {
            id: price.id ?? null,
            purchaseNet: number(price.purchaseNet),
            currentPurchaseNet: number(price.currentPurchaseNet),
            purchaseVatRate: number(price.purchaseVatRate),
            operatingCostNet: number(price.operatingCostNet),
            marginRate: number(price.marginRate),
            saleVatRate: number(price.saleVatRate),
          } : null,
        };
      }).sort((left, right) => compareStableIds(left.id, right.id)),
    })).sort((left, right) => compareStableIds(left.id, right.id));
  const totalFields = pricing.totals ? {
    purchaseNet: pricing.totals.purchaseNet,
    purchaseVatValue: pricing.totals.purchaseVatValue,
    purchaseGross: pricing.totals.purchaseGross,
    operatingCostNet: pricing.totals.operatingCostNet,
    totalCostNet: pricing.totals.totalCostNet,
    marginNet: pricing.totals.marginNet,
    saleNet: pricing.totals.saleNet,
    saleVatValue: pricing.totals.saleVatValue,
    saleGross: pricing.totals.saleGross,
    vatSurplus: pricing.totals.vatSurplus,
    profitNet: pricing.totals.profitNet,
    profitWithVatSurplus: pricing.totals.profitWithVatSurplus,
  } : null;
  const revisionData = {
    selectedTemplateIds,
    ...(draft.commercialPricing ? { commercialPricing: { ...draft.commercialPricing,
      allocations: [...draft.commercialPricing.allocations].sort((a, b) => compareStableIds(`${a.templateId}\u0000${a.itemId}`, `${b.templateId}\u0000${b.itemId}`)) } } : {}),
    saleVatMode: draft.saleVatMode,
    clientType,
    templates: revisionTemplates,
    saleAmountBasis: pricing.saleAmountBasis,
    lines: [...pricing.lines].sort((left, right) => compareStableIds(
      `${left.templateId}\u0000${left.itemId}`,
      `${right.templateId}\u0000${right.itemId}`,
    )).map((line) => ({
      templateId: line.templateId,
      itemId: line.itemId,
      quantity: line.quantity,
      includedInSale: line.includedInSale,
      resolvedCosts: line.resolvedCosts,
      saleVatRate: line.saleVatRate,
      calculation: line.calculation,
    })),
    totals: totalFields,
    systemCostBeforeFinancing: pricing.systemCostBeforeFinancing,
  };
  return {
    schemaVersion: 1,
    revision: pricingRevisionHash(JSON.stringify(revisionData)),
    selectedTemplateIds,
    saleVatMode: draft.saleVatMode,
    clientType,
    totals: {
      net: pricing.totals?.saleNet ?? null,
      gross: pricing.totals?.saleGross ?? null,
    },
  };
}

export function offerWorkspacePricingFreshness(
  saved: OfferWorkspacePricingSnapshot | null | undefined,
  current: OfferWorkspacePricingSnapshot | null | undefined,
): OfferWorkspacePricingFreshness {
  if (!saved) return 'NO_BASELINE';
  if (!current) return 'UNAVAILABLE';
  return saved.revision === current.revision ? 'CURRENT' : 'STALE';
}

export function emptyOfferWorkspaceDraft(): OfferWorkspaceDraft {
  return {
    schemaVersion: 1, step: 'SYSTEM', objective: 'SHORTEST_PAYBACK',
    existingBatteryPresent: null,
    existingPv: { powerKw: null, tiltDegrees: null, azimuthDegrees: null, lossPercent: null },
    pvStrategy: 'KEEP_EXISTING', currentSettlement: null, targetSettlement: null,
    targetOperatorId: null, targetTariffId: null, saleVatMode: 'REVIEW',
    selectedTemplateIds: [], financing: { considerGrant: false, considerTaxRelief: false },
    description: { before: '', after: '' },
  };
}

export function offerWorkspaceDraftWithBatteryPresence(
  draft: OfferWorkspaceDraft,
  existingBatteryPresent: boolean | null,
): OfferWorkspaceDraft {
  return { ...draft, existingBatteryPresent };
}

type WorkspaceTemplateReference = { id: string; kind: string };

export function selectOfferWorkspaceTemplate(
  draft: OfferWorkspaceDraft,
  templates: WorkspaceTemplateReference[],
  templateId: string,
  checked: boolean,
): OfferWorkspaceDraft {
  const template = templates.find((item) => item.id === templateId);
  const scope = template && configurationInvestmentScope(template.kind);
  if (!scope) throw new Error('Wybierz szablon magazynu lub PV');
  const retained = draft.selectedTemplateIds.filter((id) => id !== templateId
    && (!checked || configurationInvestmentScope(templates.find((item) => item.id === id)?.kind || '') !== scope));
  const selectedTemplateIds = checked ? [...retained, templateId] : retained;
  const selectionChanged = selectedTemplateIds.length !== draft.selectedTemplateIds.length
    || selectedTemplateIds.some(id => !draft.selectedTemplateIds.includes(id));
  return {
    ...draft,
    selectedTemplateIds,
    ...(selectionChanged ? { commercialPricing: automaticOfferCommercialBreakdown() } : {}),
    ...(draft.configurationEdits ? { configurationEdits: draft.configurationEdits.filter((edit) => selectedTemplateIds.includes(edit.templateId)) } : {}),
    pvStrategy: checked && scope === 'PV' ? 'ADD_TEMPLATE' : draft.pvStrategy,
  };
}

export function setOfferWorkspacePvStrategy(
  draft: OfferWorkspaceDraft,
  templates: WorkspaceTemplateReference[],
  pvStrategy: OfferWorkspaceDraft['pvStrategy'],
): OfferWorkspaceDraft {
  const selectedTemplateIds = pvStrategy === 'KEEP_EXISTING'
    ? draft.selectedTemplateIds.filter((id) => configurationInvestmentScope(templates.find((item) => item.id === id)?.kind || '') !== 'PV')
    : draft.selectedTemplateIds;
  return {
    ...draft, pvStrategy,
    selectedTemplateIds,
    ...(selectedTemplateIds.length !== draft.selectedTemplateIds.length ? { commercialPricing: automaticOfferCommercialBreakdown() } : {}),
    ...(draft.configurationEdits ? { configurationEdits: draft.configurationEdits.filter((edit) => selectedTemplateIds.includes(edit.templateId)) } : {}),
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Nieprawidłowe pole: ${label}`);
  return value as Record<string, unknown>;
}

function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(`Nieprawidłowe pole: ${label}`);
  return value as T;
}

function optionalNumber(value: unknown, min: number, max: number, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label}: wymagana liczba od ${min} do ${max}`);
  }
  return value;
}

function optionalId(value: unknown, label: string): number | null {
  const result = optionalNumber(value, 1, Number.MAX_SAFE_INTEGER, label);
  if (result !== null && !Number.isSafeInteger(result)) throw new Error(`Nieprawidłowy identyfikator: ${label}`);
  return result;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 10000) throw new Error(`${label}: maksymalnie 10 000 znaków`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Nieprawidłowe pole: ${label}`);
  return value;
}

const MIN_BILLING_YEAR = 1900;
const MAX_BILLING_YEAR = 2100;

function monthOrdinal(value: string, label: string): number {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) throw new Error(`${label}: wymagany prawidłowy miesiąc YYYY-MM.`);
  const year = Number(match[1]);
  if (year < MIN_BILLING_YEAR || year > MAX_BILLING_YEAR) {
    throw new Error(`${label}: rok musi mieścić się w zakresie ${MIN_BILLING_YEAR}–${MAX_BILLING_YEAR}.`);
  }
  return year * 12 + Number(match[2]) - 1;
}

function currentWarsawMonthOrdinal(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return year * 12 + month - 1;
}

function parseMonthOrNull(value: unknown, label: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`${label}: wymagany prawidłowy miesiąc YYYY-MM.`);
  monthOrdinal(value, label);
  return value;
}

function parseOpeningCreditLots(value: unknown): OfferWorkspaceInitialCreditLot[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Początkowe transze energii muszą być listą.');
  const now = currentWarsawMonthOrdinal();
  return value.map((item, index) => {
    const lot = record(item, `initialCreditLots[${index}]`);
    const kwh = optionalNumber(lot.kwh, 0, 1000000, `initialCreditLots[${index}].kwh`);
    if (kwh === null) throw new Error(`initialCreditLots[${index}].kwh: wymagane nieujemne saldo.`);
    if (typeof lot.creditedMonth !== 'string' || typeof lot.expiresMonth !== 'string') {
      throw new Error(`initialCreditLots[${index}]: wymagany miesiąc uznania i wygaśnięcia.`);
    }
    const credited = monthOrdinal(lot.creditedMonth, `initialCreditLots[${index}].creditedMonth`);
    const expires = monthOrdinal(lot.expiresMonth, `initialCreditLots[${index}].expiresMonth`);
    if (credited > now) throw new Error(`initialCreditLots[${index}].creditedMonth: przyszłe transze nie są dozwolone.`);
    if (expires <= credited) throw new Error(`initialCreditLots[${index}].expiresMonth: musi przypadać po miesiącu uznania.`);
    if (expires > credited + 13) {
      throw new Error(`initialCreditLots[${index}].expiresMonth: przekracza 12 miesięcy ważności opustu.`);
    }
    return { kwh, creditedMonth: lot.creditedMonth, expiresMonth: lot.expiresMonth };
  });
}

function parseOpeningDepositLots(value: unknown): OfferWorkspaceInitialDepositLot[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Początkowe transze depozytu muszą być listą.');
  const now = currentWarsawMonthOrdinal();
  return value.map((item, index) => {
    const lot = record(item, `initialDepositLots[${index}]`);
    const amountPln = optionalNumber(lot.amountPln, 0, 1000000, `initialDepositLots[${index}].amountPln`);
    const refundCapPln = optionalNumber(lot.refundCapPln, 0, 1000000, `initialDepositLots[${index}].refundCapPln`);
    if (amountPln === null || refundCapPln === null) {
      throw new Error(`initialDepositLots[${index}]: wymagane nieujemne saldo i limit zwrotu.`);
    }
    if (typeof lot.creditedMonth !== 'string' || typeof lot.expiresMonth !== 'string') {
      throw new Error(`initialDepositLots[${index}]: wymagany miesiąc uznania i wygaśnięcia.`);
    }
    const credited = monthOrdinal(lot.creditedMonth, `initialDepositLots[${index}].creditedMonth`);
    const expires = monthOrdinal(lot.expiresMonth, `initialDepositLots[${index}].expiresMonth`);
    if (credited > now) throw new Error(`initialDepositLots[${index}].creditedMonth: przyszłe transze nie są dozwolone.`);
    if (expires <= credited) throw new Error(`initialDepositLots[${index}].expiresMonth: musi przypadać po miesiącu uznania.`);
    if (expires > credited + 12) {
      throw new Error(`initialDepositLots[${index}].expiresMonth: przekracza 12 miesięcy ważności depozytu.`);
    }
    return { amountPln, creditedMonth: lot.creditedMonth, expiresMonth: lot.expiresMonth, refundCapPln };
  });
}

function validateOpeningTotal(total: number | null, lotsTotal: number, lotsLength: number, label: string): void {
  if (lotsLength > 0 && (total === null || Math.abs(total - lotsTotal) > 0.000001)) {
    throw new Error(`${label}: suma datowanych transz musi odpowiadać polu salda początkowego.`);
  }
}

// Only editable assumptions cross the API boundary; calculations and prices stay server-owned.
export function parseOfferWorkspaceDraft(value: unknown): OfferWorkspaceDraft {
  const input = record(value, 'szkic');
  if (input.schemaVersion !== OFFER_WORKSPACE_SCHEMA_VERSION) throw new Error('Nieobsługiwana wersja szkicu oferty');
  const pv = record(input.existingPv, 'istniejąca PV');
  const financing = record(input.financing, 'finansowanie');
  const description = record(input.description, 'opis');
  if (!Array.isArray(input.selectedTemplateIds) || input.selectedTemplateIds.length > 2
    || input.selectedTemplateIds.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    || new Set(input.selectedTemplateIds).size !== input.selectedTemplateIds.length) {
    throw new Error('Wybierz maksymalnie dwa różne zestawy: magazyn i PV');
  }
  const settlement = (value: unknown) => value === null ? null : choice(value, ['NET_METERING', 'NET_BILLING'], 'system rozliczeń');
  const result: OfferWorkspaceDraft = {
    schemaVersion: 1,
    step: choice(input.step, OFFER_WORKSPACE_STEPS, 'krok'),
    objective: choice(input.objective, ['SHORTEST_PAYBACK'], 'cel rekomendacji'),
    existingBatteryPresent: input.existingBatteryPresent == null ? null : boolean(input.existingBatteryPresent, 'Magazyn w okresie pomiarów'),
    existingPv: {
      powerKw: optionalNumber(pv.powerKw, 0, 10000, 'Moc PV'),
      tiltDegrees: optionalNumber(pv.tiltDegrees, 0, 90, 'Nachylenie'),
      azimuthDegrees: optionalNumber(pv.azimuthDegrees, 0, 360, 'Azymut'),
      lossPercent: optionalNumber(pv.lossPercent, 0, 99, 'Straty PV'),
    },
    pvStrategy: choice(input.pvStrategy, ['KEEP_EXISTING', 'ADD_TEMPLATE'], 'zakres PV'),
    ...(input.includeStorage === undefined ? {} : { includeStorage: boolean(input.includeStorage, 'Magazyn w ofercie') }),
    currentSettlement: settlement(input.currentSettlement),
    targetSettlement: settlement(input.targetSettlement),
    targetOperatorId: optionalId(input.targetOperatorId, 'operator'),
    targetTariffId: optionalId(input.targetTariffId, 'taryfa'),
    saleVatMode: choice(input.saleVatMode, ['REDUCED_8', 'STANDARD_23', 'MIXED', 'REVIEW'], 'VAT'),
    selectedTemplateIds: [...input.selectedTemplateIds] as string[],
    ...(input.configurationEdits === undefined ? {} : { configurationEdits: parseOfferWorkspaceConfigurationEdits(input.configurationEdits) }),
    ...(input.commercialPricing == null ? {} : { commercialPricing: parseOfferWorkspaceCommercialBreakdown(input.commercialPricing)! }),
    financing: {
      considerGrant: boolean(financing.considerGrant, 'dotacja'),
      considerTaxRelief: boolean(financing.considerTaxRelief, 'ulga'),
    },
    description: { before: text(description.before, 'Opis przed'), after: text(description.after, 'Opis po') },
  };
  if ((result.targetOperatorId === null) !== (result.targetTariffId === null)) {
    throw new Error('Wybierz jednocześnie operatora i taryfę docelową');
  }
  if (input.calculation !== undefined) {
    const calculation = record(input.calculation, 'założenia obliczeń');
    const nullable = (key: string, min: number, max: number) => optionalNumber(calculation[key], min, max, key);
    const required = (key: string, min: number, max: number) => {
      const value = nullable(key, min, max);
      if (value === null) throw new Error(`Uzupełnij ${key}`);
      return value;
    };
    result.calculation = {
      pvReconstructionAccepted: calculation.pvReconstructionAccepted === undefined ? false : boolean(calculation.pvReconstructionAccepted, 'Akceptacja szacowanej produkcji PV'),
      taxEstimateAccepted: calculation.taxEstimateAccepted === undefined ? false : boolean(calculation.taxEstimateAccepted, 'Akceptacja szacowanej ulgi'),
      ...(calculation.taxDetailedCalculation === undefined ? {} : {
        taxDetailedCalculation: boolean(calculation.taxDetailedCalculation, 'Dokładne dane do ulgi'),
      }),
      billingCycleMonths: calculation.billingCycleMonths == null
        ? null
        : nullable('billingCycleMonths', 1, 12),
      billingCycleStartMonth: parseMonthOrNull(calculation.billingCycleStartMonth, 'billingCycleStartMonth'),
      initialCreditKwh: nullable('initialCreditKwh', 0, 1000000),
      initialCreditLots: parseOpeningCreditLots(calculation.initialCreditLots),
      initialDepositPln: nullable('initialDepositPln', 0, 1000000),
      initialDepositLots: parseOpeningDepositLots(calculation.initialDepositLots),
      batteryReservePercent: required('batteryReservePercent', 0, 99),
      chargeEfficiencyPercent: required('chargeEfficiencyPercent', 1, 100),
      dischargeEfficiencyPercent: required('dischargeEfficiencyPercent', 1, 100),
      addedPvTiltDegrees: nullable('addedPvTiltDegrees', 0, 90),
      addedPvAzimuthDegrees: nullable('addedPvAzimuthDegrees', 0, 360),
      taxRatePercent: nullable('taxRatePercent', 0, 100),
      taxRemainingLimitPln: nullable('taxRemainingLimitPln', 0, 53000),
      taxEligibleCostPln: nullable('taxEligibleCostPln', 0, 10000000),
      taxBasePln: nullable('taxBasePln', 0, 100000000),
    };
    if (result.calculation.billingCycleMonths !== null && !Number.isInteger(result.calculation.billingCycleMonths)) {
      throw new Error('Cykl rozliczeniowy wymaga całkowitej liczby miesięcy.');
    }
    if (result.calculation.billingCycleStartMonth !== null
      && monthOrdinal(result.calculation.billingCycleStartMonth, 'billingCycleStartMonth') > currentWarsawMonthOrdinal()) {
      throw new Error('billingCycleStartMonth nie może wskazywać przyszłego miesiąca.');
    }
    validateOpeningTotal(result.calculation.initialCreditKwh,
      result.calculation.initialCreditLots.reduce((sum, lot) => sum + lot.kwh, 0),
      result.calculation.initialCreditLots.length, 'initialCreditKwh');
    validateOpeningTotal(result.calculation.initialDepositPln,
      result.calculation.initialDepositLots.reduce((sum, lot) => sum + lot.amountPln, 0),
      result.calculation.initialDepositLots.length, 'initialDepositPln');
  }
  return result;
}
