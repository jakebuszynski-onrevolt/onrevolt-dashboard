'use client';

import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  Checkbox,
  Flex,
  Grid,
  Text,
} from '@chakra-ui/react';
import { useMemo, useState } from 'react';
import {
  applyOfferWorkspaceConfigurationEdits,
} from 'lib/onrevolt/offer-workspace-configuration-edits';
import {
  calculateOfferCommercialPricing,
  parseOfferWorkspaceCommercialBreakdown,
  type OfferWorkspaceCommercialBreakdown,
  type OfferWorkspaceCommercialBreakdownAllocation,
  type OfferWorkspaceCommercialGroup,
  type OfferWorkspaceCommercialPricingResult,
} from 'lib/onrevolt/offer-workspace-commercial-pricing';
import type { OfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import {
  priceOfferWorkspaceConfiguration,
  type OfferWorkspacePricingLine,
  type OfferWorkspacePricingResult,
  type OfferWorkspacePricingTemplate,
} from 'lib/onrevolt/offer-workspace-pricing';
import type { WorkspaceData } from './OfferWorkspacePanel';

type Props = {
  workspace: WorkspaceData;
  draft: OfferWorkspaceDraft;
  disabled: boolean;
  itemsEditable: boolean;
  onChange: (update: (draft: OfferWorkspaceDraft) => OfferWorkspaceDraft) => void;
};

type CommercialTemplate = OfferWorkspacePricingTemplate;

const groupLabels: Record<OfferWorkspaceCommercialGroup, string> = {
  STORAGE_INSTALLATION: 'Magazyn energii wraz z montażem',
  INVERTER: 'Falownik',
  EMS: 'EMS',
  TRANSPORT: 'Transport',
};

const inverterCategories = new Set(['FALOWNIK', 'INWERTER', 'INVERTER']);
const emsCategories = new Set(['SYSTEM_MONITORUJACY', 'EMS']);
const batteryCategories = new Set(['MAGAZYN_ENERGII', 'BATTERY']);

function normalized(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? '';
}

/** Mirrors the explicit category/role rules used by the commercial pricing validator. */
export function offerCommercialDefaultGroup(
  line: Pick<OfferWorkspacePricingLine, 'role'>,
  item: { product?: { category?: string | null } | null },
): OfferWorkspaceCommercialGroup {
  const category = normalized(item.product?.category);
  const role = normalized(line.role);
  if (inverterCategories.has(category)) return 'INVERTER';
  if (emsCategories.has(category) || role === 'MONITORING') return 'EMS';
  if (role === 'LOGISTICS') return 'TRANSPORT';
  return 'STORAGE_INSTALLATION';
}

export function offerCommercialInitialAllocations(
  pricing: Pick<OfferWorkspacePricingResult, 'lines'>,
  templates: CommercialTemplate[],
): OfferWorkspaceCommercialBreakdownAllocation[] {
  const items = new Map(templates.flatMap((template) => template.items.map((item) => [
    `${template.id}\u0000${item.id}`,
    item,
  ] as const)));
  return pricing.lines.filter((line) => line.includedInSale).map((line) => {
    const item = items.get(`${line.templateId}\u0000${line.itemId}`);
    if (!item) throw new Error(`Brak źródłowej pozycji ${line.templateId}/${line.itemId}.`);
    return {
      templateId: line.templateId,
      itemId: line.itemId,
      group: offerCommercialDefaultGroup(line, item),
    };
  });
}

function requiresStorageScopeConfirmation(
  line: Pick<OfferWorkspacePricingLine, 'role'>,
  item: { product?: { category?: string | null } | null },
) {
  const category = normalized(item.product?.category);
  return offerCommercialDefaultGroup(line, item) === 'STORAGE_INSTALLATION'
    && !batteryCategories.has(category);
}

function formatMoney(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? '—'
    : `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} zł`;
}

function getLineLabel(line: OfferWorkspacePricingLine) {
  return line.description || line.productName || line.itemId;
}

function commercialResult(
  pricing: OfferWorkspacePricingResult | null,
  templates: CommercialTemplate[],
  breakdown: OfferWorkspaceCommercialBreakdown | null,
): { result: OfferWorkspaceCommercialPricingResult | null; error: string } {
  if (!breakdown) return { result: null, error: '' };
  if (!pricing) return { result: null, error: 'Nie można odczytać aktualnej wyceny konfiguracji.' };
  try {
    return { result: calculateOfferCommercialPricing(pricing, templates, breakdown), error: '' };
  } catch (cause) {
    return {
      result: null,
      error: cause instanceof Error ? cause.message : 'Nie można przygotować czterech pozycji oferty.',
    };
  }
}

function selectedCommercialTemplates(workspace: WorkspaceData, draft: OfferWorkspaceDraft) {
  return applyOfferWorkspaceConfigurationEdits(workspace.templates, draft)
    .filter((template) => draft.selectedTemplateIds.includes(template.id));
}

function assignedBreakdown(allocations: OfferWorkspaceCommercialBreakdownAllocation[]): OfferWorkspaceCommercialBreakdown {
  return {
    schemaVersion: 1,
    batteryInstallationScopeConfirmed: true,
    allocations,
  };
}

function pricingError(result: OfferWorkspacePricingResult | null) {
  if (!result) return 'Nie można odczytać wyceny.';
  if (result.calculationError) return result.calculationError;
  if (result.missingRequiredData.length) return result.missingRequiredData.join(' ');
  if (result.missingOptionalData.length) return result.missingOptionalData.join(' ');
  return '';
}

export default function OfferCommercialSummary({ workspace, draft, disabled, itemsEditable, onChange }: Props) {
  const canEdit = !disabled && itemsEditable && workspace.canEditConfigurationItems === true;
  const [preparing, setPreparing] = useState(false);
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [applyError, setApplyError] = useState('');

  const pricingState = useMemo(() => {
    try {
      const templates = selectedCommercialTemplates(workspace, draft);
      const eligible = workspace.clientType === 'B2C'
        && draft.saleVatMode === 'REDUCED_8'
        && templates.length === 1
        && templates[0].kind === 'MAGAZYN';
      const pricing = eligible
        ? priceOfferWorkspaceConfiguration(templates, 'REDUCED_8', workspace.clientType)
        : null;
      return { templates, eligible, pricing, error: '' };
    } catch (cause) {
      return {
        templates: [] as CommercialTemplate[],
        eligible: false,
        pricing: null,
        error: cause instanceof Error ? cause.message : 'Nie można odczytać wybranej konfiguracji.',
      };
    }
  }, [workspace.clientType, workspace.templates, draft.selectedTemplateIds, draft.configurationEdits, draft.saleVatMode]);

  const storedBreakdown = useMemo(() => {
    try {
      return parseOfferWorkspaceCommercialBreakdown(draft.commercialPricing);
    } catch (cause) {
      return null;
    }
  }, [draft.commercialPricing]);

  const storedResult = useMemo(() => commercialResult(
    pricingState.pricing,
    pricingState.templates,
    storedBreakdown,
  ), [pricingState.pricing, pricingState.templates, storedBreakdown]);

  const initialAllocations = useMemo(() => {
    if (!pricingState.pricing) return [];
    try {
      return offerCommercialInitialAllocations(pricingState.pricing, pricingState.templates);
    } catch {
      return [];
    }
  }, [pricingState.pricing, pricingState.templates]);

  const previewBreakdown = preparing
    ? assignedBreakdown(initialAllocations)
    : storedBreakdown;
  const preview = useMemo(() => commercialResult(
    pricingState.pricing,
    pricingState.templates,
    previewBreakdown,
  ), [pricingState.pricing, pricingState.templates, previewBreakdown]);

  const allocationByReference = new Map((previewBreakdown?.allocations ?? []).map((allocation) => [
    `${allocation.templateId}\u0000${allocation.itemId}`,
    allocation.group,
  ]));
  const initialStorageRefs = useMemo(() => {
    const byReference = new Map<string, CommercialTemplate['items'][number]>(pricingState.templates.flatMap((template) => template.items.map((item) => [
      `${template.id}\u0000${item.id}`,
      item,
    ] as [string, CommercialTemplate['items'][number]])));
    const linesByReference = new Map<string, OfferWorkspacePricingLine>((pricingState.pricing?.lines ?? []).map((line) => [
      `${line.templateId}\u0000${line.itemId}`,
      line,
    ] as [string, OfferWorkspacePricingLine]));
    return new Set(initialAllocations.filter((allocation) => {
      const key = `${allocation.templateId}\u0000${allocation.itemId}`;
      const item = byReference.get(key);
      const line = linesByReference.get(key);
      return Boolean(item && line && requiresStorageScopeConfirmation(line, item));
    }).map((allocation) => `${allocation.templateId}\u0000${allocation.itemId}`));
  }, [initialAllocations, pricingState.templates, pricingState.pricing]);
  const needsStorageConfirmation = preparing && initialStorageRefs.size > 0;
  const displayedPricingError = pricingState.error || pricingError(pricingState.pricing);
  const staleStoredError = Boolean(draft.commercialPricing && !storedBreakdown)
    || Boolean(storedBreakdown && !storedResult.result);
  const showBuild = pricingState.eligible && (!storedResult.result || preparing);

  function beginPreparation() {
    setApplyError('');
    setScopeConfirmed(false);
    setPreparing(true);
  }

  function applyCommercialBreakdown() {
    setApplyError('');
    if (!canEdit || !pricingState.eligible || !pricingState.pricing) return;
    if (displayedPricingError) {
      setApplyError(displayedPricingError);
      return;
    }
    if (needsStorageConfirmation && !scopeConfirmed) return;
    try {
      const breakdown = parseOfferWorkspaceCommercialBreakdown(assignedBreakdown(initialAllocations));
      if (!breakdown) throw new Error('Brak przypisań pozycji do czterech grup.');
      const result = calculateOfferCommercialPricing(pricingState.pricing, pricingState.templates, breakdown);
      if (!result) throw new Error('Nie można przygotować czterech pozycji oferty.');
      onChange((current) => ({ ...current, commercialPricing: breakdown }));
      setPreparing(false);
      setScopeConfirmed(false);
    } catch (cause) {
      setApplyError(cause instanceof Error ? cause.message : 'Nie można zastosować podziału ceny w ofercie.');
    }
  }

  function returnToDetailedPricing() {
    onChange((current) => {
      const { commercialPricing: _commercialPricing, ...rest } = current;
      return rest;
    });
    setPreparing(false);
    setScopeConfirmed(false);
    setApplyError('');
  }

  const groupRows = preview.result?.rows ?? [];
  const lineRows = pricingState.pricing?.lines.filter((line) => line.includedInSale) ?? [];

  return <Box aria-label="Kosztorys w ofercie" border="1px solid" borderColor="purple.200" borderRadius="14px" bg="purple.50" p={{ base: '14px', md: '18px' }} mb="18px">
    <Flex justify="space-between" align={{ base: 'start', sm: 'center' }} gap="12px" wrap="wrap">
      <Box>
        <Text as="h3" fontSize="15px" fontWeight="700">Kosztorys w ofercie</Text>
        <Text mt="3px" fontSize="11px" color="gray.600">Szczegółowy kosztorys pozostaje bez zmian. Podział tworzy cztery pozycje dokumentu.</Text>
      </Box>
      {showBuild ? <Button size="sm" colorScheme="purple" variant="outline" isDisabled={!canEdit || !pricingState.pricing} onClick={beginPreparation}>
        Przygotuj cztery pozycje
      </Button> : null}
      {!preparing && storedResult.result ? <Button size="sm" variant="outline" colorScheme="purple" isDisabled={!canEdit} onClick={beginPreparation}>
        Przygotuj cztery pozycje ponownie
      </Button> : null}
      {draft.commercialPricing ? <Button size="sm" variant="ghost" isDisabled={!canEdit} onClick={returnToDetailedPricing}>
        Wróć do szczegółowego kosztorysu
      </Button> : null}
    </Flex>

    {!pricingState.eligible ? <Text mt="10px" fontSize="11px" color="gray.600">
      Podział jest dostępny dla jednego szablonu MAGAZYN, klienta B2C i stawki VAT 8%.
    </Text> : null}
    {pricingState.error ? <Alert status="error" mt="12px" borderRadius="8px"><AlertIcon /><AlertDescription fontSize="11px">{pricingState.error}</AlertDescription></Alert> : null}
    {staleStoredError && !preparing ? <Alert status="warning" mt="12px" borderRadius="8px" alignItems="flex-start">
      <AlertIcon mt="2px" /><AlertDescription fontSize="11px">
        Zapisany podział nie odpowiada aktualnym pozycjom kosztorysu. Przygotuj cztery pozycje ponownie.
        {storedResult.error ? <Text mt="4px">{storedResult.error}</Text> : null}
      </AlertDescription>
    </Alert> : null}
    {preparing ? <Box mt="14px">
      {displayedPricingError ? <Alert status="error" borderRadius="8px" mb="12px"><AlertIcon /><AlertDescription fontSize="11px">{displayedPricingError}</AlertDescription></Alert> : null}
      <Grid templateColumns="minmax(0,1fr) 170px 110px" gap="8px" px="8px" py="7px" borderBottom="1px solid" borderColor="purple.200" color="gray.600" fontSize="10px" fontWeight="700">
        <Text>Pozycja</Text><Text>Grupa w ofercie</Text><Text textAlign="right">Cena brutto</Text>
      </Grid>
      {lineRows.map((line) => {
        const key = `${line.templateId}\u0000${line.itemId}`;
        const group = allocationByReference.get(key);
        return <Grid key={key} templateColumns="minmax(0,1fr) 170px 110px" gap="8px" alignItems="center" px="8px" py="8px" borderBottom="1px solid" borderColor="purple.100">
          <Box minW="0"><Text fontSize="11px" noOfLines={2}>{getLineLabel(line)}</Text><Text fontSize="9px" color="gray.600">{line.templateName}</Text></Box>
          <Text fontSize="10px">{group ? groupLabels[group] : 'Brak przypisania'}</Text>
          <Text textAlign="right" fontSize="10px">{formatMoney(line.saleAmount)}</Text>
        </Grid>;
      })}
      {needsStorageConfirmation ? <Checkbox mt="12px" size="sm" isChecked={scopeConfirmed} isDisabled={!canEdit} onChange={(event) => setScopeConfirmed(event.target.checked)}>
        Pozostałe pozycje dotyczą zakupu i montażu magazynu
      </Checkbox> : null}
      {applyError ? <Alert status="error" mt="12px" borderRadius="8px"><AlertIcon /><AlertDescription fontSize="11px">{applyError}</AlertDescription></Alert> : null}
      {preview.error ? <Alert status="warning" mt="12px" borderRadius="8px"><AlertIcon /><AlertDescription fontSize="11px">{preview.error}</AlertDescription></Alert> : null}
      {groupRows.length ? <Grid templateColumns={{ base: '1fr 1fr', xl: 'repeat(4,minmax(0,1fr))' }} gap="8px" mt="12px">
        {groupRows.map((row) => <Box key={row.group} bg="white" borderRadius="9px" p="10px" minW="0">
          <Text fontSize="9px" color="gray.600">{row.label}</Text>
          <Text mt="4px" fontSize="13px" fontWeight="700">{formatMoney(row.amountGross)}</Text>
          <Text fontSize="9px" color="gray.600">netto {formatMoney(row.amountNet)}</Text>
        </Box>)}
      </Grid> : null}
      <Flex justify="flex-end" gap="8px" wrap="wrap" mt="12px">
        <Button size="sm" variant="ghost" isDisabled={!canEdit} onClick={() => { setPreparing(false); setScopeConfirmed(false); setApplyError(''); }}>Anuluj</Button>
        <Button size="sm" colorScheme="purple" isDisabled={!canEdit || !pricingState.pricing || Boolean(displayedPricingError) || (needsStorageConfirmation && !scopeConfirmed)} onClick={applyCommercialBreakdown}>
          Zastosuj podział w ofercie
        </Button>
      </Flex>
    </Box> : null}

    {!preparing && storedResult.result ? <Box mt="12px">
      <Grid templateColumns={{ base: '1fr 1fr', xl: 'repeat(4,minmax(0,1fr))' }} gap="8px">
        {storedResult.result.rows.map((row) => <Box key={row.group} bg="white" borderRadius="9px" p="10px" minW="0">
          <Text fontSize="9px" color="gray.600">{row.label}</Text>
          <Text mt="4px" fontSize="13px" fontWeight="700">{formatMoney(row.amountGross)}</Text>
          <Text fontSize="9px" color="gray.600">netto {formatMoney(row.amountNet)}</Text>
        </Box>)}
      </Grid>
      {storedResult.result.transferredInverterSaleGross > 0 ? <Text mt="10px" fontSize="11px">
        Wartość przesunięta z falownika do magazynu energii: {formatMoney(storedResult.result.transferredInverterSaleGross)}. Suma oferty pozostaje bez zmian: {formatMoney(storedResult.result.totalGross)} brutto.
      </Text> : null}
    </Box> : null}
    {draft.commercialPricing && !preparing && storedBreakdown && storedResult.error ? <Alert status="warning" mt="12px" borderRadius="8px"><AlertIcon /><AlertDescription fontSize="11px">{storedResult.error}</AlertDescription></Alert> : null}
  </Box>;
}
