export type TemplateVariant = {
  id: string;
  familyKey: string;
  name: string;
  clientType: string;
  isActive?: boolean;
  version?: number;
};

export type TemplateFamily<T extends TemplateVariant = TemplateVariant> = {
  familyKey: string;
  name: string;
  variants: T[];
};

export type ConfigurationInvestmentScope = 'BATTERY' | 'PV';

export function configurationInvestmentScope(kind: string): ConfigurationInvestmentScope | null {
  if (kind === 'MAGAZYN') return 'BATTERY';
  if (kind === 'PV_DACH_PLASKI' || kind === 'PV_DACH_SKOSNY') return 'PV';
  return null;
}

export function groupTemplateVariants<T extends TemplateVariant>(templates: T[]) {
  const families = new Map<string, TemplateFamily<T>>();

  for (const template of templates) {
    const current = families.get(template.familyKey);
    if (current) {
      current.variants.push(template);
      if (template.name.localeCompare(current.name, 'pl') < 0) current.name = template.name;
      continue;
    }
    families.set(template.familyKey, {
      familyKey: template.familyKey,
      name: template.name,
      variants: [template],
    });
  }

  return Array.from(families.values())
    .map((family) => ({
      ...family,
      variants: family.variants.sort((left, right) => left.clientType.localeCompare(right.clientType, 'pl')),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'pl'));
}

export function selectTemplateVariant<T extends TemplateVariant>(family: TemplateFamily<T>, clientType: string) {
  return family.variants.find((variant) => variant.clientType === clientType && variant.isActive !== false)
    || family.variants.find((variant) => variant.clientType === 'B2C_B2B' && variant.isActive !== false);
}

type NumericValue = string | number | { toString(): string };

export type CurrentProductPrice = {
  purchaseNet: NumericValue;
  currentPurchaseNet?: NumericValue | null;
  purchaseVatRate: NumericValue;
};

export type PriceableTemplateItem = {
  description?: string | null;
  productId?: string | null;
  product?: { name?: string | null; prices?: CurrentProductPrice[] } | null;
  unitPurchaseNet?: NumericValue | null;
  purchaseVatRate?: NumericValue | null;
  operatingCostNet?: NumericValue | null;
  marginRate?: NumericValue | null;
};

function requiredNumber(value: NumericValue | null | undefined, label: string) {
  if (value === null || value === undefined || value === '') throw new Error(`Brak wartości: ${label}`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Nieprawidłowa wartość: ${label}`);
  return number;
}

export function resolveTemplateItemCosts(item: PriceableTemplateItem) {
  const label = item.description || item.product?.name || 'pozycja bez nazwy';
  const currentPrice = item.product?.prices?.[0];

  if (item.productId) {
    if (!currentPrice) throw new Error(`Brak aktualnej ceny katalogowej: ${label}`);
    return {
      unitPurchaseNet: requiredNumber(currentPrice.currentPurchaseNet ?? currentPrice.purchaseNet, `cena zakupu (${label})`),
      purchaseVatRate: requiredNumber(currentPrice.purchaseVatRate, `VAT zakupu (${label})`),
      operatingCostNet: requiredNumber(item.operatingCostNet, `koszt firmy (${label})`),
      marginRate: requiredNumber(item.marginRate, `marża (${label})`),
    };
  }

  return {
    unitPurchaseNet: requiredNumber(item.unitPurchaseNet, `cena pozycji ręcznej (${label})`),
    purchaseVatRate: requiredNumber(item.purchaseVatRate, `VAT pozycji ręcznej (${label})`),
    operatingCostNet: requiredNumber(item.operatingCostNet, `koszt firmy (${label})`),
    marginRate: requiredNumber(item.marginRate, `marża (${label})`),
  };
}
