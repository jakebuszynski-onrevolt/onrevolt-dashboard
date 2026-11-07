export type TemplateItemWrite<T = Record<string, unknown>> = {
  where: { id: string };
  data: T;
};

export type TemplateItemWritePlan<T = Record<string, unknown>> = {
  update: TemplateItemWrite<T>[];
  create: T[];
  deleteMany?: { id: { in: string[] } };
};

export function buildTemplateItemWrites<TRaw extends Record<string, unknown>, TNormalized>(
  existingIds: string[],
  rawItems: TRaw[],
  normalizedItems: TNormalized[],
): TemplateItemWritePlan<TNormalized> {
  if (rawItems.length !== normalizedItems.length) {
    throw new Error('Pozycje szablonu nie mają zgodnych danych do zapisu');
  }

  const existing = new Set(existingIds);
  const seen = new Set<string>();
  const update: TemplateItemWrite<TNormalized>[] = [];
  const create: TNormalized[] = [];

  rawItems.forEach((rawItem, index) => {
    const id = rawItem.id;
    if (id === undefined || id === null || id === '') {
      create.push(normalizedItems[index]);
      return;
    }
    if (typeof id !== 'string') throw new Error('Nieprawidłowe ID pozycji szablonu');
    if (seen.has(id)) throw new Error(`Powtórzone ID pozycji szablonu: ${id}`);
    if (!existing.has(id)) throw new Error(`Pozycja szablonu nie należy do tego szablonu: ${id}`);

    seen.add(id);
    update.push({ where: { id }, data: normalizedItems[index] });
  });

  const removedIds = existingIds.filter((id) => !seen.has(id));
  return {
    update,
    create,
    ...(removedIds.length > 0 ? { deleteMany: { id: { in: removedIds } } } : {}),
  };
}

export function normalizeTemplateSourceRow(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}

export type TemplateCatalogPriceSnapshot = {
  catalogPriceId?: unknown;
  unitPurchaseNet?: unknown;
  purchaseVatRate?: unknown;
  operatingCostNet?: unknown;
  marginRate?: unknown;
  saleVatRate?: unknown;
  operatingCostBasis?: unknown;
  description?: unknown;
};

export type TemplateManagerCatalogItemSnapshot = TemplateCatalogPriceSnapshot & {
  productId?: unknown;
  pricingMode?: unknown;
  unitSaleNet?: unknown;
};

export class CatalogPriceChangedError extends Error {
  constructor(description?: unknown) {
    const label = typeof description === 'string' && description ? description : 'bez nazwy';
    super(`Cena katalogowa pozycji „${label}” zmieniła się. Odśwież podgląd przed zapisem.`);
    this.name = 'CatalogPriceChangedError';
  }
}

export class TemplateUnitSaleNetValidationError extends Error {
  constructor() {
    super('Cena sprzedaży netto musi wynosić od 0 do 9999999999.99999999 i mieć maksymalnie 8 miejsc po przecinku');
    this.name = 'TemplateUnitSaleNetValidationError';
  }
}

function expandDecimalExponent(value: string) {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) throw new TemplateUnitSaleNetValidationError();
  const [, sign, integerPart, fractionPart = '', exponentPart = '0'] = match;
  const exponent = Number(exponentPart);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) throw new TemplateUnitSaleNetValidationError();
  const digits = `${integerPart}${fractionPart}`;
  const decimalPosition = integerPart.length + exponent;
  let integer: string;
  let fraction: string;
  if (decimalPosition <= 0) {
    integer = '0';
    fraction = `${'0'.repeat(-decimalPosition)}${digits}`;
  } else if (decimalPosition >= digits.length) {
    integer = `${digits}${'0'.repeat(decimalPosition - digits.length)}`;
    fraction = '';
  } else {
    integer = digits.slice(0, decimalPosition);
    fraction = digits.slice(decimalPosition);
  }
  integer = integer.replace(/^0+(?=\d)/, '');
  if (integer.length > 10 || fraction.length > 8 || (sign === '-' && /[1-9]/.test(`${integer}${fraction}`))) {
    throw new TemplateUnitSaleNetValidationError();
  }
  return `${integer}${fraction ? `.${fraction}` : ''}`;
}

export function normalizeTemplateUnitSaleNet(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw new TemplateUnitSaleNetValidationError();
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TemplateUnitSaleNetValidationError();
  const raw = String(value).trim();
  if (!raw) throw new TemplateUnitSaleNetValidationError();
  return expandDecimalExponent(raw);
}

function strictSnapshotNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  let number: number;
  try {
    number = Number(value);
  } catch {
    return null;
  }
  return Number.isFinite(number) ? number : null;
}

const PRICE_FIELDS = [
  'unitPurchaseNet',
  'purchaseVatRate',
  'operatingCostNet',
  'marginRate',
  'saleVatRate',
] as const;

export function assertTemplateCatalogSnapshot(
  snapshot: TemplateCatalogPriceSnapshot,
  resolved: TemplateCatalogPriceSnapshot,
  options: { allowMissingMargin?: boolean } = {},
) {
  for (const field of PRICE_FIELDS) {
    const snapshotValue = strictSnapshotNumber(snapshot[field]);
    const resolvedValue = strictSnapshotNumber(resolved[field]);
    if (field === 'marginRate' && options.allowMissingMargin && (snapshotValue === null || resolvedValue === null)) continue;
    if (snapshotValue === null || resolvedValue === null || Math.abs(snapshotValue - resolvedValue) > 1e-9) {
      throw new CatalogPriceChangedError(snapshot.description);
    }
  }

  if (typeof snapshot.operatingCostBasis !== 'string'
    || snapshot.operatingCostBasis !== resolved.operatingCostBasis) {
    throw new CatalogPriceChangedError(snapshot.description);
  }

  if (snapshot.catalogPriceId !== null
    && snapshot.catalogPriceId !== undefined
    && snapshot.catalogPriceId !== ''
    && snapshot.catalogPriceId !== resolved.catalogPriceId) {
    throw new CatalogPriceChangedError(snapshot.description);
  }
}

export function matchesStoredTemplateCatalogSnapshot(
  submitted: TemplateManagerCatalogItemSnapshot,
  stored: TemplateManagerCatalogItemSnapshot,
): boolean {
  if (submitted.productId !== stored.productId
    || submitted.pricingMode !== stored.pricingMode
    || submitted.catalogPriceId !== stored.catalogPriceId
    || submitted.operatingCostBasis !== stored.operatingCostBasis) {
    return false;
  }

  const allowMissingMargin = submitted.unitSaleNet !== null && submitted.unitSaleNet !== undefined
    || stored.unitSaleNet !== null && stored.unitSaleNet !== undefined;
  for (const field of PRICE_FIELDS) {
    const submittedValue = strictSnapshotNumber(submitted[field]);
    const storedValue = strictSnapshotNumber(stored[field]);
    if (field === 'marginRate' && allowMissingMargin && (submittedValue === null || storedValue === null)) continue;
    if (submittedValue === null || storedValue === null || Math.abs(submittedValue - storedValue) > 1e-9) {
      return false;
    }
  }
  return true;
}
