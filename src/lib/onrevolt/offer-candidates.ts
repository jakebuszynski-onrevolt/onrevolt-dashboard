import { sumConfiguration } from './calculator';
import { resolveTemplateItemCosts, resolveTemplateItemSaleVat, type PriceableTemplateItem } from './configuration-templates';
import type { ConfigurationVatMode } from './configuration-vat';
import type { CalculationInput, CalculationResult, ConfigurationTotals } from './calculator';

type NumericValue = string | number | { toString(): string };
export type OfferCandidateClientType = 'B2C' | 'B2B';
export type OfferCandidateRoofType = 'FLAT' | 'SLOPED' | 'UNKNOWN';
export type OfferCandidatePvStrategy = 'KEEP_EXISTING' | 'ADD_TEMPLATE';
export type OfferCandidateSupplyMode =
  | 'ONREVOLT_SUPPLIED'
  | 'CLIENT_OWNED_USED'
  | 'CLIENT_SUPPLIED_NEW'
  | 'SERVICE_ONLY'
  | 'NOT_INCLUDED';

export interface PvGeometry {
  tiltDegrees: number;
  azimuthDegrees: number;
}

export interface ExistingPvSystem {
  powerKw: number;
  tiltDegrees: number | null;
  azimuthDegrees: number | null;
}

export interface OfferCandidateTemplateItem extends PriceableTemplateItem {
  id: string;
  position: number;
  quantity: NumericValue;
  role: string;
  supplyMode: OfferCandidateSupplyMode;
  saleVatRate: NumericValue | null;
  isOptional: boolean;
  requiresReview: boolean;
  product?: (NonNullable<PriceableTemplateItem['product']> & {
    sku?: string | null;
    clientType?: string | null;
    category?: string | null;
  }) | null;
}

export interface ApprovedConfigurationTemplate {
  id: string;
  familyKey: string;
  name: string;
  version: number;
  isActive: boolean;
  kind: 'MAGAZYN' | 'PV_DACH_PLASKI' | 'PV_DACH_SKOSNY' | 'EMS' | 'MIXED';
  clientType: string;
  roofType: string | null;
  powerKw: NumericValue | null;
  capacityKwh: NumericValue | null;
  requiresExistingPv: boolean;
  requiresExistingInverter: boolean;
  items: OfferCandidateTemplateItem[];
}

export interface OfferCandidateEnumerationInput {
  approvedConfigurationTemplates: ApprovedConfigurationTemplate[];
  clientType: OfferCandidateClientType;
  roofType: OfferCandidateRoofType;
  pvStrategy: OfferCandidatePvStrategy;
  existingPv: ExistingPvSystem;
  addedPvGeometry: PvGeometry | null;
  existingPvCompatibilityEvidence: 'unknown' | 'yes' | 'no';
  existingInverterCompatibilityEvidence: 'unknown' | 'yes' | 'no';
  saleVatMode: ConfigurationVatMode;
}

export interface OfferCandidateItemSnapshot {
  templateId: string;
  templateVersion: number;
  position: number;
  productId: string | null;
  productSku: string | null;
  productName: string | null;
  productCategory: string | null;
  description: string | null;
  role: string;
  supplyMode: OfferCandidateSupplyMode;
  quantity: number;
  isOptional: boolean;
  requiresReview: boolean;
  resolvedCosts: ReturnType<typeof resolveTemplateItemCosts> | null;
  saleVatRate: number | null;
  calculation: CalculationResult | null;
  missingPriceReason: string | null;
}

export interface OfferCandidateSnapshot {
  id: string;
  pvStrategy: OfferCandidatePvStrategy;
  templateIds: string[];
  templateVersions: number[];
  totals: ConfigurationTotals | null;
  existingPv: ExistingPvSystem;
  addedPvGeometry: PvGeometry | null;
  pvGeometryReviewRequired: boolean;
  existingPvKw: number;
  addedPvKw: number;
  totalPvKw: number;
  batteryCapacityKwh: number;
  batteryPowerKw: number;
  items: OfferCandidateItemSnapshot[];
  requiresReview: boolean;
  reviewReasons: string[];
  missingPrices: string[];
}

export interface RejectedOfferCandidate {
  templateIds: string[];
  reasons: string[];
}

export interface OfferCandidateBaselineDescriptor {
  id: 'baseline:zero-investment' | 'baseline:tariff-only';
  kind: 'ZERO_INVESTMENT' | 'TARIFF_ONLY';
  templateIds: [];
  investmentGross: 0;
}

export interface OfferCandidateEnumerationResult {
  candidates: OfferCandidateSnapshot[];
  rejectedReasonList: RejectedOfferCandidate[];
  baselineComparisons: OfferCandidateBaselineDescriptor[];
}

const nonPricedSupplyModes = new Set<OfferCandidateSupplyMode>([
  'CLIENT_OWNED_USED',
  'CLIENT_SUPPLIED_NEW',
  'NOT_INCLUDED',
]);

const baselineComparisons: OfferCandidateBaselineDescriptor[] = [
  { id: 'baseline:zero-investment', kind: 'ZERO_INVESTMENT', templateIds: [], investmentGross: 0 },
  { id: 'baseline:tariff-only', kind: 'TARIFF_ONLY', templateIds: [], investmentGross: 0 },
];

function finiteNumber(value: NumericValue | null, label: string): number {
  if (value === null || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`Brak wartości: ${label}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Nieprawidłowa wartość: ${label}`);
  return parsed;
}

function templateSaleVatRate(mode: ConfigurationVatMode, item: OfferCandidateTemplateItem): number {
  if (mode === 'REDUCED_8') return 0.08;
  if (mode === 'STANDARD_23') return 0.23;
  if (mode === 'REVIEW') throw new Error('Tryb VAT wymaga przeglądu');
  const rate = resolveTemplateItemSaleVat(item);
  if (rate !== 0.08 && rate !== 0.23) {
    throw new Error(`Stawka VAT sprzedaży musi wynosić 8% albo 23% (${item.description || item.product?.name || item.id})`);
  }
  return rate;
}

function candidateId(templateIds: string[]): string {
  return `offer-candidate:${templateIds.map((id) => encodeURIComponent(id)).join(':')}`;
}

function clientCanUseTemplate(templateClientType: string, clientType: OfferCandidateClientType): boolean {
  return templateClientType === clientType || templateClientType === 'B2C_B2B';
}

function roofKindFor(roofType: OfferCandidateRoofType): ApprovedConfigurationTemplate['kind'] | null {
  if (roofType === 'FLAT') return 'PV_DACH_PLASKI';
  if (roofType === 'SLOPED') return 'PV_DACH_SKOSNY';
  return null;
}

function validatePvGeometry(geometry: PvGeometry, label: string): void {
  if (!Number.isFinite(geometry.tiltDegrees) || geometry.tiltDegrees < 0 || geometry.tiltDegrees > 90) {
    throw new RangeError(`${label}: nachylenie musi mieścić się w zakresie 0-90 stopni.`);
  }
  if (!Number.isFinite(geometry.azimuthDegrees) || geometry.azimuthDegrees < 0 || geometry.azimuthDegrees >= 360) {
    throw new RangeError(`${label}: azymut musi mieścić się w zakresie 0-359,999... stopni.`);
  }
}

function deviceRole(item: OfferCandidateTemplateItem): 'INVERTER' | 'EMS' | null {
  const role = item.role.trim().toUpperCase();
  const category = item.product?.category?.trim().toUpperCase() || '';
  const label = `${item.description || ''} ${item.product?.name || ''}`;
  if (role === 'INVERTER' || role === 'FALOWNIK' || role === 'EMS_INVERTER'
    || ['FALOWNIK', 'INWERTER', 'INVERTER'].includes(category)
    || /falownik|inwerter|inverter/i.test(label)) return 'INVERTER';
  if (role === 'EMS' || role === 'ENERGY_MANAGEMENT'
    || ['EMS', 'ENERGY_MANAGEMENT_SYSTEM'].includes(category)
    || /\bems\b|system zarządzania energią|energy management system/i.test(label)) return 'EMS';
  return null;
}

function duplicatedDeviceRoles(templates: ApprovedConfigurationTemplate[]): string[] {
  const templatesByRole = new Map<'INVERTER' | 'EMS', number>();
  for (const template of templates) {
    const roles = new Set(template.items.map(deviceRole).filter((role): role is 'INVERTER' | 'EMS' => role !== null));
    for (const role of roles) templatesByRole.set(role, (templatesByRole.get(role) || 0) + 1);
  }
  return Array.from(templatesByRole.entries())
    .filter(([, templateCount]) => templateCount > 1)
    .map(([role]) => role === 'INVERTER'
      ? 'Falownik występuje w kilku szablonach; sprawdź, czy urządzenia się nie dublują.'
      : 'EMS występuje w kilku szablonach; sprawdź, czy urządzenia się nie dublują.');
}

function validateTemplate(
  template: ApprovedConfigurationTemplate,
  scope: 'BATTERY' | 'PV',
  input: OfferCandidateEnumerationInput,
): string[] {
  const reasons: string[] = [];
  if (!template.id.trim()) reasons.push('Szablon nie ma identyfikatora.');
  if (template.isActive !== true) reasons.push(`Szablon „${template.name}” nie jest aktywny.`);
  if (!Number.isInteger(template.version) || template.version <= 0) {
    reasons.push(`Szablon „${template.name}” nie ma poprawnej wersji.`);
  }
  if (!clientCanUseTemplate(template.clientType, input.clientType)) {
    reasons.push(`Szablon „${template.name}” nie jest przeznaczony dla klienta ${input.clientType}.`);
  }
  if (template.items.length === 0) reasons.push(`Szablon „${template.name}” nie zawiera BOM.`);

  if (scope === 'BATTERY') {
    try {
      const capacity = finiteNumber(template.capacityKwh, `pojemność szablonu „${template.name}”`);
      if (capacity <= 0) reasons.push(`Szablon „${template.name}” musi mieć dodatnią pojemność magazynu.`);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : `Brak pojemności szablonu „${template.name}”.`);
    }
    try {
      const power = finiteNumber(template.powerKw, `moc szablonu „${template.name}”`);
      if (power <= 0) reasons.push(`Szablon „${template.name}” musi mieć dodatnią moc magazynu.`);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : `Brak mocy szablonu „${template.name}”.`);
    }
  } else {
    try {
      const power = finiteNumber(template.powerKw, `moc PV szablonu „${template.name}”`);
      if (power <= 0) reasons.push(`Szablon „${template.name}” musi mieć dodatnią moc PV.`);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : `Brak mocy PV szablonu „${template.name}”.`);
    }
    const requiredKind = roofKindFor(input.roofType);
    if (requiredKind === null) {
      reasons.push('Nie można dobrać szablonu PV bez potwierdzonego rodzaju dachu.');
    } else if (template.kind !== requiredKind || template.roofType !== input.roofType) {
      reasons.push(`Szablon PV „${template.name}” nie pasuje do dachu ${input.roofType}.`);
    }
  }

  for (const item of template.items) {
    const label = item.description || item.product?.name || item.id || 'pozycja bez identyfikatora';
    if (!Number.isInteger(item.position) || item.position <= 0) {
      reasons.push(`Pozycja „${label}” ma niepoprawną kolejność BOM.`);
    }
    if (typeof item.quantity !== 'number' && typeof item.quantity !== 'string' && typeof item.quantity?.toString !== 'function') {
      reasons.push(`Pozycja „${label}” nie ma jawnej ilości.`);
    } else {
      try {
        const quantity = finiteNumber(item.quantity, `ilość (${label})`);
        if (quantity <= 0) reasons.push(`Pozycja „${label}” ma ilość zero lub ujemną.`);
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : `Ilość pozycji „${label}” jest niepoprawna.`);
      }
    }
    if (!item.role.trim()) reasons.push(`Pozycja „${label}” nie ma roli.`);
    if (!['ONREVOLT_SUPPLIED', 'CLIENT_OWNED_USED', 'CLIENT_SUPPLIED_NEW', 'SERVICE_ONLY', 'NOT_INCLUDED'].includes(item.supplyMode)) {
      reasons.push(`Pozycja „${label}” ma nieznany tryb dostawy.`);
    }
    if (typeof item.isOptional !== 'boolean' || typeof item.requiresReview !== 'boolean') {
      reasons.push(`Pozycja „${label}” nie ma jawnych flag opcjonalności i przeglądu.`);
    }
  }
  return Array.from(new Set(reasons));
}

function makeCalculationInput(
  item: OfferCandidateTemplateItem,
  quantity: number,
  saleVatMode: ConfigurationVatMode,
): { input: CalculationInput; costs: ReturnType<typeof resolveTemplateItemCosts> | null; saleVatRate: number } {
  if (nonPricedSupplyModes.has(item.supplyMode)) {
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
    };
  }

  const costs = resolveTemplateItemCosts(item);
  const saleVatRate = templateSaleVatRate(saleVatMode, item);
  return {
    input: { quantity, ...costs, saleVatRate },
    costs,
    saleVatRate,
  };
}

function reject(
  rejectedReasonList: RejectedOfferCandidate[],
  templateIds: string[],
  reasons: string[],
): void {
  if (reasons.length === 0) return;
  rejectedReasonList.push({ templateIds: [...templateIds], reasons: Array.from(new Set(reasons)) });
}

export function enumerateOfferCandidates(
  input: OfferCandidateEnumerationInput,
): OfferCandidateEnumerationResult {
  if (!['B2C', 'B2B'].includes(input.clientType)) throw new TypeError('Typ klienta musi być jawnie B2C albo B2B.');
  if (!['FLAT', 'SLOPED', 'UNKNOWN'].includes(input.roofType)) throw new TypeError('Rodzaj dachu musi być jawny.');
  if (!['KEEP_EXISTING', 'ADD_TEMPLATE'].includes(input.pvStrategy)) throw new TypeError('Strategia PV musi być jawna.');
  if (!['REDUCED_8', 'STANDARD_23', 'MIXED', 'REVIEW'].includes(input.saleVatMode)) {
    throw new TypeError('Tryb VAT sprzedaży musi być jawny.');
  }
  if (!['unknown', 'yes', 'no'].includes(input.existingPvCompatibilityEvidence)
    || !['unknown', 'yes', 'no'].includes(input.existingInverterCompatibilityEvidence)) {
    throw new TypeError('Dowody zgodności istniejących urządzeń muszą być jawne.');
  }
  if (!Number.isFinite(input.existingPv.powerKw) || input.existingPv.powerKw < 0) {
    throw new RangeError('Istniejąca moc PV musi być skończona i nieujemna.');
  }
  if (input.existingPv.powerKw === 0) {
    if (input.existingPv.tiltDegrees !== null || input.existingPv.azimuthDegrees !== null) {
      throw new TypeError('Brak istniejącego PV wymaga pustej geometrii istniejącej instalacji.');
    }
    if (input.pvStrategy === 'KEEP_EXISTING') {
      throw new RangeError('Tryb zachowania istniejącego PV wymaga dodatniej mocy PV.');
    }
  } else {
    if (input.existingPv.tiltDegrees === null || input.existingPv.azimuthDegrees === null) {
      throw new TypeError('Istniejące PV wymaga jawnego nachylenia i azymutu.');
    }
    validatePvGeometry({
      tiltDegrees: input.existingPv.tiltDegrees,
      azimuthDegrees: input.existingPv.azimuthDegrees,
    }, 'Istniejące PV');
  }
  if (input.pvStrategy === 'KEEP_EXISTING' && input.addedPvGeometry !== null) {
    throw new TypeError('Geometria dodawanego PV nie ma zastosowania w trybie zachowania instalacji.');
  }
  if (input.addedPvGeometry !== null) validatePvGeometry(input.addedPvGeometry, 'Dodawane PV');

  const rejectedReasonList: RejectedOfferCandidate[] = [];
  const seenTemplateIds = new Set<string>();
  const templates: ApprovedConfigurationTemplate[] = [];
  for (const template of input.approvedConfigurationTemplates) {
    if (seenTemplateIds.has(template.id)) {
      reject(rejectedReasonList, [template.id], ['Powtórzony identyfikator szablonu w katalogu wejściowym.']);
      continue;
    }
    seenTemplateIds.add(template.id);
    templates.push(template);
  }

  const batteryTemplates = templates
    .filter((template) => template.kind === 'MAGAZYN')
    .sort((left, right) => left.id.localeCompare(right.id));
  const pvTemplates = input.pvStrategy === 'ADD_TEMPLATE'
    ? templates
      .filter((template) => template.kind === 'PV_DACH_PLASKI' || template.kind === 'PV_DACH_SKOSNY')
      .filter((template) => input.roofType === 'UNKNOWN' || template.kind === roofKindFor(input.roofType))
      .sort((left, right) => left.id.localeCompare(right.id))
    : [];
  const validBatteries = batteryTemplates.filter((template) => {
    const reasons = validateTemplate(template, 'BATTERY', input);
    reject(rejectedReasonList, [template.id], reasons);
    return reasons.length === 0;
  });
  const validPvTemplates = pvTemplates.filter((template) => {
    const reasons = validateTemplate(template, 'PV', input);
    reject(rejectedReasonList, [template.id], reasons);
    return reasons.length === 0;
  });
  if (batteryTemplates.length === 0) {
    reject(rejectedReasonList, [], ['Brak aktywnych szablonów magazynu energii.']);
  }

  const candidates: OfferCandidateSnapshot[] = [];
  const seenCandidateKeys = new Set<string>();
  for (const battery of validBatteries) {
    let batteryCapacityKwh: number;
    let batteryPowerKw: number;
    try {
      batteryCapacityKwh = finiteNumber(battery.capacityKwh, `pojemność szablonu „${battery.name}”`);
      batteryPowerKw = finiteNumber(battery.powerKw, `moc szablonu „${battery.name}”`);
    } catch (error) {
      reject(rejectedReasonList, [battery.id], [error instanceof Error ? error.message : 'Brak danych technicznych baterii.']);
      continue;
    }

    const pvChoices: Array<ApprovedConfigurationTemplate | null> = input.pvStrategy === 'KEEP_EXISTING'
      ? [null]
      : validPvTemplates;
    if (pvChoices.length === 0) {
      reject(rejectedReasonList, [battery.id], ['Brak aktywnego, zgodnego z klientem i dachem szablonu PV do dodania.']);
      continue;
    }

    for (const pvTemplate of pvChoices) {
      const orderedTemplates = pvTemplate ? [battery, pvTemplate] : [battery];
      const templateIds = orderedTemplates.map((template) => template.id);
      const key = JSON.stringify(templateIds);
      if (seenCandidateKeys.has(key)) continue;
      seenCandidateKeys.add(key);

      const reasons: string[] = [];
      // A storage bundle can use the new PV supplied in this same candidate.
      // A PV extension template still requires the customer's existing installation.
      const missingRequiredPv = input.existingPv.powerKw === 0 && orderedTemplates.some((template) =>
        template.requiresExistingPv && !(template === battery && pvTemplate !== null));
      if (missingRequiredPv) {
        reject(rejectedReasonList, templateIds, ['Szablon wymaga istniejącej instalacji PV, której klient nie posiada.']);
        continue;
      }
      if (input.pvStrategy === 'KEEP_EXISTING' || input.existingPv.powerKw > 0) {
        if (input.existingPvCompatibilityEvidence === 'no') {
          reject(rejectedReasonList, templateIds, ['Istniejąca instalacja PV została oznaczona jako niezgodna.']);
          continue;
        }
        if (input.existingPvCompatibilityEvidence === 'unknown') {
          reasons.push('Zgodność istniejącej instalacji PV wymaga sprawdzenia.');
        }
      }
      if (orderedTemplates.some((template) => template.requiresExistingPv) && input.existingPv.powerKw > 0
        && input.existingPvCompatibilityEvidence === 'unknown') {
        reasons.push('Szablon wymaga potwierdzenia zgodności istniejącej instalacji PV.');
      }
      reasons.push(...duplicatedDeviceRoles(orderedTemplates));
      if (orderedTemplates.some((template) => template.requiresExistingInverter)) {
        if (input.existingInverterCompatibilityEvidence === 'no') {
          reject(rejectedReasonList, templateIds, ['Szablon wymaga istniejącego falownika, którego zgodność oznaczono jako niezgodną.']);
          continue;
        }
        if (input.existingInverterCompatibilityEvidence === 'unknown') {
          reasons.push('Zgodność wymaganego istniejącego falownika wymaga sprawdzenia.');
        }
      }

      let addedPvKw = 0;
      if (pvTemplate) {
        try {
          addedPvKw = finiteNumber(pvTemplate.powerKw, `moc PV szablonu „${pvTemplate.name}”`);
        } catch (error) {
          reject(rejectedReasonList, templateIds, [error instanceof Error ? error.message : 'Brak mocy PV.']);
          continue;
        }
      }
      const totalPvKw = input.existingPv.powerKw + addedPvKw;
      if (!Number.isFinite(totalPvKw) || totalPvKw <= 0) {
        reject(rejectedReasonList, templateIds, ['Łączna moc PV kandydata musi być skończona i dodatnia.']);
        continue;
      }
      if (pvTemplate && input.addedPvGeometry === null) {
        reasons.push('Geometria dodawanego PV wymaga osobnego potwierdzenia nachylenia i azymutu; nie dziedziczę parametrów istniejącej instalacji.');
      }

      const lineInputs: CalculationInput[] = [];
      const itemSnapshots: OfferCandidateItemSnapshot[] = [];
      const missingPrices: string[] = [];
      for (const template of orderedTemplates) {
        const orderedItems = template.items
          .map((item, index) => ({ item, index }))
          .sort((left, right) => left.item.position - right.item.position || left.index - right.index);
        for (const { item } of orderedItems) {
          const label = item.description || item.product?.name || item.id;
          const quantity = finiteNumber(item.quantity, `ilość (${label})`);
          let costs: ReturnType<typeof resolveTemplateItemCosts> | null = null;
          let saleVatRate: number | null = null;
          let missingPriceReason: string | null = null;
          try {
            const line = makeCalculationInput(item, quantity, input.saleVatMode);
            costs = line.costs;
            saleVatRate = line.saleVatRate;
            lineInputs.push(line.input);
          } catch (error) {
            missingPriceReason = error instanceof Error ? error.message : `Nie udało się wycenić pozycji „${label}”.`;
            missingPrices.push(`${template.name} / ${label}: ${missingPriceReason}`);
            reasons.push(`Pozycja „${label}” wymaga uzupełnienia ceny lub VAT.`);
          }
          if (item.requiresReview) reasons.push(`Pozycja „${label}” wymaga przeglądu według szablonu.`);
          itemSnapshots.push({
            templateId: template.id,
            templateVersion: template.version,
            position: item.position,
            productId: item.productId ?? null,
            productSku: item.product?.sku ?? null,
            productName: item.product?.name ?? null,
            productCategory: item.product?.category ?? null,
            description: item.description ?? null,
            role: item.role,
            supplyMode: item.supplyMode,
            quantity,
            isOptional: item.isOptional,
            requiresReview: item.requiresReview,
            resolvedCosts: costs,
            saleVatRate,
            calculation: null,
            missingPriceReason,
          });
        }
      }

      let totals: ConfigurationTotals | null = null;
      if (missingPrices.length === 0 && lineInputs.length === itemSnapshots.length) {
        try {
          totals = sumConfiguration(lineInputs);
          itemSnapshots.forEach((item, index) => {
            item.calculation = totals?.lines[index] ?? null;
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Dane BOM nie pozwalają na kalkulację.';
          reasons.push(`Kalkulacja BOM wymaga przeglądu: ${reason}`);
        }
      }

      candidates.push({
        id: candidateId(templateIds),
        pvStrategy: input.pvStrategy,
        templateIds,
        templateVersions: orderedTemplates.map((template) => template.version),
        totals,
        existingPv: { ...input.existingPv },
        addedPvGeometry: input.addedPvGeometry ? { ...input.addedPvGeometry } : null,
        pvGeometryReviewRequired: pvTemplate !== null && input.addedPvGeometry === null,
        existingPvKw: input.existingPv.powerKw,
        addedPvKw,
        totalPvKw,
        batteryCapacityKwh,
        batteryPowerKw,
        items: itemSnapshots,
        requiresReview: reasons.length > 0,
        reviewReasons: Array.from(new Set(reasons)),
        missingPrices,
      });
    }
  }

  candidates.sort((left, right) => left.templateIds.join('\u0000').localeCompare(right.templateIds.join('\u0000')));
  return {
    candidates,
    rejectedReasonList,
    baselineComparisons: baselineComparisons.map((baseline) => ({ ...baseline, templateIds: [] })),
  };
}
