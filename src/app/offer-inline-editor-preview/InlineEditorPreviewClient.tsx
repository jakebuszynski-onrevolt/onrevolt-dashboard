'use client';

import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { useCallback, useState } from 'react';
import OfferWorkspaceConfiguration from 'components/onrevolt/OfferWorkspaceConfiguration';
import type { WorkspaceTemplate } from 'components/onrevolt/OfferWorkspacePanel';
import type { OfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import { applyOfferWorkspaceConfigurationEdits } from 'lib/onrevolt/offer-workspace-configuration-edits';
import { priceOfferWorkspaceConfiguration, type OfferWorkspacePricingResult } from 'lib/onrevolt/offer-workspace-pricing';

export default function InlineEditorPreviewClient({ templates, initialDraft }: {
  templates: WorkspaceTemplate[]; initialDraft: OfferWorkspaceDraft;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [clientType, setClientType] = useState('B2C');
  const [preview, setPreview] = useState<{ pricing: OfferWorkspacePricingResult | null; active: boolean }>({ pricing: null, active: false });
  const [generation, setGeneration] = useState(0);
  const onPreview = useCallback((pricing: OfferWorkspacePricingResult | null, active: boolean) => setPreview({ pricing, active }), []);
  const effective = applyOfferWorkspaceConfigurationEdits(templates, draft);
  const pricing = preview.active ? preview.pricing : priceOfferWorkspaceConfiguration(effective.filter(t => draft.selectedTemplateIds.includes(t.id)), draft.saleVatMode, clientType);
  const margin = pricing?.totals && pricing.totals.saleNet > 0 ? pricing.totals.profitNet / pricing.totals.saleNet * 100 : null;

  return <Box bg="#f4f7fe" minH="100vh" p={{ base: '12px', md: '28px' }}>
    <Box maxW="1440px" mx="auto">
      <Flex bg="white" p="14px" mb="16px" borderRadius="12px" gap="12px" wrap="wrap" align="center">
        <Text fontWeight="700">Lokalna kontrola edytora · bez zapisu do CRM</Text>
        <Button size="sm" isDisabled={preview.active} onClick={() => setClientType(value => value === 'B2C' ? 'B2B' : 'B2C')}>Tryb: {clientType}</Button>
        <Button size="sm" onClick={() => { setDraft(structuredClone(initialDraft)); setGeneration(value => value + 1); setPreview({ pricing: null, active: false }); }}>Reset testu</Button>
        <Text data-testid="preview-margin">Marża netto: {margin == null ? '—' : margin.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'}</Text>
        <Text data-testid="preview-pending">{preview.active ? 'Zmiany pozycji oczekują na zastosowanie' : 'Brak oczekujących zmian pozycji'}</Text>
      </Flex>
      <OfferWorkspaceConfiguration key={generation} draft={draft} templates={templates} clientType={clientType}
        disabled={false} itemsEditable onPricingPreview={onPreview} calculationDisabled
        pendingConfigurationEdits={preview.active} pendingPricing={preview.pricing}
        calculation={null} calculationLoading={false} calculationMode={null} calculationProgress={null}
        calculationIsStale={false} calculationError="" onCalculate={() => undefined} onSelectRanking={() => undefined}
        onChange={update => setDraft(current => update(current))} />
      <Box as="pre" mt="16px" p="12px" bg="white" whiteSpace="pre-wrap" fontSize="11px" data-testid="preview-draft-edits">{JSON.stringify(draft.configurationEdits || [], null, 2)}</Box>
    </Box>
  </Box>;
}
