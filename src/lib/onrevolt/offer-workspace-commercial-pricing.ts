import type {
  OfferWorkspacePricingLine,
  OfferWorkspacePricingResult,
  OfferWorkspacePricingTemplate,
} from './offer-workspace-pricing';

export const OFFER_WORKSPACE_COMMERCIAL_GROUPS = [
  'STORAGE_INSTALLATION',
  'INVERTER',
  'EMS',
  'TRANSPORT',
] as const;

export type OfferWorkspaceCommercialGroup = typeof OFFER_WORKSPACE_COMMERCIAL_GROUPS[number];

export type OfferWorkspaceCommercialBreakdownAllocation = {
  templateId: string;
  itemId: string;
  group: OfferWorkspaceCommercialGroup;
};

export type OfferWorkspaceCommercialBreakdown = {
  schemaVersion: 1;
  allocations: OfferWorkspaceCommercialBreakdownAllocation[];
  batteryInstallationScopeConfirmed: true;
};

export type OfferWorkspaceCommercialPricingSourceReference = {
  templateId: string;
  templateName: string;
  itemId: string;
  description: string | null;
};

export type OfferWorkspaceCommercialPricingRow = {
  group: OfferWorkspaceCommercialGroup;
  label: string;
  amountGross: number;
  amountNet: number;
  sourceReferences: OfferWorkspaceCommercialPricingSourceReference[];
};

export type OfferWorkspaceCommercialPricingResult = {
  clientType: 'B2C';
  saleVatRate: 0.08;
  rows: OfferWorkspaceCommercialPricingRow[];
  totalGross: number;
  totalNet: number;
  batteryEligibleGross: number;
  transferredInverterSaleGross: number;
};

const groupLabels: Record<OfferWorkspaceCommercialGroup, string> = {
  STORAGE_INSTALLATION: 'Magazyn energii wraz z montażem',
  INVERTER: 'Falownik',
  EMS: 'EMS',
  TRANSPORT: 'Transport',
};

const inverterCategories = new Set(['FALOWNIK', 'INWERTER', 'INVERTER']);
const emsCategories = new Set(['SYSTEM_MONITORUJACY', 'EMS']);
const batteryCategories = new Set(['MAGAZYN_ENERGII', 'BATTERY']);
const inverterRoles = new Set(['FALOWNIK', 'INWERTER', 'INVERTER', 'EMS_INVERTER']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (unknown.length > 0 || missing.length > 0) {
    throw new TypeError(`${label}: nieznane pola [${unknown.join(', ')}], brakujące pola [${missing.join(', ')}].`);
  }
}

function referenceKey(templateId: string, itemId: string): string {
  return `${templateId}\u0000${itemId}`;
}

export function parseOfferWorkspaceCommercialBreakdown(
  value: unknown,
): OfferWorkspaceCommercialBreakdown | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new TypeError('Podział ceny komercyjnej musi być obiektem.');
  assertExactKeys(value, ['schemaVersion', 'allocations', 'batteryInstallationScopeConfirmed'], 'Podział ceny komercyjnej');
  if (value.schemaVersion !== 1) throw new TypeError('Nieobsługiwana wersja podziału ceny komercyjnej.');
  if (value.batteryInstallationScopeConfirmed !== true) {
    throw new TypeError('Zakres montażu magazynu musi być jawnie potwierdzony.');
  }
  if (!Array.isArray(value.allocations)) throw new TypeError('Przypisania podziału ceny muszą być tablicą.');

  const seen = new Set<string>();
  const allocations = value.allocations.map((entry, index): OfferWorkspaceCommercialBreakdownAllocation => {
    if (!isRecord(entry)) throw new TypeError(`Przypisanie ${index + 1} musi być obiektem.`);
    assertExactKeys(entry, ['templateId', 'itemId', 'group'], `Przypisanie ${index + 1}`);
    if (typeof entry.templateId !== 'string' || !entry.templateId.trim()) {
      throw new TypeError(`Przypisanie ${index + 1} nie ma prawidłowego identyfikatora szablonu.`);
    }
    if (typeof entry.itemId !== 'string' || !entry.itemId.trim()) {
      throw new TypeError(`Przypisanie ${index + 1} nie ma prawidłowego identyfikatora pozycji.`);
    }
    if (typeof entry.group !== 'string'
      || !OFFER_WORKSPACE_COMMERCIAL_GROUPS.includes(entry.group as OfferWorkspaceCommercialGroup)) {
      throw new TypeError(`Przypisanie ${index + 1} ma nieprawidłową grupę komercyjną.`);
    }
    const key = referenceKey(entry.templateId, entry.itemId);
    if (seen.has(key)) throw new TypeError(`Powtórzone przypisanie pozycji ${entry.templateId}/${entry.itemId}.`);
    seen.add(key);
    return {
      templateId: entry.templateId,
      itemId: entry.itemId,
      group: entry.group as OfferWorkspaceCommercialGroup,
    };
  });

  return {
    schemaVersion: 1,
    allocations,
    batteryInstallationScopeConfirmed: true,
  };
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? '';
}

function roundCents(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} musi być skończoną kwotą nieujemną.`);
  const cents = Math.round((value + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) throw new RangeError(`${label} przekracza obsługiwany limit.`);
  if (Math.abs(value - cents / 100) > 0.0000001) throw new RangeError(`${label} musi być wyrażona w pełnych groszach.`);
  return cents;
}

function money(cents: number): number {
  return cents / 100;
}

function normalizedItemGroup(
  line: OfferWorkspacePricingLine,
  item: OfferWorkspacePricingTemplate['items'][number],
): OfferWorkspaceCommercialGroup {
  const category = normalized(item.product?.category ?? null);
  const role = normalized(line.role);
  const constraints = new Set<OfferWorkspaceCommercialGroup>();

  if (inverterCategories.has(category)) constraints.add('INVERTER');
  if (emsCategories.has(category) || role === 'MONITORING') constraints.add('EMS');
  if (role === 'LOGISTICS') constraints.add('TRANSPORT');

  if (constraints.size > 1) {
    throw new TypeError(`Pozycja ${line.templateId}/${line.itemId} ma sprzeczną kategorię produktu i rolę.`);
  }

  if (inverterRoles.has(role) && !inverterCategories.has(category)) {
    throw new TypeError(`Pozycja falownika ${line.templateId}/${line.itemId} wymaga jawnej kategorii produktu.`);
  }

  return constraints.values().next().value ?? 'STORAGE_INSTALLATION';
}

function assertEqualCents(actual: number, expected: number, label: string): void {
  if (actual !== expected) throw new Error(`${label} nie uzgadnia się z sumą pozycji w pełnych groszach.`);
}

export function calculateOfferCommercialPricing(
  pricing: OfferWorkspacePricingResult,
  templates: OfferWorkspacePricingTemplate[],
  breakdown: OfferWorkspaceCommercialBreakdown | null | undefined,
): OfferWorkspaceCommercialPricingResult {
  const parsedBreakdown = parseOfferWorkspaceCommercialBreakdown(breakdown);
  if (!parsedBreakdown) throw new Error('Podział ceny komercyjnej wymaga jawnych przypisań pozycji.');
  if (pricing.clientType !== 'B2C' || pricing.saleAmountBasis !== 'GROSS') {
    throw new Error('Podział komercyjny jest obecnie dostępny wyłącznie dla klienta B2C.');
  }
  if (pricing.totals === null || pricing.calculationError || pricing.missingRequiredData.length > 0
    || pricing.missingOptionalData.length > 0) {
    throw new Error('Nie można podzielić ceny: wycena zawiera brakujące albo nieprawidłowe ceny.');
  }

  const templatesById = new Map<string, OfferWorkspacePricingTemplate>();
  const itemsByReference = new Map<string, OfferWorkspacePricingTemplate['items'][number]>();
  for (const template of templates) {
    if (!template.id.trim()) throw new TypeError('Każdy szablon musi mieć identyfikator.');
    if (templatesById.has(template.id)) throw new TypeError(`Powtórzony identyfikator szablonu ${template.id}.`);
    templatesById.set(template.id, template);
    for (const item of template.items) {
      const key = referenceKey(template.id, item.id);
      if (itemsByReference.has(key)) throw new TypeError(`Powtórzona pozycja ${template.id}/${item.id} w szablonie.`);
      itemsByReference.set(key, item);
    }
  }

  const linesByReference = new Map<string, OfferWorkspacePricingLine>();
  for (const line of pricing.lines) {
    const key = referenceKey(line.templateId, line.itemId);
    if (linesByReference.has(key)) throw new TypeError(`Powtórzona pozycja wyceny ${line.templateId}/${line.itemId}.`);
    linesByReference.set(key, line);
  }

  const includedLines = pricing.lines.filter((line) => line.includedInSale);
  if (includedLines.length === 0) throw new Error('Brak aktualnych pozycji uwzględnionych w cenie sprzedaży.');
  const includedReferences = new Set<string>();
  const sourceReferencesByGroup = new Map<OfferWorkspaceCommercialGroup, OfferWorkspaceCommercialPricingSourceReference[]>();
  for (const group of OFFER_WORKSPACE_COMMERCIAL_GROUPS) {
    sourceReferencesByGroup.set(group, []);
  }

  let includedGrossCents = 0;
  let includedNetCents = 0;
  let originalInverterGrossCents = 0;
  let inverterPurchaseGrossCents = 0;
  let emsGrossCents = 0;
  let transportGrossCents = 0;
  let batteryFound = false;

  for (const line of includedLines) {
    const key = referenceKey(line.templateId, line.itemId);
    includedReferences.add(key);
    const template = templatesById.get(line.templateId);
    const item = itemsByReference.get(key);
    if (!template || !item) throw new Error(`Brak źródłowej pozycji ${line.templateId}/${line.itemId} w wybranych szablonach.`);
    if (template.kind !== 'MAGAZYN') {
      throw new Error(`Pozycja ${line.templateId}/${line.itemId} nie pochodzi z wybranego szablonu MAGAZYN.`);
    }
    if (!line.calculation || !line.resolvedCosts || line.saleVatRate === null || line.saleAmount === null) {
      throw new Error(`Brak aktualnej ceny dla pozycji ${line.templateId}/${line.itemId}.`);
    }
    if (line.saleVatRate !== 0.08) {
      throw new Error(`Pozycja ${line.templateId}/${line.itemId} musi mieć VAT sprzedaży 8%.`);
    }
    const lineGrossCents = roundCents(line.calculation.saleGross, `Cena brutto pozycji ${line.templateId}/${line.itemId}`);
    const lineNetCents = roundCents(line.calculation.saleNet, `Cena netto pozycji ${line.templateId}/${line.itemId}`);
    const lineSaleAmountCents = roundCents(line.saleAmount, `Cena sprzedaży pozycji ${line.templateId}/${line.itemId}`);
    assertEqualCents(lineSaleAmountCents, lineGrossCents, `Cena sprzedaży pozycji ${line.templateId}/${line.itemId}`);
    includedGrossCents += lineGrossCents;
    includedNetCents += lineNetCents;

    const group = normalizedItemGroup(line, item);
    const assignment = parsedBreakdown.allocations.find((allocation) => allocation.templateId === line.templateId && allocation.itemId === line.itemId);
    if (!assignment) throw new Error(`Brak przypisania pozycji ${line.templateId}/${line.itemId} do grupy komercyjnej.`);
    if (assignment.group !== group) {
      throw new Error(`Pozycja ${line.templateId}/${line.itemId} musi należeć do grupy ${group}.`);
    }

    const sourceReference: OfferWorkspaceCommercialPricingSourceReference = {
      templateId: line.templateId,
      templateName: line.templateName,
      itemId: line.itemId,
      description: line.description,
    };
    const groupSources = sourceReferencesByGroup.get(group)!;
    groupSources.push(sourceReference);

    if (group === 'INVERTER') {
      const grossAtEightPercentCents = roundCents(
        Math.round((line.calculation.purchaseNet * (1 + line.saleVatRate) + Number.EPSILON) * 100) / 100,
        `Cena brutto falownika ${line.templateId}/${line.itemId}`,
      );
      inverterPurchaseGrossCents += grossAtEightPercentCents;
      originalInverterGrossCents += lineGrossCents;
    } else if (group === 'EMS') {
      emsGrossCents += lineGrossCents;
    } else if (group === 'TRANSPORT') {
      transportGrossCents += lineGrossCents;
    }
    if (group === 'STORAGE_INSTALLATION' && batteryCategories.has(normalized(item.product?.category ?? null))) {
      batteryFound = true;
    }
  }

  const allocationsByReference = new Map(parsedBreakdown.allocations.map((allocation) => [
    referenceKey(allocation.templateId, allocation.itemId),
    allocation,
  ]));
  for (const [key, allocation] of allocationsByReference) {
    const line = linesByReference.get(key);
    if (!line) throw new Error(`Przypisanie wskazuje nieznaną pozycję ${allocation.templateId}/${allocation.itemId}.`);
    if (!line.includedInSale) throw new Error(`Pozycja ${allocation.templateId}/${allocation.itemId} jest wyłączona z ceny sprzedaży.`);
    if (!includedReferences.has(key)) throw new Error(`Przypisanie wskazuje nieaktualną pozycję ${allocation.templateId}/${allocation.itemId}.`);
  }

  const allocationReferences = new Set(allocationsByReference.keys());
  if (allocationReferences.size !== includedReferences.size
    || [...includedReferences].some((key) => !allocationReferences.has(key))) {
    throw new Error('Każda aktualna pozycja uwzględniona w cenie musi mieć dokładnie jedno przypisanie.');
  }
  if (!batteryFound) throw new Error('Grupa magazynu musi zawierać produkt magazynu energii MAGAZYN_ENERGII albo BATTERY.');
  for (const group of OFFER_WORKSPACE_COMMERCIAL_GROUPS) {
    if (sourceReferencesByGroup.get(group)!.length === 0) {
      throw new Error(`Brak aktualnych pozycji w wymaganej grupie ${group}.`);
    }
  }

  const totalGrossCents = roundCents(pricing.totals.saleGross, 'Łączna cena brutto');
  const totalNetCents = roundCents(pricing.totals.saleNet, 'Łączna cena netto');
  assertEqualCents(includedGrossCents, totalGrossCents, 'Łączna cena brutto');
  assertEqualCents(includedNetCents, totalNetCents, 'Łączna cena netto');
  const inverterGroupGrossCents = inverterPurchaseGrossCents;
  const transferredInverterGrossCents = originalInverterGrossCents - inverterGroupGrossCents;
  if (transferredInverterGrossCents < 0) {
    throw new Error('Cena sprzedaży falownika nie pokrywa jego efektywnej ceny zakupu brutto przy VAT 8%.');
  }
  const storageGrossCents = totalGrossCents - inverterGroupGrossCents - emsGrossCents - transportGrossCents;
  if (storageGrossCents < 0) throw new Error('Podział grup przekracza łączną cenę brutto.');

  const grossByGroup = new Map<OfferWorkspaceCommercialGroup, number>([
    ['STORAGE_INSTALLATION', storageGrossCents],
    ['INVERTER', inverterGroupGrossCents],
    ['EMS', emsGrossCents],
    ['TRANSPORT', transportGrossCents],
  ]);

  const netByGroup = new Map<OfferWorkspaceCommercialGroup, number>();
  let assignedNetCents = 0;
  for (const group of ['INVERTER', 'EMS', 'TRANSPORT'] as const) {
    const amountNetCents = Math.round((grossByGroup.get(group)! / 1.08) + Number.EPSILON);
    netByGroup.set(group, amountNetCents);
    assignedNetCents += amountNetCents;
  }
  const storageNetCents = totalNetCents - assignedNetCents;
  if (storageNetCents < 0) throw new Error('Podział ceny netto przekracza łączną cenę netto.');
  netByGroup.set('STORAGE_INSTALLATION', storageNetCents);

  const rows = OFFER_WORKSPACE_COMMERCIAL_GROUPS.map((group): OfferWorkspaceCommercialPricingRow => ({
    group,
    label: groupLabels[group],
    amountGross: money(grossByGroup.get(group)!),
    amountNet: money(netByGroup.get(group)!),
    sourceReferences: sourceReferencesByGroup.get(group)!,
  }));

  return {
    clientType: 'B2C',
    saleVatRate: 0.08,
    rows,
    totalGross: money(totalGrossCents),
    totalNet: money(totalNetCents),
    batteryEligibleGross: money(storageGrossCents),
    transferredInverterSaleGross: money(transferredInverterGrossCents),
  };
}
