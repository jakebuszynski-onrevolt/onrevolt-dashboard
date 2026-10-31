'use client';

import {
  Accordion, AccordionButton, AccordionIcon, AccordionItem, AccordionPanel,
  Alert, AlertIcon, Box, Button, Checkbox, Flex, FormControl, FormLabel, Grid,
  Input, Select, Stack, Table, TableContainer, Tbody, Td, Text, Textarea,
  Tfoot, Th, Thead, Tooltip, Tr, useColorModeValue,
} from '@chakra-ui/react';
import { useState, type ReactNode } from 'react';
import { MdAdd, MdAutoAwesome } from 'react-icons/md';
import OfferEnergyChart from './OfferEnergyChart';
import type { OfferEnergyForecast } from './OfferEnergyChart';
import OfferWorkspaceDocumentPreview from './OfferWorkspaceDocumentPreview';
import { setOfferWorkspacePvStrategy, type OfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import type { OfferWorkspaceCalculation } from 'lib/onrevolt/offer-workspace-calculation-types';
import type { OfferBillingMonthResult } from 'lib/onrevolt/offer-workspace-billing';
import type { OfferTariffRateState } from 'lib/onrevolt/offer-workspace-tariffs';
import type { TariffData, WorkspaceData } from './OfferWorkspacePanel';

type SharedProps = {
  workspace: WorkspaceData;
  draft: OfferWorkspaceDraft;
  tariffs: TariffData | null;
  currentTariffLabel: string;
  currentTariffRates: OfferTariffRateState;
  targetTariffRates: OfferTariffRateState;
  tariffRateDate: string;
  actualSettlement: OfferWorkspaceDraft['currentSettlement'];
  disabled: boolean;
  onChange: (update: (draft: OfferWorkspaceDraft) => OfferWorkspaceDraft) => void;
};

const format = (value: number | null | undefined, digits = 1) => value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('pl-PL', { maximumFractionDigits: digits }).format(value);
const settlement = (value: OfferWorkspaceDraft['currentSettlement']) => value === 'NET_METERING' ? 'Net-metering' : value === 'NET_BILLING' ? 'Net-billing' : 'Nieustalony';
const monthLabel = (period: string) => new Intl.DateTimeFormat('pl-PL', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${period}-01T12:00:00Z`));

function useOfferColors() {
  return { text: useColorModeValue('#2b3674', 'white'), muted: useColorModeValue('#8392b4', 'gray.400'), line: useColorModeValue('#e0e5f2', 'whiteAlpha.200'), surface: useColorModeValue('white', 'navy.800'), soft: useColorModeValue('#f5f7fd', 'whiteAlpha.50') };
}

export function OfferScreen({ children }: { children: ReactNode }) {
  const c = useOfferColors();
  return <Stack spacing="18px" color={c.text} fontSize="12px" minW="0" sx={{ letterSpacing: 0, 'input,select,textarea': { fontSize: '12px', borderRadius: '13px', borderColor: c.line }, label: { fontSize: '11px', fontWeight: 500 }, button: { boxShadow: 'none' } }}>{children}</Stack>;
}

function Section({ title, subtitle, children, action, hideHeading = false }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode; hideHeading?: boolean }) {
  const c = useOfferColors();
  return <Box as="section" aria-label={title} bg={c.surface} border="1px solid" borderColor={c.line} borderRadius="20px" px={{ base: '16px', md: '24px' }} py="24px" minW="0">
    {!hideHeading ? <Flex justify="space-between" align="start" gap="14px" mb="22px" wrap="wrap"><Box><Text as="h2" fontSize="20px" fontWeight="700">{title}</Text>{subtitle ? <Text mt="4px" color={c.muted}>{subtitle}</Text> : null}</Box>{action}</Flex> : null}
    {children}
  </Box>;
}

function DisabledControl({ children, reason }: { children: ReactNode; reason: string }) {
  return <Tooltip label={reason}><Box>{children}</Box></Tooltip>;
}

function EmptyChart({ label, tall = false }: { label: string; tall?: boolean }) {
  const c = useOfferColors();
  return <Flex h={tall ? '280px' : '220px'} align="center" justify="center" borderBottom="1px solid" borderLeft="1px solid" borderColor={c.line} position="relative" bgImage={`repeating-linear-gradient(to top, transparent, transparent 54px, ${c.line} 55px, transparent 56px)`}>
    <Text px="16px" py="8px" bg={c.surface} color={c.muted} textAlign="center">{label}</Text>
  </Flex>;
}

function Metrics({ items }: { items: Array<{ label: string; value: string; green?: boolean }> }) {
  const c = useOfferColors();
  return <Grid templateColumns={{ base: 'repeat(2,minmax(0,1fr))', xl: `repeat(${items.length},minmax(0,1fr))` }} gap="12px" mt="18px">
    {items.map((item) => <Box key={item.label} bg={c.soft} borderRadius="14px" p="15px" minW="0"><Text fontSize="10px" color={c.muted}>{item.label}</Text><Text fontSize="23px" mt="5px" fontWeight="700" color={item.green ? '#14986c' : c.text} overflowWrap="anywhere">{item.value}</Text></Box>)}
  </Grid>;
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return <FormControl><FormLabel>{label}</FormLabel><Input value={value} readOnly h="42px" /></FormControl>;
}

function tariffRateUnit(row: { amount_mode?: string; billing_cycle_months?: number | null }, group: 'fixed' | 'variable') {
  if (group === 'variable') return 'PLN/kWh';
  if (row.amount_mode === 'per_kw_month') return 'PLN/kW/mies.';
  return row.billing_cycle_months && row.billing_cycle_months > 1
    ? `PLN/${row.billing_cycle_months} mies.`
    : 'PLN/mies.';
}

function RateRows({ title, rates }: { title: string; rates: OfferTariffRateState }) {
  const c = useOfferColors();
  if (rates.status === 'loading') return <Box minW="0"><Text fontWeight="700" mb="10px">{title}</Text><Text color={c.muted}>Wczytywanie cen taryfowych…</Text></Box>;
  if (rates.status === 'unavailable') return <Box minW="0"><Text fontWeight="700" mb="10px">{title}</Text><Text color={c.muted}>{rates.message}</Text></Box>;

  const groups = [
    { key: 'variable' as const, label: 'Stawki zmienne' as const, rows: rates.tariff.pricing.tariffStorage.variable },
    { key: 'fixed' as const, label: 'Stawki stałe' as const, rows: rates.tariff.pricing.tariffStorage.fixed },
  ];
  return <Box minW="0">
    <Text fontWeight="700" mb="4px">{title}</Text>
    <Text color={c.muted} mb="12px">{rates.source === 'ENEA' ? 'Potwierdzona historia ENEA' : rates.source === 'MANUAL' ? 'Historia taryf CRM' : 'Katalog RE'} · katalog od {rates.tariff.pricing.tariffStorage.validFrom}{rates.tariff.catalogRevision ? ` · rewizja ${rates.tariff.catalogRevision}` : ''}</Text>
    {groups.map((group) => <Box key={group.key} mb="14px">
      <Text fontSize="11px" fontWeight="700" mb="6px">{group.label}</Text>
      {group.rows.length ? <Box overflowX="auto"><Box minW="520px">
        <Grid templateColumns="minmax(0,1fr) 82px 82px 58px" gap="8px" px="8px" py="6px" color={c.muted} fontSize="10px" borderBottom="1px solid" borderColor={c.line}>
          <Text>Pozycja</Text><Text textAlign="right">Netto</Text><Text textAlign="right">Brutto</Text><Text textAlign="right">VAT</Text>
        </Grid>
        {group.rows.map((row) => {
          const details = [
            row.window_code || null,
            row.annual_usage_min_kwh != null ? `od ${format(Number(row.annual_usage_min_kwh), 0)} kWh/rok` : null,
            row.annual_usage_max_kwh != null ? `poniżej ${format(Number(row.annual_usage_max_kwh), 0)} kWh/rok` : null,
          ].filter(Boolean).join(' · ');
          return <Grid key={row.component_key} templateColumns="minmax(0,1fr) 82px 82px 58px" gap="8px" alignItems="center" px="8px" py="9px" borderBottom="1px solid" borderColor={c.line}>
            <Box minW="0"><Text>{row.label}</Text><Text color={c.muted} fontSize="10px">{tariffRateUnit(row, group.key)}{details ? ` · ${details}` : ''}</Text></Box>
            <Text textAlign="right">{format(row.net, 4)}</Text><Text textAlign="right">{format(row.gross, 4)}</Text><Text textAlign="right">{format(row.vatRate * 100, 2)}%</Text>
          </Grid>;
        })}
      </Box></Box> : <Text fontSize="11px" color={c.muted}>Brak pozycji w tej grupie taryfowej.</Text>}
    </Box>)}
  </Box>;
}

export function offerSystemExpandedPanels(currentRates: OfferTariffRateState, targetRates: OfferTariffRateState, userExpanded: number[] | null) {
  if (userExpanded !== null) return userExpanded;
  return currentRates.status === 'ready' && targetRates.status === 'ready' ? [0] : [0, 1];
}

export function OfferSystemScreen(props: SharedProps & { tariffError: string }) {
  const { workspace, draft, tariffs, disabled, onChange, currentTariffRates, targetTariffRates } = props;
  const c = useOfferColors();
  const [expanded, setExpanded] = useState<number[] | null>(null);
  const operator = tariffs?.catalog.find((item) => item.id === draft.targetOperatorId);
  const issues = [...workspace.input.issues.filter(issue =>
    !(draft.existingPv.powerKw != null && issue.startsWith('Brak potwierdzonej mocy istniejącej PV'))
    && !(workspace.energy?.totals.loadKwh != null && issue.startsWith('Brak zapisanej rocznej deklaracji zużycia'))),
    ...workspace.measurements.issues, ...(workspace.energy?.issues || []), ...(workspace.energyError ? [workspace.energyError] : []),
    ...(workspace.draft && workspace.draft.sourceRevision !== workspace.revision ? ['Dane projektu lub katalogu zmieniły się od zapisu szkicu. Obliczenia zachowują ręczne założenia PV ze szkicu; sprawdź je przed kolejnym zapisem.'] : [])];
  const selectedIsDifferent = draft.currentSettlement !== props.actualSettlement;
  return <OfferScreen>
    <Section title="Stan aktualny" hideHeading>
      <OfferEnergyChart workspace={workspace} targetTariffLabel={operator ? `${operator.name} · ${operator.tariffs.find(item => item.id === draft.targetTariffId)?.code || 'Nie wybrano taryfy'}` : 'Nie wybrano taryfy docelowej'} netMetering={props.actualSettlement === 'NET_METERING'} />
      <Box mt="20px" borderTop="1px solid" borderColor={c.line} pt="14px"><DisabledControl reason="Zwiększenie zapotrzebowania będzie dostępne wraz z pełną symulacją."><Button variant="ghost" size="sm" rightIcon={<MdAdd />} fontSize="12px" isDisabled>Zwiększ zapotrzebowanie</Button></DisabledControl></Box>
      {issues.length ? <Alert status="warning" mt="12px" borderRadius="8px"><AlertIcon /><Box>{issues.map((issue, index) => <Text key={index}>{issue}</Text>)}</Box></Alert> : null}
    </Section>
    <Flex justify="space-between" gap="10px" align="center" wrap="wrap"><Text fontSize="13px" fontWeight="700">System rozliczeń i stawki</Text><Flex gap="8px"><Button size="xs" variant="outline" onClick={() => setExpanded([0, 1, 2])}>Rozwiń wszystkie</Button><Button size="xs" variant="outline" onClick={() => setExpanded([])}>Zwiń wszystkie</Button></Flex></Flex>
    <Accordion allowMultiple index={offerSystemExpandedPanels(currentTariffRates, targetTariffRates, expanded)} onChange={(value) => setExpanded(value as number[])} sx={{ '.chakra-accordion__item': { border: '1px solid', borderColor: c.line, borderRadius: '17px', mb: '12px', overflow: 'hidden' }, '.chakra-accordion__button': { p: '18px', textAlign: 'left' }, '.chakra-accordion__panel': { px: { base: '16px', md: '24px' }, pb: '24px' } }}>
      <AccordionItem><AccordionButton><Box flex="1"><Text fontWeight="700" fontSize="14px">System rozliczeń</Text><Text color={c.muted} fontSize="11px" mt="2px">Operator, taryfa i system rozliczeniowy</Text></Box><AccordionIcon /></AccordionButton><AccordionPanel>
        <Grid templateColumns={{ base: '1fr', md: 'repeat(2,minmax(0,1fr))' }} gap="48px" pt="12px">
          <Stack spacing="22px"><ReadonlyField label="Aktualny operator" value={props.currentTariffLabel.includes(' · ') ? props.currentTariffLabel.split(' · ')[0] : 'Nie określono'} /><ReadonlyField label="Aktualna taryfa" value={props.currentTariffLabel.includes(' · ') ? props.currentTariffLabel.split(' · ').slice(1).join(' · ') : props.currentTariffLabel} /><ReadonlyField label="Aktualny system rozliczeniowy" value={settlement(props.actualSettlement)} /></Stack>
          <Stack spacing="22px" color="#14986c">
            <FormControl isDisabled={disabled || !tariffs?.catalog.length}><FormLabel>Nowy operator</FormLabel><Select value={draft.targetOperatorId || ''} placeholder="Wybierz operatora" onChange={(event) => { const value = event.target.value; onChange((current) => ({ ...current, targetOperatorId: value ? Number(value) : null, targetTariffId: null })); }}>{tariffs?.catalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></FormControl>
            <FormControl isDisabled={disabled || !operator}><FormLabel>Nowa taryfa</FormLabel><Select value={draft.targetTariffId || ''} placeholder="Wybierz taryfę" onChange={(event) => { const value = event.target.value; onChange((current) => ({ ...current, targetTariffId: value ? Number(value) : null })); }}>{operator?.tariffs.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</Select></FormControl>
            <FormControl isDisabled={disabled}><FormLabel>Nowy system rozliczeniowy</FormLabel><Select value={draft.targetSettlement || ''} placeholder="Wybierz system" onChange={(event) => { const value = event.target.value as OfferWorkspaceDraft['targetSettlement']; onChange((current) => ({ ...current, targetSettlement: value || null })); }}><option value="NET_METERING">Net-metering</option><option value="NET_BILLING">Net-billing</option></Select></FormControl>
          </Stack>
        </Grid>
        {selectedIsDifferent ? <Alert status="warning" mt="16px" borderRadius="8px"><AlertIcon />System rozliczeń szkicu różni się od projektu. Szkic zachowuje dotychczasową wartość.</Alert> : null}
        {props.tariffError ? <Alert status="warning" mt="12px"><AlertIcon />{props.tariffError}</Alert> : null}
      </AccordionPanel></AccordionItem>
      <AccordionItem><AccordionButton><Box flex="1"><Text fontSize="14px" fontWeight="700">Stawki</Text><Text fontSize="11px" color={c.muted} mt="2px">Ceny jednostkowe na bieżącą datę</Text></Box><AccordionIcon /></AccordionButton><AccordionPanel><Text color={c.muted} mb="14px">Stawki obowiązujące na {props.tariffRateDate}; nie są to koszty ani prognoza roczna.</Text><Grid templateColumns={{ base: '1fr', xl: 'repeat(2,minmax(0,1fr))' }} gap="24px"><RateRows title={`Bieżąca taryfa · ${props.tariffRateDate}`} rates={currentTariffRates} /><RateRows title={`Taryfa scenariusza · ${props.tariffRateDate}`} rates={targetTariffRates} /></Grid></AccordionPanel></AccordionItem>
      <AccordionItem><AccordionButton><Box flex="1"><Text fontSize="14px" fontWeight="700">Dane instalacji PV</Text><Text fontSize="11px" color={c.muted} mt="2px">Geometria i założenia do modelu produkcji</Text></Box><AccordionIcon /></AccordionButton><AccordionPanel>
        <ReadonlyField label="Lokalizacja" value={workspace.input.location?.address || 'Brak zapisanej lokalizacji'} />
        <FormControl mt="18px" isDisabled={disabled}><FormLabel>Magazyn energii w okresie pomiarów operatora</FormLabel><Select value={draft.existingBatteryPresent == null ? '' : draft.existingBatteryPresent ? 'yes' : 'no'} placeholder="Potwierdź stan instalacji" onChange={event => { const value = event.target.value; onChange(current => ({ ...current, existingBatteryPresent: value === '' ? null : value === 'yes' })); }}><option value="no">Bez magazynu energii</option><option value="yes">Działał magazyn energii</option></Select></FormControl>
        <Grid templateColumns={{ base: '1fr 1fr', xl: 'repeat(4,minmax(0,1fr))' }} gap="16px" mt="22px">{([
          ['powerKw', 'Moc istniejącej PV', 'kWp', 10000], ['tiltDegrees', 'Nachylenie paneli', '°', 90], ['azimuthDegrees', 'Azymut paneli', '°', 360], ['lossPercent', 'Założone straty PV', '%', 99],
        ] as const).map(([key, label, unit, max]) => <FormControl key={key} isDisabled={disabled} minW="0"><FormLabel minH="32px">{label} [{unit}]</FormLabel><Input type="number" inputMode="decimal" min={0} max={max} step={key === 'powerKw' ? '0.1' : '1'} placeholder="Nie określono" value={draft.existingPv[key] ?? ''} onChange={(event) => { const raw = event.target.value; const value = raw.trim() ? Number(raw) : null; onChange((current) => ({ ...current, existingPv: { ...current.existingPv, [key]: value != null && !Number.isFinite(value) ? null : value } })); }} /></FormControl>)}</Grid>
        <FormControl mt="22px" isDisabled={disabled}><FormLabel>Zakres fotowoltaiki</FormLabel><Select value={draft.pvStrategy} onChange={(event) => { const value = event.target.value as OfferWorkspaceDraft['pvStrategy']; onChange((current) => setOfferWorkspacePvStrategy(current, workspace.templates, value)); }}><option value="KEEP_EXISTING">Pozostaw istniejącą instalację</option><option value="ADD_TEMPLATE">Rozważ zestaw PV z katalogu</option></Select></FormControl>
      </AccordionPanel></AccordionItem>
    </Accordion>
  </OfferScreen>;
}

export function OfferDescriptionScreen({ draft, disabled, onChange }: Pick<SharedProps, 'draft' | 'disabled' | 'onChange'>) {
  const c = useOfferColors();
  return <OfferScreen><Section title="Opis" subtitle="Podsumowanie oferty dla klienta.">
    <Flex gap="20px" align={{ base: 'stretch', md: 'end' }} direction={{ base: 'column', md: 'row' }} mt="34px" mb="28px">
      <FormControl maxW={{ md: '440px' }}><FormLabel>Wzór opisu</FormLabel><Select isDisabled value="standard"><option value="standard">Standardowy opis oferty</option></Select></FormControl>
      <DisabledControl reason="Generowanie opisu przez LLM nie jest jeszcze podłączone."><Button leftIcon={<MdAutoAwesome />} size="sm" h="42px" borderRadius="13px" bg={c.soft} color="#8a47ff" isDisabled>Generuj opis</Button></DisabledControl>
    </Flex>
    <FormControl isDisabled={disabled}><FormLabel>Opis</FormLabel><Textarea aria-label="Proponowany zakres" value={draft.description.after} maxLength={10000} onChange={(event) => { const value = event.target.value; onChange((current) => ({ ...current, description: { ...current.description, after: value } })); }} minH="340px" resize="vertical" p="16px" lineHeight="1.7" placeholder="Opis proponowanego rozwiązania" /></FormControl>
    <Box as="details" mt="24px" borderTop="1px solid" borderColor={c.line} pt="16px"><Box as="summary" cursor="pointer" fontWeight="700">Stan obecny · dane uzupełniające</Box><FormControl mt="16px" isDisabled={disabled}><FormLabel>Stan obecny</FormLabel><Textarea value={draft.description.before} maxLength={10000} minH="150px" onChange={(event) => { const value = event.target.value; onChange((current) => ({ ...current, description: { ...current.description, before: value } })); }} /></FormControl></Box>
  </Section></OfferScreen>;
}

export type OfferWorkspaceCalculationPresentation = {
  recommendationEligible: boolean | null;
  recommendationReasons: string[];
  paybackYears: number | null;
  breakdown: Array<{ label: string; value: number }>;
};

export function offerWorkspaceCalculationPresentation(
  calculation: OfferWorkspaceCalculation | null | undefined,
): OfferWorkspaceCalculationPresentation {
  if (!calculation || calculation.status !== 'ready') {
    return { recommendationEligible: null, recommendationReasons: [], paybackYears: null, breakdown: [] };
  }
  const breakdown = [
    { label: 'Sama zmiana taryfy', value: calculation.tariffOnlyAnnualSavingsPln },
    { label: 'Dodatkowa korzyść ze sprzętu', value: calculation.hardwareAnnualSavingsPln },
    { label: 'Rachunek po samej zmianie taryfy', value: calculation.tariffOnlyAnnualCostPln },
  ].flatMap((item) => item.value == null ? [] : [{ label: item.label, value: item.value }]);
  const recommendationEligible = calculation.recommendationEligible ?? null;
  return {
    recommendationEligible,
    recommendationReasons: recommendationEligible === false ? calculation.recommendationReasons || [] : [],
    paybackYears: recommendationEligible === false || calculation.paybackYears == null
      ? null : Math.floor(calculation.paybackYears),
    breakdown,
  };
}

type OfferSavingsBillRow = {
  month: string;
  baseline: OfferBillingMonthResult;
  proposed: OfferBillingMonthResult | null;
};

export function offerSavingsFinancialRows(calculation: OfferWorkspaceCalculation | null | undefined): OfferSavingsBillRow[] {
  if (calculation?.status !== 'ready' || !calculation.baselineBill || !calculation.proposedBill) return [];
  const proposedByMonth = new Map(calculation.proposedBill.months.map((row) => [row.month, row]));
  return calculation.baselineBill.months.map((baseline) => ({
    month: baseline.month,
    baseline,
    proposed: proposedByMonth.get(baseline.month) || null,
  }));
}

function savingsAnnualValue(
  label: string,
  future: boolean,
  workspace: WorkspaceData,
  calculation: OfferWorkspaceCalculation | null,
): string {
  if (!calculation || calculation.status !== 'ready') return '—';
  const energy = future ? calculation.forecastEnergy : workspace.energy;
  const measurements = future ? calculation.forecastMeasurements : workspace.measurements;
  const bill = future ? calculation.proposedBill : calculation.baselineBill;
  const moneyLabels: Record<string, number | null | undefined> = {
    'Zakup energii': bill?.totals.energyCostPln,
    'Dystrybucja energii': bill?.totals.distributionCostPln,
    'Opłaty stałe': bill?.totals.fixedCostPln,
    'Całkowity rachunek': bill?.totals.cashDuePln,
  };
  if (label in moneyLabels) {
    const value = moneyLabels[label];
    return value == null ? '—' : `${format(value, 2)} zł`;
  }
  if (label === 'Oszczędność') return calculation.annualSavingsPln == null ? '—' : `${format(calculation.annualSavingsPln, 2)} zł`;
  if (label === 'Wartość skumulowanego depozytu') {
    const value = bill?.totals.depositBalancePln;
    return value == null ? '—' : `${format(value, 2)} zł`;
  }
  if (label === 'Pobór z magazynu') {
    const flows = calculation.forecastFlows;
    return !future || !flows?.length ? '—' : `${format(flows.reduce((total, flow) => total + flow.batteryToLoadKwh, 0))} kWh`;
  }
  const value = label === 'Zużycie energii'
    ? energy?.totals.loadKwh
    : label === 'Autokonsumpcja z PV'
      ? energy?.totals.directKwh
      : label === 'Zakup z sieci'
        ? measurements?.totalsImportKwh
        : null;
  return value == null ? '—' : `${format(value)} kWh`;
}

export function OfferSavingsScreen({ workspace, calculation = null }: Pick<SharedProps, 'workspace'> & { calculation?: OfferWorkspaceCalculation | null }) {
  const c = useOfferColors();
  const [expanded, setExpanded] = useState<number[]>([0, 1, 2, 3]);
  const isB2B = workspace.clientType === 'B2B';
  const readyCalculation = calculation?.status === 'ready' ? calculation : null;
  const calculationPresentation = offerWorkspaceCalculationPresentation(calculation);
  const forecast: OfferEnergyForecast | undefined = readyCalculation?.forecastEnergy && readyCalculation.forecastMeasurements
    ? { energy: readyCalculation.forecastEnergy, measurements: readyCalculation.forecastMeasurements }
    : undefined;
  const financialRows = offerSavingsFinancialRows(readyCalculation);
  const financialBasis = isB2B ? 'netto' : 'brutto';
  return <OfferScreen>
    <Section title="Stan z systemem" hideHeading>
      <OfferEnergyChart workspace={workspace} targetTariffLabel="" netMetering={false} future futureForecast={forecast} />
    </Section>
    <Section title="Zużycie energii" subtitle="Porównanie stawek i rachunków." action={<Flex gap="8px"><Button size="xs" variant="outline" onClick={() => setExpanded([0, 1, 2, 3])}>Rozwiń wszystkie</Button><Button size="xs" variant="outline" onClick={() => setExpanded([])}>Zwiń wszystkie</Button></Flex>}>
      {calculation?.status === 'blocked' && calculation.reasons.length ? <Alert status="warning" mb="14px" alignItems="flex-start" borderRadius="6px"><AlertIcon mt="2px" /><Box>{calculation.reasons.map((reason, index) => <Text key={`${index}-${reason}`}>{reason}</Text>)}</Box></Alert> : null}
      {calculation?.status === 'ready' && calculationPresentation.recommendationEligible === false ? <Alert status="warning" mb="14px" alignItems="flex-start" borderRadius="6px"><AlertIcon mt="2px" /><Box>
        <Text fontWeight="700">Wariant nie kwalifikuje się do rekomendacji sprzętu.</Text>
        {(calculationPresentation.recommendationReasons.length ? calculationPresentation.recommendationReasons : ['Brak potwierdzonej kwalifikacji do rekomendacji.']).map((reason, index) => <Text key={`${index}-${reason}`} mt="3px">{reason}</Text>)}
      </Box></Alert> : null}
      <Grid templateColumns="1fr 1fr" gap="16px" mb="12px" display={{ base: 'none', md: 'grid' }} fontWeight="700"><Text>Stan aktualny</Text><Text color="#14986c">Z systemem</Text></Grid>
      <Accordion allowMultiple index={expanded} onChange={(value) => setExpanded(value as number[])} display="grid" gridTemplateColumns={{ base: '1fr', md: 'repeat(2,minmax(0,1fr))' }} gap="12px" alignItems="start">
        {[false, true, false, true].map((future, index) => {
          const annual = index > 1;
          const title = annual ? `${future ? 'Prognozowany' : 'Aktualny'} rachunek roczny` : 'Koszt zakupu 1 kWh';
          const rows = annual ? ['Zużycie energii', 'Autokonsumpcja z PV', 'Zakup z sieci', ...(future ? ['Pobór z magazynu'] : []), 'Zakup energii', 'Dystrybucja energii', 'Opłaty stałe', 'Całkowity rachunek', ...(future ? ['Oszczędność', 'Wartość skumulowanego depozytu'] : [])] : ['Zakup energii', 'Dystrybucja energii', 'Opłata zmienna sieciowa', 'Opłata jakościowa', 'Opłata OZE', 'Opłata kogeneracyjna', 'Całkowity koszt zakupu 1 kWh', 'Opłaty stałe / miesiąc'];
          return <AccordionItem key={index} border="1px solid" borderColor={future ? '#60e5ae' : '#ffabb6'} borderRadius="16px" overflow="hidden" minW="0" gridRow={{ base: index === 1 ? 3 : index === 2 ? 2 : 'auto', md: 'auto' }}>
            <AccordionButton p="16px"><Text flex="1" textAlign="left" fontSize="14px" fontWeight="700">{title} <Text as="span" fontSize="10px" fontWeight="400">(PLN {isB2B ? 'netto' : 'brutto'})</Text></Text><AccordionIcon /></AccordionButton>
            <AccordionPanel px="16px" pb="20px"><Grid templateColumns="minmax(35px, 15%) minmax(0,1fr)" gap="14px" minH={annual ? '390px' : '275px'}>
              <Flex borderLeft="1px solid" borderBottom="1px solid" borderColor={c.line} align="center" justify="center" color={c.muted} bgImage={`repeating-linear-gradient(to top, transparent, transparent 42px, ${c.line} 43px, transparent 44px)`}>—</Flex>
              <Box>{rows.map((label) => <Flex key={label} justify="space-between" align="start" gap="10px" py="10px" borderBottom="1px solid" borderColor={c.line} fontSize="11px"><Text flex="1" minW="0">{label}</Text><Text flexShrink={0} textAlign="right">{annual ? savingsAnnualValue(label, future, workspace, readyCalculation) : '—'}</Text></Flex>)}</Box>
            </Grid></AccordionPanel>
          </AccordionItem>;
        })}
      </Accordion>
      <Metrics items={[
        { label: 'Łączna zmiana rachunku rocznego', value: readyCalculation?.annualSavingsPln == null ? '— zł / rok' : `${format(readyCalculation.annualSavingsPln, 2)} zł / rok`, green: true },
        { label: 'Zwrot z dodatkowego sprzętu', value: calculationPresentation.paybackYears == null ? '— lat' : `${format(calculationPresentation.paybackYears)} lat` },
      ]} />
      {calculationPresentation.breakdown.length ? <Grid aria-label="Rozbicie rocznej zmiany rachunku" templateColumns={{ base: '1fr', md: 'repeat(3, minmax(0, 1fr))' }} columnGap="18px" rowGap="5px" mt="10px" color={c.muted} fontSize="10px">
        {calculationPresentation.breakdown.map((item) => <Flex key={item.label} justify="space-between" gap="8px"><Text>{item.label}</Text><Text flexShrink={0} color={c.text}>{format(item.value, 2)} zł/rok</Text></Flex>)}
      </Grid> : null}
      {financialRows.length ? <Box mt="24px" aria-label="Miesięczne rachunki z kalkulacji">
        <Flex justify="space-between" align="baseline" gap="10px" wrap="wrap" mb="8px">
          <Text fontWeight="700">Rachunki miesięczne · PLN {financialBasis}</Text>
          {readyCalculation?.pricesAsOf ? <Text color={c.muted} fontSize="10px">Ceny na {readyCalculation.pricesAsOf}</Text> : null}
        </Flex>
        <TableContainer maxW="100%" border="1px solid" borderColor={c.line} borderRadius="8px">
          <Table size="sm" minW="880px" sx={{ th: { fontSize: '10px', color: c.muted, fontWeight: 500, borderColor: c.line }, td: { fontSize: '11px', py: '9px', borderColor: c.line } }}>
            <Thead>
              <Tr><Th rowSpan={2}>Miesiąc</Th><Th colSpan={4} textAlign="center">Bez systemu</Th><Th colSpan={4} textAlign="center" color="#14986c">Z systemem</Th></Tr>
              <Tr><Th isNumeric>Energia</Th><Th isNumeric>Dystrybucja</Th><Th isNumeric>Opłaty stałe</Th><Th isNumeric>Rachunek</Th><Th isNumeric>Energia</Th><Th isNumeric>Dystrybucja</Th><Th isNumeric>Opłaty stałe</Th><Th isNumeric>Rachunek</Th></Tr>
            </Thead>
            <Tbody>{financialRows.map(({ month, baseline, proposed }) => <Tr key={month}>
              <Td whiteSpace="nowrap">{monthLabel(month)}</Td>
              {[baseline.energyCostPln, baseline.distributionCostPln, baseline.fixedCostPln, baseline.cashDuePln,
                proposed?.energyCostPln, proposed?.distributionCostPln, proposed?.fixedCostPln, proposed?.cashDuePln]
                .map((value, index) => <Td key={index} isNumeric>{value == null ? '—' : format(value, 2)}</Td>)}
            </Tr>)}</Tbody>
            {readyCalculation?.baselineBill && readyCalculation.proposedBill ? <Tfoot>
              <Tr bg={c.soft} fontWeight="700"><Td>Rok</Td>
                {[readyCalculation.baselineBill.totals.energyCostPln, readyCalculation.baselineBill.totals.distributionCostPln,
                  readyCalculation.baselineBill.totals.fixedCostPln, readyCalculation.baselineBill.totals.cashDuePln,
                  readyCalculation.proposedBill.totals.energyCostPln, readyCalculation.proposedBill.totals.distributionCostPln,
                  readyCalculation.proposedBill.totals.fixedCostPln, readyCalculation.proposedBill.totals.cashDuePln]
                  .map((value, index) => <Td key={index} isNumeric>{format(value, 2)}</Td>)}
              </Tr>
            </Tfoot> : null}
          </Table>
        </TableContainer>
      </Box> : null}
    </Section>
    <Section title="Oszczędność w czasie" subtitle="Rachunek w kolejnych latach · prognoza na 20 lat" action={<FormControl maxW="200px" isDisabled><FormLabel>Roczny wzrost cen energii</FormLabel><Input placeholder="— % / rok" readOnly /></FormControl>}>
      <EmptyChart label={readyCalculation ? 'Wynik kalkulacji obejmuje jeden rok, bez prognozy wieloletniej' : 'Prognoza wymaga pełnej kalkulacji wariantu'} />
      <Metrics items={[{ label: 'Rachunki bez systemu · 20 lat', value: '— zł' }, { label: 'Rachunki z systemem · 20 lat', value: '— zł' }, { label: 'Oszczędność w ciągu 20 lat', value: '— zł', green: true }]} />
    </Section>
  </OfferScreen>;
}

export function OfferSummaryScreen({ workspace, draft, templatePreview }: Pick<SharedProps, 'workspace' | 'draft'> & { templatePreview: boolean }) {
  return <OfferScreen><Section title="Podsumowanie" subtitle="Podgląd wygenerowanego dokumentu.">
    <OfferWorkspaceDocumentPreview workspace={workspace} draft={draft} templatePreview={templatePreview} />
  </Section></OfferScreen>;
}
