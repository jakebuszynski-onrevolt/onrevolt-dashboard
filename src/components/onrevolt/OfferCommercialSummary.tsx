'use client';

import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Grid,
  Text,
} from '@chakra-ui/react';
import { useMemo } from 'react';
import {
  applyOfferWorkspaceConfigurationEdits,
} from 'lib/onrevolt/offer-workspace-configuration-edits';
import {
  automaticOfferCommercialBreakdown,
  calculateOfferCommercialPricing,
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

const inverterCategories = new Set(['FALOWNIK', 'INWERTER', 'INVERTER']);
const emsCategories = new Set(['SYSTEM_MONITORUJACY', 'EMS']);

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

function formatMoney(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? '—'
    : `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} zł`;
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
      error: cause instanceof Error ? cause.message : 'Nie można przygotować podziału pozycji oferty.',
    };
  }
}

function selectedCommercialTemplates(workspace: WorkspaceData, draft: OfferWorkspaceDraft) {
  return applyOfferWorkspaceConfigurationEdits(workspace.templates, draft)
    .filter((template) => draft.selectedTemplateIds.includes(template.id));
}

export default function OfferCommercialSummary({ workspace, draft }: Props) {
  const state = useMemo(() => {
    try {
      const templates = selectedCommercialTemplates(workspace, draft);
      if (!templates.length) return { result: null, error: '' };
      const pricing = priceOfferWorkspaceConfiguration(templates, draft.saleVatMode, workspace.clientType);
      return commercialResult(pricing, templates, draft.commercialPricing ?? automaticOfferCommercialBreakdown());
    } catch (cause) {
      return { result: null, error: cause instanceof Error ? cause.message : 'Nie można przygotować podziału ceny.' };
    }
  }, [workspace.templates, workspace.clientType, draft]);
  return <Box aria-label="Kosztorys w ofercie" border="1px solid" borderColor="purple.200" borderRadius="14px" bg="purple.50" p={{ base: '14px', md: '18px' }} mb="18px">
    <Text as="h3" fontSize="15px" fontWeight="700">Kosztorys w ofercie</Text>
    <Text mt="3px" fontSize="11px" color="gray.600">4 pozycje bez nowej PV, 5 z modułami PV. Podział pozostaje po zmianie rekomendacji; szczegóły są zachowane w kosztorysie.</Text>
    {state.error ? <Alert status="warning" mt="12px" borderRadius="8px"><AlertIcon /><AlertDescription fontSize="11px">{state.error}</AlertDescription></Alert> : null}
    {state.result ? <>
      <Grid templateColumns={{ base: '1fr 1fr', xl: `repeat(${state.result.rows.length},minmax(0,1fr))` }} gap="8px" mt="12px">
        {state.result.rows.map(row => <Box key={row.group} bg="white" borderRadius="9px" p="10px" minW="0">
          <Text fontSize="9px" color="gray.600">{row.label}</Text>
          <Text mt="4px" fontSize="13px" fontWeight="700">{formatMoney(workspace.clientType === 'B2B' ? row.amountNet : row.amountGross)}</Text>
          <Text fontSize="9px" color="gray.600">{workspace.clientType === 'B2B' ? 'netto' : `brutto · netto ${formatMoney(row.amountNet)}`}</Text>
        </Box>)}
      </Grid>
      <Text mt="10px" fontSize="11px">Falownik i moduły PV są wycenione po kosztach zakupu. Pozostała część ceny jest ujęta w pozycji magazynu. Łączna cena oferty pozostaje bez zmian.</Text>
      {state.result.transferredPvSaleGross > 0 ? <Text mt="6px" fontSize="11px">Z kosztorysu PV do pozycji magazynu przeniesiono {formatMoney(state.result.transferredPvSaleGross)} brutto. Ta kwota nie zwiększa podstawy dotacji na magazyn.</Text> : null}
    </> : null}
  </Box>;
}
