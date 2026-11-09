'use client';

import {
  Accordion, AccordionButton, AccordionIcon, AccordionItem, AccordionPanel,
  Alert, AlertIcon, Box, Button, Checkbox, Flex, FormControl, FormLabel, Grid,
  Input, Link, Select, Stack, Table, TableContainer, Tbody, Td, Text, Textarea,
  Tfoot, Th, Thead, Tooltip, Tr, useColorModeValue,
} from '@chakra-ui/react';
import { useMemo, useState, type ReactNode } from 'react';
import { MdAdd, MdAutoAwesome, MdRefresh } from 'react-icons/md';
import { OfferSavingsBar, OfferSavingsProjectionChart } from './OfferSavingsCharts';
import OfferEnergyChart from './OfferEnergyChart';
import type { OfferEnergyForecast } from './OfferEnergyChart';
import OfferWorkspaceDocumentPreview from './OfferWorkspaceDocumentPreview';
import OfferCommercialSummary from './OfferCommercialSummary';
import { setOfferWorkspacePvStrategy, type OfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import type { OfferWorkspaceCalculation } from 'lib/onrevolt/offer-workspace-calculation-types';
import type { OfferBillingMonthResult } from 'lib/onrevolt/offer-workspace-billing';
import type { OfferTariffRateState } from 'lib/onrevolt/offer-workspace-tariffs';
import { adaptOfferWorkspaceProposedBillValuation, buildOfferWorkspaceSavingsPresentation, offerSavingsBatteryTotals, summarizeOfferSavingsBill } from 'lib/onrevolt/offer-workspace-savings';
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

export function offerSystemIssues(workspace: WorkspaceData, draft: OfferWorkspaceDraft): string[] {
  const annualModel = workspace.energy?.modelledMeasurements?.provenance.kind === 'annual-consumption';
  const measurementIssues = annualModel ? workspace.measurements.issues.filter(issue => ![
    'Konto ENEA nie ma zapisanego numeru PPE.', 'Nie znaleziono konta ENEA przypisanego do projektu.',
    'Brak pobranych miesięcznych plików ENEA w okresie ', 'Model rocznego zużycia:',
    'Import pomiarów godzinowych dla operatora ',
  ].some(prefix => issue.startsWith(prefix))) : workspace.measurements.issues;
  const issues = [...workspace.input.issues.filter(issue =>
    !(draft.existingPv.powerKw != null && issue.startsWith('Brak potwierdzonej mocy istniejącej PV'))
    && !(workspace.energy?.totals.loadKwh != null && issue.startsWith('Brak zapisanej rocznej deklaracji zużycia'))),
    ...measurementIssues, ...(workspace.energy?.issues || []), ...(workspace.energyError ? [workspace.energyError] : []),
    ...(workspace.draft && workspace.draft.sourceRevision !== workspace.revision ? ['Dane projektu lub katalogu zmieniły się od zapisu szkicu. Obliczenia zachowują ręczne założenia PV ze szkicu; sprawdź je przed kolejnym zapisem.'] : [])];
  return [...new Set(issues)];
}

export function OfferSystemScreen(props: SharedProps & { tariffError: string }) {
  const { workspace, draft, tariffs, disabled, onChange, currentTariffRates, targetTariffRates } = props;
  const c = useOfferColors();
  const [expanded, setExpanded] = useState<number[] | null>(null);
  const operator = tariffs?.catalog.find((item) => item.id === draft.targetOperatorId);
  const issues = offerSystemIssues(workspace, draft);
  const selectedIsDifferent = draft.existingPv.powerKw !== 0 && draft.currentSettlement !== props.actualSettlement;
  return <OfferScreen>
    <Section title="Stan aktualny" hideHeading>
      <OfferEnergyChart workspace={workspace} targetTariffLabel={operator ? `${operator.name} · ${operator.tariffs.find(item => item.id === draft.targetTariffId)?.code || 'Nie wybrano taryfy docelowej'}` : 'Nie wybrano taryfy docelowej'} netMetering={draft.existingPv.powerKw !== 0 && props.actualSettlement === 'NET_METERING'} />
      <Box mt="20px" borderTop="1px solid" borderColor={c.line} pt="14px"><DisabledControl reason="Zwiększenie zapotrzebowania będzie dostępne wraz z pełną symulacją."><Button variant="ghost" size="sm" rightIcon={<MdAdd />} fontSize="12px" isDisabled>Zwiększ zapotrzebowanie</Button></DisabledControl></Box>
      {issues.length ? <Alert status="warning" mt="12px" borderRadius="8px"><AlertIcon /><Box>{issues.map((issue, index) => <Text key={index}>{issue}</Text>)}</Box></Alert> : null}
    </Section>
    <Flex justify="space-between" gap="10px" align="center" wrap="wrap"><Text fontSize="13px" fontWeight="700">System rozliczeń i stawki</Text><Flex gap="8px"><Button size="xs" variant="outline" onClick={() => setExpanded([0, 1, 2])}>Rozwiń wszystkie</Button><Button size="xs" variant="outline" onClick={() => setExpanded([])}>Zwiń wszystkie</Button></Flex></Flex>
    <Accordion allowMultiple index={offerSystemExpandedPanels(currentTariffRates, targetTariffRates, expanded)} onChange={(value) => setExpanded(value as number[])} sx={{ '.chakra-accordion__item': { border: '1px solid', borderColor: c.line, borderRadius: '17px', mb: '12px', overflow: 'hidden' }, '.chakra-accordion__button': { p: '18px', textAlign: 'left' }, '.chakra-accordion__panel': { px: { base: '16px', md: '24px' }, pb: '24px' } }}>
      <AccordionItem><AccordionButton><Box flex="1"><Text fontWeight="700" fontSize="14px">System rozliczeń</Text><Text color={c.muted} fontSize="11px" mt="2px">Operator, taryfa i system rozliczeniowy</Text></Box><AccordionIcon /></AccordionButton><AccordionPanel>
        <Grid templateColumns={{ base: '1fr', md: 'repeat(2,minmax(0,1fr))' }} gap="48px" pt="12px">
          <Stack spacing="22px"><ReadonlyField label="Aktualny operator" value={props.currentTariffLabel.includes(' · ') ? props.currentTariffLabel.split(' · ')[0] : 'Nie określono'} /><ReadonlyField label="Aktualna taryfa" value={props.currentTariffLabel.includes(' · ') ? props.currentTariffLabel.split(' · ').slice(1).join(' · ') : props.currentTariffLabel} /><ReadonlyField label="Aktualny system rozliczeniowy" value={draft.existingPv.powerKw === 0 ? 'Zakup energii z sieci (brak PV)' : settlement(props.actualSettlement)} /></Stack>
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
        <Flex mt="18px" direction={{ base: 'column', sm: 'row' }} gap="8px" justify="space-between" align={{ sm: 'end' }}>
          <ReadonlyField label="Istniejący magazyn energii · Dane energetyczne" value={workspace.input.existingBatteryPresent == null
            ? 'Status nieustalony'
            : workspace.input.existingBatteryPresent
              ? workspace.input.existingBatteryKwh == null ? 'Tak, pojemność nieustalona' : `Tak, ${format(workspace.input.existingBatteryKwh)} kWh`
              : 'Nie (0 kWh)'} />
          <Link href={`/admin/clients/${encodeURIComponent(workspace.clientId)}?projectId=${encodeURIComponent(workspace.projectId)}&tab=billing#energy-data`} color="#8a47ff" textDecoration="underline" fontSize="11px" whiteSpace="nowrap">
            Otwórz Dane energetyczne
          </Link>
        </Flex>
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
      ? null : calculation.paybackYears,
    breakdown,
  };
}

type OfferSavingsBillRow = {
  month: string;
  baseline: OfferBillingMonthResult;
  proposed: OfferBillingMonthResult | null;
};

export function offerSavingsFinancialRows(calculation: OfferWorkspaceCalculation | null | undefined, comparison: 'CURRENT' | 'TARGET_TARIFF' = 'CURRENT'): OfferSavingsBillRow[] {
  const baselineBill = comparison === 'TARGET_TARIFF' ? calculation?.tariffOnlyBill : calculation?.baselineBill;
  if (calculation?.status !== 'ready' || !baselineBill || !calculation.proposedBill) return [];
  const proposedByMonth = new Map(calculation.proposedBill.months.map((row) => [row.month, row]));
  return baselineBill.months.map((baseline) => ({
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
    'Pokrycie energii opustem / depozytem': bill?.totals.coveredEnergyPln,
    'Wartość energii oddanej': bill?.totals.exportValuePln,
    'Depozyt wykorzystany': bill?.totals.depositUsedPln,
    'Depozyt oczekujący': bill?.totals.pendingDepositPln,
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

export function OfferSavingsScreen({ workspace, draft, currentTariffLabel, targetTariffLabel, currentTariffRates, targetTariffRates, calculation = null, calculationLoading = false, calculationError = '', calculationDisabled = false, onCalculate }: Pick<SharedProps, 'workspace' | 'draft' | 'currentTariffLabel' | 'currentTariffRates' | 'targetTariffRates'> & {
  targetTariffLabel: string;
  calculation?: OfferWorkspaceCalculation | null;
  calculationLoading?: boolean;
  calculationError?: string;
  calculationDisabled?: boolean;
  onCalculate: () => void;
}) {
  const c = useOfferColors();
  const [expanded, setExpanded] = useState<number[]>([0, 1, 2, 3]);
  const [billComparison, setBillComparison] = useState<'CURRENT' | 'TARGET_TARIFF'>('CURRENT');
  const isB2B = workspace.clientType === 'B2B';
  const matchesSelection = calculation?.evaluatedTemplateIds?.length === draft.selectedTemplateIds.length
    && draft.selectedTemplateIds.every(id => calculation?.evaluatedTemplateIds?.includes(id));
  const readyCalculation = matchesSelection && calculation?.status === 'ready' ? calculation : null;
  const calculationPresentation = offerWorkspaceCalculationPresentation(readyCalculation);
  const results = useMemo(() => {
    if (!readyCalculation) return { forecast: undefined, before: null, after: null, projection: null, error: '' };
    try {
      const before = readyCalculation.baselineBill ? summarizeOfferSavingsBill(readyCalculation.baselineBill, draft.currentSettlement) : null;
      const after = readyCalculation.proposedBill ? summarizeOfferSavingsBill(readyCalculation.proposedBill, draft.targetSettlement) : null;
      const forecast: OfferEnergyForecast | undefined = readyCalculation.forecastEnergy && readyCalculation.forecastMeasurements
        ? { energy: readyCalculation.forecastEnergy, measurements: readyCalculation.forecastMeasurements,
          valuation: readyCalculation.proposedBill ? adaptOfferWorkspaceProposedBillValuation(readyCalculation.proposedBill, draft.targetSettlement, readyCalculation.forecastMeasurements.dayProfiles || []) : null,
          battery: readyCalculation.forecastFlows ? offerSavingsBatteryTotals(readyCalculation.forecastFlows) : null }
        : undefined;
      const projection = readyCalculation.estimatedAnnualTargetCostPln && readyCalculation.estimatedAnnualTariffOnlyCostPln
        ? buildOfferWorkspaceSavingsPresentation(readyCalculation, draft.targetSettlement).projection : null;
      return { forecast, before, after, projection, error: '' };
    } catch (error) {
      return { forecast: undefined, before: null, after: null, projection: null, error: error instanceof Error ? error.message : 'Nie udało się odczytać wyniku kalkulacji.' };
    }
  }, [readyCalculation, draft.currentSettlement, draft.targetSettlement]);
  const { forecast, before, after, projection } = results;
  const estimatedPayback = readyCalculation?.estimatedPaybackYears;
  const displayedPayback = estimatedPayback != null ? estimatedPayback : calculationPresentation.paybackYears;
  const rateTotal = (bill: typeof before) => bill?.totals.averageEnergyPurchasePlnPerKwh == null || bill.totals.averageDistributionPurchasePlnPerKwh == null
    ? null : bill.totals.averageEnergyPurchasePlnPerKwh + bill.totals.averageDistributionPurchasePlnPerKwh;
  const rateMaximum = Math.max(.2, Math.ceil(Math.max(rateTotal(before) ?? 0, rateTotal(after) ?? 0) * 5) / 5);
  const billMaximum = Math.max(1000, Math.ceil(Math.max(before?.totals.cashDuePln ?? 0, after?.totals.cashDuePln ?? 0) / 1000) * 1000);
  const financialRows = offerSavingsFinancialRows(readyCalculation, billComparison);
  const financialBaseline = billComparison === 'TARGET_TARIFF' ? readyCalculation?.tariffOnlyBill : readyCalculation?.baselineBill;
  const comparisonSettlement = billComparison === 'TARGET_TARIFF' ? draft.targetSettlement : draft.currentSettlement;
  const financialBasis = isB2B ? 'netto' : 'brutto';
  return <OfferScreen>
    <Flex justify="space-between" align="center" gap="12px" wrap="wrap">
      <Text color={c.muted}>{calculationLoading ? 'Przeliczam wybraną konfigurację…' : readyCalculation ? 'Wynik wybranej konfiguracji · szacunek RE' : 'Oblicz wybraną konfigurację, aby uzupełnić oszczędności.'}</Text>
      <Button size="sm" variant="outline" leftIcon={<MdRefresh />} isLoading={calculationLoading} isDisabled={calculationDisabled} onClick={onCalculate}>Oblicz wybrany wariant</Button>
    </Flex>
    {calculationError ? <Alert status="error"><AlertIcon />{calculationError}</Alert> : null}
    {results.error ? <Alert status="error"><AlertIcon />{results.error} Przelicz wariant ponownie.</Alert> : null}
    <Section title="Stan z systemem" hideHeading>
      <OfferEnergyChart workspace={workspace} targetTariffLabel={targetTariffLabel} netMetering={draft.targetSettlement === 'NET_METERING'} future futureForecast={forecast} />
    </Section>
    <Section title="Zużycie energii" subtitle="Porównanie stawek i rachunków." action={<Flex gap="8px"><Button size="xs" variant="outline" onClick={() => setExpanded([0, 1, 2, 3])}>Rozwiń wszystkie</Button><Button size="xs" variant="outline" onClick={() => setExpanded([])}>Zwiń wszystkie</Button></Flex>}>
      {calculation?.status === 'blocked' && calculation.reasons.length ? <Alert status="warning" mb="14px" alignItems="flex-start" borderRadius="6px"><AlertIcon mt="2px" /><Box>{calculation.reasons.map((reason, index) => <Text key={`${index}-${reason}`}>{reason}</Text>)}</Box></Alert> : null}
      {readyCalculation?.warnings.length ? <Alert status="warning" mb="14px" alignItems="flex-start" borderRadius="6px"><AlertIcon mt="2px" /><Box as="details" minW="0"><Box as="summary" cursor="pointer" fontWeight="700">Uwagi i założenia do wyniku ({readyCalculation.warnings.length})</Box>{readyCalculation.warnings.map((reason, index) => <Text key={`${index}-${reason}`} mt="6px">{reason}</Text>)}</Box></Alert> : null}
      <Grid templateColumns="1fr 1fr" gap="16px" mb="12px" display={{ base: 'none', md: 'grid' }} fontWeight="700"><Box><Text>Stan aktualny</Text><Text fontSize="11px" fontWeight="400" color={c.muted}>{currentTariffLabel} · {(draft.existingPv.powerKw === 0 ? 'Zakup z sieci (brak PV)' : settlement(draft.currentSettlement))}</Text></Box><Box><Text color="#14986c">Z systemem</Text><Text fontSize="11px" fontWeight="400" color={c.muted}>{targetTariffLabel} · {settlement(draft.targetSettlement)}</Text></Box></Grid>
      <Accordion allowMultiple index={expanded} onChange={(value) => setExpanded(value as number[])} display="grid" gridTemplateColumns={{ base: '1fr', md: 'repeat(2,minmax(0,1fr))' }} gap="12px" alignItems="start">
        {[false, true, false, true].map((future, index) => {
          const annual = index > 1;
          const title = annual ? `${future ? 'Prognozowany' : 'Aktualny'} rachunek roczny` : 'Średni koszt zakupu 1 kWh';
          const rows = annual ? ['Zużycie energii', 'Autokonsumpcja z PV', 'Zakup z sieci', ...(future ? ['Pobór z magazynu'] : []), 'Zakup energii', 'Dystrybucja energii', 'Opłaty stałe', 'Całkowity rachunek', ...(future ? ['Oszczędność', 'Wartość skumulowanego depozytu'] : [])] : ['Zakup energii', 'Dystrybucja energii', 'Całkowity koszt zakupu 1 kWh', 'Opłaty stałe / miesiąc'];
          const bill = future ? after : before;
          const unitValues: Record<string, number | null | undefined> = {
            'Zakup energii': bill?.totals.averageEnergyPurchasePlnPerKwh,
            'Dystrybucja energii': bill?.totals.averageDistributionPurchasePlnPerKwh,
            'Całkowity koszt zakupu 1 kWh': rateTotal(bill),
            'Opłaty stałe / miesiąc': bill?.averageMonthlyFixedCostPln,
          };
          const parts = bill ? annual ? [
            { label: 'Opłaty stałe', value: bill.totals.paidFixedCostPln, color: '#ffcd95' },
            { label: 'Dystrybucja energii', value: bill.totals.paidDistributionCostPln, color: '#ffb362' },
            { label: 'Zakup energii', value: bill.totals.paidEnergyCostPln, color: '#ff8505' },
            ...(future && readyCalculation?.annualSavingsPln != null && readyCalculation.annualSavingsPln > 0 ? [{ label: 'Oszczędność', value: readyCalculation.annualSavingsPln, color: '#7ce4bb' }] : []),
          ] : [
            { label: 'Dystrybucja energii', value: bill.totals.averageDistributionPurchasePlnPerKwh, color: '#ffb362' },
            { label: 'Zakup energii', value: bill.totals.averageEnergyPurchasePlnPerKwh, color: '#ff8505' },
          ].flatMap(part => part.value == null ? [] : [{ ...part, value: part.value }]) : [];
          return <AccordionItem key={index} border="1px solid" borderColor={future ? '#60e5ae' : '#ffabb6'} borderRadius="16px" overflow="hidden" minW="0" gridRow={{ base: index === 1 ? 3 : index === 2 ? 2 : 'auto', md: 'auto' }}>
            <AccordionButton p="16px"><Text flex="1" textAlign="left" fontSize="14px" fontWeight="700">{title} <Text as="span" fontSize="10px" fontWeight="400">(PLN {isB2B ? 'netto' : 'brutto'})</Text></Text><AccordionIcon /></AccordionButton>
            <AccordionPanel px="16px" pb="20px"><Text display={{ base: 'block', md: 'none' }} color={c.muted} fontSize="11px" mb="12px">{future ? 'Z systemem' : 'Stan aktualny'} · {future ? targetTariffLabel : currentTariffLabel}</Text><Grid templateColumns="minmax(65px, 19%) minmax(0,1fr)" gap="10px" minH={annual ? '390px' : '260px'}>
              <OfferSavingsBar parts={parts} maximum={annual ? billMaximum : rateMaximum} unit={annual ? 'PLN' : 'PLN/kWh'} />
              <Box>{rows.map((label) => <Flex key={label} justify="space-between" align="start" gap="10px" py="10px" borderBottom="1px solid" borderColor={c.line} fontSize="11px" fontWeight={label.startsWith('Całkowity') ? 700 : 400}><Text flex="1" minW="0">{label}</Text><Text flexShrink={0} textAlign="right">{annual ? savingsAnnualValue(label, future, workspace, readyCalculation) : unitValues[label] == null ? '—' : `${format(unitValues[label], label === 'Opłaty stałe / miesiąc' ? 2 : 4)} zł`}</Text></Flex>)}</Box>
            </Grid></AccordionPanel>
          </AccordionItem>;
        })}
      </Accordion>
      <Text fontSize="10px" color={c.muted} mt="8px">Stawki średnie ważone poborem, przed rozliczeniem PV, bez opłat stałych. Rachunki uwzględniają opust lub depozyt. Pobór z sieci obejmuje także ładowanie magazynu; rozładowanie magazynu nie jest dodatkowym zakupem.</Text>
      <Box as="details" mt="16px"><Box as="summary" cursor="pointer" fontWeight="700">Szczegółowe składniki cenników</Box><Grid templateColumns={{ base: '1fr', xl: '1fr 1fr' }} gap="24px" mt="16px"><RateRows title={currentTariffLabel} rates={currentTariffRates} /><RateRows title={targetTariffLabel} rates={targetTariffRates} /></Grid></Box>
      <Metrics items={[
        { label: 'Łączna zmiana rachunku rocznego', value: readyCalculation?.annualSavingsPln == null ? '— zł / rok' : `${format(readyCalculation.annualSavingsPln, 2)} zł / rok`, green: true },
        { label: 'Szacunkowy zwrot z dodatkowego sprzętu', value: displayedPayback == null ? '— lat' : `${format(displayedPayback)} lat` },
      ]} />
      {calculationPresentation.breakdown.length ? <Grid aria-label="Rozbicie rocznej zmiany rachunku" templateColumns={{ base: '1fr', md: 'repeat(3, minmax(0, 1fr))' }} columnGap="18px" rowGap="5px" mt="10px" color={c.muted} fontSize="10px">
        {calculationPresentation.breakdown.map((item) => <Flex key={item.label} justify="space-between" gap="8px"><Text>{item.label}</Text><Text flexShrink={0} color={c.text}>{format(item.value, 2)} zł/rok</Text></Flex>)}
      </Grid> : null}
      {financialRows.length ? <Box mt="24px" aria-label="Miesięczne rachunki z kalkulacji">
        <Flex justify="space-between" align="baseline" gap="10px" wrap="wrap" mb="8px">
          <Text fontWeight="700">Rachunki miesięczne · kwoty do zapłaty · PLN {financialBasis}</Text>
          {readyCalculation?.pricesAsOf ? <Text color={c.muted} fontSize="10px">Ceny na {readyCalculation.pricesAsOf}</Text> : null}
        </Flex>
        <FormControl maxW="440px" mb="12px"><FormLabel htmlFor="offer-bill-comparison">Porównanie rachunków</FormLabel><Select id="offer-bill-comparison" value={billComparison} onChange={event => setBillComparison(event.target.value as 'CURRENT' | 'TARGET_TARIFF')}>
          <option value="CURRENT">Stan obecny → po inwestycji i zmianie taryfy</option>
          <option value="TARGET_TARIFF" disabled={!readyCalculation?.tariffOnlyBill}>Ta sama taryfa docelowa → korzyść ze sprzętu</option>
        </Select></FormControl>
        <Text fontSize="11px" color={c.muted} mb="12px">
          {billComparison === 'CURRENT'
            ? `Stan obecny: ${currentTariffLabel} · ${(draft.existingPv.powerKw === 0 ? 'Zakup z sieci (brak PV)' : settlement(draft.currentSettlement))}. Po inwestycji: ${targetTariffLabel} · ${settlement(draft.targetSettlement)}.`
            : `Oba warianty: ${targetTariffLabel} · ${settlement(draft.targetSettlement)}. To porównanie jest podstawą wykresu zwrotu sprzętu.`}
          {draft.existingPv.powerKw != null && draft.existingPv.powerKw > 0 ? ` Wariant bez nowej inwestycji obejmuje istniejącą instalację PV ${format(draft.existingPv.powerKw, 2)} kWp.` : ''}
        </Text>
        <TableContainer maxW="100%" border="1px solid" borderColor={c.line} borderRadius="8px">
          <Table size="sm" minW="1080px" sx={{ th: { fontSize: '10px', color: c.muted, fontWeight: 500, borderColor: c.line }, td: { fontSize: '11px', py: '9px', borderColor: c.line } }}>
            <Thead>
              <Tr><Th rowSpan={2}>Miesiąc</Th><Th colSpan={5} textAlign="center">{billComparison === 'CURRENT' ? 'Stan obecny' : 'Taryfa docelowa bez inwestycji'} · {settlement(comparisonSettlement)}</Th><Th colSpan={5} textAlign="center" color="#14986c">Po inwestycji · {settlement(draft.targetSettlement)}</Th></Tr>
              <Tr>{[0, 1].map(side => <SavingsBillHeaders key={side} />)}</Tr>
            </Thead>
            <Tbody>{financialRows.map(({ month, baseline, proposed }) => <Tr key={month}>
              <Td whiteSpace="nowrap">{monthLabel(month)}</Td>
              {[baseline.importKwh, baseline.energyCostPln, baseline.distributionCostPln, baseline.fixedCostPln, baseline.cashDuePln,
                proposed?.importKwh, proposed?.energyCostPln, proposed?.distributionCostPln, proposed?.fixedCostPln, proposed?.cashDuePln]
                .map((value, index) => <Td key={index} isNumeric>{value == null ? '—' : format(value, 2)}</Td>)}
            </Tr>)}</Tbody>
            {financialBaseline && readyCalculation?.proposedBill ? <Tfoot>
              <Tr bg={c.soft} fontWeight="700"><Td>Rok</Td>
                {[financialBaseline.totals.importKwh, financialBaseline.totals.energyCostPln, financialBaseline.totals.distributionCostPln,
                  financialBaseline.totals.fixedCostPln, financialBaseline.totals.cashDuePln,
                  readyCalculation.proposedBill.totals.importKwh, readyCalculation.proposedBill.totals.energyCostPln, readyCalculation.proposedBill.totals.distributionCostPln,
                  readyCalculation.proposedBill.totals.fixedCostPln, readyCalculation.proposedBill.totals.cashDuePln]
                  .map((value, index) => <Td key={index} isNumeric>{format(value, 2)}</Td>)}
              </Tr>
            </Tfoot> : null}
          </Table>
        </TableContainer>
        <Text fontSize="11px" color={c.muted} mt="10px">Pobór z sieci pokazuje ilość energii, a kolumny pieniężne — kwoty po rozliczeniu PV. Zero zł nie oznacza zerowego poboru. W net-meteringu opust pokrywa energię i zmienną dystrybucję. W net-billingu depozyt pokrywa tylko energię; dystrybucja i opłaty stałe pozostają do zapłaty. Wyższy rachunek w pojedynczym miesiącu jest możliwy — sumę roku pokazuje ostatni wiersz.</Text>
      </Box> : null}
    </Section>
    <Section title="Finansowanie" subtitle={`Kwoty ${financialBasis} · szacunek warunkowy`}>
      <Metrics items={[
        { label: 'Koszt systemu', value: `${format(readyCalculation?.systemCostPln, 2)} zł` },
        { label: 'Dotacja', value: `${format(readyCalculation?.grantPln, 2)} zł` },
        { label: 'Ulga termomodernizacyjna', value: `${format(readyCalculation?.taxReliefPln, 2)} zł` },
      ]} />
      <Flex justify="space-between" gap="16px" wrap="wrap" mt="18px" p="18px" bg={c.soft} color="#14986c" fontWeight="700" borderRadius="8px"><Text>Koszt systemu po dofinansowaniach</Text><Text fontSize="22px">{format(readyCalculation?.costAfterFinancingPln, 2)} zł</Text></Flex>
    </Section>
    <Section title="Oszczędność w czasie" subtitle={`Koszty skumulowane · ta sama taryfa docelowa · ${projection?.horizonYears ?? 20} lat`} action={<FormControl maxW="220px"><FormLabel>Roczny wzrost kosztów prądu</FormLabel><Input value={projection ? `${format(projection.annualPriceGrowthRate * 100)}% rocznie` : '5% rocznie · po przeliczeniu'} readOnly /></FormControl>}>
      {projection ? <OfferSavingsProjectionChart before={projection.cumulativeTariffOnlyCostPln} after={projection.cumulativeTargetCostPln} paybackYears={projection.estimatedPaybackYears} /> : <EmptyChart label={readyCalculation ? 'Prognoza wieloletnia niedostępna. Przelicz wariant lub sprawdź uwagi do wyniku.' : 'Prognoza wymaga kalkulacji wybranego wariantu'} />}
      <Text fontSize="11px" color={c.muted} mt="12px">Linia z systemem zaczyna się od kosztu inwestycji po finansowaniu. Do obu linii dodajemy kolejne rachunki. Ich przecięcie oznacza, że oszczędności pokryły koszt inwestycji.</Text>
      <Metrics items={[
        { label: `Rachunki bez inwestycji · ${projection?.horizonYears ?? 20} lat`, value: `${format(projection?.totalTariffOnlyCostPln, 2)} zł` },
        { label: `Rachunki z systemem · ${projection?.horizonYears ?? 20} lat`, value: `${format(projection?.totalTargetCostPln, 2)} zł` },
        { label: `Oszczędność ze sprzętu · ${projection?.horizonYears ?? 20} lat`, value: `${format(projection?.totalSavingsPln, 2)} zł`, green: true },
      ]} />
      <Flex justify="space-between" gap="16px" wrap="wrap" mt="18px" p="18px" bg={c.soft} color="#14986c" fontWeight="700" borderRadius="8px"><Text>Korzyść po odjęciu kosztu inwestycji</Text><Text fontSize="22px">{format(projection?.netSavingsAfterCostPln, 2)} zł</Text></Flex>
      <Text fontSize="10px" color={c.muted} mt="10px">{projection ? `Założenie: zakup energii, dystrybucja i opłaty stałe +${format(projection.annualPriceGrowthRate * 100)}% rocznie od drugiego roku; cena oddania energii bez wzrostu. Powtórzenie profilu rocznego z przenoszeniem i wygasaniem nominalnego depozytu. Stałe zużycie i praca systemu, bez degradacji, dyskontowania oraz kosztów serwisu. Porównanie nie obejmuje korzyści ani kosztu przejścia ze starej taryfy i rozliczenia na nowe.` : 'Założenia prognozy będą widoczne po przeliczeniu wariantu.'}</Text>
    </Section>
  </OfferScreen>;
}

function SavingsBillHeaders() {
  return <><Th isNumeric>Pobór z sieci (kWh)</Th><Th isNumeric>Energia do zapłaty</Th><Th isNumeric>Dystrybucja do zapłaty</Th><Th isNumeric>Opłaty stałe</Th><Th isNumeric>Rachunek</Th></>;
}

export function OfferSummaryScreen({ workspace, draft, disabled, onChange, itemsEditable, templatePreview }: Pick<SharedProps, 'workspace' | 'draft' | 'disabled' | 'onChange'> & { itemsEditable: boolean; templatePreview: boolean }) {
  return <OfferScreen><Section title="Podsumowanie" subtitle="Podgląd wygenerowanego dokumentu.">
    <OfferCommercialSummary workspace={workspace} draft={draft} disabled={disabled || templatePreview} itemsEditable={itemsEditable} onChange={onChange} />
    <OfferWorkspaceDocumentPreview workspace={workspace} draft={draft} templatePreview={templatePreview} />
  </Section></OfferScreen>;
}
