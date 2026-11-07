import {
  calculateConfigurationLine,
  type CalculationResult,
} from './calculator';
import {
  resolveTemplateItemCosts,
  type PriceableTemplateItem,
} from './configuration-templates';

type NumericValue = number | string | { toString(): string };

export type TemplatePricingItem = PriceableTemplateItem & {
  quantity: NumericValue;
  supplyMode: string;
};

export type TemplatePricingCosts = {
  unitPurchaseNet: number;
  purchaseVatRate: number;
  operatingCostNet: number;
  marginRate: number;
  operatingCostBasis: 'PER_UNIT' | 'PER_LINE';
  catalogPriceId: string | null;
};

export type TemplatePricingPreview = {
  saved: CalculationResult | null;
  suggested: CalculationResult | null;
  suggestedCosts: TemplatePricingCosts | null;
  savedError: string | null;
  suggestedError: string | null;
  excluded: boolean;
  difference: number | null;
};

export type TemplatePricingSummary = {
  saleNet: number;
  saleGross8: number;
  saleGross23: number;
  vatDifference: number;
};

const SUGGESTED_MARGIN_RATE = 0.3;
const EXCLUDED_SUPPLY_MODES = new Set([
  'CLIENT_OWNED_USED',
  'CLIENT_SUPPLIED_NEW',
  'NOT_INCLUDED',
]);

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function requiredNumber(value: NumericValue | null | undefined, label: string) {
  if (value === null || value === undefined || value === '' || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`Brak wartości: ${label}`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Nieprawidłowa wartość: ${label}`);
  return number;
}

function itemLabel(item: TemplatePricingItem) {
  return item.description || item.product?.name || 'pozycja bez nazwy';
}

function zeroResult(): CalculationResult {
  return {
    purchaseNet: 0,
    purchaseVatValue: 0,
    purchaseGross: 0,
    operatingCostNet: 0,
    totalCostNet: 0,
    marginNet: 0,
    saleNet: 0,
    saleVatValue: 0,
    saleGross: 0,
    vatSurplus: 0,
    profitNet: 0,
    profitWithVatSurplus: 0,
  };
}

function calculateSavedSnapshot(item: TemplatePricingItem): CalculationResult {
  const label = itemLabel(item);
  const mode = item.pricingMode ?? 'LEGACY';
  const basis = item.operatingCostBasis ?? 'PER_LINE';

  if (!['LEGACY', 'CATALOG', 'INDIVIDUAL'].includes(mode)) {
    throw new Error(`Nieprawidłowe źródło ceny (${label})`);
  }
  if (basis !== 'PER_UNIT' && basis !== 'PER_LINE') {
    throw new Error(`Nieprawidłowy koszt realizacji (${label})`);
  }

  const unitSaleNet = item.unitSaleNet === null || item.unitSaleNet === undefined
    ? undefined
    : requiredNumber(item.unitSaleNet, `cena sprzedaży ręczna (${label})`);
  const marginMissing = item.marginRate === null || item.marginRate === undefined || item.marginRate === ''
    || (typeof item.marginRate === 'string' && item.marginRate.trim() === '');

  return calculateConfigurationLine({
    quantity: requiredNumber(item.quantity, `ilość (${label})`),
    unitPurchaseNet: requiredNumber(item.unitPurchaseNet, `cena pozycji ręcznej (${label})`),
    purchaseVatRate: requiredNumber(item.purchaseVatRate, `VAT pozycji ręcznej (${label})`),
    operatingCostNet: requiredNumber(item.operatingCostNet, `koszt firmy (${label})`),
    operatingCostBasis: basis,
    marginRate: unitSaleNet !== undefined && marginMissing ? 0 : requiredNumber(item.marginRate, `narzut (${label})`),
    saleVatRate: 0,
    ...(unitSaleNet === undefined ? {} : { unitSaleNet }),
  });
}

function resolveSuggestedCosts(item: TemplatePricingItem): TemplatePricingCosts {
  const mode = item.pricingMode ?? 'LEGACY';
  if (!['LEGACY', 'CATALOG', 'INDIVIDUAL'].includes(mode)) {
    throw new Error(`Nieprawidłowe źródło ceny (${itemLabel(item)})`);
  }

  // The template's suggested markup is an explicit 30%; supplying it to the
  // resolver keeps a missing catalog or snapshot markup from blocking costs.
  const suggestedItem: TemplatePricingItem = {
    ...item,
    unitSaleNet: null,
    marginRate: SUGGESTED_MARGIN_RATE,
  };

  const label = itemLabel(item);
  const currentPrice = item.product?.prices?.[0];
  if (item.productId && currentPrice) {
    requiredNumber(currentPrice.purchaseNet, `cena zakupu katalogowa (${label})`);
    if (currentPrice.currentPurchaseNet !== null && currentPrice.currentPurchaseNet !== undefined) {
      requiredNumber(currentPrice.currentPurchaseNet, `aktualna cena zakupu (${label})`);
    }
    requiredNumber(currentPrice.purchaseVatRate, `VAT zakupu (${label})`);
  }

  if (mode === 'CATALOG') {
    if (currentPrice) requiredNumber(currentPrice.operatingCostNet, `koszt realizacji (${label})`);
  } else {
    requiredNumber(item.operatingCostNet, `koszt firmy (${label})`);
    if (!item.productId) {
      requiredNumber(item.unitPurchaseNet, `cena pozycji ręcznej (${label})`);
      requiredNumber(item.purchaseVatRate, `VAT pozycji ręcznej (${label})`);
    }
  }

  if (mode === 'CATALOG') {
    const prices = item.product?.prices;
    const product = item.product && prices
      ? {
        ...item.product,
        prices: prices.map((price, index) => index === 0
          ? { ...price, marginRate: SUGGESTED_MARGIN_RATE }
          : price),
      }
      : item.product;

    return resolveTemplateItemCosts({
      ...suggestedItem,
      pricingMode: 'CATALOG',
      product,
    });
  }

  // Linked individual items still take the current product purchase price and
  // purchase VAT, while keeping their saved operating cost and basis.
  return resolveTemplateItemCosts({
    ...suggestedItem,
    pricingMode: 'LEGACY',
  });
}

export function previewTemplateItem(item: TemplatePricingItem): TemplatePricingPreview {
  if (EXCLUDED_SUPPLY_MODES.has(item.supplyMode)) {
    return {
      saved: zeroResult(),
      suggested: zeroResult(),
      suggestedCosts: null,
      savedError: null,
      suggestedError: null,
      excluded: true,
      difference: 0,
    };
  }

  let saved: CalculationResult | null = null;
  let savedError: string | null = null;
  try {
    saved = calculateSavedSnapshot(item);
  } catch (error) {
    savedError = error instanceof Error ? error.message : String(error);
  }

  let suggested: CalculationResult | null = null;
  let suggestedCosts: TemplatePricingCosts | null = null;
  let suggestedError: string | null = null;
  try {
    suggestedCosts = resolveSuggestedCosts(item);
    suggested = calculateConfigurationLine({
      quantity: requiredNumber(item.quantity, `ilość (${itemLabel(item)})`),
      ...suggestedCosts,
      saleVatRate: 0,
    });
  } catch (error) {
    suggestedCosts = null;
    suggestedError = error instanceof Error ? error.message : String(error);
  }

  return {
    saved,
    suggested,
    suggestedCosts,
    savedError,
    suggestedError,
    excluded: false,
    difference: saved && suggested ? roundMoney(suggested.saleNet - saved.saleNet) : null,
  };
}

export function summarizeTemplatePricing(
  previews: TemplatePricingPreview[],
  kind: 'saved' | 'suggested',
): TemplatePricingSummary | null {
  if (previews.some((preview) => preview[kind] === null)) return null;

  let saleNet = 0;
  let vat8 = 0;
  let vat23 = 0;

  for (const preview of previews) {
    const line = preview[kind];
    if (!line) return null;
    saleNet = roundMoney(saleNet + line.saleNet);
    const saleGross8 = line.rawSaleNet === undefined
      ? roundMoney(line.saleNet + roundMoney(line.saleNet * 0.08))
      : roundMoney(line.rawSaleNet * 1.08);
    const saleGross23 = line.rawSaleNet === undefined
      ? roundMoney(line.saleNet + roundMoney(line.saleNet * 0.23))
      : roundMoney(line.rawSaleNet * 1.23);
    vat8 = roundMoney(vat8 + saleGross8 - line.saleNet);
    vat23 = roundMoney(vat23 + saleGross23 - line.saleNet);
  }

  return {
    saleNet,
    saleGross8: roundMoney(saleNet + vat8),
    saleGross23: roundMoney(saleNet + vat23),
    vatDifference: roundMoney(vat23 - vat8),
  };
}

export function priceDifferenceColor(saved: number | null, suggested: number | null) {
  if (saved === null || suggested === null || !Number.isFinite(saved) || !Number.isFinite(suggested)) {
    return undefined;
  }

  const differenceInCents = Math.round((suggested + Number.EPSILON) * 100)
    - Math.round((saved + Number.EPSILON) * 100);
  if (differenceInCents > 0) return 'red.600';
  if (differenceInCents < 0) return 'green.600';
  return undefined;
}
