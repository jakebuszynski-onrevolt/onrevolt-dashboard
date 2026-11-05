export type ProductPriceInput = {
  purchaseNet: number;
  purchaseVatRate: number;
  operatingCostNet: number;
  marginRate: number;
  saleVatRate: number;
  currency: string;
};

export function activeProductPriceInclude(asOf = new Date()) {
  return {
    where: { validFrom: { lte: asOf } },
    orderBy: { validFrom: 'desc' as const },
    take: 1,
  };
}

function normalizeNumber(value: unknown, key: string) {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    throw new Error(`Pole ${key} jest wymagane`);
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`Pole ${key} musi być liczbą`);
  }

  const normalized = typeof value === 'string' ? value.replace(',', '.').trim() : value;
  const number = Number(normalized);
  if (!Number.isFinite(number)) throw new Error(`Pole ${key} musi być liczbą`);
  return number;
}

export function parseProductPriceInput(value: unknown): ProductPriceInput | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Pole price musi być obiektem');
  }

  const price = value as Record<string, unknown>;
  const currency = typeof price.currency === 'string' ? price.currency.trim() : '';
  if (!/^[a-z]{3}$/i.test(currency)) {
    throw new Error('Pole price.currency musi być trzyliterowym kodem waluty');
  }

  const parsed = {
    purchaseNet: normalizeNumber(price.purchaseNet, 'price.purchaseNet'),
    purchaseVatRate: normalizeNumber(price.purchaseVatRate, 'price.purchaseVatRate'),
    operatingCostNet: normalizeNumber(price.operatingCostNet, 'price.operatingCostNet'),
    marginRate: normalizeNumber(price.marginRate, 'price.marginRate'),
    saleVatRate: normalizeNumber(price.saleVatRate, 'price.saleVatRate'),
    currency: currency.toUpperCase(),
  };

  if (parsed.purchaseNet < 0 || parsed.operatingCostNet < 0) {
    throw new Error('Cena zakupu i koszt własny realizacji nie mogą być ujemne');
  }
  if (parsed.purchaseVatRate < 0 || parsed.purchaseVatRate > 1 || parsed.saleVatRate < 0 || parsed.saleVatRate > 1) {
    throw new Error('Stawki VAT zakupu i sprzedaży muszą mieścić się w zakresie 0-100%');
  }
  if (parsed.marginRate < 0) {
    throw new Error('Narzut nie może być ujemny');
  }

  return parsed;
}

function decimalNumber(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'object' && 'toString' in value) return Number(value.toString());
  return Number(value);
}

export function productPriceChanged(current: any, next: ProductPriceInput) {
  return (
    decimalNumber(current.purchaseNet) !== next.purchaseNet ||
    decimalNumber(current.currentPurchaseNet) !== next.purchaseNet ||
    decimalNumber(current.purchaseVatRate) !== next.purchaseVatRate ||
    decimalNumber(current.operatingCostNet) !== next.operatingCostNet ||
    decimalNumber(current.marginRate) !== next.marginRate ||
    decimalNumber(current.saleVatRate) !== next.saleVatRate ||
    current.currency !== next.currency
  );
}

export function productPriceData(price: ProductPriceInput) {
  return {
    purchaseNet: price.purchaseNet,
    currentPurchaseNet: price.purchaseNet,
    purchaseVatRate: price.purchaseVatRate,
    operatingCostNet: price.operatingCostNet,
    marginRate: price.marginRate,
    saleVatRate: price.saleVatRate,
    currency: price.currency,
  };
}
