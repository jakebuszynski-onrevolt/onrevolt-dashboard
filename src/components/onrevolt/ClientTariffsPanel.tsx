'use client';

import {
  Accordion, AccordionButton, AccordionIcon, AccordionItem, AccordionPanel, Alert, AlertIcon,
  Badge, Box, Button, Checkbox, Flex, FormControl, FormLabel, IconButton, Input,
  Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay,
  Select, SimpleGrid, Spinner, Table, Tbody, Td, Text, Th, Thead, Tooltip, Tr, useColorModeValue,
} from '@chakra-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MdAdd, MdArrowForward, MdEdit, MdExpandMore, MdRefresh, MdSave, MdUndo } from 'react-icons/md';
import {
  generalTariffSummary, tariffPeriodLabel, tariffSchedule, tariffToday,
  type ClientTariffData, type ClientTariffPayload, type ClientTariffPeriod, type ClientTariffProfile,
} from 'lib/onrevolt/client-tariffs';

type Props = { clientId: string; projectId?: string; clientType?: string; compact?: boolean; onOpen?: () => void; onHistoryChange?: (enabled: boolean) => void };
const months = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const zoneNames = { all: ['Cała doba'], daynight: ['Noc', 'Dzień'], peakoffpeak: ['Poza szczytem', 'Szczyt'], highmidlow: ['Wysoka', 'Średnia', 'Niska'] };
const nextDay = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export default function ClientTariffsPanel({ clientId, projectId, clientType, compact, onOpen, onHistoryChange }: Props) {
  const [data, setData] = useState<ClientTariffData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<ClientTariffPeriod | null>(null);
  const [catalog, setCatalog] = useState<ClientTariffPayload | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [operation, setOperation] = useState<'change' | 'correct'>('change');
  const [preview, setPreview] = useState<ClientTariffProfile | null>(null);
  const [month, setMonth] = useState('1');
  const [evidenceId, setEvidenceId] = useState<string | undefined>();
  const [confirmEvidence, setConfirmEvidence] = useState<string | null>(null);
  const requestId = useRef(0);
  const text = useColorModeValue('navy.700', 'white');
  const muted = useColorModeValue('gray.600', 'gray.400');
  const border = useColorModeValue('gray.200', 'whiteAlpha.200');
  const background = useColorModeValue('white', 'navy.800');
  const selected = useColorModeValue('purple.50', 'whiteAlpha.100');
  const gross = clientType !== 'B2B';
  const query = new URLSearchParams({ clientId, projectId: projectId || '' });
  const endpoint = `/api/crm/projects/tariffs?${query}`;

  const load = useCallback(async (signal?: AbortSignal) => {
    const id = ++requestId.current;
    setError(''); setLoading(true);
    try {
      if (!projectId) { setData(null); return; }
      const response = await fetch(`/api/crm/projects/tariffs?${new URLSearchParams({ clientId, projectId })}`, { cache: 'no-store', signal });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Nie udało się odczytać taryf.');
      if (id === requestId.current && !signal?.aborted) setData(payload.data);
    } catch (e) { if (id === requestId.current && !signal?.aborted) setError((e as Error).message); }
    finally { if (id === requestId.current && !signal?.aborted) setLoading(false); }
  }, [clientId, projectId]);

  useEffect(() => { const controller = new AbortController(); setData(null); setEditor(null); load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => { onHistoryChange?.(Boolean(data?.profile?.periods.length || data?.evidence.length)); }, [data, onHistoryChange]);
  useEffect(() => {
    const changed = () => { load(); };
    window.addEventListener('client-tariffs-changed', changed);
    return () => window.removeEventListener('client-tariffs-changed', changed);
  }, [load]);
  const editorDate = editor?.validFrom || tariffToday();
  useEffect(() => {
    if (!editor?.tariffId || !editor.osdId) { setCatalog(null); return; }
    const controller = new AbortController();
    setCatalog(null); setCatalogError(''); setCatalogLoading(true);
    const params = new URLSearchParams({ clientId, projectId: projectId || '', action: 'catalog', osdId: String(editor.osdId), tariffId: String(editor.tariffId), date: editorDate });
    fetch(`/api/crm/projects/tariffs?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const value = await response.json(); if (!response.ok || !value.ok) throw new Error(value.error); return value.data; })
      .then(setCatalog).catch(e => { if (!controller.signal.aborted) setCatalogError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [editor?.osdId, editor?.tariffId, editorDate, clientId, projectId]);

  const periods = data?.profile?.periods || [];
  const today = tariffToday();
  const current = periods.find(p => (!p.validFrom || p.validFrom <= today) && (!p.validUntil || p.validUntil > today));
  const generalSummary = generalTariffSummary(data?.generalTariff);
  const hasGeneralTariff = Boolean(data?.generalTariff?.operator && data.generalTariff.code);
  const name = (p: ClientTariffPeriod) => data?.catalog.find(o => o.id === p.osdId)?.tariffs.find(t => t.id === p.tariffId)?.code || `#${p.tariffId}`;
  const osdName = (p: ClientTariffPeriod) => data?.catalog.find(o => o.id === p.osdId)?.name || '';
  const update = (patch: Partial<ClientTariffPeriod>) => { setEditor(p => p ? { ...p, ...patch } : p); setPreview(null); setError(''); };

  function open(period?: ClientTariffPeriod, evidence?: ClientTariffData['evidence'][number]) {
    if (evidence && !period) period = periods.find(p => p.validFrom === evidence.valid_from);
    setError(''); setPreview(null); setEvidenceId(evidence?.id); setOperation(period ? 'correct' : 'change');
    const base = current || periods[periods.length - 1];
    const value: ClientTariffPeriod = period ? JSON.parse(JSON.stringify(period)) : {
      id: crypto.randomUUID(), validFrom: periods.length ? today : null, validUntil: null,
      osdId: base?.osdId || data?.generalTariff?.osdId || 0, tariffId: base?.tariffId || data?.generalTariff?.tariffId || 0, source: 'MANUAL', overrides: {}, schedule: null, note: '',
    };
    if (evidence) {
      const osd = data?.catalog.find(o => o.slug.toLowerCase() === 'enea');
      value.osdId = osd?.id || 0;
      value.tariffId = osd?.tariffs.find(t => t.code.toLowerCase() === evidence.tariff_code?.toLowerCase())?.id || 0;
      value.validFrom = evidence.valid_from; value.validUntil = evidence.valid_until;
      value.note = 'Potwierdzenie metadanych ENEA';
    }
    setEditor(value);
  }

  async function confirmExistingEvidence(id: string) {
    setSaving(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: confirmEvidence === id ? 'save' : 'preview', operation: 'confirm',
          clientId, projectId, revision: data?.profile?.revision || 0, evidenceId: id }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error);
      if (confirmEvidence === id) { setConfirmEvidence(null); window.dispatchEvent(new Event('client-tariffs-changed')); }
      else setConfirmEvidence(id);
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  async function bindStation() {
    setSaving(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bind', clientId, projectId, revision: data?.profile?.revision || 0 }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error);
      window.dispatchEvent(new Event('client-tariffs-changed'));
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  async function submit(action: 'preview' | 'save') {
    if (!editor) return;
    setError(''); setSaving(true);
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, clientId, projectId, revision: data?.profile?.revision || 0, operation,
          period: editor, evidenceId, periods: operation === 'correct' ? periods.map(p => p.id === editor.id ? { ...editor, source: 'MANUAL' } : p) : undefined }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Nie udało się zapisać taryf.');
      if (action === 'preview') setPreview(payload.data);
      else { setEditor(null); window.dispatchEvent(new Event('client-tariffs-changed')); }
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  if (compact) return <Flex align="center" gap="12px" justify="space-between" wrap="wrap" py="10px">
    <Box><Text fontSize="sm" fontWeight="700">Taryfa</Text><Text fontSize="sm" color={muted}>
      {error || (!projectId ? 'Najpierw wybierz projekt.' : !data ? 'Ładowanie taryfy…' : current ? `${osdName(current)} · ${name(current)} · ${current.validFrom || 'od początku danych'}` : periods.length || data.evidence.length ? 'Wymaga uzupełnienia: brak bieżącej taryfy' : `${generalSummary}${hasGeneralTariff ? ' · Cennik ogólny' : ''}`)}
    </Text></Box><Button size="sm" variant="outline" rightIcon={<MdArrowForward />} onClick={onOpen}>Taryfy</Button>
  </Flex>;

  return <Box bg={background} p={{ base: '16px', md: '22px' }} color={text}>
    <Flex justify="space-between" align="center" gap="12px" wrap="wrap" mb="16px">
      <Box><Text fontSize="lg" fontWeight="800">Taryfy</Text><Text color={muted} fontSize="sm">{data?.profile?.ppe ? `PPE ${data.profile.ppe}` : 'Aktywny projekt'}{data?.profile?.station ? ` · Stacja ${data.profile.station}` : ''}</Text></Box>
      <Flex gap="8px"><Tooltip label="Odśwież taryfy"><IconButton aria-label="Odśwież taryfy" icon={<MdRefresh />} onClick={() => load()} isLoading={loading} variant="ghost" /></Tooltip>
        {data?.canEdit && projectId ? <Button size="sm" leftIcon={<MdAdd />} colorScheme="purple" onClick={() => open()}>Zmiana taryfy od dnia</Button> : null}</Flex>
    </Flex>
    {error && !editor ? <Alert status="error" mb="12px"><AlertIcon />{error}</Alert> : null}
    {data?.profile && data.profile.station !== data.assignedStation ? <Alert status="warning" mb="12px"><AlertIcon /><Box flex="1">Powiązanie profilu taryfowego ze stacją EMS wymaga aktualizacji.</Box>{data.canEdit ? <Button size="sm" onClick={bindStation} isLoading={saving}>Połącz z EMS</Button> : null}</Alert> : null}
    {!projectId ? <Text>Najpierw wybierz projekt.</Text> : loading && !data ? <Spinner /> : null}
    {data && !periods.length ? data.evidence.length ? <Text color={muted} py="12px">Historia taryf wymaga uzupełnienia.</Text> : <Box py="12px">
      <Text color={muted} fontSize="sm" mb="4px">{data.generalTariffSource === 'RE' ? 'Taryfa dotychczasowa · Dashboard RE' : 'Taryfa · Dane energetyczne'}</Text>
      <Flex align="center" gap="8px" wrap="wrap"><Text fontWeight="700">{generalSummary}</Text><Badge colorScheme={hasGeneralTariff ? 'blue' : 'orange'}>{hasGeneralTariff ? 'Cennik ogólny' : 'Wymaga uzupełnienia'}</Badge></Flex>
      <Text color={muted} fontSize="sm" mt="4px">{hasGeneralTariff ? 'Brak indywidualnej historii.' : data.generalTariffSource === 'RE' ? 'Brak zapisanej taryfy w dashboardzie RE. Uzupełnij ustawienia instalacji lub dodaj okres taryfy.' : 'Brak zapisanej taryfy dla tego projektu. Uzupełnij Dane energetyczne lub dodaj okres taryfy.'}</Text>
    </Box> : null}
    {data?.generalTariffSource === 'RE' ? <Box py="12px"><Text color={muted} fontSize="sm" mb="4px">Taryfa docelowa / symulacja · Dashboard RE</Text><Text fontWeight="700">{generalTariffSummary(data.targetTariff)}</Text></Box> : null}
    <Box display={{ base: 'block', md: 'none' }}>{periods.map(p => <Flex key={p.id} gap="8px" py="12px" px="8px" borderBottom="1px solid" borderColor={border} bg={p.id === current?.id ? selected : undefined} align="start">
      <Box flex="1" minW="0"><Text fontWeight="700">{osdName(p)} · {name(p)}</Text><Text fontSize="sm" mt="4px">{tariffPeriodLabel(p)}</Text>
        <Flex gap="5px" wrap="wrap" mt="7px">{p.id === current?.id ? <Badge colorScheme="green">Aktualna</Badge> : p.validFrom && p.validFrom > today ? <Badge colorScheme="blue">Planowana</Badge> : <Badge>Historia</Badge>}
          <Badge>{Object.keys(p.overrides).length || p.schedule ? 'Indywidualna' : 'Katalogowa'}</Badge><Badge>{p.source === 'ENEA' ? 'ENEA' : 'Ręcznie'}</Badge>
          <Badge colorScheme={data?.resolved[p.id]?.ok ? 'green' : 'orange'}>{data?.resolved[p.id]?.ok ? 'Kompletna' : 'Wymaga uzupełnienia'}</Badge></Flex>
      </Box><Tooltip label={data?.canEdit ? 'Edytuj okres' : 'Szczegóły okresu'}><IconButton size="sm" aria-label="Edytuj okres" icon={<MdEdit />} variant="ghost" onClick={() => open(p)} /></Tooltip>
    </Flex>)}</Box>
    <Box display={{ base: 'none', md: periods.length ? 'block' : 'none' }} overflowX="auto"><Table size="sm"><Thead><Tr><Th>Okres</Th><Th>Operator / taryfa</Th><Th>Stawki</Th><Th>Źródło</Th><Th>Stan</Th><Th /></Tr></Thead><Tbody>
      {periods.map(p => <Tr key={p.id} bg={p.id === current?.id ? selected : undefined}>
        <Td whiteSpace="nowrap" py="14px">{tariffPeriodLabel(p)}<Box mt="4px">{p.id === current?.id ? <Badge colorScheme="green">Aktualna</Badge> : p.validFrom && p.validFrom > today ? <Badge colorScheme="blue">Planowana</Badge> : <Badge>Historia</Badge>}</Box></Td>
        <Td><Text fontWeight="700">{name(p)}</Text><Text color={muted}>{osdName(p)}</Text></Td>
        <Td>{Object.keys(p.overrides).length || p.schedule ? 'Indywidualna' : 'Katalogowa'}</Td><Td>{p.source === 'ENEA' ? 'ENEA' : 'Ręcznie'}</Td>
        <Td>{data?.resolved[p.id]?.ok ? <Badge colorScheme="green">Kompletna</Badge> : <Tooltip label={data?.resolved[p.id]?.error}><Badge colorScheme="orange">Wymaga uzupełnienia</Badge></Tooltip>}</Td>
        <Td><Tooltip label={data?.canEdit ? 'Edytuj okres' : 'Szczegóły okresu'}><IconButton size="sm" aria-label="Edytuj okres" icon={<MdEdit />} variant="ghost" onClick={() => open(p)} /></Tooltip></Td>
      </Tr>)}
    </Tbody></Table></Box>
    {data?.evidence.map(e => <Alert key={e.id} status="warning" mt="12px" alignItems="start"><AlertIcon /><Box flex="1"><Text fontWeight="700">ENEA: {e.tariff_code || 'Taryfa do ustalenia'} · {e.valid_from} – {nextDay(e.valid_until, -1)}</Text><Text fontSize="sm">{e.evidence.message || e.evidence.reason || 'Potwierdź taryfę i zakres obowiązywania.'}</Text>{confirmEvidence === e.id ? <Text fontSize="sm" mt="8px">Konflikt zostanie zamknięty. Istniejące okresy, ceny i godziny pozostaną bez zmian. Brakujące okresy nadal wymagają uzupełnienia.</Text> : null}{data.canEdit ? <Flex gap="8px" mt="8px" wrap="wrap"><Button size="sm" onClick={() => open(undefined, e)}>Zweryfikuj taryfę</Button><Button size="sm" variant="outline" onClick={() => confirmExistingEvidence(e.id)} isLoading={saving}>{confirmEvidence === e.id ? 'Potwierdź zachowanie wpisów' : 'Zachowaj istniejące wpisy'}</Button></Flex> : null}</Box></Alert>)}

    <Modal isOpen={Boolean(editor)} onClose={() => { if (!saving) setEditor(null); }} size="4xl" scrollBehavior="inside">
      <ModalOverlay /><ModalContent maxW={{ base: 'calc(100vw - 16px)', md: '980px' }}><ModalHeader>{operation === 'change' ? 'Zmiana taryfy od dnia' : 'Korekta okresu taryfy'}</ModalHeader><ModalCloseButton />
        <ModalBody>{editor ? <>
          {error ? <Alert status="error" mb="12px"><AlertIcon />{error}</Alert> : null}
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing="12px">
            <FormControl><FormLabel>Operator</FormLabel><Select value={editor.osdId || ''} isDisabled={!data?.canEdit} onChange={e => update({ osdId: Number(e.target.value), tariffId: 0, overrides: {}, schedule: null })}><option value="">Wybierz OSD</option>{data?.catalog.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></FormControl>
            <FormControl><FormLabel>Taryfa</FormLabel><Select value={editor.tariffId || ''} isDisabled={!data?.canEdit} onChange={e => update({ tariffId: Number(e.target.value), overrides: {}, schedule: null })}><option value="">Wybierz taryfę</option>{data?.catalog.find(o => o.id === editor.osdId)?.tariffs.map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</Select></FormControl>
            <FormControl><FormLabel>Od dnia</FormLabel><Input type="date" value={editor.validFrom || ''} isDisabled={!data?.canEdit} onChange={e => update({ validFrom: e.target.value || null })} /><Checkbox size="sm" mt="6px" isChecked={editor.validFrom === null} isDisabled={!data?.canEdit || (operation === 'change' && periods.length > 0)} onChange={e => update({ validFrom: e.target.checked ? null : today })}>Od początku danych</Checkbox></FormControl>
            <FormControl><FormLabel>Do dnia (włącznie)</FormLabel><Input type="date" value={editor.validUntil ? nextDay(editor.validUntil, -1) : ''} isDisabled={!data?.canEdit} onChange={e => update({ validUntil: e.target.value ? nextDay(e.target.value, 1) : null })} /><Text color={muted} fontSize="xs" mt="6px">{editor.validUntil ? '' : 'Bez daty końcowej'}</Text></FormControl>
          </SimpleGrid>
          {catalogLoading ? <Spinner mt="16px" /> : catalogError ? <Alert status="warning" mt="16px"><AlertIcon />{catalogError}</Alert> : null}
          {catalog ? <Accordion allowMultiple mt="18px">
            <AccordionItem borderColor={border}><AccordionButton><Box flex="1" textAlign="left" fontWeight="700">Stawki i opłaty · PLN {gross ? 'brutto' : 'netto'}</Box><AccordionIcon /></AccordionButton><AccordionPanel px="0">
              {(['variable', 'fixed'] as const).map(group => <Box key={group} mb="12px"><Text fontWeight="700" fontSize="sm" px="8px" mb="6px">{group === 'variable' ? 'Opłaty zmienne / kWh' : 'Opłaty stałe / miesiąc'}</Text><Box overflowX="auto"><Table size="sm"><Thead><Tr><Th>Własna</Th><Th>Pozycja</Th><Th isNumeric>Kwota</Th><Th isNumeric>VAT %</Th><Th /></Tr></Thead><Tbody>
                {catalog.pricing.tariffStorage[group].map(row => {
                  const override = editor.overrides[row.component_key];
                  const price = override || row;
                  return <Tr key={row.component_key}><Td><Checkbox aria-label={`Indywidualna stawka: ${row.label}`} isChecked={Boolean(override)} isDisabled={!data?.canEdit} onChange={e => {
                    const overrides = { ...editor.overrides }; if (e.target.checked) overrides[row.component_key] = { net: row.net, vatRate: row.vatRate }; else delete overrides[row.component_key]; update({ overrides });
                  }} /></Td><Td><Text fontSize="sm">{row.label}</Text><Text color={muted} fontSize="xs">{row.window_code || (row.amount_mode === 'per_kw_month' ? 'PLN/kW/miesiąc' : '')}{row.billing_cycle_months ? ` · cykl ${row.billing_cycle_months} mies.` : ''}{row.annual_usage_min_kwh != null ? ` · od ${row.annual_usage_min_kwh} kWh/rok` : ''}{row.annual_usage_max_kwh != null ? ` · poniżej ${row.annual_usage_max_kwh} kWh/rok` : ''}</Text></Td>
                    <Td isNumeric><Input aria-label={`Kwota: ${row.label}`} type="number" step="0.0001" min="0" w="120px" size="sm" textAlign="right" isDisabled={!override || !data?.canEdit} value={Number((price.net * (gross ? 1 + price.vatRate : 1)).toFixed(8))} onChange={e => update({ overrides: { ...editor.overrides, [row.component_key]: { ...price, net: Number(e.target.value) / (gross ? 1 + price.vatRate : 1) } } })} /></Td>
                    <Td isNumeric><Input aria-label={`VAT: ${row.label}`} type="number" step="1" min="0" max="100" w="70px" size="sm" textAlign="right" isDisabled={!override || !data?.canEdit} value={Number((price.vatRate * 100).toFixed(4))} onChange={e => update({ overrides: { ...editor.overrides, [row.component_key]: { ...price, vatRate: Number(e.target.value) / 100 } } })} /></Td>
                    <Td>{override && data?.canEdit ? <Tooltip label="Przywróć stawkę katalogową"><IconButton size="sm" aria-label="Przywróć stawkę katalogową" icon={<MdUndo />} variant="ghost" onClick={() => { const overrides = { ...editor.overrides }; delete overrides[row.component_key]; update({ overrides }); }} /></Tooltip> : null}</Td></Tr>;
                })}</Tbody></Table></Box></Box>)}
            </AccordionPanel></AccordionItem>
            <AccordionItem borderColor={border}><AccordionButton><Box flex="1" textAlign="left" fontWeight="700">Godziny stref</Box><AccordionIcon /></AccordionButton><AccordionPanel>
              <Checkbox isChecked={Boolean(editor.schedule)} isDisabled={!data?.canEdit} onChange={e => update({ schedule: e.target.checked ? tariffSchedule(catalog) : null })}>Własny harmonogram</Checkbox>
              {(() => { const schedule = editor.schedule || tariffSchedule(catalog); return <>
                <Flex my="12px" gap="16px" wrap="wrap" align="center"><Select aria-label="Miesiąc harmonogramu" w="180px" size="sm" value={month} onChange={e => setMonth(e.target.value)}>{months.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}</Select>
                  <Checkbox isDisabled={!editor.schedule || !data?.canEdit} isChecked={schedule.cheap_saturday} onChange={e => update({ schedule: { ...schedule, cheap_saturday: e.target.checked } })}>Sobota: najtańsza strefa</Checkbox>
                  <Checkbox isDisabled={!editor.schedule || !data?.canEdit} isChecked={schedule.cheap_sunday} onChange={e => update({ schedule: { ...schedule, cheap_sunday: e.target.checked } })}>Niedziela: najtańsza strefa</Checkbox></Flex>
                <SimpleGrid columns={{ base: 6, md: 12 }} spacing="8px" sx={{ '.chakra-select': { paddingLeft: '6px', paddingRight: '16px' }, '.chakra-select__icon-wrapper': { right: '2px', width: '12px' } }}>{schedule.monthly[month].map((zone, hour) => <Box minW="0" key={hour}><Text textAlign="center" fontSize="xs" mb="5px">{String(hour).padStart(2, '0')}</Text><Select aria-label={`${months[Number(month) - 1]}, godzina ${hour}`} size="sm" iconSize="12px" icon={<MdExpandMore />} value={zone} isDisabled={!editor.schedule || !data?.canEdit} onChange={e => { const hours = [...schedule.monthly[month]]; hours[hour] = Number(e.target.value); update({ schedule: { ...schedule, monthly: { ...schedule.monthly, [month]: hours } } }); }}>{zoneNames[schedule.zone_model].map((label, i) => <option key={label} value={i + 1}>{i + 1}</option>)}</Select></Box>)}</SimpleGrid>
                <Flex justify="space-between" gap="10px" wrap="wrap" mt="12px"><Text fontSize="xs" color={muted}>{zoneNames[schedule.zone_model].map((label, i) => `${i + 1}: ${label}`).join(' · ')}</Text>{editor.schedule && data?.canEdit ? <Button size="xs" variant="outline" onClick={() => update({ schedule: { ...schedule, monthly: Object.fromEntries(months.map((_, i) => [String(i + 1), [...schedule.monthly[month]]])) } })}>Zastosuj do wszystkich miesięcy</Button> : null}</Flex>
              </>; })()}
            </AccordionPanel></AccordionItem>
          </Accordion> : null}
          <FormControl mt="14px"><FormLabel>Uwagi / podstawa korekty</FormLabel><Input value={editor.note} maxLength={1000} isDisabled={!data?.canEdit} onChange={e => update({ note: e.target.value })} /></FormControl>
          {preview ? <Box mt="18px" borderTop="1px solid" borderColor={border} pt="12px"><Text fontWeight="700" mb="8px">Podział okresów po zapisie</Text>{preview.periods.map(p => <Flex key={p.id} justify="space-between" gap="12px" py="5px"><Text fontSize="sm">{tariffPeriodLabel(p)}</Text><Text fontWeight="700" fontSize="sm">{name(p)}</Text></Flex>)}</Box> : null}
        </> : null}</ModalBody>
        <ModalFooter gap="10px"><Button variant="ghost" isDisabled={saving} onClick={() => setEditor(null)}>Zamknij</Button>{data?.canEdit ? <Button leftIcon={preview ? <MdSave /> : <MdArrowForward />} colorScheme="purple" isLoading={saving} isDisabled={!editor?.tariffId || catalogLoading} onClick={() => submit(preview ? 'save' : 'preview')}>{preview ? 'Zapisz zmianę' : 'Sprawdź podział okresów'}</Button> : null}</ModalFooter>
      </ModalContent>
    </Modal>
  </Box>;
}
