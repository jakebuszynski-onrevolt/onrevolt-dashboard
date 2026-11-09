import { sumConfiguration, type CalculationResult, type ConfigurationTotals } from './calculator';
import { resolveTemplateItemCosts, resolveTemplateItemSaleVat, type PriceableTemplateItem } from './configuration-templates';
import type { ConfigurationVatMode } from './configuration-vat';

type NumericValue = string | number | { toString(): string };

export type OfferWorkspacePricingClientType = 'B2C' | 'B2B';

export type OfferWorkspacePricingSupplyMode =
  | 'ONREVOLT_SUPPLIED'
  | 'CLIENT_OWNED_USED'
  | 'CLIENT_SUPPLIED_NEW'
  | 'SERVICE_ONLY'
  | 'NOT_INCLUDED';

export type OfferWorkspacePricingItem = PriceableTemplateItem & {
  id: string;
  position: number;
  quantity: NumericValue;
  role: string;
  supplyMode: string;
  saleVatRate: NumericValue | null;
  isOptional: boolean;
  requiresReview: boolean;
  workspaceRemoved?: boolean;
  workspaceAdded?: boolean;
  workspaceChanged?: boolean;
  product?: (NonNullable<PriceableTemplateItem['product']> & {
    id?: string | null;
    sku?: string | null;
    category?: string | null;
  }) | null;
};

export type OfferWorkspacePricingTemplate = {
  id: string;
  name: string;
  kind?: string;
  capacityKwh?: number | null;
  items: OfferWorkspacePricingItem[];
};

export type OfferWorkspacePricingLine = {
  templateId: string;
  templateName: string;
  itemId: string;
  position: number;
  description: string | null;
  productName: string | null;
  role: string;
  supplyMode: string;
  quantity: number | null;
  isOptional: boolean;
  requiresReview: boolean;
  includedInSale: boolean;
  resolvedCosts: ReturnType<typeof resolveTemplateItemCosts> | null;
  saleVatRate: number | null;
  calculation: CalculationResult | null;
  saleAmount: number | null;
  missingPriceReason: string | null;
  workspaceRemoved?: boolean;
  workspaceAdded?: boolean;
  workspaceChanged?: boolean;
};

export type OfferWorkspacePricingResult = {
  clientType: OfferWorkspacePricingClientType;
  saleAmountBasis: 'NET' | 'GROSS';
  lines: OfferWorkspacePricingLine[];
  totals: ConfigurationTotals | null;
  systemCostBeforeFinancing: number | null;
  missingRequiredData: string[];
  missingOptionalData: string[];
  calculationError: string | null;
};

const nonPricedSupplyModes = new Set<OfferWorkspacePricingSupplyMode>([
  'CLIENT_OWNED_USED',
  'CLIENT_SUPPLIED_NEW',
  'NOT_INCLUDED',
]);

const knownSupplyModes = new Set<OfferWorkspacePricingSupplyMode>([
  'ONREVOLT_SUPPLIED',
  'CLIENT_OWNED_USED',
  'CLIENT_SUPPLIED_NEW',
  'SERVICE_ONLY',
  'NOT_INCLUDED',
]);

function finiteNumber(value: NumericValue | null, label: string): number {
  if (value === null || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`Brak wartości: ${label}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Nieprawidłowa wartość: ${label}`);
  return parsed;
}

function saleVatRate(mode: ConfigurationVatMode, item: OfferWorkspacePricingItem): number {
  if (mode === 'REDUCED_8') return 0.08;
  if (mode === 'STANDARD_23') return 0.23;
  if (mode === 'REVIEW') throw new Error('Tryb VAT wymaga przeglądu');
  if (mode !== 'MIXED') throw new TypeError('Tryb VAT sprzedaży musi być jawny.');

  const label = item.description || item.product?.name || item.id;
  const rate = resolveTemplateItemSaleVat(item);
  if (rate !== 0.08 && rate !== 0.23) {
    throw new Error(`Stawka VAT sprzedaży musi wynosić 8% albo 23% (${label})`);
  }
  return rate;
}

function itemCalculationInput(
  item: OfferWorkspacePricingItem,
  quantity: number,
  mode: ConfigurationVatMode,
) {
  const supplyMode = item.supplyMode as OfferWorkspacePricingSupplyMode;
  if (nonPricedSupplyModes.has(supplyMode)) {
    return {
      input: {
        quantity,
        unitPurchaseNet: 0,
        purchaseVatRate: 0,
        operatingCostNet: 0,
        marginRate: 0,
        saleVatRate: 0,
        includeVatSurplus: false,
      },
      costs: null,
      saleVatRate: 0,
      includedInSale: false,
    };
  }

  const costs = resolveTemplateItemCosts({
    ...item,
    productId: item.product?.id ?? item.productId,
  });
  const resolvedSaleVatRate = saleVatRate(mode, item);
  return {
    input: { quantity, ...costs, saleVatRate: resolvedSaleVatRate },
    costs,
    saleVatRate: resolvedSaleVatRate,
    includedInSale: true,
  };
}

function itemLabel(item: OfferWorkspacePricingItem) {
  return item.description || item.product?.name || item.id || 'pozycja bez identyfikatora';
}

export function priceOfferWorkspaceConfiguration(
  templates: OfferWorkspacePricingTemplate[],
  saleVatMode: ConfigurationVatMode,
  clientType: string,
): OfferWorkspacePricingResult {
  if (clientType !== 'B2C' && clientType !== 'B2B') {
    throw new TypeError('Typ klienta musi być jawnie B2C albo B2B.');
  }
  if (!['REDUCED_8', 'STANDARD_23', 'MIXED', 'REVIEW'].includes(saleVatMode)) {
    throw new TypeError('Tryb VAT sprzedaży musi być jawny.');
  }

  const saleAmountBasis = clientType === 'B2B' ? 'NET' : 'GROSS';
  const lines: OfferWorkspacePricingLine[] = [];
  const calculationInputs: Parameters<typeof sumConfiguration>[0] = [];
  const calculationIndexByLine = new Map<string, number>();
  const missingRequiredData: string[] = [];
  const missingOptionalData: string[] = [];

  const orderedTemplates = templates
    .map((template, index) => ({ template, index }))
    .sort((left, right) => {
      const scopeOrder = (kind?: string) => kind === 'MAGAZYN' ? 0
        : kind === 'PV_DACH_PLASKI' || kind === 'PV_DACH_SKOSNY' ? 1 : 2;
      return scopeOrder(left.template.kind) - scopeOrder(right.template.kind)
        || left.template.id.localeCompare(right.template.id)
        || left.index - right.index;
    })
    .map(({ template }) => template);

  for (const template of orderedTemplates) {
    const orderedItems = template.items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => left.item.position - right.item.position || left.index - right.index);

    for (const { item } of orderedItems) {
      const label = itemLabel(item);
      if (item.workspaceRemoved) {
        lines.push({
          templateId: template.id,
          templateName: template.name,
          itemId: item.id,
          position: item.position,
          description: item.description ?? null,
          productName: item.product?.name ?? null,
          role: item.role,
          supplyMode: item.supplyMode,
          quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
          isOptional: item.isOptional,
          requiresReview: item.requiresReview,
          includedInSale: false,
          resolvedCosts: null,
          saleVatRate: null,
          calculation: null,
          saleAmount: null,
          missingPriceReason: null,
          workspaceRemoved: true,
          ...(item.workspaceAdded ? { workspaceAdded: true } : {}),
          ...(item.workspaceChanged ? { workspaceChanged: true } : {}),
        });
        continue;
      }
      let quantity: number | null = null;
      let costs: ReturnType<typeof resolveTemplateItemCosts> | null = null;
      let resolvedSaleVatRate: number | null = null;
      let includedInSale = false;
      let missingPriceReason: string | null = null;
      let lineInput: Parameters<typeof sumConfiguration>[0][number] | null = null;

      try {
        quantity = finiteNumber(item.quantity, `ilość (${label})`);
        if (!knownSupplyModes.has(item.supplyMode as OfferWorkspacePricingSupplyMode)) {
          throw new Error(`Nieznany tryb dostawy (${label})`);
        }
        const calculated = itemCalculationInput(item, quantity, saleVatMode);
        costs = calculated.costs;
        resolvedSaleVatRate = calculated.saleVatRate;
        includedInSale = calculated.includedInSale;
        lineInput = calculated.input;
        calculationIndexByLine.set(`${template.id}\u0000${item.id}`, calculationInputs.length);
        calculationInputs.push(lineInput);
      } catch (error) {
        missingPriceReason = error instanceof Error ? error.message : `Nie udało się wycenić pozycji „${label}”.`;
        (item.isOptional ? missingOptionalData : missingRequiredData).push(`${template.name} / ${label}: ${missingPriceReason}`);
      }

      lines.push({
        templateId: template.id,
        templateName: template.name,
        itemId: item.id,
        position: item.position,
        description: item.description ?? null,
        productName: item.product?.name ?? null,
        role: item.role,
        supplyMode: item.supplyMode,
        quantity,
        isOptional: item.isOptional,
        requiresReview: item.requiresReview,
        includedInSale,
        resolvedCosts: costs,
        saleVatRate: resolvedSaleVatRate,
        calculation: null,
        saleAmount: null,
        missingPriceReason,
        ...(item.workspaceRemoved ? { workspaceRemoved: true } : {}),
        ...(item.workspaceAdded ? { workspaceAdded: true } : {}),
        ...(item.workspaceChanged ? { workspaceChanged: true } : {}),
      });
    }
  }

  let totals: ConfigurationTotals | null = null;
  let calculationError: string | null = null;
  const hasMissingData = missingRequiredData.length > 0 || missingOptionalData.length > 0;
  if (!hasMissingData && calculationInputs.length > 0) {
    try {
      totals = sumConfiguration(calculationInputs);
      lines.forEach((line) => {
        const calculationIndex = calculationIndexByLine.get(`${line.templateId}\u0000${line.itemId}`);
        const calculation = calculationIndex === undefined ? null : totals?.lines[calculationIndex] ?? null;
        line.calculation = calculation;
        line.saleAmount = calculation
          ? (saleAmountBasis === 'NET' ? calculation.saleNet : calculation.saleGross)
          : null;
      });
    } catch (error) {
      calculationError = error instanceof Error ? error.message : 'Dane BOM nie pozwalają na kalkulację.';
    }
  }

  return {
    clientType,
    saleAmountBasis,
    lines,
    totals,
    systemCostBeforeFinancing: totals
      ? (saleAmountBasis === 'NET' ? totals.saleNet : totals.saleGross)
      : null,
    missingRequiredData,
    missingOptionalData,
    calculationError,
  };
}
