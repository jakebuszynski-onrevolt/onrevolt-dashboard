'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, Flex, FormControl, FormLabel,
  Grid, Input, Select, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr, useColorModeValue,
} from '@chakra-ui/react';
import type { OfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import {
  applyOfferWorkspaceConfigurationEdits, configurationEnergyQuantityFingerprint,
  configurationItemEditablePricing, configurationQuantityAffectsEnergy,
  offerWorkspaceSaleAmountToNet, offerWorkspaceSaleNetToAmount,
  parseOfferWorkspaceConfigurationEdits, validateOfferWorkspaceConfigurationEdits,
  type OfferWorkspaceConfigurationEdit, type OfferWorkspaceConfigurationItemEdit,
} from 'lib/onrevolt/offer-workspace-configuration-edits';
import { priceOfferWorkspaceConfiguration, type OfferWorkspacePricingResult } from 'lib/onrevolt/offer-workspace-pricing';
import type { WorkspaceTemplate } from './OfferWorkspacePanel';

export type EditorRow = {
  id: string;
  pricingItemId: string;
  description: string;
  quantity: string;
  unitSaleAmount: string;
  baselineDescription: string;
  baselineQuantity: number;
  baselineSaleAmount: number | null;
  baselineUnitSaleNet: number | null;
  salePriceEdited: boolean;
  baselineRemoved: boolean;
  added: boolean;
  persistedAdded: boolean;
  removed: boolean;
  role: string;
  supplyMode: string;
  model: string;
  core: boolean;
  unitPurchaseNet: string;
  purchaseVatRate: string;
  operatingCostNet: string;
  operatingCostBasis: 'PER_UNIT' | 'PER_LINE';
  saleVatRate: string;
  marginRate: number | null;
  unitSaleNet: number | null;
  baselineUnitPurchaseNet: number | null;
  baselinePurchaseVatRate: number | null;
  baselineOperatingCostNet: number | null;
  baselineOperatingCostBasis: 'PER_UNIT' | 'PER_LINE';
  baselineSaleVatRate: number | null;
  baselineMarginRate: number | null;
};
export type EditorGroup = {
  templateId: string;
  rows: EditorRow[];
  powerKw: string;
  capacityKwh: string;
  baselinePowerKw: number | null;
  baselineCapacityKwh: number | null;
  technicalConfirmed: boolean;
  baselineTechnicalConfirmed: boolean;
};
type Props = {
  draft: OfferWorkspaceDraft;
  templates: WorkspaceTemplate[];
  clientType: string;
  disabled: boolean;
  onApply: (edits: OfferWorkspaceConfigurationEdit[]) => void;
  onPreview?: (pricing: OfferWorkspacePricingResult | null, active: boolean) => void;
};

const tryNumeric = (value: string) => {
  const normalized = value.trim().replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!normalized) return null;
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const result = Number(normalized);
  if (!Number.isFinite(result)) return null;
  return result;
};
const numeric = (value: string, label = 'wartość') => {
  const parsed = tryNumeric(value);
  if (parsed === null && value.trim()) throw new Error(`Wpisz poprawną, nieujemną liczbę w polu „${label}”.`);
  return parsed;
};

const numberText = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '' : String(value);
const inputAmountText = (value: number | null) => value == null || !Number.isFinite(value) ? ''
  : new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(value);

function sameDisplayedAmount(value: string, baseline: number | null) {
  const parsed = tryNumeric(value);
  if (parsed === null) return baseline === null && !value.trim();
  if (baseline === null) return false;
  const displayed = Number(inputAmountText(baseline).replace(',', '.'));
  return parsed !== null && parsed === displayed;
}

function sameNumericText(value: string, baseline: number | null) {
  const parsed = tryNumeric(value);
  if (parsed === null) return baseline === null && !value.trim();
  return parsed === baseline;
}

function inputPercent(value: number | null | undefined) {
  return value == null ? '' : numberText(value * 100);
}

function fixedVat(mode: OfferWorkspaceDraft['saleVatMode']): number | null {
  if (mode === 'REDUCED_8') return 0.08;
  if (mode === 'STANDARD_23') return 0.23;
  return null;
}

function itemVatRate(item: WorkspaceTemplate['items'][number], mode: OfferWorkspaceDraft['saleVatMode']) {
  return fixedVat(mode) ?? (mode === 'MIXED' ? configurationItemEditablePricing(item).saleVatRate : null);
}

function unitSaleAmount(
  template: WorkspaceTemplate,
  item: WorkspaceTemplate['items'][number],
  draft: OfferWorkspaceDraft,
  clientType: string,
): number | null {
  const basis = clientType === 'B2B' ? 'NET' : 'GROSS';
  const vatRate = itemVatRate(item, draft.saleVatMode);
  const unitSaleNet = configurationItemEditablePricing(item).unitSaleNet;
  if (unitSaleNet !== null) {
    try { return offerWorkspaceSaleNetToAmount(unitSaleNet, basis, vatRate); }
    catch { return null; }
  }
  try {
    const result = priceOfferWorkspaceConfiguration([{ ...template, items: [{ ...item, workspaceRemoved: false } as typeof item] }], draft.saleVatMode, clientType);
    const line = result.lines[0];
    const quantity = line?.quantity;
    if (!line?.calculation || quantity == null || quantity <= 0) return null;
    return (basis === 'NET' ? line.calculation.saleNet : line.calculation.saleGross) / quantity;
  } catch { return null; }
}

function effectiveUnitSaleNet(
  template: WorkspaceTemplate,
  item: WorkspaceTemplate['items'][number],
  draft: OfferWorkspaceDraft,
  clientType: string,
): number | null {
  const saved = configurationItemEditablePricing(item).unitSaleNet;
  if (saved !== null) return saved;
  try {
    const result = priceOfferWorkspaceConfiguration([{ ...template, items: [{ ...item, workspaceRemoved: false } as typeof item] }], draft.saleVatMode, clientType);
    const line = result.lines[0];
    if (!line?.calculation || !line.quantity || line.quantity <= 0) return null;
    return line.calculation.saleNet / line.quantity;
  } catch { return null; }
}

function rowFromItem(
  template: WorkspaceTemplate,
  item: WorkspaceTemplate['items'][number],
  draft: OfferWorkspaceDraft,
  clientType: string,
  savedAddedIds: Set<string>,
): EditorRow {
  const pricing = configurationItemEditablePricing(item);
  const marked = item as typeof item & { workspaceRemoved?: boolean; workspaceAdded?: boolean; workspaceAddedId?: string };
  const id = marked.workspaceAddedId || item.id;
  const currentSaleAmount = unitSaleAmount(template, item, draft, clientType);
  return {
    id,
    pricingItemId: item.id,
    description: item.description || '',
    quantity: String(item.quantity),
    unitSaleAmount: inputAmountText(currentSaleAmount),
    baselineDescription: item.description || '',
    baselineQuantity: Number(item.quantity),
    baselineSaleAmount: currentSaleAmount,
    baselineUnitSaleNet: effectiveUnitSaleNet(template, item, draft, clientType),
    salePriceEdited: false,
    baselineRemoved: Boolean(marked.workspaceRemoved),
    added: Boolean(marked.workspaceAdded),
    persistedAdded: Boolean(marked.workspaceAdded && savedAddedIds.has(id)),
    removed: Boolean(marked.workspaceRemoved),
    role: item.role,
    supplyMode: item.supplyMode,
    model: item.product?.name || '',
    core: configurationQuantityAffectsEnergy(item),
    unitPurchaseNet: numberText(pricing.unitPurchaseNet),
    purchaseVatRate: inputPercent(pricing.purchaseVatRate),
    operatingCostNet: numberText(pricing.operatingCostNet),
    operatingCostBasis: pricing.operatingCostBasis,
    saleVatRate: inputPercent(itemVatRate(item, draft.saleVatMode)),
    marginRate: pricing.marginRate,
    unitSaleNet: pricing.unitSaleNet,
    baselineUnitPurchaseNet: pricing.unitPurchaseNet,
    baselinePurchaseVatRate: pricing.purchaseVatRate,
    baselineOperatingCostNet: pricing.operatingCostNet,
    baselineOperatingCostBasis: pricing.operatingCostBasis,
    baselineSaleVatRate: itemVatRate(item, draft.saleVatMode),
    baselineMarginRate: pricing.marginRate,
  };
}

export function seedGroups(templates: WorkspaceTemplate[], draft: OfferWorkspaceDraft, clientType: string): EditorGroup[] {
  const effective = applyOfferWorkspaceConfigurationEdits(templates, draft);
  return effective.filter(template => draft.selectedTemplateIds.includes(template.id)).map(template => {
    const savedEdit = draft.configurationEdits?.find(edit => edit.templateId === template.id);
    const savedAddedIds = new Set(savedEdit?.addedItems?.map(item => item.id) || []);
    return {
      templateId: template.id,
      rows: template.items.map(item => rowFromItem(template, item, draft, clientType, savedAddedIds)),
      powerKw: numberText(template.powerKw),
      capacityKwh: numberText(template.capacityKwh),
      baselinePowerKw: template.powerKw,
      baselineCapacityKwh: template.capacityKwh,
      technicalConfirmed: savedEdit?.technical?.quantityFingerprint === configurationEnergyQuantityFingerprint(template),
      baselineTechnicalConfirmed: savedEdit?.technical?.quantityFingerprint === configurationEnergyQuantityFingerprint(template),
    };
  });
}

function cloneEdit(edit: OfferWorkspaceConfigurationEdit | undefined, templateId: string): OfferWorkspaceConfigurationEdit {
  return edit ? {
    ...edit,
    ...(edit.items ? { items: edit.items.map(item => ({ ...item, ...(item.pricing ? { pricing: { ...item.pricing } } : {}) })) } : {}),
    ...(edit.addedItems ? { addedItems: edit.addedItems.map(item => ({ ...item, pricing: { ...item.pricing } })) } : {}),
    ...(edit.technical ? { technical: { ...edit.technical } } : {}),
  } : { templateId, items: [], addedItems: [] };
}

function removeEmptyItemEdits(edit: OfferWorkspaceConfigurationEdit) {
  edit.items = (edit.items || []).filter(item => Object.keys(item).some(key => key !== 'itemId'));
  if (!edit.items.length) delete edit.items;
  if (!edit.addedItems?.length) delete edit.addedItems;
}

function changedAgainstSaved(row: EditorRow, original?: WorkspaceTemplate['items'][number], effectiveItem?: WorkspaceTemplate['items'][number], draft?: OfferWorkspaceDraft, clientType?: string, template?: WorkspaceTemplate) {
  if (row.added || row.removed || !original || !draft || !template) return true;
  const originalAmount = unitSaleAmount(template, original, draft, clientType || 'B2C');
  const sourcePricing = configurationItemEditablePricing(original);
  const effectivePricing = configurationItemEditablePricing(effectiveItem || original);
  const pricingChanged = (['unitPurchaseNet', 'purchaseVatRate', 'operatingCostNet', 'operatingCostBasis', 'marginRate', 'unitSaleNet', 'saleVatRate'] as const)
    .some(key => sourcePricing[key] !== effectivePricing[key]);
  return row.description !== (original.description || '')
    || tryNumeric(row.quantity) !== Number(original.quantity)
    || pricingChanged
    || row.salePriceEdited || !sameDisplayedAmount(row.unitSaleAmount, originalAmount);
}

export function buildOfferWorkspaceItemEdits(
  groups: EditorGroup[],
  templates: WorkspaceTemplate[],
  draft: OfferWorkspaceDraft,
  clientType: string,
  requireConfirmation = true,
): OfferWorkspaceConfigurationEdit[] {
  const savedEdits = parseOfferWorkspaceConfigurationEdits(draft.configurationEdits);
  const effectiveTemplates = applyOfferWorkspaceConfigurationEdits(templates, draft);
  return groups.flatMap(group => {
    const source = templates.find(template => template.id === group.templateId);
    const effective = effectiveTemplates.find(template => template.id === group.templateId);
    if (!source || !effective) throw new Error('Konfiguracja nie jest już dostępna.');
    const edit = cloneEdit(savedEdits.find(candidate => candidate.templateId === group.templateId), group.templateId);
    const currentItems = new Map((edit.items || []).map(item => [item.itemId, item]));
    const nextItems: OfferWorkspaceConfigurationItemEdit[] = [];
    let energyChanged = false;
    let coreRemovalChanged = false;
    const energyItems = source.items.map(item => {
      const row = group.rows.find(candidate => !candidate.added && candidate.id === item.id);
      const effectiveItem = effective.items.find(candidate => candidate.id === item.id);
      if (!row || !effectiveItem) throw new Error('Brak pozycji źródłowej w edytorze.');
      const quantity = numeric(row.quantity);
      if (quantity == null) throw new Error('Uzupełnij ilość pozycji.');
      if (!row.removed && quantity <= 0) throw new Error('Ilość musi być większa od zera. Aby pominąć pozycję, wybierz „Usuń”.');
      const itemEdit = { ...(currentItems.get(item.id) || { itemId: item.id }), itemId: item.id } as OfferWorkspaceConfigurationItemEdit;
      if (row.description !== (effectiveItem.description || '')) {
        if (row.description === (item.description || '')) delete itemEdit.description;
        else itemEdit.description = row.description;
      }
      if (quantity !== Number(effectiveItem.quantity)) {
        if (quantity === Number(item.quantity)) delete itemEdit.quantity;
        else itemEdit.quantity = quantity;
      }
      if (row.removed !== Boolean((effectiveItem as typeof effectiveItem & { workspaceRemoved?: boolean }).workspaceRemoved)) {
        if (row.removed) itemEdit.removed = true;
        else delete itemEdit.removed;
      }
      if (!row.removed && row.salePriceEdited) {
        const amount = numeric(row.unitSaleAmount);
        if (amount == null) throw new Error(`Uzupełnij cenę jednostkową pozycji „${row.description || row.model}”.`);
        const basis = clientType === 'B2B' ? 'NET' : 'GROSS';
        const vat = itemVatRate(effectiveItem, draft.saleVatMode);
        const rawAmount = unitSaleAmount(source, item, draft, clientType);
        const itemPricing = { ...(itemEdit.pricing || {}) };
        if (quantity === Number(item.quantity) && rawAmount !== null && sameDisplayedAmount(row.unitSaleAmount, rawAmount)) {
          if (configurationItemEditablePricing(item).unitSaleNet != null) itemPricing.unitSaleNet = configurationItemEditablePricing(item).unitSaleNet;
          else delete itemPricing.unitSaleNet;
        } else {
          itemPricing.unitSaleNet = offerWorkspaceSaleAmountToNet(amount, basis, vat);
        }
        itemEdit.pricing = itemPricing;
        if (!Object.keys(itemPricing).length) delete itemEdit.pricing;
      } else if (!row.removed && quantity !== Number(effectiveItem.quantity) && quantity !== Number(item.quantity)
        && configurationItemEditablePricing(effectiveItem).unitSaleNet == null && row.baselineUnitSaleNet != null) {
        // Calculated prices follow the visible unit amount; manual source prices retain their full net precision.
        const visibleAmount = numeric(row.unitSaleAmount);
        if (visibleAmount == null) throw new Error(`Uzupełnij cenę jednostkową pozycji „${row.description || row.model}”.`);
        const basis = clientType === 'B2B' ? 'NET' : 'GROSS';
        const vat = itemVatRate(effectiveItem, draft.saleVatMode);
        itemEdit.pricing = { ...(itemEdit.pricing || {}), unitSaleNet: offerWorkspaceSaleAmountToNet(visibleAmount, basis, vat) };
      } else if (!row.removed && quantity !== Number(effectiveItem.quantity) && quantity === Number(item.quantity)
        && configurationItemEditablePricing(item).unitSaleNet == null && itemEdit.pricing?.unitSaleNet != null) {
        // Prune the quantity-only pin when the row returns to its original quantity and visible price.
        const sourceAmount = unitSaleAmount(source, item, draft, clientType);
        const sourceVisibleAmount = sourceAmount == null ? null : tryNumeric(inputAmountText(sourceAmount));
        const sourceUnitSaleNet = sourceVisibleAmount == null ? null : offerWorkspaceSaleAmountToNet(
          sourceVisibleAmount, clientType === 'B2B' ? 'NET' : 'GROSS', itemVatRate(item, draft.saleVatMode),
        );
        if (sourceUnitSaleNet != null && itemEdit.pricing.unitSaleNet === sourceUnitSaleNet) {
          const itemPricing = { ...itemEdit.pricing };
          delete itemPricing.unitSaleNet;
          if (Object.keys(itemPricing).length) itemEdit.pricing = itemPricing;
          else delete itemEdit.pricing;
        }
      }
      if (configurationQuantityAffectsEnergy(item) && !row.removed && quantity !== Number(effectiveItem.quantity)) energyChanged = true;
      if (configurationQuantityAffectsEnergy(item)
        && row.removed !== Boolean((effectiveItem as typeof effectiveItem & { workspaceRemoved?: boolean }).workspaceRemoved)) coreRemovalChanged = true;
      if (Object.keys(itemEdit).some(key => key !== 'itemId')) nextItems.push(itemEdit);
      return { ...item, quantity, workspaceRemoved: row.removed };
    });

    const savedAddedItems = new Map((edit.addedItems || []).map(item => [item.id, item]));
    const nextAddedItems = group.rows.filter(row => row.added && !row.removed).map(row => {
      const saved = savedAddedItems.get(row.id);
      const description = row.description.trim();
      const quantity = numeric(row.quantity);
      if (!description || quantity == null || quantity <= 0) throw new Error('Dodana pozycja wymaga opisu i ilości większej od zera.');
      const saleAmount = numeric(row.unitSaleAmount);
      if (saleAmount == null) throw new Error(`Uzupełnij cenę jednostkową dodanej pozycji „${description}”.`);
      const unitPurchaseNet = numeric(row.unitPurchaseNet);
      const purchaseVat = numeric(row.purchaseVatRate);
      const operatingCostNet = numeric(row.operatingCostNet);
      if (unitPurchaseNet == null || purchaseVat == null || operatingCostNet == null) {
        throw new Error(`Uzupełnij cenę zakupu, VAT zakupu i koszt realizacji dla pozycji „${description}”.`);
      }
      const saleVatPercent = draft.saleVatMode === 'MIXED' ? numeric(row.saleVatRate) : null;
      const saleVatValue = draft.saleVatMode === 'MIXED' ? (saleVatPercent == null ? null : saleVatPercent / 100) : fixedVat(draft.saleVatMode);
      if (draft.saleVatMode === 'MIXED' && saleVatValue == null) {
        throw new Error(`W trybie VAT według stawek pozycji wybierz VAT dla „${description}”.`);
      }
      const basis = clientType === 'B2B' ? 'NET' : 'GROSS';
      const priceUnchanged = Boolean(saved && !row.salePriceEdited);
      const quantityChanged = Boolean(saved && quantity !== Number(saved.quantity));
      const saleVatChanged = row.saleVatRate !== inputPercent(row.baselineSaleVatRate);
      const saleAmountNeedsRepricing = !priceUnchanged || (basis === 'GROSS' && saleVatChanged);
      const unitSaleNet = saleAmountNeedsRepricing || !saved ? offerWorkspaceSaleAmountToNet(saleAmount, basis, saleVatValue)
        : saved.pricing.unitSaleNet;
      const pinnedUnitPrice = priceUnchanged && quantityChanged && saved?.pricing.unitSaleNet == null
        ? offerWorkspaceSaleAmountToNet(saleAmount, basis, saleVatValue) : null;
      const pricing = saved ? { ...saved.pricing } : {
        unitPurchaseNet, purchaseVatRate: purchaseVat / 100, operatingCostNet,
        operatingCostBasis: row.operatingCostBasis,
      };
      if (!sameNumericText(row.unitPurchaseNet, row.baselineUnitPurchaseNet)) pricing.unitPurchaseNet = unitPurchaseNet;
      if (!sameNumericText(row.purchaseVatRate, row.baselinePurchaseVatRate == null ? null : row.baselinePurchaseVatRate * 100)) {
        pricing.purchaseVatRate = purchaseVat / 100;
      }
      if (!sameNumericText(row.operatingCostNet, row.baselineOperatingCostNet)) pricing.operatingCostNet = operatingCostNet;
      if (row.operatingCostBasis !== row.baselineOperatingCostBasis) pricing.operatingCostBasis = row.operatingCostBasis;
      if (saleAmountNeedsRepricing || !priceUnchanged) pricing.unitSaleNet = unitSaleNet;
      else if (pinnedUnitPrice != null) pricing.unitSaleNet = pinnedUnitPrice;
      if (saleVatValue !== null && row.saleVatRate !== '' && row.saleVatRate !== inputPercent(row.baselineSaleVatRate)) {
        pricing.saleVatRate = saleVatValue;
      }
      if (!saved && saleVatValue !== null) pricing.saleVatRate = saleVatValue;
      return {
        ...(saved || {}),
        id: row.id,
        description,
        quantity,
        role: row.role as NonNullable<OfferWorkspaceConfigurationEdit['addedItems']>[number]['role'],
        supplyMode: row.supplyMode as 'ONREVOLT_SUPPLIED' | 'SERVICE_ONLY',
        pricing: pricing as NonNullable<OfferWorkspaceConfigurationEdit['addedItems']>[number]['pricing'],
      };
    });
    edit.items = nextItems;
    edit.addedItems = nextAddedItems;
      const finalEnergyQuantityChanged = energyItems.some((item, index) => configurationQuantityAffectsEnergy(item)
        && !item.workspaceRemoved && Number(item.quantity) !== Number(source.items[index].quantity));
      if (!finalEnergyQuantityChanged) {
        if (energyChanged || coreRemovalChanged) delete edit.technical;
      } else if (energyChanged || coreRemovalChanged) {
      if (requireConfirmation && !group.technicalConfirmed) throw new Error('Potwierdź parametry energetyczne po zmianie liczby głównych urządzeń. Najlepiej wybrać inną gotową konfigurację.');
      if (group.technicalConfirmed) {
        edit.technical = {
          powerKw: numeric(group.powerKw) ?? (() => { throw new Error('Uzupełnij moc całego zestawu.'); })(),
          capacityKwh: source.kind === 'MAGAZYN' ? numeric(group.capacityKwh) ?? (() => { throw new Error('Uzupełnij pojemność całego magazynu.'); })() : null,
          quantityFingerprint: configurationEnergyQuantityFingerprint({ ...source, items: energyItems }),
        };
      }
    }
    removeEmptyItemEdits(edit);
    return edit.items?.length || edit.addedItems?.length || edit.technical ? [edit] : [];
  });
}

function hasRawChanges(groups: EditorGroup[], baseGroups: EditorGroup[]) {
  if (groups.length !== baseGroups.length) return true;
  return groups.some(group => {
    const baseline = baseGroups.find(candidate => candidate.templateId === group.templateId);
    if (!baseline || group.rows.length !== baseline.rows.length || group.powerKw !== baseline.powerKw || group.capacityKwh !== baseline.capacityKwh) return true;
    return group.rows.some(row => {
      const original = baseline.rows.find(candidate => candidate.id === row.id);
      if (!original || row.added !== original.added || row.removed !== original.removed
        || row.description !== original.description || !sameNumericText(row.quantity, original.baselineQuantity)
        || row.salePriceEdited || !sameDisplayedAmount(row.unitSaleAmount, original.baselineSaleAmount)) return true;
      if (row.added && (!sameNumericText(row.unitPurchaseNet, original.baselineUnitPurchaseNet)
        || !sameNumericText(row.purchaseVatRate, original.baselinePurchaseVatRate == null ? null : original.baselinePurchaseVatRate * 100)
        || !sameNumericText(row.operatingCostNet, original.baselineOperatingCostNet)
        || row.operatingCostBasis !== original.baselineOperatingCostBasis
        || row.saleVatRate !== inputPercent(original.baselineSaleVatRate))) return true;
      return group.technicalConfirmed !== baseline.technicalConfirmed;
    });
  });
}

export default function OfferWorkspaceItemEditor({ draft, templates, clientType, disabled, onApply, onPreview }: Props) {
  const baseGroups = useMemo(() => seedGroups(templates, draft, clientType), [templates, draft.selectedTemplateIds, draft.configurationEdits, draft.saleVatMode, clientType]);
  const effectiveTemplates = useMemo(() => applyOfferWorkspaceConfigurationEdits(templates, draft), [templates, draft.selectedTemplateIds, draft.configurationEdits]);
  const [groups, setGroups] = useState(baseGroups);
  const [error, setError] = useState('');
  const changedBackground = useColorModeValue('orange.50', 'orange.900');
  const addedBackground = useColorModeValue('green.50', 'green.900');
  const removedBackground = useColorModeValue('red.50', 'red.900');
  const line = useColorModeValue('gray.200', 'whiteAlpha.300');
  const muted = useColorModeValue('gray.600', 'gray.400');
  const previewState = useMemo(() => {
    try {
      const edits = parseOfferWorkspaceConfigurationEdits(buildOfferWorkspaceItemEdits(groups, templates, draft, clientType, false));
      const saved = parseOfferWorkspaceConfigurationEdits(draft.configurationEdits);
      const pending = JSON.stringify(edits) !== JSON.stringify(saved);
      const effective = applyOfferWorkspaceConfigurationEdits(templates, { ...draft, configurationEdits: edits });
      const pricing = priceOfferWorkspaceConfiguration(effective.filter(template => draft.selectedTemplateIds.includes(template.id)), draft.saleVatMode, clientType);
      return { pending, pricing };
    } catch {
      return { pending: hasRawChanges(groups, baseGroups), pricing: null };
    }
  }, [groups, templates, draft, clientType, baseGroups]);
  useEffect(() => { setGroups(baseGroups); setError(''); }, [baseGroups]);
  useEffect(() => { onPreview?.(previewState.pending ? previewState.pricing : null, previewState.pending); }, [onPreview, previewState]);
  useEffect(() => () => { onPreview?.(null, false); }, [onPreview]);

  const updateGroup = (id: string, update: (group: EditorGroup) => EditorGroup) => setGroups(current => current.map(group => group.templateId === id ? update(group) : group));
  function updateRow(templateId: string, id: string, key: keyof EditorRow, value: string | boolean) {
    updateGroup(templateId, group => {
      const currentRow = group.rows.find(row => row.id === id);
      const rows = group.rows.map(row => row.id === id ? {
        ...row,
        [key]: value,
        ...(key === 'unitSaleAmount' && typeof value === 'string'
          ? { salePriceEdited: !sameDisplayedAmount(value, row.baselineSaleAmount) } : {}),
      } : row);
      if (key === 'quantity' && currentRow?.core && typeof value === 'string') {
        const returnedToBaseline = tryNumeric(value) === currentRow.baselineQuantity;
        return {
          ...group,
          rows,
          powerKw: returnedToBaseline ? numberText(group.baselinePowerKw) : '',
          capacityKwh: returnedToBaseline ? numberText(group.baselineCapacityKwh) : '',
          technicalConfirmed: returnedToBaseline ? group.baselineTechnicalConfirmed : false,
        };
      }
      if (key === 'removed' && currentRow?.core && typeof value === 'boolean') {
        const returnedToBaseline = value === currentRow.baselineRemoved;
        return {
          ...group, rows,
          powerKw: returnedToBaseline ? numberText(group.baselinePowerKw) : '',
          capacityKwh: returnedToBaseline ? numberText(group.baselineCapacityKwh) : '',
          technicalConfirmed: returnedToBaseline ? group.baselineTechnicalConfirmed : false,
        };
      }
      return { ...group, rows, technicalConfirmed: key === 'removed' && currentRow?.core ? false : group.technicalConfirmed };
    });
    setError('');
  }
  function addRow(templateId: string) {
    updateGroup(templateId, group => ({ ...group, rows: [...group.rows, {
      id: `custom-${globalThis.crypto.randomUUID()}`, pricingItemId: '', description: '', quantity: '1', unitSaleAmount: '',
      baselineDescription: '', baselineQuantity: 1, baselineSaleAmount: null, baselineUnitSaleNet: null, salePriceEdited: false, baselineRemoved: false,
      added: true, persistedAdded: false, removed: false, role: 'ACCESSORY', supplyMode: 'ONREVOLT_SUPPLIED', model: '', core: false,
      unitPurchaseNet: '', purchaseVatRate: '', operatingCostNet: '', operatingCostBasis: 'PER_UNIT',
      saleVatRate: inputPercent(fixedVat(draft.saleVatMode)), marginRate: null, unitSaleNet: null,
      baselineUnitPurchaseNet: null, baselinePurchaseVatRate: null, baselineOperatingCostNet: null,
      baselineOperatingCostBasis: 'PER_UNIT', baselineSaleVatRate: fixedVat(draft.saleVatMode), baselineMarginRate: null,
    }] }));
    setError('');
  }
  function apply() {
    if (disabled) return;
    try {
      const edits = parseOfferWorkspaceConfigurationEdits(buildOfferWorkspaceItemEdits(groups, templates, draft, clientType));
      validateOfferWorkspaceConfigurationEdits(templates, { ...draft, configurationEdits: edits });
      onApply(edits);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie można zastosować zmian pozycji.'); }
  }
  const money = (value: number) => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value);
  const priceBasis = clientType === 'B2B' ? 'netto' : 'brutto';
  const disabledGrossVat = clientType !== 'B2B';

  return <Box aria-label="Edytor wybranej konfiguracji" mt="10px">
    <Flex gap="8px" mb="10px" wrap="wrap" fontSize="xs"><Badge colorScheme="orange">Zmieniona</Badge><Badge colorScheme="green">Dodana</Badge><Badge colorScheme="red">Usunięta</Badge></Flex>
    {draft.saleVatMode === 'REVIEW' ? <Alert status="warning" mb="10px"><AlertIcon /><Text fontSize="sm">Potwierdź VAT oferty, aby wyliczyć ceny brutto. Cena jednostkowa netto dla B2B pozostaje niezależna od VAT.</Text></Alert> : null}
    {error ? <Alert status="error" mb="10px" role="alert"><AlertIcon />{error}</Alert> : null}
    {groups.map(group => {
      const template = templates.find(item => item.id === group.templateId)!;
      const effectiveTemplate = effectiveTemplates.find(item => item.id === group.templateId);
      const coreChanged = group.rows.some(row => row.core && (row.removed || tryNumeric(row.quantity) !== Number(template.items.find(item => item.id === row.id)?.quantity)));
      const activeCoreQuantityChanged = group.rows.some(row => row.core && !row.removed
        && tryNumeric(row.quantity) !== Number(template.items.find(item => item.id === row.id)?.quantity))
        && group.rows.some(row => row.core && (row.removed !== row.baselineRemoved
          || (!row.removed && tryNumeric(row.quantity) !== row.baselineQuantity)));
      return <Box key={group.templateId} mb="18px">
        <Text as="h3" fontWeight="700" mb="6px">{template.name}</Text>
        {coreChanged ? <Alert status="warning" alignItems="flex-start" mb="10px"><AlertIcon /><Box>
          <Text fontWeight="700">Zmieniono liczbę głównych urządzeń. Najlepiej wybrać inną gotową konfigurację.</Text>
          <Text fontSize="sm" mt="3px">Model głównego urządzenia pozostaje bez zmian. Zmiana ilości wymaga potwierdzenia nowych parametrów technicznych.</Text>
        </Box></Alert> : null}
        <TableContainer maxW="100%">
          <Table size="sm" variant="simple" minW="760px" sx={{ th: { fontSize: '10px', color: muted, fontWeight: 500, borderColor: line, whiteSpace: 'normal' }, td: { fontSize: '12px', py: '8px', borderColor: line } }}>
            <Thead><Tr><Th w="34px">Nr</Th><Th minW="180px">Pozycja</Th><Th minW="90px">Model</Th><Th isNumeric w="82px">Ilość</Th><Th isNumeric w="140px">Cena jednostkowa {priceBasis} [zł]</Th><Th isNumeric w="145px">Wartość pozycji {priceBasis} [zł]</Th><Th w="74px" /></Tr></Thead>
            <Tbody>{group.rows.map((row, index) => {
              const original = template.items.find(item => item.id === row.id);
              const effectiveItem = effectiveTemplate?.items.find(item => item.id === row.pricingItemId);
              const changed = changedAgainstSaved(row, original, effectiveItem, draft, clientType, template);
              const background = row.removed ? removedBackground : row.added ? addedBackground : changed ? changedBackground : undefined;
              const previewLine = previewState.pricing?.lines.find(item => item.templateId === group.templateId && item.itemId === (row.pricingItemId || `workspace-add-${row.id}`));
              const vatUnavailable = disabledGrossVat && itemVatRate(original || ({ saleVatRate: Number(row.saleVatRate) / 100 } as WorkspaceTemplate['items'][number]), draft.saleVatMode) == null;
              const excludedFromSale = ['CLIENT_OWNED_USED', 'CLIENT_SUPPLIED_NEW', 'NOT_INCLUDED'].includes(row.supplyMode);
              return <React.Fragment key={row.id}>
                <Tr bg={background} data-testid="editable-configuration-row" data-change={row.removed ? 'removed' : row.added ? 'added' : changed ? 'changed' : 'original'}>
                  <Td>{index + 1}</Td>
                  <Td>
                    {row.removed ? <Text textDecoration="line-through">{row.description || 'Pozycja dodatkowa'}</Text>
                      : <Input size="sm" value={row.description} maxLength={10000} aria-label={`Opis pozycji ${index + 1} — ${template.name}`} onChange={event => updateRow(group.templateId, row.id, 'description', event.target.value)} isDisabled={disabled} />}
                    {row.added ? <Text mt="3px" color="green.700" fontSize="10px" fontWeight="600">Dodana w tej ofercie</Text>
                      : row.removed ? <Text mt="3px" color="red.700" fontSize="10px" fontWeight="600">Usunięta z wyceny</Text>
                        : changed ? <Text mt="3px" color="orange.700" fontSize="10px" fontWeight="600">Zmieniona w tej ofercie</Text> : null}
                  </Td>
                  <Td whiteSpace="normal">{row.model || '—'}{row.core ? <Text color={muted} fontSize="10px">Model główny · tylko do odczytu</Text> : row.added ? <Text color={muted} fontSize="10px">Nowa pozycja</Text> : null}</Td>
                  <Td isNumeric><Input size="sm" w="76px" textAlign="right" inputMode="decimal" value={row.quantity} aria-label={`Ilość pozycji ${index + 1} — ${template.name}`} onChange={event => updateRow(group.templateId, row.id, 'quantity', event.target.value)} isDisabled={disabled || row.removed} /></Td>
                  <Td isNumeric>
                    {excludedFromSale ? <Text fontSize="11px" color={muted}>Poza wyceną</Text> : <Input size="sm" w="132px" textAlign="right" inputMode="decimal" value={row.unitSaleAmount} aria-label={`Cena jednostkowa ${priceBasis} pozycji ${index + 1} — ${template.name}`} onChange={event => updateRow(group.templateId, row.id, 'unitSaleAmount', event.target.value)} isDisabled={disabled || row.removed || vatUnavailable} />}
                    {!excludedFromSale && vatUnavailable ? <Text fontSize="9px" color={muted}>Brak jawnej stawki VAT pozycji</Text> : null}
                  </Td>
                  <Td isNumeric color={previewLine?.missingPriceReason ? 'orange.700' : undefined}>
                    {row.removed || excludedFromSale ? 'Poza wyceną' : previewLine?.saleAmount == null ? '—' : money(previewLine.saleAmount)}
                  </Td>
                  <Td><Button size="xs" variant="outline" colorScheme={row.removed ? 'gray' : 'red'} isDisabled={disabled}
                    onClick={() => row.added && !row.persistedAdded && !row.removed
                      ? updateGroup(group.templateId, current => ({ ...current, rows: current.rows.filter(item => item.id !== row.id) }))
                      : updateRow(group.templateId, row.id, 'removed', !row.removed)}>{row.removed ? 'Przywróć' : 'Usuń'}</Button></Td>
                </Tr>
                {row.added && !row.removed ? <Tr bg={background}>
                  <Td /><Td colSpan={6}>
                    <Text fontSize="10px" color={muted} mb="6px">Koszty wymagane dla nowej pozycji · bez domyślnych wartości</Text>
                    <Grid templateColumns={{ base: '1fr 1fr', lg: 'repeat(5, minmax(110px, 1fr))' }} gap="8px" alignItems="end">
                      <FormControl isDisabled={disabled}><FormLabel fontSize="9px" mb="3px">Cena zakupu netto / szt. [zł]</FormLabel><Input size="xs" inputMode="decimal" value={row.unitPurchaseNet} onChange={event => updateRow(group.templateId, row.id, 'unitPurchaseNet', event.target.value)} /></FormControl>
                      <FormControl isDisabled={disabled}><FormLabel fontSize="9px" mb="3px">VAT zakupu [%]</FormLabel><Input size="xs" inputMode="decimal" value={row.purchaseVatRate} onChange={event => updateRow(group.templateId, row.id, 'purchaseVatRate', event.target.value)} /></FormControl>
                      <FormControl isDisabled={disabled}><FormLabel fontSize="9px" mb="3px">Koszt realizacji netto [zł]</FormLabel><Input size="xs" inputMode="decimal" value={row.operatingCostNet} onChange={event => updateRow(group.templateId, row.id, 'operatingCostNet', event.target.value)} /></FormControl>
                      <FormControl isDisabled={disabled}><FormLabel fontSize="9px" mb="3px">Naliczanie kosztu</FormLabel><Select size="xs" value={row.operatingCostBasis} onChange={event => updateRow(group.templateId, row.id, 'operatingCostBasis', event.target.value)}><option value="PER_UNIT">Za sztukę</option><option value="PER_LINE">Za pozycję</option></Select></FormControl>
                      {draft.saleVatMode === 'MIXED' ? <FormControl isDisabled={disabled}><FormLabel fontSize="9px" mb="3px">VAT sprzedaży [%] · wymagany</FormLabel><Select size="xs" value={row.saleVatRate} onChange={event => updateRow(group.templateId, row.id, 'saleVatRate', event.target.value)}><option value="">Wybierz VAT</option><option value="8">8%</option><option value="23">23%</option></Select></FormControl>
                        : <Text fontSize="10px" color={muted}>VAT sprzedaży: {fixedVat(draft.saleVatMode) == null ? 'do weryfikacji' : `${fixedVat(draft.saleVatMode)! * 100}% z oferty`}</Text>}
                      <FormControl isDisabled={disabled}><FormLabel fontSize="9px" mb="3px">Rodzaj pozycji</FormLabel><Select size="xs" value={row.role} onChange={event => updateRow(group.templateId, row.id, 'role', event.target.value)}><option value="ACCESSORY">Osprzęt</option><option value="PROTECTION">Zabezpieczenia</option><option value="CABLING">Okablowanie</option><option value="MOUNTING">Konstrukcja</option><option value="LABOR">Montaż / usługa</option><option value="DESIGN">Projekt</option><option value="OTHER">Inna pozycja</option></Select></FormControl>
                      <FormControl isDisabled={disabled}><FormLabel fontSize="9px" mb="3px">Dostawa</FormLabel><Select size="xs" value={row.supplyMode} onChange={event => updateRow(group.templateId, row.id, 'supplyMode', event.target.value)}><option value="ONREVOLT_SUPPLIED">Dostarcza onRevolt</option><option value="SERVICE_ONLY">Usługa</option></Select></FormControl>
                    </Grid>
                  </Td>
                </Tr> : null}
              </React.Fragment>;
            })}</Tbody>
          </Table>
        </TableContainer>
        {activeCoreQuantityChanged ? <Box border="1px solid" borderColor="orange.300" borderRadius="8px" p="10px" mt="8px">
          <Grid templateColumns={{ base: '1fr', sm: template.kind === 'MAGAZYN' ? '1fr 1fr' : '1fr' }} gap="10px">
            <FormControl isDisabled={disabled}><FormLabel fontSize="10px">{template.kind === 'MAGAZYN' ? 'Moc ładowania i rozładowania całego zestawu [kW]' : 'Moc PV po zmianie [kWp]'}</FormLabel><Input size="sm" inputMode="decimal" value={group.powerKw} onChange={event => updateGroup(group.templateId, current => ({ ...current, powerKw: event.target.value, technicalConfirmed: false }))} /></FormControl>
            {template.kind === 'MAGAZYN' ? <FormControl isDisabled={disabled}><FormLabel fontSize="10px">Pojemność całego magazynu po zmianie [kWh]</FormLabel><Input size="sm" inputMode="decimal" value={group.capacityKwh} onChange={event => updateGroup(group.templateId, current => ({ ...current, capacityKwh: event.target.value, technicalConfirmed: false }))} /></FormControl> : null}
          </Grid>
          <Checkbox mt="8px" fontSize="sm" isDisabled={disabled} isChecked={group.technicalConfirmed} onChange={event => updateGroup(group.templateId, current => ({ ...current, technicalConfirmed: event.target.checked }))}>Potwierdzam parametry techniczne dla zmienionej ilości głównych urządzeń</Checkbox>
        </Box> : null}
        <Button mt="8px" size="sm" variant="outline" isDisabled={disabled} onClick={() => addRow(group.templateId)}>Dodaj pozycję dodatkową</Button>
      </Box>;
    })}
    {previewState.pending ? <Box mt="12px" p="10px" bg="purple.50" borderRadius="8px" role="status">
      <Flex justify="space-between" gap="12px" align="center" wrap="wrap">
        <Box><Text fontSize="sm" fontWeight="700">Zmiany w tabeli są jeszcze robocze.</Text><Text fontSize="10px">Zastosuj je albo anuluj przed zmianą etapu, szablonu, obliczeniem lub zapisem oferty.</Text></Box>
        <Flex gap="8px"><Button size="sm" variant="outline" isDisabled={disabled} onClick={() => { setGroups(baseGroups); setError(''); }}>Anuluj</Button><Button size="sm" colorScheme="purple" isDisabled={disabled} onClick={apply}>Zastosuj zmiany</Button></Flex>
      </Flex>
      <Text mt="7px" fontSize="11px">Podgląd sum: {previewState.pricing?.totals
        ? `${money(previewState.pricing.totals.saleNet)} netto · ${money(previewState.pricing.totals.saleGross)} brutto`
        : 'Brak pełnej wyceny dla bieżących zmian'}</Text>
    </Box> : null}
  </Box>;
}
