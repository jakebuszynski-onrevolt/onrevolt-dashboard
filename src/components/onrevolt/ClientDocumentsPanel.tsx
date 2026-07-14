'use client';

import { Alert, AlertIcon, Badge, Box, Button, Checkbox, Flex, FormControl, FormLabel, Icon, IconButton, Input, Select, SimpleGrid, Text, Textarea, Tooltip, useColorModeValue } from '@chakra-ui/react';
import Card from 'components/card/Card';
import { ChangeEvent, useMemo, useState } from 'react';
import { MdDeleteOutline, MdDownload, MdEdit, MdOpenInNew, MdSave, MdUploadFile } from 'react-icons/md';

type Props = { mode: 'files' | 'invoices'; clientId: string; projectId?: string; documents: any[]; onChanged: () => Promise<void> | void };
const fileTypes = [['ZDJECIE_MONTAZU', 'Zdjęcie'], ['PROTOKOL', 'Protokół'], ['DOKUMENT_OSD', 'Dokument OSD'], ['RE_DOKUMENT', 'Dokument RE'], ['INNE', 'Inny plik']] as const;
const cycles = [['1', 'Miesięczna'], ['2', 'Dwumiesięczna'], ['3', 'Kwartalna'], ['6', 'Półroczna'], ['12', 'Roczna']] as const;

function inputDate(value?: string | null) { return value ? new Date(value).toISOString().slice(0, 10) : ''; }
function dateLabel(value?: string | null) { return value ? new Intl.DateTimeFormat('pl-PL').format(new Date(value)) : '-'; }
function money(value: unknown) { return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(Number(value || 0)); }
function tags(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function cycleLabel(value?: number | null) { return cycles.find(([months]) => Number(months) === Number(value))?.[1] || (value ? `${value} mies.` : 'Okres własny'); }
function periodEnd(from: string, months: string) { if (!from || !months) return ''; const date = new Date(`${from}T12:00:00`); date.setMonth(date.getMonth() + Number(months)); date.setDate(date.getDate() - 1); return date.toISOString().slice(0, 10); }

export default function ClientDocumentsPanel({ mode, clientId, projectId, documents, onChanged }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState(mode === 'invoices' ? 'FAKTURA_PRAD' : 'ZDJECIE_MONTAZU');
  const [notes, setNotes] = useState('');
  const [documentDate, setDocumentDate] = useState(new Date().toISOString().slice(0, 10));
  const [tagText, setTagText] = useState('');
  const [visibleToClient, setVisibleToClient] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [amountGross, setAmountGross] = useState('');
  const [billingCycleMonths, setBillingCycleMonths] = useState('1');
  const [billingPeriodFrom, setBillingPeriodFrom] = useState('');
  const [billingPeriodTo, setBillingPeriodTo] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const shown = useMemo(() => documents.filter((document) => mode === 'invoices' ? document.type === 'FAKTURA_PRAD' : !['FAKTURA_PRAD', 'ENEA_ZUZYCIE', 'ENEA_PRODUKCJA'].includes(document.type)), [documents, mode]);

  function setCycle(value: string) { setBillingCycleMonths(value); if (billingPeriodFrom) setBillingPeriodTo(periodEnd(billingPeriodFrom, value)); }
  function setPeriodFrom(value: string) { setBillingPeriodFrom(value); if (billingCycleMonths) setBillingPeriodTo(periodEnd(value, billingCycleMonths)); }
  function selectFile(event: ChangeEvent<HTMLInputElement>) { const selected = event.target.files?.[0] || null; setFile(selected); if (selected && !title) setTitle(selected.name.replace(/\.[^.]+$/, '')); }
  async function read(response: Response) { const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`); return payload.data; }

  async function upload() {
    if (!file || !title.trim()) return;
    setBusy('upload'); setError(''); setMessage('');
    try {
      const form = new FormData(); form.set('file', file); form.set('type', mode === 'invoices' ? 'FAKTURA_PRAD' : type); form.set('title', title.trim()); form.set('clientId', clientId); if (projectId) form.set('projectId', projectId); form.set('notes', notes); form.set('documentDate', documentDate); form.set('tags', tagText); form.set('visibleToClient', String(visibleToClient));
      if (mode === 'invoices') { form.set('invoiceNumber', invoiceNumber); form.set('amountGross', amountGross); form.set('billingCycleMonths', billingCycleMonths); form.set('billingPeriodFrom', billingPeriodFrom); form.set('billingPeriodTo', billingPeriodTo); }
      await read(await fetch('/api/documents/upload', { method: 'POST', body: form }));
      setFile(null); setTitle(''); setNotes(''); setTagText(''); setInvoiceNumber(''); setAmountGross(''); setMessage(mode === 'invoices' ? 'Dodano fakturę.' : 'Dodano plik.'); await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  function beginEdit(document: any) { setEditing({ ...document, documentDate: inputDate(document.documentDate), billingPeriodFrom: inputDate(document.billingPeriodFrom), billingPeriodTo: inputDate(document.billingPeriodTo), tagsText: tags(document.tags).join(', '), amountGross: document.amountGross == null ? '' : String(document.amountGross) }); }
  async function saveEdit() { if (!editing) return; setBusy(editing.id); setError(''); try { await read(await fetch('/api/documents', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing.id, title: editing.title, type: editing.type, notes: editing.notes, documentDate: editing.documentDate, tags: editing.tagsText.split(',').map((item: string) => item.trim()).filter(Boolean), visibleToClient: editing.visibleToClient, invoiceNumber: editing.invoiceNumber, amountGross: editing.amountGross, billingCycleMonths: editing.billingCycleMonths, billingPeriodFrom: editing.billingPeriodFrom, billingPeriodTo: editing.billingPeriodTo }) })); setEditing(null); setMessage('Zapisano opis dokumentu.'); await onChanged(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); } }
  async function remove(document: any) { if (!window.confirm(`Usunąć plik „${document.title}”? Tej operacji nie można cofnąć.`)) return; setBusy(document.id); setError(''); try { await read(await fetch('/api/documents', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: document.id }) })); setMessage('Usunięto dokument i plik.'); await onChanged(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); } }

  return <Flex direction="column" gap="20px">
    <Card p="22px"><Text color={textColor} fontSize="lg" fontWeight="800">{mode === 'invoices' ? 'Dodaj fakturę za energię' : 'Dodaj zdjęcie lub plik'}</Text><Text color={mutedColor} mb="16px">{mode === 'invoices' ? 'Okres rozliczeniowy może obejmować dowolną liczbę miesięcy.' : 'Plik można opisać, datować, oznaczyć i udostępnić klientowi.'}</Text>
      {error ? <Alert status="error" mb="12px"><AlertIcon />{error}</Alert> : null}{message ? <Alert status="success" mb="12px"><AlertIcon />{message}</Alert> : null}
      <SimpleGrid columns={{ base: 1, md: 2 }} gap="12px"><FormControl isRequired><FormLabel>Plik</FormLabel><Input type="file" accept={mode === 'invoices' ? '.pdf,.jpg,.jpeg,.png,.webp' : undefined} p="5px" onChange={selectFile} /></FormControl><FormControl isRequired><FormLabel>{mode === 'invoices' ? 'Nazwa faktury' : 'Nazwa'}</FormLabel><Input value={title} onChange={(event) => setTitle(event.target.value)} /></FormControl>
      {mode === 'files' ? <FormControl><FormLabel>Rodzaj</FormLabel><Select value={type} onChange={(event) => setType(event.target.value)}>{fileTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormControl> : <><FormControl><FormLabel>Numer faktury</FormLabel><Input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></FormControl><FormControl><FormLabel>Kwota brutto</FormLabel><Input type="number" min="0" step="0.01" value={amountGross} onChange={(event) => setAmountGross(event.target.value)} /></FormControl><FormControl><FormLabel>Częstotliwość</FormLabel><Select value={billingCycleMonths} onChange={(event) => setCycle(event.target.value)}>{cycles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormControl><FormControl><FormLabel>Okres od</FormLabel><Input type="date" value={billingPeriodFrom} onChange={(event) => setPeriodFrom(event.target.value)} /></FormControl><FormControl><FormLabel>Okres do</FormLabel><Input type="date" value={billingPeriodTo} onChange={(event) => setBillingPeriodTo(event.target.value)} /></FormControl></>}
      <FormControl><FormLabel>Data dokumentu</FormLabel><Input type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} /></FormControl><FormControl><FormLabel>Oznaczenia</FormLabel><Input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="np. dach, przed montażem, ważne" /></FormControl></SimpleGrid>
      <FormControl mt="12px"><FormLabel>Opis</FormLabel><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></FormControl><Checkbox mt="10px" isChecked={visibleToClient} onChange={(event) => setVisibleToClient(event.target.checked)}>Widoczny dla klienta</Checkbox><Button mt="14px" colorScheme="purple" leftIcon={<Icon as={MdUploadFile} />} onClick={upload} isLoading={busy === 'upload'} isDisabled={!file || !title.trim()}>Dodaj</Button>
    </Card>
    <Card p="22px"><Flex justify="space-between" mb="14px"><Box><Text color={textColor} fontSize="lg" fontWeight="800">{mode === 'invoices' ? 'Faktury' : 'Zdjęcia i pliki'}</Text><Text color={mutedColor}>{shown.length} dokumentów</Text></Box></Flex><Flex direction="column" gap="10px">{shown.map((document) => {
      const isEditing = editing?.id === document.id; const image = document.mimeType?.startsWith('image/');
      return <Box key={document.id} border="1px solid" borderColor={borderColor} borderRadius="8px" p="12px">{isEditing ? <><SimpleGrid columns={{ base: 1, md: 2 }} gap="10px"><FormControl><FormLabel>Nazwa</FormLabel><Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></FormControl>{mode === 'files' ? <FormControl><FormLabel>Rodzaj</FormLabel><Select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>{fileTypes.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</Select></FormControl> : <><FormControl><FormLabel>Numer faktury</FormLabel><Input value={editing.invoiceNumber || ''} onChange={(e) => setEditing({ ...editing, invoiceNumber: e.target.value })} /></FormControl><FormControl><FormLabel>Kwota brutto</FormLabel><Input type="number" value={editing.amountGross} onChange={(e) => setEditing({ ...editing, amountGross: e.target.value })} /></FormControl><FormControl><FormLabel>Okres (miesiące)</FormLabel><Input type="number" min="1" max="24" value={editing.billingCycleMonths || ''} onChange={(e) => setEditing({ ...editing, billingCycleMonths: e.target.value })} /></FormControl><FormControl><FormLabel>Od</FormLabel><Input type="date" value={editing.billingPeriodFrom} onChange={(e) => setEditing({ ...editing, billingPeriodFrom: e.target.value })} /></FormControl><FormControl><FormLabel>Do</FormLabel><Input type="date" value={editing.billingPeriodTo} onChange={(e) => setEditing({ ...editing, billingPeriodTo: e.target.value })} /></FormControl></>}<FormControl><FormLabel>Data dokumentu</FormLabel><Input type="date" value={editing.documentDate} onChange={(e) => setEditing({ ...editing, documentDate: e.target.value })} /></FormControl><FormControl><FormLabel>Oznaczenia</FormLabel><Input value={editing.tagsText} onChange={(e) => setEditing({ ...editing, tagsText: e.target.value })} /></FormControl></SimpleGrid><FormControl mt="10px"><FormLabel>Opis</FormLabel><Textarea value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></FormControl><Checkbox mt="8px" isChecked={editing.visibleToClient} onChange={(e) => setEditing({ ...editing, visibleToClient: e.target.checked })}>Widoczny dla klienta</Checkbox><Flex gap="8px" mt="10px"><Button size="sm" colorScheme="purple" leftIcon={<MdSave />} onClick={saveEdit} isLoading={busy === document.id}>Zapisz</Button><Button size="sm" variant="outline" onClick={() => setEditing(null)}>Anuluj</Button></Flex></> : <Flex gap="12px" align="start">{image ? <Box as="img" src={`/api/documents/${document.id}/file`} alt={document.title} w="86px" h="64px" objectFit="cover" borderRadius="6px" flexShrink="0" /> : null}<Box flex="1" minW="0"><Flex gap="8px" wrap="wrap"><Text color={textColor} fontWeight="800">{document.title}</Text>{document.visibleToClient ? <Badge colorScheme="green">Dla klienta</Badge> : null}{tags(document.tags).map((tag) => <Badge key={tag} colorScheme="blue">{tag}</Badge>)}</Flex><Text color={mutedColor} fontSize="sm">{document.fileName} · {dateLabel(document.documentDate || document.createdAt)}</Text>{mode === 'invoices' ? <Text color={textColor} fontSize="sm" mt="4px">{document.invoiceNumber || 'Bez numeru'} · {money(document.amountGross)} · {cycleLabel(document.billingCycleMonths)} · {dateLabel(document.billingPeriodFrom)}–{dateLabel(document.billingPeriodTo)}</Text> : null}{document.notes ? <Text color={mutedColor} mt="5px">{document.notes}</Text> : null}</Box><Flex gap="4px"><Tooltip label="Otwórz"><IconButton as="a" href={`/api/documents/${document.id}/file`} target="_blank" aria-label="Otwórz plik" icon={<MdOpenInNew />} size="sm" variant="outline" /></Tooltip><Tooltip label="Pobierz"><IconButton as="a" href={`/api/documents/${document.id}/file?download=1`} aria-label="Pobierz plik" icon={<MdDownload />} size="sm" variant="outline" /></Tooltip><Tooltip label="Edytuj"><IconButton aria-label="Edytuj opis" icon={<MdEdit />} size="sm" variant="outline" onClick={() => beginEdit(document)} /></Tooltip><Tooltip label="Usuń"><IconButton aria-label="Usuń plik" icon={<MdDeleteOutline />} size="sm" variant="outline" colorScheme="red" onClick={() => remove(document)} isLoading={busy === document.id} /></Tooltip></Flex></Flex>}</Box>;
    })}{!shown.length ? <Text color={mutedColor}>Brak dokumentów w tej sekcji.</Text> : null}</Flex></Card>
  </Flex>;
}
