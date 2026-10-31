'use client';

import {
  Box, Button, Checkbox, Flex, FormControl, FormLabel, Grid, Icon,
  IconButton, Input, Select, Slider, SliderTrack, SliderFilledTrack, SliderThumb,
  Table, TableContainer, Tbody, Td, Text, Th, Thead, Tooltip, Tr, useColorModeValue,
} from '@chakra-ui/react';
import React, { useState } from 'react';
import { MdAdd, MdArrowDropDown, MdArrowDropUp, MdAutoAwesome } from 'react-icons/md';
import { configurationInvestmentScope } from 'lib/onrevolt/configuration-templates';
import { selectOfferWorkspaceTemplate, setOfferWorkspacePvStrategy, type OfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import { priceOfferWorkspaceConfiguration } from 'lib/onrevolt/offer-workspace-pricing';
import type { OfferWorkspaceCalculation } from 'lib/onrevolt/offer-workspace-calculation-types';
import OfferWorkspaceCalculationControls, { type OfferWorkspaceCalculationMode } from './OfferWorkspaceCalculationControls';
import { offerWorkspaceCalculationPresentation } from './OfferWorkspaceScreens';
import type { WorkspaceTemplate } from './OfferWorkspacePanel';

type Props = {
  draft: OfferWorkspaceDraft;
  templates: WorkspaceTemplate[];
  clientType: string;
  disabled: boolean;
  calculationDisabled?: boolean;
  calculation: OfferWorkspaceCalculation | null;
  calculationLoading: boolean;
  calculationMode: OfferWorkspaceCalculationMode | null;
  calculationProgress: { completed: number; total: number } | null;
  calculationIsStale: boolean;
  calculationError: string;
  onCalculate: (mode: OfferWorkspaceCalculationMode) => void;
  onSelectRanking: (templateIds: string[]) => void;
  onChange: (update: (draft: OfferWorkspaceDraft) => OfferWorkspaceDraft) => void;
};

type CalculationEstimates = OfferWorkspaceCalculation & {
  evaluatedTemplateIds?: string[];
  estimatedPaybackYears?: number | null;
};

const number = (value: number) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 }).format(value);
const money = (value: number) => new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(value);
const knownAmount = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) ? value : null;
const sameTemplateIds = (left: string[] | null | undefined, right: string[]) =>
  left != null && left.length === right.length && right.every((id) => left.includes(id));

function supplyModeLabel(mode: string) {
  switch (mode) {
    case 'ONREVOLT_SUPPLIED': return 'Dostarcza onRevolt';
    case 'CLIENT_OWNED_USED': return 'Sprzęt klienta · poza wyceną';
    case 'CLIENT_SUPPLIED_NEW': return 'Dostarcza klient · poza wyceną';
    case 'SERVICE_ONLY': return 'Usługa';
    case 'NOT_INCLUDED': return 'Nieujęte w cenie';
    default: return 'Nieznany tryb dostawy';
  }
}

export default function OfferWorkspaceConfiguration({ draft, templates, clientType, disabled, calculationDisabled = false, calculation, calculationLoading, calculationMode, calculationProgress, calculationIsStale, calculationError, onCalculate, onSelectRanking, onChange }: Props) {
  const [pendingStorage, setPendingStorage] = useState(false);
  const color = useColorModeValue('#2b3674', 'white');
  const muted = useColorModeValue('#8392b4', 'gray.400');
  const line = useColorModeValue('#e0e5f2', 'whiteAlpha.200');
  const surface = useColorModeValue('white', 'navy.800');
  const tile = useColorModeValue('#f5f7fd', 'whiteAlpha.50');
  const greenSurface = useColorModeValue('green.50', 'whiteAlpha.100');
  const green = useColorModeValue('#14986c', 'green.300');
  const storageTemplates = templates.filter((item) => configurationInvestmentScope(item.kind) === 'BATTERY');
  const pvTemplates = templates.filter((item) => configurationInvestmentScope(item.kind) === 'PV');
  const candidateTemplates = [
    ...storageTemplates.map((template) => ({ template, scope: 'BATTERY' as const })),
    ...pvTemplates.map((template) => ({ template, scope: 'PV' as const })),
  ];
  const catalogCandidates = candidateTemplates.map(({ template, scope }) => {
    const candidatePricing = priceOfferWorkspaceConfiguration([template], 'MIXED', clientType);
    const missingReasons = [
      ...candidatePricing.missingRequiredData,
      ...candidatePricing.missingOptionalData,
      ...(candidatePricing.calculationError ? [candidatePricing.calculationError] : []),
    ];
    return {
      template,
      scope,
      pricing: candidatePricing,
      missingReason: candidatePricing.systemCostBeforeFinancing == null
        ? missingReasons.join('; ') || 'Brak wycenianych pozycji w zestawie.'
        : null,
    };
  });
  const selected = templates.filter((item) => draft.selectedTemplateIds.includes(item.id));
  const storage = storageTemplates.find((item) => draft.selectedTemplateIds.includes(item.id));
  const pv = pvTemplates.find((item) => draft.selectedTemplateIds.includes(item.id));
  const storageEnabled = !!storage || pendingStorage;
  const pvEnabled = draft.pvStrategy === 'ADD_TEMPLATE';
  const totalPv = draft.existingPv.powerKw == null || (pvEnabled && pv?.powerKw == null)
    ? null : draft.existingPv.powerKw + (pvEnabled ? pv!.powerKw! : 0);
  const pricing = priceOfferWorkspaceConfiguration(selected, draft.saleVatMode, clientType);
  const rows = pricing.lines;
  const missingDataColor = useColorModeValue('orange.700', 'orange.300');
  const currentCalculation = calculationIsStale ? null : calculation;
  const estimateCalculation = currentCalculation as CalculationEstimates | null;
  const calculationMatchesSelected = sameTemplateIds(estimateCalculation?.evaluatedTemplateIds, draft.selectedTemplateIds);
  const selectedCalculation = currentCalculation && calculationMatchesSelected ? currentCalculation : null;
  const selectionNeedsCalculation = Boolean(currentCalculation && !selectedCalculation);
  const result = selectedCalculation?.status === 'ready' ? selectedCalculation : null;
  const calculationPresentation = offerWorkspaceCalculationPresentation(currentCalculation);
  const selectedCalculationPresentation = offerWorkspaceCalculationPresentation(selectedCalculation);
  const recommendationIneligible = calculationPresentation.recommendationEligible === false;
  const controlsCalculation = currentCalculation && (recommendationIneligible || currentCalculation.status === 'blocked')
    ? {
      ...currentCalculation,
      recommendedTemplateIds: null,
      ...(currentCalculation.status === 'blocked' ? { rankings: currentCalculation.rankings
        .filter((ranking) => ranking.recommendationEligible === false
          || sameTemplateIds(estimateCalculation?.estimatedRecommendedTemplateIds, ranking.templateIds))
        .map((ranking) => ({ ...ranking, paybackYears: null })) } : {}),
    }
    : currentCalculation;
  const baselineCost = knownAmount(currentCalculation?.baselineAnnualCostPln);
  const proposedCost = knownAmount(selectedCalculation?.proposedAnnualCostPln);
  const annualSavings = knownAmount(selectedCalculation?.annualSavingsPln);
  const systemCost = pricing.systemCostBeforeFinancing;
  const partialBreakdown = selectedCalculation?.status === 'blocked'
    ? [
      { label: 'Sama zmiana taryfy', value: selectedCalculation.tariffOnlyAnnualSavingsPln },
      { label: 'Dodatkowa korzyść ze sprzętu', value: selectedCalculation.hardwareAnnualSavingsPln },
      { label: 'Rachunek po samej zmianie taryfy', value: selectedCalculation.tariffOnlyAnnualCostPln },
    ].flatMap((item) => knownAmount(item.value) == null ? [] : [{ label: item.label, value: knownAmount(item.value)! }])
    : selectedCalculationPresentation.breakdown;
  const blockedKnownCosts = selectedCalculation?.status === 'blocked'
    ? [
      { label: 'Koszt systemu z obliczenia', value: knownAmount(selectedCalculation.systemCostPln) },
      { label: 'Koszt po finansowaniu z obliczenia', value: knownAmount(selectedCalculation.costAfterFinancingPln) },
    ].filter((item): item is { label: string; value: number } => item.value !== null)
    : [];
  const hasRecommendation = currentCalculation?.status === 'ready'
    && currentCalculation.recommendationEligible === true
    && calculationPresentation.paybackYears != null
    && Boolean(currentCalculation.recommendedTemplateIds?.length);
  const estimatedWinnerTemplateIds = !hasRecommendation && estimateCalculation?.estimatedRecommendedTemplateIds?.length
    ? estimateCalculation.estimatedRecommendedTemplateIds : null;
  const estimatedWinnerRanking = estimatedWinnerTemplateIds
    ? currentCalculation?.rankings.find((ranking) => sameTemplateIds(ranking.templateIds, estimatedWinnerTemplateIds)) || null
    : null;
  const estimatedWinnerTemplates = estimatedWinnerTemplateIds
    ?.map((id) => templates.find((template) => template.id === id)?.name)
    .filter((name): name is string => Boolean(name)) || [];
  const estimatedWinnerName = estimatedWinnerRanking?.name || estimatedWinnerTemplates.join(' + ');
  const hasEstimatedWinner = Boolean(estimatedWinnerTemplateIds?.length && estimatedWinnerName);
  const estimatedWinnerIsSelected = sameTemplateIds(estimatedWinnerTemplateIds, draft.selectedTemplateIds);
  const estimatedWinnerIsCalculated = estimatedWinnerIsSelected && Boolean(selectedCalculation);
  const estimatedWinnerPayback = knownAmount(estimatedWinnerRanking?.estimatedPaybackYears ?? estimateCalculation?.estimatedPaybackYears);
  const savingsPercent = result && baselineCost != null && baselineCost !== 0 && annualSavings != null
    ? annualSavings / baselineCost * 100 : null;
  const sliderMax = baselineCost != null && baselineCost > 0 ? baselineCost : 1;
  const sliderValue = annualSavings == null ? 0 : Math.max(0, Math.min(sliderMax, annualSavings));

  function financingEstimate(grant: boolean) {
    const checked = grant ? draft.financing.considerGrant : draft.financing.considerTaxRelief;
    const amount = knownAmount(grant ? selectedCalculation?.grantPln : selectedCalculation?.taxReliefPln);
    if (calculationIsStale) return { amount: null, detail: 'Obliczenie jest nieaktualne' };
    if (!currentCalculation) return { amount: null, detail: 'Nie obliczono' };
    if (!selectedCalculation) return { amount: null, detail: 'Obliczenie dotyczy innej lub niepotwierdzonej konfiguracji' };
    if (!checked) return { amount: 0, detail: 'Nie uwzględniono · 0 zł' };
    if (amount == null) return { amount: null, detail: currentCalculation.status === 'blocked' ? 'Brak kwoty w wyniku częściowym' : 'Brak danych do oszacowania' };
    return { amount, detail: currentCalculation.status === 'blocked' ? 'Szacunek częściowy' : 'Szacunek warunkowy' };
  }

  const grantEstimate = financingEstimate(true);
  const taxReliefEstimate = financingEstimate(false);
  const finalCost = knownAmount(selectedCalculation?.costAfterFinancingPln);
  const finalCostDetail = calculationIsStale ? 'Obliczenie jest nieaktualne'
    : !currentCalculation ? 'Nie obliczono'
      : !selectedCalculation ? 'Obliczenie dotyczy innej lub niepotwierdzonej konfiguracji'
        : finalCost == null ? selectedCalculation.status === 'blocked' ? 'Brak pełnego wyniku' : 'Brak danych do oszacowania'
          : selectedCalculation.status === 'blocked' ? 'Szacunek częściowy · bez rekomendacji' : 'Szacunek warunkowy';
  const systemCostDetail = systemCost != null ? 'Cena katalogowa przed finansowaniem'
    : selected.length ? draft.saleVatMode === 'REVIEW' ? 'Potwierdź VAT sprzedaży' : 'Niepełna wycena katalogowa'
      : 'Nie wybrano konfiguracji';
  const selectedStrictPayback = selectedCalculation?.status === 'ready' && selectedCalculation.recommendationEligible === true
    ? knownAmount(selectedCalculation.paybackYears) : null;
  const selectedEstimatedPayback = selectedStrictPayback == null
    ? knownAmount((selectedCalculation as CalculationEstimates | null)?.estimatedPaybackYears) : null;
  const selectedSummaryPayback = selectedStrictPayback ?? selectedEstimatedPayback;
  const selectedPaybackDetail = selectedStrictPayback != null ? 'Wynik dla wariantu spełniającego kryteria rekomendacji'
    : selectedEstimatedPayback != null ? 'Szacunek warunkowy · wymaga potwierdzenia'
      : selectionNeedsCalculation ? ''
        : calculationIsStale ? 'Obliczenie jest nieaktualne'
          : !currentCalculation ? 'Nie obliczono'
          : selectedCalculation.recommendationEligible === false ? 'Brak kwalifikacji do rekomendacji'
            : 'Brak danych do oszacowania';

  function selectTemplate(scope: 'BATTERY' | 'PV', id: string) {
    onChange((current) => {
      if (id) return selectOfferWorkspaceTemplate(current, templates, id, true);
      return { ...current, selectedTemplateIds: current.selectedTemplateIds.filter((selectedId) =>
        configurationInvestmentScope(templates.find((item) => item.id === selectedId)?.kind || '') !== scope) };
    });
  }

  function capacityControl(scope: 'BATTERY' | 'PV') {
    const isPv = scope === 'PV';
    const available = (isPv ? pvTemplates : storageTemplates)
      .filter((item) => (isPv ? item.powerKw : item.capacityKwh) != null)
      .sort((a, b) => (isPv ? a.powerKw! - b.powerKw! : a.capacityKwh! - b.capacityKwh!) || a.name.localeCompare(b.name));
    const choice = isPv ? pv : storage;
    const index = available.findIndex((item) => item.id === choice?.id);
    const value = isPv ? totalPv : storage?.capacityKwh ?? (storageEnabled ? null : 0);
    const label = isPv ? 'Moc instalacji fotowoltaicznej' : 'Pojemność magazynu energii';
    const unit = isPv ? 'kWp' : 'kWh';
    function move(direction: -1 | 1) {
      const target = available[index + direction];
      if (!target) return;
      selectTemplate(scope, target.id);
    }
    return <FormControl minW="0">
      <FormLabel fontSize="11px" minH="34px" mb="8px">{label}</FormLabel>
      <Box position="relative">
        <Input data-capacity-input aria-label={label} value={value == null ? '' : number(value)} placeholder="—" readOnly h="52px" pr="68px" fontSize="16px" fontWeight="700" bg={surface} />
        <Text position="absolute" right="34px" top="18px" fontSize="10px" color={muted}>{unit}</Text>
        <Flex position="absolute" right="4px" top="2px" bottom="2px" direction="column">
          <Tooltip label={isPv ? 'Następny zestaw PV' : 'Następny magazyn'}><IconButton aria-label={isPv ? 'Następny zestaw PV' : 'Następny magazyn'} icon={<MdArrowDropUp />} variant="ghost" minW="24px" w="24px" h="24px" borderRadius="4px" color={muted} isDisabled={disabled || index >= available.length - 1} onClick={() => move(1)} /></Tooltip>
          <Tooltip label={isPv ? 'Poprzedni zestaw PV' : 'Poprzedni magazyn'}><IconButton aria-label={isPv ? 'Poprzedni zestaw PV' : 'Poprzedni magazyn'} icon={<MdArrowDropDown />} variant="ghost" minW="24px" w="24px" h="24px" borderRadius="4px" color={muted} isDisabled={disabled || index <= 0} onClick={() => move(-1)} /></Tooltip>
        </Flex>
      </Box>
      <Text mt="8px" color={muted} fontSize="10px">{isPv ? (pvEnabled ? 'Istniejąca PV + rozbudowa' : 'Istniejąca instalacja') : 'Pojemności zestawów katalogowych'}</Text>
    </FormControl>;
  }

  const section = { px: { base: '16px', md: '24px' }, py: '24px', bg: surface, border: '1px solid', borderColor: line, borderRadius: '20px' };

  return <Box color={color} fontSize="12px" sx={{ 'input, select': { borderColor: line, borderRadius: '13px', fontSize: '12px', minHeight: '42px' }, 'input[data-capacity-input]': { fontSize: '16px' }, 'label': { fontWeight: 500 }, '.chakra-checkbox__control[data-checked]': { background: '#8a47ff', borderColor: '#8a47ff' }, '.chakra-checkbox__label': { fontSize: '12px' } }}>
    <Box as="section" aria-labelledby="offer-recommendation-title" {...section}>
      <Text as="h2" id="offer-recommendation-title" fontSize="20px" fontWeight="700">
        {hasEstimatedWinner ? 'Najkrótszy szacunkowy zwrot' : recommendationIneligible ? 'Analiza wariantu' : hasRecommendation ? 'Rekomendacja systemu' : currentCalculation?.status === 'blocked' ? 'Dane częściowe' : 'Konfiguracja systemu'}
      </Text>
      <Text mt="4px" color={muted}>
        {hasEstimatedWinner ? 'Wariant wskazany przez estymację. To szacunek, nie potwierdzona rekomendacja techniczna.'
          : recommendationIneligible ? 'Wariant nie spełnia kryteriów rekomendacji sprzętu.'
          : hasRecommendation ? 'Wariant wskazany przez obliczenie zwrotu.'
            : currentCalculation?.status === 'blocked' ? 'Obliczenie jest zablokowane; widoczne kwoty są tylko znanymi wartościami cząstkowymi.'
              : 'Brak automatycznej rekomendacji bez obliczenia zwrotu.'}
      </Text>
      {recommendationIneligible && !hasEstimatedWinner ? <Box mt="8px" color={missingDataColor} role="status" aria-live="polite">
        {(calculationPresentation.recommendationReasons.length ? calculationPresentation.recommendationReasons : ['Brak potwierdzonej kwalifikacji do rekomendacji.']).map((reason, index) => <Text key={`${index}-${reason}`}>{reason}</Text>)}
      </Box> : null}
      <OfferWorkspaceCalculationControls
        draft={draft}
        clientType={clientType}
        disabled={disabled}
        calculationDisabled={calculationDisabled}
        calculation={controlsCalculation}
        calculationLoading={calculationLoading}
        calculationMode={calculationMode}
        calculationProgress={calculationProgress}
        calculationIsStale={calculationIsStale}
        calculationError={calculationError}
        onChange={onChange}
        onCalculate={onCalculate}
        onSelectRanking={onSelectRanking}
      />
      {hasEstimatedWinner && estimatedWinnerTemplateIds ? <Flex mt="12px" p="12px" gap="12px" align="center" justify="space-between" wrap="wrap" border="1px solid" borderColor="green.300" borderRadius="6px" bg={greenSurface}>
        <Box minW="0">
          <Text color={green} fontWeight="700">Wybrany najkrótszy szacunkowy zwrot</Text>
          <Text mt="3px" fontWeight="700" overflowWrap="anywhere">{estimatedWinnerName}</Text>
          <Text mt="2px" color={muted} fontSize="10px">Szacunkowy czas zwrotu: {estimatedWinnerPayback == null ? '—' : <Tooltip label={`Dokładny szacunek: ${number(estimatedWinnerPayback)} lat`}><Text as="span" title={`Dokładny szacunek: ${number(estimatedWinnerPayback)} lat`} textDecoration="underline dotted">{number(Math.floor(estimatedWinnerPayback))} lat</Text></Tooltip>}. Kwalifikowalność i zgodność techniczna wymagają potwierdzenia.</Text>
        </Box>
        <Button size="sm" variant={estimatedWinnerIsCalculated ? 'solid' : 'outline'} colorScheme="green" isDisabled={disabled || estimatedWinnerIsCalculated} onClick={() => onSelectRanking(estimatedWinnerTemplateIds)}>
          {estimatedWinnerIsCalculated ? 'Wybrany wariant' : estimatedWinnerIsSelected ? 'Oblicz zwycięski wariant' : 'Wybierz zwycięski wariant'}
        </Button>
      </Flex> : null}
      {hasEstimatedWinner && recommendationIneligible && calculationPresentation.recommendationReasons.length ? <Box as="details" mt="8px" fontSize="10px" color={muted}>
        <Box as="summary" cursor="pointer">Ograniczenia formalnej rekomendacji ({calculationPresentation.recommendationReasons.length})</Box>
        {calculationPresentation.recommendationReasons.map((reason, index) => <Text key={`${index}-${reason}`} mt="4px">{reason}</Text>)}
      </Box> : null}
      <Grid templateColumns={{ base: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }} gap="24px" mt="24px">
        {['Aktualny rachunek roczny', 'Prognozowany rachunek roczny', 'Łączna zmiana rachunku rocznego'].map((label, index) => <Box key={label} minW="0" gridColumn={{ base: index === 2 ? '1 / -1' : 'auto', md: 'auto' }}>
          <Text fontSize="11px" color={muted} minH="18px">{label}</Text>
          <Text mt="6px" fontSize="27px" fontWeight="700" color={index === 2 ? green : color} aria-label={`${label}: ${index === 0 ? (baselineCost == null ? 'nie obliczono' : `${money(baselineCost)} zł`) : index === 1 ? (proposedCost == null ? 'nie obliczono' : `${money(proposedCost)} zł`) : (annualSavings == null ? 'nie obliczono' : `${money(annualSavings)} zł`)}${selectedCalculation?.status === 'blocked' ? ' · wartość częściowa' : ''}`}>
            {index === 0 ? (baselineCost == null ? '—' : money(baselineCost))
              : index === 1 ? (proposedCost == null ? '—' : money(proposedCost))
                : (annualSavings == null ? '—' : money(annualSavings))}
            <Text as="span" fontSize="16px" fontWeight="400">{index === 2 ? ` zł${savingsPercent == null ? '' : ` / ${number(savingsPercent)}%`}` : ' zł'}</Text>
          </Text>
          {index === 2 && partialBreakdown.length ? <Box mt="8px" pt="7px" borderTop="1px solid" borderColor={line} color={muted} fontSize="10px">
            {selectedCalculation?.status === 'blocked' ? <Text mb="4px">Znane wartości cząstkowe</Text> : null}
            {partialBreakdown.map((item) => <Flex key={item.label} justify="space-between" gap="8px"><Text>{item.label}</Text><Text flexShrink={0}>{money(item.value)} zł/rok</Text></Flex>)}
          </Box> : null}
        </Box>)}
      </Grid>
      {selectionNeedsCalculation ? <Text mt="10px" fontSize="11px" color={muted} role="status">
        Wybierz wskazany zestaw, aby zobaczyć jego podsumowanie.
      </Text> : null}
      {selectedCalculation?.status === 'blocked' ? <Text mt="10px" fontSize="10px" color={missingDataColor} role="status">
        Kwoty poniżej nie stanowią pełnego wyniku ani rekomendacji.
      </Text> : null}
      {blockedKnownCosts.length ? <Box mt="12px" pt="8px" borderTop="1px solid" borderColor={line} fontSize="10px" role="status">
        <Text color={muted} mb="4px">Znane kwoty cząstkowe z obliczenia</Text>
        {blockedKnownCosts.map((item) => <Flex key={item.label} justify="space-between" gap="8px"><Text>{item.label}</Text><Text flexShrink={0}>{money(item.value)} zł</Text></Flex>)}
      </Box> : null}
      <Box mt="22px" mb="28px" pt="34px" position="relative">
        <Flex position="absolute" top="0" left="50%" transform="translateX(-50%)" align="center" gap="5px" px="10px" py="6px" borderRadius="8px" bg={tile} color={muted} whiteSpace="nowrap" fontSize="11px"><Icon as={MdAutoAwesome} />{result ? 'Wynik symulacji' : selectedCalculation?.status === 'blocked' ? 'Wynik częściowy' : 'Brak wyniku obliczenia'}</Flex>
        <Box><Slider aria-label="Roczna oszczędność — dobór konfiguracji" min={0} max={sliderMax} value={sliderValue} isDisabled={!result || annualSavings == null || baselineCost == null} focusThumbOnChange={false}>
          <SliderTrack h="10px" bg="#d6eee2"><SliderFilledTrack bg="#97d9b9" /></SliderTrack><SliderThumb boxSize="23px" bg={green} border="4px solid white" />
        </Slider></Box>
        <Flex justify="space-between" color={muted} mt="6px" fontSize="11px"><Text>{baselineCost == null ? '—' : `${money(baselineCost)} zł`} / rok</Text><Text>{proposedCost == null ? '—' : `${money(proposedCost)} zł`} / rok</Text></Flex>
      </Box>
      <Grid templateColumns={{ base: 'repeat(2, minmax(0, 1fr))', xl: '1fr 1fr 2.08fr' }} gap="16px">
        <Box bg={tile} borderRadius="14px" p="16px" minH="174px">
          <Text fontSize="11px" minH="36px" color={muted}>{selectedEstimatedPayback != null ? 'Szacunkowy czas zwrotu' : 'Zwrot z dodatkowego sprzętu'}</Text>
          {selectedEstimatedPayback != null ? <Tooltip label={`Dokładny szacunek: ${number(selectedEstimatedPayback)} lat`}><Text as="span" title={`Dokładny szacunek: ${number(selectedEstimatedPayback)} lat`} aria-label={`Czas zwrotu z dodatkowego sprzętu: ${number(Math.floor(selectedEstimatedPayback))} lat`} fontSize="27px" fontWeight="700" mt="6px" mb="9px" display="inline-block" textDecoration="underline dotted">{number(Math.floor(selectedEstimatedPayback))} <Text as="span" fontSize="18px" fontWeight="400">lat</Text></Text></Tooltip>
            : <Text fontSize="27px" fontWeight="700" mt="6px" mb="9px" aria-label={`Czas zwrotu z dodatkowego sprzętu: ${selectedSummaryPayback == null ? 'nie obliczono' : `${number(Math.floor(selectedSummaryPayback))} lat`}`}>{selectedSummaryPayback == null ? '—' : number(Math.floor(selectedSummaryPayback))} <Text as="span" fontSize="18px" fontWeight="400">lat</Text></Text>}
          <Text fontSize="10px" color={muted}>{selectedPaybackDetail}</Text>
        </Box>
        <Box bg={tile} borderRadius="14px" p="16px" minH="174px">
          <Text fontSize="11px" minH="36px" color={muted}>Koszt systemu</Text>
          <Text fontSize="27px" fontWeight="700" mt="6px" mb="9px" aria-label={systemCost == null
            ? selected.length ? 'Koszt systemu przed finansowaniem: niepełna wycena katalogowa' : 'Koszt systemu przed finansowaniem: nie wybrano konfiguracji'
            : `Koszt systemu przed finansowaniem: ${money(systemCost)} zł`}>
            {systemCost == null ? '—' : money(systemCost)} <Text as="span" fontSize="18px">zł</Text>
          </Text>
          <Text fontSize="10px" color={muted}>{systemCost != null ? 'Przed finansowaniem · cena katalogowa' : selected.length ? 'Wymaga pełnej wyceny i potwierdzonego VAT' : 'Po wybraniu zestawu katalogowego'}</Text>
        </Box>
        <Box bg={tile} borderRadius="14px" p="16px" minW="0" gridColumn={{ base: '1 / -1', xl: 'auto' }}>
          <Text color={muted} fontSize="11px">Konfiguracja</Text>
          <Grid templateColumns="repeat(2, minmax(0, 1fr))" gap="12px" mt="14px">{capacityControl('PV')}{capacityControl('BATTERY')}</Grid>
        </Box>
      </Grid>

      <Box as="section" aria-labelledby="offer-financing-title" mt="26px" pt="25px" borderTop="1px solid" borderColor={line}>
        <Text as="h2" id="offer-financing-title" fontSize="20px" fontWeight="700">Finansowanie</Text>
        <Text color={muted} mt="4px">Kwalifikowalność i kwoty do potwierdzenia.</Text>
        <Grid templateColumns={{ base: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} columnGap="48px" rowGap="24px" mt="32px">
          {(['grant', 'relief'] as const).map((kind) => {
            const grant = kind === 'grant';
            const label = grant ? 'Dotacja' : 'Ulga';
            const checked = grant ? draft.financing.considerGrant : draft.financing.considerTaxRelief;
            const estimate = grant ? grantEstimate : taxReliefEstimate;
            const amount = estimate.amount;
            return <Box key={kind} minW="0">
              <Checkbox colorScheme="purple" isChecked={checked} isDisabled={disabled} onChange={(event) => {
                const value = event.target.checked;
                onChange((current) => ({ ...current, financing: { ...current.financing, [grant ? 'considerGrant' : 'considerTaxRelief']: value } }));
              }}>{label}</Checkbox>
              <FormControl mt="28px" isDisabled={disabled || !checked}>
                <FormLabel fontSize="11px">{label}</FormLabel>
                <Flex gap="18px" align="center">
                  <Select aria-label={`${label} — program`} value={kind} onChange={() => undefined} minW="0"><option value={kind}>{grant ? 'Przydomowe Magazyny Energii' : 'Ulga termomodernizacyjna'}</option></Select>
                  <Tooltip label="Dodawanie innych źródeł finansowania nie jest jeszcze dostępne."><Box><IconButton aria-label={grant ? 'Dodaj źródło dotacji' : 'Dodaj ulgę'} icon={<MdAdd />} variant="outline" isDisabled w="38px" minW="38px" borderRadius="11px" /></Box></Tooltip>
                </Flex>
                <Text mt="7px" fontSize="10px" color={muted}>{checked
                  ? selectedCalculation?.status === 'blocked'
                    ? `Kwota cząstkowa: ${amount == null ? '—' : `${money(amount)} zł`}`
                    : selectedCalculation ? `Kwota w symulacji: ${amount == null ? '—' : `${money(amount)} zł`}` : estimate.detail
                  : selectedCalculation ? `Nie uwzględniono w kosztach: ${money(amount ?? 0)} zł` : 'Nie uwzględniono w kosztach'}</Text>
              </FormControl>
            </Box>;
          })}
        </Grid>
        {currentCalculation ? <Text mt="8px" fontSize="10px" color={muted}>Dotacje i ulgi są szacunkowe; kwalifikowalność, warunki i ostateczne kwoty wymagają potwierdzenia.</Text> : null}
        <Tooltip label="Rabaty zostaną udostępnione po podłączeniu kosztorysu oferty."><Grid templateColumns={{ base: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} columnGap="48px" rowGap="16px" mt="24px">
          <FormControl isDisabled><FormLabel fontSize="11px">Nazwa rabatu</FormLabel><Input value="" readOnly /></FormControl>
          <FormControl isDisabled><FormLabel fontSize="11px">Kwota rabatu [zł]</FormLabel><Input value="" placeholder="—" readOnly /></FormControl>
        </Grid></Tooltip>
      </Box>
    </Box>

    <Box as="section" aria-labelledby="offer-configuration-title" {...section} mt="18px">
      <Text as="h2" id="offer-configuration-title" fontSize="20px" fontWeight="700">Dobierz konfigurację</Text>
      <Text color={muted} mt="4px">Zestawy katalogowe</Text>
      <FormControl mt="18px" maxW="420px" isDisabled={disabled}>
        <FormLabel fontSize="11px">VAT od sprzedaży</FormLabel>
        <Select value={draft.saleVatMode} onChange={(event) => { const value = event.target.value as OfferWorkspaceDraft['saleVatMode']; onChange((current) => ({ ...current, saleVatMode: value })); }}>
          <option value="REVIEW">Do weryfikacji</option><option value="REDUCED_8">8% · stawka obniżona</option><option value="STANDARD_23">23% · stawka podstawowa</option><option value="MIXED">Według stawek pozycji</option>
        </Select>
      </FormControl>
      {draft.saleVatMode === 'REVIEW' ? <Text mt="7px" color={missingDataColor} fontSize="11px" role="status">
        Potwierdź VAT sprzedaży, aby wyliczyć koszt wybranej konfiguracji.
      </Text> : null}
      {!selected.length ? candidateTemplates.length ? <Box mt="18px" aria-label="Dostępne konfiguracje katalogowe">
        <Text mb="8px" color={muted} fontSize="11px">
          Nie wybrano konfiguracji. Cena katalogowa wg stawek pozycji · {clientType === 'B2B' ? 'netto' : 'brutto'}.
        </Text>
        <TableContainer maxW="100%">
          <Table size="sm" variant="simple" minW="520px" sx={{ th: { fontSize: '10px', color: muted, fontWeight: 500, borderColor: line }, td: { fontSize: '11px', py: '8px', borderColor: line } }}>
            <Thead><Tr><Th>Typ</Th><Th>Konfiguracja</Th><Th isNumeric>Moc / pojemność</Th><Th isNumeric>Cena katalogowa</Th><Th /></Tr></Thead>
            <Tbody>{catalogCandidates.map(({ template, scope, pricing: candidatePricing, missingReason }) => {
              const specifications = [
                template.powerKw == null ? null : `${number(template.powerKw)} ${scope === 'PV' ? 'kWp' : 'kW'}`,
                template.capacityKwh == null ? null : `${number(template.capacityKwh)} kWh`,
              ].filter((value): value is string => value !== null);
              return <Tr key={template.id}>
                <Td>{scope === 'PV' ? 'Fotowoltaika' : 'Magazyn energii'}</Td>
                <Td whiteSpace="normal" minW="150px" overflowWrap="anywhere">{template.name}</Td>
                <Td isNumeric whiteSpace="nowrap">{specifications.join(' · ') || '—'}</Td>
                <Td isNumeric color={missingReason ? missingDataColor : color}>
                  {candidatePricing.systemCostBeforeFinancing == null
                    ? <Tooltip label={missingReason}><Text as="span" fontSize="10px">Nieustalona cena · {missingReason}</Text></Tooltip>
                    : `${money(candidatePricing.systemCostBeforeFinancing)} zł`}
                </Td>
                <Td><Button size="xs" variant="outline" isDisabled={disabled} aria-label={`Wybierz ${template.name}`} onClick={() => selectTemplate(scope, template.id)}>Wybierz</Button></Td>
              </Tr>;
            })}</Tbody>
          </Table>
        </TableContainer>
      </Box> : <Text mt="18px" color={muted} fontSize="11px" role="status">
        Brak dostępnych zestawów katalogowych PV ani magazynów energii.
      </Text> : null}
      <Grid templateColumns={{ base: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} columnGap="48px" rowGap="28px" mt="32px">
        {(['BATTERY', 'PV'] as const).map((scope) => {
          const isPv = scope === 'PV';
          const choices = isPv ? pvTemplates : storageTemplates;
          const choice = isPv ? pv : storage;
          const enabled = isPv ? pvEnabled : storageEnabled;
          return <Box key={scope} minW="0">
            <Checkbox isChecked={enabled} isDisabled={disabled || !choices.length} colorScheme="purple" onChange={(event) => {
              const checked = event.target.checked;
              if (isPv) onChange((current) => setOfferWorkspacePvStrategy(current, templates, checked ? 'ADD_TEMPLATE' : 'KEEP_EXISTING'));
              else { setPendingStorage(checked); if (!checked) selectTemplate('BATTERY', ''); }
            }}>{isPv ? 'Instalacja fotowoltaiczna' : 'Magazyn energii'}</Checkbox>
            <Text mt="24px" mb="24px" pl="24px" color={muted}>{isPv ? 'Panele PV, konstrukcja, zabezpieczenia i montaż.' : 'Falownik, magazyn i wymagany osprzęt.'}</Text>
            <FormControl isDisabled={disabled || !enabled || !choices.length}>
              <FormLabel fontSize="11px">{isPv ? 'Konfiguracja instalacji fotowoltaicznej' : 'Konfiguracja magazynu'}</FormLabel>
              <Select value={choice?.id || ''} placeholder={choices.length ? 'Wybierz konfigurację' : 'Brak zestawów katalogowych'} onChange={(event) => selectTemplate(scope, event.target.value)} title={choice?.name}>
                {choices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
              {choice ? <Text mt="7px" fontSize="10px" color={muted} overflowWrap="anywhere">{choice.name} · wersja {choice.version}{choice.items.some((item) => item.requiresReview) ? ' · wymaga weryfikacji' : ''}{choice.requiresExistingPv ? ' · wymaga istniejącej PV' : ''}{choice.requiresExistingInverter ? ' · wymaga istniejącego falownika' : ''}</Text> : null}
            </FormControl>
            {!isPv ? <Box mt="28px"><Tooltip label="Dodatkowe pozycje będą dostępne po podłączeniu edycji kosztorysu."><Box><Checkbox isDisabled isChecked={false}>Inne</Checkbox></Box></Tooltip><FormControl isDisabled mt="24px"><FormLabel fontSize="11px">Konfiguracja</FormLabel><Select placeholder="Wybierz konfigurację" /></FormControl></Box> : null}
          </Box>;
        })}
      </Grid>
      <Flex mt="38px" mb="18px" justify="space-between" gap="12px" align="center" wrap="wrap">
        <Box><Text as="h2" fontSize="20px" fontWeight="700">Wybrana konfiguracja</Text><Text color={muted} mt="4px">Podgląd</Text></Box>
        <Tooltip label="Edycja pozycji kosztorysu nie jest jeszcze podłączona do nowego szkicu."><Box><Button variant="outline" size="sm" fontSize="12px" borderRadius="13px" isDisabled>Edytuj pozycje</Button></Box></Tooltip>
      </Flex>
      <TableContainer maxW="100%">
        <Table size="sm" variant="simple" minW="600px" sx={{ th: { fontSize: '10px', color: muted, fontWeight: 500, borderColor: line }, td: { fontSize: '12px', py: '18px', borderColor: line } }}>
          <Thead><Tr><Th>Nr</Th><Th>Pozycja</Th><Th>Model</Th><Th isNumeric>Ilość</Th><Th isNumeric>Cena {pricing.saleAmountBasis === 'NET' ? 'netto' : 'brutto'} [zł]</Th></Tr></Thead>
          <Tbody>{rows.length ? <>
            {rows.map((item, index) => <Tr key={`${item.templateId}-${item.itemId}`}>
              <Td>{index + 1}</Td>
              <Td whiteSpace="normal" minW="140px">
                <Text>{item.description || item.templateName}</Text>
                <Flex wrap="wrap" gap="4px 8px" mt="5px" color={muted} fontSize="10px">
                  <Text>{supplyModeLabel(item.supplyMode)}</Text>
                  {item.isOptional ? <Text>Opcjonalna · wliczona w kalkulację</Text> : null}
                  {item.requiresReview ? <Text color={missingDataColor}>Wymaga weryfikacji</Text> : null}
                </Flex>
              </Td>
              <Td whiteSpace="normal" minW="120px">{item.productName || '—'}</Td>
              <Td isNumeric>{item.quantity == null ? '—' : number(item.quantity)}</Td>
              <Td isNumeric color={item.missingPriceReason || pricing.calculationError ? missingDataColor : color}>
                {item.missingPriceReason ? <Tooltip label={item.missingPriceReason}><Text as="span">Brak danych</Text></Tooltip>
                  : !item.includedInSale ? 'Poza wyceną'
                    : item.saleAmount == null ? 'Niepełna wycena' : money(item.saleAmount)}
              </Td>
            </Tr>)}
            <Tr bg={tile} fontWeight="700" aria-label="Koszt systemu przed finansowaniem">
              <Td colSpan={4} py="10px"><Text>Koszt systemu przed finansowaniem</Text><Text mt="2px" fontSize="10px" fontWeight="400" color={muted}>{systemCostDetail}</Text></Td>
              <Td isNumeric py="10px">{systemCost == null ? '—' : money(systemCost)}</Td>
            </Tr>
            {[
              { key: 'grant', label: 'Dotacja · szacunek warunkowy', estimate: grantEstimate },
              { key: 'relief', label: 'Ulga termomodernizacyjna · szacunek warunkowy', estimate: taxReliefEstimate },
            ].map(({ key, label, estimate }) => <Tr key={key} aria-label={label}>
              <Td colSpan={4} py="9px"><Text>{label}</Text><Text mt="2px" fontSize="10px" color={muted}>{estimate.detail}</Text></Td>
              <Td isNumeric py="9px">{estimate.amount == null ? '—' : money(estimate.amount)}</Td>
            </Tr>)}
            <Tr aria-label={selectedEstimatedPayback != null ? 'Szacunkowy czas zwrotu' : 'Czas zwrotu'}>
              <Td colSpan={4} py="9px"><Text>{selectedEstimatedPayback != null ? 'Szacunkowy czas zwrotu sprzętu' : 'Czas zwrotu sprzętu'}</Text><Text mt="2px" fontSize="10px" color={muted}>{selectedPaybackDetail}</Text></Td>
              <Td isNumeric py="9px">{selectedSummaryPayback == null ? '—' : <Tooltip label={selectedEstimatedPayback != null ? `Dokładny szacunek: ${number(selectedEstimatedPayback)} lat` : `${number(selectedSummaryPayback)} lat`}><Text as="span" title={selectedEstimatedPayback != null ? `Dokładny szacunek: ${number(selectedEstimatedPayback)} lat` : `${number(selectedSummaryPayback)} lat`} textDecoration={selectedEstimatedPayback != null ? 'underline dotted' : 'none'}>{number(Math.floor(selectedSummaryPayback))} lat</Text></Tooltip>}</Td>
            </Tr>
            <Tr bg={greenSurface} color={green} fontWeight="700" aria-label="Koszt systemu po dofinansowaniach">
              <Td colSpan={4} py="12px"><Text>Koszt systemu po dofinansowaniach</Text><Text mt="2px" fontSize="10px" fontWeight="400">{finalCostDetail}</Text></Td>
              <Td isNumeric py="12px" fontSize="14px">{finalCost == null ? '—' : `${money(finalCost)} zł`}</Td>
            </Tr>
          </> : <Tr><Td colSpan={5} color={muted}>{candidateTemplates.length ? 'Nie wybrano konfiguracji.' : 'Brak dostępnych zestawów katalogowych PV ani magazynów energii.'}</Td></Tr>}</Tbody>
        </Table>
      </TableContainer>
      {pricing.missingRequiredData.length || pricing.missingOptionalData.length || pricing.calculationError ? <Box mt="12px" color={missingDataColor} fontSize="11px" role="status">
        {pricing.missingRequiredData.length ? <Text>Brak danych w pozycjach wymaganych: {pricing.missingRequiredData.length}. Suma nie jest prezentowana.</Text> : null}
        {pricing.missingOptionalData.length ? <Text>Brak danych w pozycjach opcjonalnych: {pricing.missingOptionalData.length}. Suma nie jest prezentowana.</Text> : null}
        {pricing.calculationError ? <Text>Kalkulacja wymaga weryfikacji: {pricing.calculationError}</Text> : null}
      </Box> : null}
    </Box>
  </Box>;
}
