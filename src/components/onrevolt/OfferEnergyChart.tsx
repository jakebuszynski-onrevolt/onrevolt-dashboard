'use client';

import { Box, Flex, Grid, Select, Text, Tooltip, Checkbox, useColorModeValue } from '@chakra-ui/react';
import { useId, useMemo, useState } from 'react';
import type { WorkspaceData } from './OfferWorkspacePanel';
import type { OfferWorkspaceEnergy } from 'lib/onrevolt/offer-workspace-energy';
import type { OfferWorkspaceMeasurements } from 'lib/onrevolt/offer-workspace-server';
import type { OfferWorkspaceValuationScenario, OfferWorkspaceValuationValues } from 'lib/onrevolt/offer-workspace-valuation';

export type OfferEnergyForecast = {
  energy: OfferWorkspaceEnergy;
  measurements: OfferWorkspaceMeasurements;
  valuation?: OfferWorkspaceValuationScenario | null;
  battery?: { months: Record<string, number>; hours: Record<string, number> } | null;
};

export type EnergyChartRow = {
  label: string;
  title: string;
  importKwh: number | null;
  exportKwh: number | null;
  loadKwh: number | null;
  pvKwh: number | null;
  directKwh: number | null;
  batteryKwh?: number | null;
};

const number = (value: number | null | undefined, digits = 1) => value == null ? '—' : new Intl.NumberFormat('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const shortMonth = (period: string) => new Intl.DateTimeFormat('pl-PL', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${period}-01T12:00:00Z`));
const longMonth = (period: string) => { const label = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}-01T12:00:00Z`)); return label[0].toUpperCase() + label.slice(1); };

export function niceEnergyCeil(value: number) {
  if (value <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(value));
  const k = value / base;
  return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 4 ? 4 : k <= 5 ? 5 : 10) * base;
}

export function offerEnergyAxisCeil(value: number, annual: boolean) {
  if (!annual || value <= 1000) return niceEnergyCeil(value);
  return Math.ceil(value / 1000) * 1000;
}

export function energyStepPath(rows: EnergyChartRow[], key: 'loadKwh' | 'pvKwh', y: (value: number) => number) {
  const band = 922 / Math.max(rows.length, 1);
  let path = '', connected = false;
  rows.forEach((row, index) => {
    const value = row[key];
    if (value == null) { connected = false; return; }
    const xa = 58 + index * band, xb = xa + band;
    path += `${connected ? 'L' : 'M'}${xa} ${y(value)}L${xb} ${y(value)}`;
    connected = true;
  });
  return path;
}

// Geometry, series colours and stepped paths follow drawChart in the supplied Horizon SVG.
export function OfferEnergyPlot({ rows, annual, future = false }: { rows: EnergyChartRow[]; annual: boolean; future?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const surface = useColorModeValue('white', '#111c44');
  const H = 210, L = 58, T = 25, B = 38, w = 922, h = H - T - B;
  const max = offerEnergyAxisCeil(Math.max(1, ...rows.flatMap(r => [r.importKwh ?? 0, r.loadKwh ?? 0, r.pvKwh ?? 0])), annual);
  const hasExport = rows.some(r => r.exportKwh != null && r.exportKwh > .01);
  const bottom = hasExport ? niceEnergyCeil(Math.max(...rows.map(r => r.exportKwh ?? 0))) : 0;
  const range = max + bottom, y = (v: number) => T + (max - v) / range * h;
  const band = w / Math.max(rows.length, 1), bw = band * .68;
  const current = active == null ? null : rows[active];
  const hasData = rows.some(r => r.importKwh != null || r.exportKwh != null || r.loadKwh != null || r.pvKwh != null);
  return <Box position="relative" mt="6px" data-energy-plot={annual ? 'annual' : 'hourly'}>
    <Box overflowX="auto" pb="4px">
      <Box as="svg" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" w="100%" minW="620px" h={{ base: '190px', md: '225px' }} role="img" aria-label={`${future ? 'Stan z systemem' : 'Stan aktualny'}; energia ${annual ? 'miesięczna' : 'godzinowa'} w kWh`} fontFamily="DM Sans, sans-serif">
        <title>{future ? 'Stan z systemem' : 'Stan aktualny'}</title>
        {Array.from({ length: 5 }, (_, i) => { const value = max * i / 4; return <g key={i}><line x1={L} x2={980} y1={y(value)} y2={y(value)} stroke="#e9eef8" /><text x={L - 10} y={y(value) + 4} textAnchor="end" fontSize="12" fill="#8190b5">{number(value, max < 10 ? 1 : 0)}</text></g>; })}
        <text x={L} y={13} fontSize="12" fill="#8190b5">kWh / {annual ? 'miesiąc' : 'godzinę'}</text>
        <line x1={L} x2={980} y1={y(0)} y2={y(0)} stroke="#bac6df" />
        {rows.map((row, i) => <g key={i}>
          {row.importKwh != null ? <rect data-series="import" x={L + (i + .5) * band - bw / 2} y={y(row.importKwh)} width={bw} height={row.importKwh / range * h} fill="#ff8505" rx="3" /> : null}
          {row.exportKwh != null && row.exportKwh > 0 ? <rect data-series="export" x={L + (i + .5) * band - bw / 2} y={y(0) + 1} width={bw} height={row.exportKwh / range * h} fill="#087744" opacity=".85" rx="1" /> : null}
          <text x={L + (i + .5) * band} y={H - 11} fontSize="12" fill="#7c8cb0" textAnchor="middle">{row.label}</text>
        </g>)}
        {(['pvKwh', 'loadKwh'] as const).map(key => { const d = energyStepPath(rows, key, y); return d ? <g key={key}><path d={d} fill="none" stroke="white" strokeWidth="5" /><path data-series={key} d={d} fill="none" stroke={key === 'pvKwh' ? '#efbc50' : '#96a4ca'} strokeWidth="2.5" /></g> : null; })}
        {hasExport ? <text x={L - 10} y={y(-bottom) + 3} textAnchor="end" fontSize="11" fill="#087744">oddanie</text> : null}
        {!hasData ? <text x="520" y="95" textAnchor="middle" fontSize="12" fill="#8190b5">{future ? 'Wyniki symulacji RE jeszcze niedostępne' : 'Brak pełnego dnia pomiarowego'}</text> : null}
        {rows.map((row, i) => <rect key={i} x={L + i * band} y={T} width={band} height={h} fill="transparent" tabIndex={0} role="button" aria-label={`${row.title}, pobór ${number(row.importKwh, 2)} kWh, oddanie ${number(row.exportKwh, 2)} kWh`} aria-describedby={active === i ? id : undefined} onPointerMove={() => setActive(i)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onClick={() => setActive(active === i ? null : i)} />)}
      </Box>
    </Box>
    {current ? <Box id={id} role="tooltip" position="absolute" pointerEvents="none" top="15px" right="20px" p="12px" w="260px" maxW="calc(100% - 30px)" bg={surface} boxShadow="0 5px 24px #26346322" border="1px solid #e2e8f5" borderRadius="8px" fontSize="11px"><Text fontWeight="700" mb="6px">{current.title}</Text>{[['Zużycie energii', current.loadKwh], ['Produkcja PV', current.pvKwh], ['Autokonsumpcja z PV', current.directKwh], ['Zakup z sieci', current.importKwh], ['Oddanie do sieci', current.exportKwh]].map(([label, value]) => <Flex key={String(label)} justify="space-between" gap="12px"><Text>{label}</Text><Text>{number(value as number | null, 2)} kWh</Text></Flex>)}</Box> : null}
  </Box>;
}

function total(rows: EnergyChartRow[], key: keyof EnergyChartRow) {
  if (!rows.length || rows.some(row => row[key] == null)) return null;
  return rows.reduce((sum, row) => sum + Number(row[key]), 0);
}

export function OfferEnergySummary({ rows, netMetering, b2b, future = false, sourceNote, valuation, valuationLoading = false }: { rows: EnergyChartRow[]; netMetering: boolean; b2b: boolean; future?: boolean; sourceNote?: string; valuation?: OfferWorkspaceValuationValues | null; valuationLoading?: boolean }) {
  const line = useColorModeValue('#e2e8f5', 'whiteAlpha.200');
  const muted = useColorModeValue('#8392b5', 'gray.400');
  const flows = [
    { label: 'Zużycie energii', key: 'loadKwh', color: '#96a4ca', line: true },
    { label: 'Produkcja z PV', key: 'pvKwh', color: '#efbc50', line: true },
    { label: 'Autokonsumpcja z PV', key: 'directKwh', color: '#ffd787', line: false },
    ...(future ? [{ label: 'Pobór z magazynu', key: 'batteryKwh', color: '#32cc91', line: false }] : []),
  ];
  const pv = total(rows, 'pvKwh'), direct = total(rows, 'directKwh');
  const marker = (color: string, isLine = false) => <Box as="span" display="inline-block" verticalAlign="middle" w={isLine ? '12px' : '7px'} h={isLine ? '2px' : '7px'} borderRadius={isLine ? '0' : '50%'} bg={color} mr="7px" />;
  return <Box aria-label={`Podsumowanie energii ${future ? 'z systemem' : 'stan aktualny'}`} mt="16px">
    <Text as="h3" fontSize="12px" fontWeight="700" mt="10px" mb="5px">Przepływy energii <Text as="span" fontSize="10px" fontWeight="400" color={muted}>(kWh)</Text></Text>
    <Grid templateColumns={{ base: '1fr', sm: `repeat(${flows.length},minmax(0,1fr))` }} border="1px solid" borderColor={line} borderRadius="10px" overflow="hidden">{flows.map((flow, i) => <Box key={flow.key} p="10px 12px" minW="0" borderRightWidth={{ sm: i < flows.length - 1 ? '1px' : '0' }} borderBottomWidth={{ base: i < flows.length - 1 ? '1px' : '0', sm: '0' }} borderColor={line}><Text fontSize="10px" fontWeight="500">{marker(flow.color, flow.line)}{flow.label}</Text><Text pl="17px" mt="3px" fontWeight="500">{number(total(rows, flow.key as keyof EnergyChartRow))} kWh{flow.key === 'directKwh' && pv != null && direct != null && pv > 0 ? <Text as="span" color={muted} fontSize="10px"> / {number(direct / pv * 100, 0)}% PV</Text> : null}</Text></Box>)}</Grid>
    <Text as="h3" fontSize="12px" fontWeight="700" mt="12px" mb="5px">Rozliczenie energii <Text as="span" color={muted} fontSize="10px" fontWeight="400">(PLN {b2b ? 'netto' : 'brutto'})</Text></Text>
    <Box border="1px solid" borderColor={line} borderRadius="10px" overflow="hidden">{(['exportKwh', 'importKwh'] as const).map((key, rowIndex) => <Grid key={key} templateColumns={{ base: '1fr', sm: 'repeat(3,minmax(0,1fr))' }} borderBottom={rowIndex === 0 ? '1px solid' : '0'} borderColor={line}>
      <Box p="8px 12px" borderRightWidth={{ sm: '1px' }} borderColor={line}><Text fontSize="10px">{marker(rowIndex ? '#ff8505' : '#087744')}Energia {rowIndex ? 'pobrana z sieci' : 'oddana do sieci'}</Text><Text fontWeight="500" mt="3px">{number(total(rows, key))} kWh</Text></Box>
      <Box p="8px 12px" borderRightWidth={{ sm: '1px' }} borderColor={line}><Text fontSize="10px">{future && !rowIndex && !netMetering ? 'Wartość oddania do depozytu' : `Wartość energii ${rowIndex ? 'pobranej' : 'oddanej'}`}</Text><Text mt="3px" data-energy-value={rowIndex ? 'import' : 'export'}>{valuationLoading ? 'Obliczanie…' : !rowIndex && netMetering ? 'Rozliczenie ilościowe · opust' : (rowIndex ? valuation?.importValuePln : valuation?.exportValuePln) == null ? '—' : `${number(rowIndex ? valuation!.importValuePln : valuation!.exportValuePln, 2)} zł`}</Text></Box>
      <Box p="8px 12px"><Text fontSize="10px">{future && !rowIndex && !netMetering ? 'Średnia wartość 1 kWh do depozytu' : `Średnia cena ${rowIndex ? 'zakupu' : 'sprzedaży'} 1 kWh`}</Text><Text mt="3px" data-energy-price={rowIndex ? 'buy' : 'sell'} color={!rowIndex && netMetering ? muted : undefined} fontSize={!rowIndex && netMetering ? '10px' : '12px'}>{valuationLoading ? 'Obliczanie…' : !rowIndex && netMetering ? 'Rozliczenie ilościowe · opust' : (rowIndex ? valuation?.averageBuyPlnPerKwh : valuation?.averageSellPlnPerKwh) == null ? '—' : `${number(rowIndex ? valuation!.averageBuyPlnPerKwh : valuation!.averageSellPlnPerKwh, 4)} zł/kWh`}</Text></Box>
    </Grid>)}</Box>
    <Text fontSize="9px" color={muted} mt="7px">{sourceNote || (future ? 'Wartości zostaną uzupełnione po obliczeniu wariantu w RE.' : 'Pobór i oddanie: pomiary operatora. Produkcja PV i autokonsumpcja oczekują na obliczenia.')}</Text>
  </Box>;
}

export function offerChartValuation(scenario: OfferWorkspaceValuationScenario | null | undefined, period: string, date?: string): OfferWorkspaceValuationValues | null {
  if (!scenario) return null;
  if (period === 'all') return scenario.totals;
  // The monthly selector displays a representative day, not the whole month's volume.
  return scenario.days.find(day => day.period === period && day.date === date)?.totals ?? null;
}

export function offerEnergyChartRows(workspace: WorkspaceData, period: string, dayType: 'workday' | 'free', future = false, forecast?: OfferEnergyForecast): EnergyChartRow[] {
  const measurements = future && forecast ? forecast.measurements : workspace.measurements;
  const energy = future ? forecast?.energy || null : workspace.energy || null;
  const months = [...measurements.months].sort((a, b) => a.period.localeCompare(b.period));
  const day = measurements.dayProfiles?.find(item => item.period === period && item.dayType === dayType);
  const values = (imp: number | null, exp: number | null) => ({
    importKwh: future && !forecast ? null : imp,
    exportKwh: future && !forecast ? null : exp,
    loadKwh: null, pvKwh: null, directKwh: null,
  });
  const rows: EnergyChartRow[] = period === 'all' ? months.map(month => ({ label: shortMonth(month.period), title: longMonth(month.period), ...values(month.importKwh, month.exportKwh) })) : Array.from({ length: 24 }, (_, hour) => { const reading = day?.hours.find(item => item.hour === hour); return { label: String(hour).padStart(2, '0'), title: `${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`, ...values(reading?.importKwh ?? null, reading?.exportKwh ?? null) }; });
  if (energy) rows.forEach((row, index) => {
    const energyRow = period === 'all'
      ? energy.months.find(month => month.period === months[index].period)
      : energy.dayProfiles.find(profile => profile.date === day?.date)?.hours.find(hour => hour.hour === index);
    if (energyRow) { row.loadKwh = energyRow.loadKwh; row.pvKwh = energyRow.pvKwh; row.directKwh = energyRow.directKwh; }
  });
  if (future && forecast?.battery) rows.forEach((row, index) => {
    const key = period === 'all' ? months[index].period : `${day?.date}T${String(index).padStart(2, '0')}`;
    row.batteryKwh = (period === 'all' ? forecast.battery!.months[key] : forecast.battery!.hours[key]) ?? null;
  });
  return rows;
}

export function offerEnergyChartProvenance(energy: WorkspaceData['energy'] | null | undefined) {
  const annual = energy?.modelledMeasurements?.provenance;
  const confirmedNoPv = energy?.model.includes('bez instalacji PV') === true;
  return annual?.kind === 'annual-consumption' ? {
    sourceNote: confirmedNoPv
      ? `MODELLED · pobór, oddanie i profil budynku z rocznej deklaracji RE (${annual.annualConsumptionKwh} kWh/rok); potwierdzono brak instalacji PV. Wartości nie są pomiarami.`
      : `MODELLED · pobór, oddanie i profil budynku z rocznej deklaracji RE (${annual.annualConsumptionKwh} kWh/rok); PV z modelu pogodowego. Wartości nie są pomiarami.`,
    periodLabel: 'Profil MODELLED · RE',
    periodAriaLabel: 'Miesiąc profilu modelowanego',
    noPeriodLabel: 'Brak profilu rocznego',
    tariffLabel: 'Wycena modelowanego profilu godzinowego według godzin i stref taryfy scenariusza.',
  } : null;
}

export default function OfferEnergyChart({ workspace, targetTariffLabel, netMetering, future = false, futureForecast }: { workspace: WorkspaceData; targetTariffLabel: string; netMetering: boolean; future?: boolean; futureForecast?: OfferEnergyForecast }) {
  const [period, setPeriod] = useState('all');
  const [dayType, setDayType] = useState<'workday' | 'free'>('workday');
  const [useTargetTariff, setUseTargetTariff] = useState(false);
  const muted = useColorModeValue('#8392b5', 'gray.400'), soft = useColorModeValue('#f5f7fd', 'whiteAlpha.50');
  const chartMeasurements = future && futureForecast ? futureForecast.measurements : workspace.measurements;
  const months = useMemo(() => [...chartMeasurements.months].sort((a, b) => a.period.localeCompare(b.period)), [chartMeasurements.months]);
  const day = chartMeasurements.dayProfiles?.find(item => item.period === period && item.dayType === dayType);
  const rows = offerEnergyChartRows(workspace, period, dayType, future, futureForecast);
  const valuationScenario = future ? futureForecast?.valuation : useTargetTariff ? workspace.valuation?.target : workspace.valuation?.current;
  const valuation = offerChartValuation(valuationScenario, period, day?.date);
  const valuationIssues = !future ? [...(workspace.valuationError ? [workspace.valuationError] : []), ...(valuationScenario?.issues || [])] : [];
  const annualProvenance = !future ? offerEnergyChartProvenance(workspace.energy) : null;
  const sourceNote = !future ? workspace.energyLoading ? 'Obliczanie produkcji PV i zużycia budynku…'
    : annualProvenance ? annualProvenance.sourceNote
    : workspace.energy ? workspace.energy.quality === 'MODELLED'
      ? `Pobór i oddanie: pomiary operatora. PV: ${workspace.energy.source}, typowy profil pogodowy. Zużycie budynku i autokonsumpcja: szacunek RE, nie pomiar falownika.`
      : workspace.energy.totals.loadKwh != null ? 'Zużycie budynku: pomiary poboru operatora; instalacja bez PV i magazynu.' : 'Pobór: pomiary operatora. Potwierdzono brak PV; zużycie budynku wymaga danych o magazynie.' : undefined
    : futureForecast ? 'Prognoza energii z kalkulacji oferty; wartości modelowane, nie pomiary.' : undefined;
  return <>
    <Flex justify="space-between" align="start" mb="18px" gap="12px" wrap="wrap"><Box><Text as="h2" fontSize="20px" fontWeight="700">{future ? 'Stan z systemem' : 'Stan aktualny'}</Text><Text color={muted} mt="4px">{future ? 'Podgląd działania wybranej konfiguracji.' : 'Podgląd zużycia z zakładki Dane energetyczne.'}</Text></Box><Text bg={soft} color={muted} borderRadius="30px" p="6px 11px" fontSize="10px">{future ? futureForecast ? 'Prognoza obliczona' : 'Oczekuje na symulację RE' : annualProvenance ? annualProvenance.periodLabel : period === 'all' ? 'Okres z Danych energetycznych' : day ? `Pomiary · ${day.date}` : 'Brak pełnego dnia pomiarowego'}</Text></Flex>
    <Flex justify="space-between" align="start" gap="14px" wrap="wrap"><Flex gap="8px" wrap={{ base: 'wrap', md: 'nowrap' }} minW="0"><Select aria-label={future ? 'Widok wykresu z systemem' : annualProvenance ? annualProvenance.periodAriaLabel : 'Miesiąc pomiarów'} value={period} onChange={e => setPeriod(e.target.value)} w={{ base: '100%', sm: '222px' }} h="44px"><option value="all">{months.length ? `Okres ${months[0].period.slice(0, 4)}/${months.at(-1)!.period.slice(0, 4)} · rocznie` : annualProvenance ? annualProvenance.noPeriodLabel : 'Brak pomiarów'}</option>{months.map(month => <option key={month.period} value={month.period}>{longMonth(month.period)}</option>)}</Select>{period !== 'all' ? <Select aria-label={future ? 'Typ dnia z systemem' : annualProvenance ? 'Typ reprezentatywnego dnia modelowego' : 'Typ dnia aktualnie'} w={{ base: '100%', sm: '142px' }} h="44px" value={dayType} onChange={e => setDayType(e.target.value as typeof dayType)}><option value="workday">Dzień roboczy</option><option value="free">Dzień wolny</option></Select> : null}</Flex><Box textAlign="right"><Tooltip label={future ? 'SOC wymaga obliczonej symulacji magazynu.' : annualProvenance ? annualProvenance.tariffLabel : 'Wycena tych samych pomiarów według godzin i stref taryfy scenariusza.'}><Box><Checkbox isDisabled={future || !workspace.valuation} isChecked={!future && useTargetTariff} onChange={event => setUseTargetTariff(event.target.checked)}>{future ? 'Pokaż SOC magazynu' : 'Nanieś nową taryfę'}</Checkbox></Box></Tooltip><Text color={muted} fontSize="10px" mt="9px">{useTargetTariff || future ? targetTariffLabel : 'Historia taryf · stan aktualny'}</Text></Box></Flex>
    <OfferEnergyPlot rows={rows} annual={period === 'all'} future={future} />
    <OfferEnergySummary rows={rows} netMetering={valuationScenario ? valuationScenario.settlement === 'NET_METERING' : netMetering} b2b={workspace.clientType === 'B2B'} future={future} sourceNote={sourceNote} valuation={valuation} valuationLoading={!future && workspace.valuationLoading} />
    {valuationScenario ? <Text fontSize="10px" color={muted} mt="8px">{useTargetTariff || future ? 'Wycena scenariusza według cennika kalkulacji.' : 'Wycena według historii taryf.'} Pobór: energia i dystrybucja zmienna, przed opustem lub depozytem, bez opłat stałych. {valuationScenario.settlement === 'NET_BILLING' ? future ? 'Oddanie: wartość naliczona do depozytu, z mnożnikiem przyjętym w kalkulacji; nie sama cena RCE. Kwoty i średnie według energii rozliczeniowej po bilansowaniu godzinowym. ' : 'Oddanie: wycena RCE, przed rozliczeniem depozytu. ' : ''}Średnie ceny ważone ilością energii.</Text> : null}
    {valuationIssues.length ? <Box as="details" mt="8px" fontSize="11px" color={muted}><Box as="summary" cursor="pointer">Wycena wymaga uzupełnienia ({valuationIssues.length})</Box>{valuationIssues.slice(0, 12).map((issue, index) => <Text key={index} mt="4px">{issue}</Text>)}{valuationIssues.length > 12 ? <Text mt="4px">Dalsze okresy: {valuationIssues.length - 12}.</Text> : null}</Box> : null}
  </>;
}
