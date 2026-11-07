import { configurationInvestmentScope } from './configuration-templates';
import { resolveProductPurchaseNet } from './product-pricing';
import type { OfferWorkspaceDraft } from './offer-workspace';

export type OfferWorkspaceConfigurationPricingEdit = {
  unitSaleNet?: number | null;
  unitPurchaseNet?: number | null;
  purchaseVatRate?: number | null;
  operatingCostNet?: number | null;
  operatingCostBasis?: 'PER_UNIT' | 'PER_LINE';
  marginRate?: number | null;
  saleVatRate?: number | null;
};

export type OfferWorkspaceConfigurationItemEdit = {
  itemId: string;
  description?: string | null;
  quantity?: number;
  pricing?: OfferWorkspaceConfigurationPricingEdit;
  removed?: boolean;
};

export type OfferWorkspaceAddedItemPricing = {
  unitSaleNet?: number;
  unitPurchaseNet: number;
  purchaseVatRate: number;
  operatingCostNet: number;
  operatingCostBasis: 'PER_UNIT' | 'PER_LINE';
  marginRate?: number | null;
  saleVatRate?: number | null;
};

export type OfferWorkspaceAddedItem = {
  id: string;
  description: string;
  quantity: number;
  role: 'ACCESSORY' | 'MOUNTING' | 'CABLING' | 'PROTECTION' | 'MONITORING' | 'FORMALITIES' | 'LOGISTICS' | 'LABOR' | 'DESIGN' | 'OTHER';
  supplyMode: 'ONREVOLT_SUPPLIED' | 'SERVICE_ONLY';
  pricing: OfferWorkspaceAddedItemPricing;
};

export type OfferWorkspaceConfigurationTechnical = {
  powerKw: number;
  capacityKwh: number | null;
  quantityFingerprint: string;
};

export type OfferWorkspaceConfigurationEdit = {
  templateId: string;
  items?: OfferWorkspaceConfigurationItemEdit[];
  addedItems?: OfferWorkspaceAddedItem[];
  technical?: OfferWorkspaceConfigurationTechnical;
};

type EnergyQuantityItem = {
  id: string;
  quantity: number | string;
  role?: string | null;
  description?: string | null;
  product?: { category?: string | null } | null;
};

type EditableTemplate = {
  id: string;
  kind?: string;
  powerKw?: number | null;
  capacityKwh?: number | null;
  items: Array<EnergyQuantityItem & Record<string, unknown>>;
};

const addedItemRoles = ['ACCESSORY', 'MOUNTING', 'CABLING', 'PROTECTION', 'MONITORING', 'FORMALITIES', 'LOGISTICS', 'LABOR', 'DESIGN', 'OTHER'] as const;
const addedSupplyModes = ['ONREVOLT_SUPPLIED', 'SERVICE_ONLY'] as const;
const energyTerms = /(?:PV|FOTOWOLTA|FOTOWOLTAIK|MAGAZYN|BATTER|INVERTER|INWERTER|FALOWNIK|MODULE|PANEL|MODUŁ|MODUL)/i;
const coreProductCategories = new Set(['MAGAZYN_ENERGII', 'BATTERY', 'FALOWNIK', 'INWERTER', 'INVERTER', 'FOTOWOLTAIKA', 'PV']);
const criticalRoles = new Set(['MAIN_EQUIPMENT']);
const maxDescriptionLength = 10000;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Nieprawidłowe pole konfiguracji: ${label}`);
  return value as Record<string, unknown>;
}

function allowKeys(input: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`Niedozwolone pole ${label}.${unknown}. Zmiana tożsamości produktu nie jest dozwolona.`);
}

function finite(value: unknown, min: number, max: number, label: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label}: wymagana liczba od ${min} do ${max}`);
  }
  return value;
}

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error(`Nieprawidłowy identyfikator: ${label}`);
  return value;
}

function description(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length > maxDescriptionLength) throw new Error(`${label}: maksymalnie ${maxDescriptionLength} znaków`);
  return value;
}

function parsePricingEdit(value: unknown, label: string): OfferWorkspaceConfigurationPricingEdit {
  const input = record(value, label);
  allowKeys(input, ['unitSaleNet', 'unitPurchaseNet', 'purchaseVatRate', 'operatingCostNet', 'operatingCostBasis', 'marginRate', 'saleVatRate'], label);
  const result: OfferWorkspaceConfigurationPricingEdit = {};
  if ('unitSaleNet' in input) result.unitSaleNet = finite(input.unitSaleNet, 0, 100000000, `${label}.unitSaleNet`, true);
  if ('unitPurchaseNet' in input) result.unitPurchaseNet = finite(input.unitPurchaseNet, 0, 100000000, `${label}.unitPurchaseNet`, true);
  if ('purchaseVatRate' in input) result.purchaseVatRate = finite(input.purchaseVatRate, 0, 1, `${label}.purchaseVatRate`, true);
  if ('operatingCostNet' in input) result.operatingCostNet = finite(input.operatingCostNet, 0, 100000000, `${label}.operatingCostNet`, true);
  if ('operatingCostBasis' in input) {
    if (input.operatingCostBasis !== 'PER_UNIT' && input.operatingCostBasis !== 'PER_LINE') throw new Error(`${label}.operatingCostBasis: nieprawidłowa podstawa kosztu`);
    result.operatingCostBasis = input.operatingCostBasis;
  }
  if ('marginRate' in input) result.marginRate = finite(input.marginRate, 0, 100, `${label}.marginRate`, true);
  if ('saleVatRate' in input) result.saleVatRate = finite(input.saleVatRate, 0, 1, `${label}.saleVatRate`, true);
  return result;
}

function parseAddedPricing(value: unknown, label: string): OfferWorkspaceAddedItemPricing {
  const input = record(value, label);
  allowKeys(input, ['unitSaleNet', 'unitPurchaseNet', 'purchaseVatRate', 'operatingCostNet', 'operatingCostBasis', 'marginRate', 'saleVatRate'], label);
  if (input.operatingCostBasis !== 'PER_UNIT' && input.operatingCostBasis !== 'PER_LINE') {
    throw new Error(`${label}.operatingCostBasis: nieprawidłowa podstawa kosztu`);
  }
  const number = (key: string, min: number, max: number) => {
    const parsed = finite(input[key], min, max, `${label}.${key}`);
    return parsed as number;
  };
  const unitSaleNet = input.unitSaleNet === undefined ? undefined
    : finite(input.unitSaleNet, 0, 100000000, `${label}.unitSaleNet`) as number;
  const marginRate = input.marginRate === undefined ? undefined
    : finite(input.marginRate, 0, 100, `${label}.marginRate`, true);
  if (unitSaleNet === undefined && marginRate == null) {
    throw new Error(`${label}: wymagana cena sprzedaży jednostkowa albo starszy narzut.`);
  }
  return {
    ...(unitSaleNet === undefined ? {} : { unitSaleNet }),
    unitPurchaseNet: number('unitPurchaseNet', 0, 100000000),
    purchaseVatRate: number('purchaseVatRate', 0, 1),
    operatingCostNet: number('operatingCostNet', 0, 100000000),
    operatingCostBasis: input.operatingCostBasis,
    ...(marginRate === undefined ? {} : { marginRate }),
    saleVatRate: input.saleVatRate === undefined ? null
      : finite(input.saleVatRate, 0, 1, `${label}.saleVatRate`, true),
  };
}

function parseAddedItem(value: unknown, label: string): OfferWorkspaceAddedItem {
  const input = record(value, label);
  allowKeys(input, ['id', 'description', 'quantity', 'role', 'supplyMode', 'pricing'], label);
  if (typeof input.role !== 'string' || !addedItemRoles.includes(input.role as typeof addedItemRoles[number])) {
    throw new Error(`${label}.role: nie można dodać głównego urządzenia`);
  }
  if (typeof input.supplyMode !== 'string' || !addedSupplyModes.includes(input.supplyMode as typeof addedSupplyModes[number])) {
    throw new Error(`${label}.supplyMode: dozwolone są tylko dostawa OnRevolt lub usługa`);
  }
  return {
    id: id(input.id, `${label}.id`),
    description: description(input.description, `${label}.description`) as string,
    quantity: finite(input.quantity, 0.000001, 1000000, `${label}.quantity`) as number,
    role: input.role as OfferWorkspaceAddedItem['role'],
    supplyMode: input.supplyMode as OfferWorkspaceAddedItem['supplyMode'],
    pricing: parseAddedPricing(input.pricing, `${label}.pricing`),
  };
}

function parseTechnical(value: unknown, label: string): OfferWorkspaceConfigurationTechnical {
  const input = record(value, label);
  allowKeys(input, ['powerKw', 'capacityKwh', 'quantityFingerprint'], label);
  const capacityKwh = finite(input.capacityKwh, 0.000001, 1000000, `${label}.capacityKwh`, true);
  if (typeof input.quantityFingerprint !== 'string' || !/^energy-quantity-v1-[a-f0-9]{16}$/.test(input.quantityFingerprint)) {
    throw new Error(`${label}.quantityFingerprint: nieprawidłowe potwierdzenie ilości urządzeń`);
  }
  return {
    powerKw: finite(input.powerKw, 0.000001, 10000, `${label}.powerKw`) as number,
    capacityKwh,
    quantityFingerprint: input.quantityFingerprint,
  };
}

/** Whitelist parser for per-offer row edits. It never accepts product identity or supply changes. */
export function parseOfferWorkspaceConfigurationEdits(value: unknown): OfferWorkspaceConfigurationEdit[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 2) throw new Error('Edytować można maksymalnie dwa wybrane zestawy.');
  const templateIds = new Set<string>();
  let totalRows = 0;
  const parsed = value.map((entry, index) => {
    const input = record(entry, `configurationEdits[${index}]`);
    allowKeys(input, ['templateId', 'items', 'addedItems', 'technical'], `configurationEdits[${index}]`);
    const templateId = id(input.templateId, `configurationEdits[${index}].templateId`);
    if (templateIds.has(templateId)) throw new Error('Zestaw konfiguracji może wystąpić tylko raz w zmianach.');
    templateIds.add(templateId);
    if (input.items !== undefined && !Array.isArray(input.items)) throw new Error(`configurationEdits[${index}].items: wymagana lista pozycji.`);
    if (input.addedItems !== undefined && !Array.isArray(input.addedItems)) throw new Error(`configurationEdits[${index}].addedItems: wymagana lista pozycji.`);
    const rawItems = input.items === undefined ? [] : input.items as unknown[];
    const rawAddedItems = input.addedItems === undefined ? [] : input.addedItems as unknown[];
    const itemIds = new Set<string>();
    const items = rawItems.map((entryItem: unknown, itemIndex: number) => {
      const item = record(entryItem, `configurationEdits[${index}].items[${itemIndex}]`);
      allowKeys(item, ['itemId', 'description', 'quantity', 'pricing', 'removed'], `configurationEdits[${index}].items[${itemIndex}]`);
      const itemId = id(item.itemId, `configurationEdits[${index}].items[${itemIndex}].itemId`);
      if (itemIds.has(itemId)) throw new Error('Pozycja konfiguracji może wystąpić tylko raz w zmianach.');
      itemIds.add(itemId);
      if (item.removed !== undefined && typeof item.removed !== 'boolean') throw new Error('removed musi być wartością logiczną.');
      const result: OfferWorkspaceConfigurationItemEdit = { itemId };
      if ('description' in item) result.description = description(item.description, `configurationEdits[${index}].items[${itemIndex}].description`, true);
      if ('quantity' in item) result.quantity = finite(item.quantity, 0.000001, 1000000, `configurationEdits[${index}].items[${itemIndex}].quantity`) as number;
      if ('pricing' in item) result.pricing = parsePricingEdit(item.pricing, `configurationEdits[${index}].items[${itemIndex}].pricing`);
      if ('removed' in item) result.removed = item.removed as boolean;
      return result;
    });
    const addedItems = rawAddedItems.map((item: unknown, itemIndex: number) => parseAddedItem(item, `configurationEdits[${index}].addedItems[${itemIndex}]`));
    const addedIds = new Set<string>();
    for (const added of addedItems) {
      if (addedIds.has(added.id)) throw new Error('Dodawana pozycja może wystąpić tylko raz.');
      addedIds.add(added.id);
    }
    totalRows += items.length + addedItems.length;
    if (totalRows > 200) throw new Error('Jedna oferta może zawierać maksymalnie 200 zmienionych pozycji.');
    const result: OfferWorkspaceConfigurationEdit = { templateId };
    if (items.length) result.items = items;
    if (addedItems.length) result.addedItems = addedItems;
    if ('technical' in input) result.technical = parseTechnical(input.technical, `configurationEdits[${index}].technical`);
    return result;
  });
  return parsed;
}

/** True for quantities that can change the physical energy model. */
export function configurationQuantityAffectsEnergy(item: EnergyQuantityItem): boolean {
  const category = item.product?.category?.toUpperCase() || '';
  const role = item.role?.toUpperCase() || '';
  return criticalRoles.has(role)
    || coreProductCategories.has(category)
    || energyTerms.test(category)
    || energyTerms.test(role);
}

function numericQuantity(value: number | string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableHash(serialized: string) {
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
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

export function configurationEnergyQuantityFingerprint(template: Pick<EditableTemplate, 'id' | 'items'>): string {
  const values = template.items.filter((item) => !item.workspaceRemoved && configurationQuantityAffectsEnergy(item))
    .map((item) => ({ id: item.id, quantity: numericQuantity(item.quantity) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return `energy-quantity-v1-${stableHash(JSON.stringify({ templateId: template.id, values }))}`;
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Converts an entered per-unit sale amount to the calculator's unrounded net unit price. */
export function offerWorkspaceSaleAmountToNet(amount: number, basis: 'NET' | 'GROSS', vatRate: number | null): number {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Cena jednostkowa musi być nieujemną liczbą.');
  if (basis === 'NET') return amount;
  if (vatRate === null || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1) {
    throw new Error('Do przeliczenia ceny brutto potrzebna jest jawna stawka VAT sprzedaży.');
  }
  return amount / (1 + vatRate);
}

/** Converts a stored net unit price to the displayed per-unit sale amount without rounding. */
export function offerWorkspaceSaleNetToAmount(unitSaleNet: number, basis: 'NET' | 'GROSS', vatRate: number | null): number {
  if (!Number.isFinite(unitSaleNet) || unitSaleNet < 0) throw new Error('Cena jednostkowa netto musi być nieujemną liczbą.');
  if (basis === 'NET') return unitSaleNet;
  if (vatRate === null || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1) {
    throw new Error('Do wyświetlenia ceny brutto potrzebna jest jawna stawka VAT sprzedaży.');
  }
  return unitSaleNet * (1 + vatRate);
}

/** Reads each currently effective price component independently for editor initialization. */
export function configurationItemEditablePricing(item: {
  pricingMode?: string | null;
  operatingCostBasis?: string | null;
  productId?: string | null;
  unitPurchaseNet?: unknown;
  purchaseVatRate?: unknown;
  operatingCostNet?: unknown;
  marginRate?: unknown;
  saleVatRate?: unknown;
  product?: { id?: string | null; prices?: Array<{
    purchaseNet?: unknown;
    currentPurchaseNet?: unknown;
    purchaseVatRate?: unknown;
    operatingCostNet?: unknown;
    marginRate?: unknown;
    saleVatRate?: unknown;
  }> } | null;
}): Required<OfferWorkspaceConfigurationPricingEdit> {
  const mode = item.pricingMode ?? 'LEGACY';
  const price = item.product?.prices?.[0];
  const catalogMode = mode === 'CATALOG';
  const legacyProductMode = mode === 'LEGACY' && Boolean(item.product?.id ?? item.productId);
  const catalogPurchase = price ? finiteOrNull(price.currentPurchaseNet ?? price.purchaseNet) : null;
  const unitPurchaseNet = catalogMode || legacyProductMode
    ? catalogPurchase
    : finiteOrNull(item.unitPurchaseNet);
  // Surface an invalid catalog transition as missing rather than silently treating 0 as an approved cost.
  let resolvedCatalogPurchase = catalogPurchase;
  if (price) {
    try {
      resolvedCatalogPurchase = resolveProductPurchaseNet({
        purchaseNet: price.purchaseNet as number | string,
        currentPurchaseNet: price.currentPurchaseNet as number | string | null | undefined,
      });
    } catch {
      resolvedCatalogPurchase = null;
    }
  }
  return {
    unitPurchaseNet: catalogMode || legacyProductMode ? resolvedCatalogPurchase : unitPurchaseNet,
    purchaseVatRate: catalogMode || legacyProductMode ? finiteOrNull(price?.purchaseVatRate) : finiteOrNull(item.purchaseVatRate),
    operatingCostNet: catalogMode ? finiteOrNull(price?.operatingCostNet) : finiteOrNull(item.operatingCostNet),
    operatingCostBasis: catalogMode ? 'PER_UNIT' : item.operatingCostBasis === 'PER_UNIT' ? 'PER_UNIT' : 'PER_LINE',
    marginRate: catalogMode ? finiteOrNull(price?.marginRate) : finiteOrNull(item.marginRate),
    saleVatRate: catalogMode ? finiteOrNull(price?.saleVatRate) : finiteOrNull(item.saleVatRate),
    unitSaleNet: finiteOrNull((item as { unitSaleNet?: unknown }).unitSaleNet),
  };
}

function applyPricingEdit<T extends Record<string, any>>(item: T, pricing: OfferWorkspaceConfigurationPricingEdit): T {
  const effective = configurationItemEditablePricing(item);
  return {
    ...item,
    ...effective,
    ...pricing,
    ...(Object.prototype.hasOwnProperty.call(pricing, 'marginRate') && !Object.prototype.hasOwnProperty.call(pricing, 'unitSaleNet')
      ? { unitSaleNet: null } : {}),
    pricingMode: 'INDIVIDUAL',
    catalogPriceId: null,
    workspaceChanged: true,
  };
}

function rowsForTemplate(template: EditableTemplate, edit: OfferWorkspaceConfigurationEdit): EditableTemplate['items'] {
  const edits = new Map((edit.items || []).map((item) => [item.itemId, item]));
  const existingIds = new Set(template.items.map((item) => item.id));
  if (existingIds.size !== template.items.length) throw new Error(`Zestaw ${template.id} zawiera powielone identyfikatory pozycji.`);
  for (const itemId of edits.keys()) if (!existingIds.has(itemId)) throw new Error(`Nieznana pozycja zestawu ${template.id}: ${itemId}.`);
  const updated = template.items.map((item) => {
    const itemEdit = edits.get(item.id);
    if (!itemEdit) return item;
    const changed = itemEdit.description !== undefined && itemEdit.description !== item.description
      || itemEdit.quantity !== undefined && itemEdit.quantity !== item.quantity
      || itemEdit.pricing !== undefined
      || itemEdit.removed === true;
    const priced = itemEdit.pricing ? applyPricingEdit(item as Record<string, any>, itemEdit.pricing) : item;
    return {
      ...priced,
      ...(itemEdit.description === undefined ? {} : { description: itemEdit.description }),
      ...(itemEdit.quantity === undefined ? {} : { quantity: itemEdit.quantity }),
      ...(itemEdit.removed ? { workspaceRemoved: true } : { workspaceRemoved: false }),
      ...(changed ? { workspaceChanged: true } : {}),
    };
  });
  const addedIdSet = new Set<string>();
  const added = (edit.addedItems || []).map((item) => {
    const rowId = `workspace-add-${item.id}`;
    if (existingIds.has(rowId) || addedIdSet.has(rowId)) throw new Error(`Identyfikator dodanej pozycji jest już używany: ${item.id}.`);
    addedIdSet.add(rowId);
    return {
      id: rowId,
      position: template.items.reduce((max, row) => Math.max(max, Number(row.position) || 0), 0) + addedIdSet.size,
      description: item.description,
      quantity: item.quantity,
      role: item.role,
      supplyMode: item.supplyMode,
      pricingMode: 'INDIVIDUAL',
      operatingCostBasis: item.pricing.operatingCostBasis,
      catalogPriceId: null,
      productId: null,
      unitSaleNet: item.pricing.unitSaleNet ?? null,
      unitPurchaseNet: item.pricing.unitPurchaseNet,
      purchaseVatRate: item.pricing.purchaseVatRate,
      operatingCostNet: item.pricing.operatingCostNet,
      marginRate: item.pricing.marginRate ?? null,
      saleVatRate: item.pricing.saleVatRate ?? null,
      isOptional: false,
      requiresReview: false,
      product: null,
      workspaceAdded: true,
      workspaceChanged: true,
      workspaceAddedId: item.id,
    };
  });
  return [...updated, ...added] as EditableTemplate['items'];
}

function energyQuantityChanged(template: EditableTemplate, edit: OfferWorkspaceConfigurationEdit) {
  const edits = new Map((edit.items || []).map((item) => [item.itemId, item]));
  return template.items.some((item) => {
    const itemEdit = edits.get(item.id);
    return Boolean(itemEdit && !itemEdit.removed && itemEdit.quantity !== undefined
      && itemEdit.quantity !== numericQuantity(item.quantity)
      && configurationQuantityAffectsEnergy(item));
  });
}

function validateEditAgainstTemplate(template: EditableTemplate, edit: OfferWorkspaceConfigurationEdit) {
  // Validate row IDs and added-row collisions even when no technical confirmation is needed.
  const appliedItems = rowsForTemplate(template, edit);
  const changedEnergyQuantity = energyQuantityChanged(template, edit);
  if (changedEnergyQuantity && !edit.technical) {
    throw new Error(`Zmiana ilości urządzeń w zestawie „${template.id}” wymaga ponownego potwierdzenia mocy i pojemności.`);
  }
  if (edit.technical) {
    const applied = { ...template, items: appliedItems };
    if (edit.technical.quantityFingerprint !== configurationEnergyQuantityFingerprint(applied)) {
      throw new Error(`Zmieniła się liczba urządzeń w zestawie „${template.id}”. Potwierdź ponownie parametry techniczne.`);
    }
    const scope = configurationInvestmentScope(template.kind || '');
    if (scope === 'BATTERY' && !(edit.technical.capacityKwh! > 0)) {
      throw new Error(`Zestaw magazynu „${template.id}” wymaga jawnej pojemności w kWh.`);
    }
    if (scope === 'PV' && edit.technical.capacityKwh !== null) {
      throw new Error(`Dla zestawu PV „${template.id}” pojemności magazynu nie wolno podawać.`);
    }
  }
}

/** Validates that edits refer only to selected existing templates and rows, and that energy confirmations are current. */
export function validateOfferWorkspaceConfigurationEdits(
  templates: Array<EditableTemplate>,
  draft: Pick<OfferWorkspaceDraft, 'selectedTemplateIds' | 'configurationEdits'>,
): void {
  const selected = new Set(draft.selectedTemplateIds);
  const edits = parseOfferWorkspaceConfigurationEdits(draft.configurationEdits);
  const templateById = new Map(templates.map((template) => [template.id, template]));
  for (const edit of edits) {
    if (!selected.has(edit.templateId)) throw new Error(`Zmiany dotyczą niewybranego zestawu „${edit.templateId}”.`);
    const template = templateById.get(edit.templateId);
    if (!template) throw new Error(`Nieznany wybrany zestaw „${edit.templateId}”.`);
    validateEditAgainstTemplate(template, edit);
  }
}

/** Returns immutable selected-template clones with only per-offer edits applied. */
export function applyOfferWorkspaceConfigurationEdits<T extends EditableTemplate>(
  templates: T[],
  draft: Pick<OfferWorkspaceDraft, 'selectedTemplateIds' | 'configurationEdits'>,
): T[] {
  const selected = new Set(draft.selectedTemplateIds);
  const parsedEdits = parseOfferWorkspaceConfigurationEdits(draft.configurationEdits);
  const editsById = new Map(parsedEdits.map((edit) => [edit.templateId, edit]));
  const available = new Map(templates.map((template) => [template.id, template]));
  for (const edit of editsById.values()) {
    if (!selected.has(edit.templateId)) throw new Error(`Zmiany dotyczą niewybranego zestawu „${edit.templateId}”.`);
    if (!available.has(edit.templateId)) throw new Error(`Nieznany wybrany zestaw „${edit.templateId}”.`);
  }
  return templates.map((template) => {
    if (!selected.has(template.id)) return template;
    const edit = editsById.get(template.id);
    if (!edit) return template;
    const changedItems = rowsForTemplate(template, edit);
    return {
      ...template,
      items: changedItems,
      ...(edit.technical ? { powerKw: edit.technical.powerKw, capacityKwh: edit.technical.capacityKwh } : {}),
    };
  });
}

export function hasRemovedCriticalConfigurationItem(
  templates: Array<EditableTemplate>,
  draft: Pick<OfferWorkspaceDraft, 'selectedTemplateIds' | 'configurationEdits'>,
  scope?: 'PV' | 'BATTERY',
): boolean {
  const selected = new Set(draft.selectedTemplateIds);
  const templateById = new Map(templates.map((template) => [template.id, template]));
  return (draft.configurationEdits || []).some((edit) => {
    if (!selected.has(edit.templateId)) return false;
    const template = templateById.get(edit.templateId);
    if (!template) return false;
    if (scope && configurationInvestmentScope(template.kind || '') !== scope) return false;
    const removed = new Set((edit.items || []).filter((item) => item.removed).map((item) => item.itemId));
    return template.items.some((item) => removed.has(item.id)
      && (criticalRoles.has(item.role?.toUpperCase() || '')
        || energyTerms.test(item.role?.toUpperCase() || '')
        || coreProductCategories.has(item.product?.category?.toUpperCase() || '')
        || energyTerms.test(item.product?.category?.toUpperCase() || '')));
  });
}

export function configurationEditsContainPricing(edits: OfferWorkspaceConfigurationEdit[] | undefined): boolean {
  return Boolean(edits?.some((edit) => edit.items?.some((item) => item.pricing !== undefined)
    || edit.addedItems?.length));
}
