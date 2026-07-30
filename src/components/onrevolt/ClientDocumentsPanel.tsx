'use client';

import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormLabel,
  Icon,
  IconButton,
  Input,
  Select,
  SimpleGrid,
  Spinner,
  Table,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tooltip,
  Tr,
  useColorModeValue,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import DocumentImagePreviewModal from 'components/onrevolt/DocumentImagePreviewModal';
import type { InvoiceRecognitionResult } from 'lib/onrevolt/invoice-recognition';
import { ChangeEvent, useMemo, useState } from 'react';
import {
  MdDeleteOutline,
  MdDownload,
  MdEdit,
  MdOpenInNew,
  MdSave,
  MdUploadFile,
  MdVisibility,
} from 'react-icons/md';

type Props = {
  mode: 'files' | 'invoices';
  clientId: string;
  projectId?: string;
  documents: any[];
  onChanged: () => Promise<void> | void;
  expectedPpeNumber?: string;
  expectedTariff?: string;
};

type PanelProps = Omit<Props, 'mode'>;

type InvoiceDuplicate = {
  kind: 'IDENTICAL' | 'INVOICE_NUMBER';
  document: {
    id: string;
    title: string;
    fileName: string;
    sha256?: string | null;
    invoiceNumber?: string | null;
    documentDate?: string | null;
  };
};

type InvoiceRecognitionPayload = {
  recognition: InvoiceRecognitionResult;
  duplicate: InvoiceDuplicate | null;
};

const fileTypes = [
  ['ZDJECIE_MONTAZU', 'Zdjęcie'],
  ['PROTOKOL', 'Protokół'],
  ['DOKUMENT_OSD', 'Dokument OSD'],
  ['RE_DOKUMENT', 'Dokument RE'],
  ['INNE', 'Inny plik'],
] as const;

const cycles = [
  ['1', 'Miesięczna'],
  ['2', 'Dwumiesięczna'],
  ['3', 'Kwartalna'],
  ['6', 'Półroczna'],
  ['12', 'Roczna'],
] as const;

function inputDate(value?: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function dateLabel(value?: string | null) {
  return value ? new Intl.DateTimeFormat('pl-PL').format(new Date(value)) : '-';
}

function monthLabel(period: string) {
  const [year, month] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1));
}

function money(value: unknown) {
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' })
    .format(Number(value || 0));
}

function kwh(value: unknown) {
  return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 }).format(Number(value || 0))} kWh`;
}

function tags(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function cycleLabel(value?: number | null) {
  return cycles.find(([months]) => Number(months) === Number(value))?.[1]
    || (value ? `${value} mies.` : 'Okres własny');
}

function normalizedPpe(value?: string | null) {
  return String(value || '').replace(/\s/g, '');
}

function normalizedTariff(value?: string | null) {
  return String(value || '').trim().toUpperCase();
}

function isHeicFile(file?: File | null) {
  return Boolean(file && /\.(heic|heif)$/i.test(file.name));
}

function recognitionOf(document: any) {
  const value = document?.invoiceRecognition;
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as InvoiceRecognitionResult;
    } catch {
      return null;
    }
  }
  return value as InvoiceRecognitionResult;
}

async function readResponse(response: Response) {
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  }
  return payload.data;
}

export default function ClientDocumentsPanel(props: Props) {
  if (props.mode === 'invoices') {
    return <ClientInvoicesPanel {...props} />;
  }
  return <ClientFilesPanel {...props} />;
}

function ClientFilesPanel({ clientId, projectId, documents, onChanged }: PanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('ZDJECIE_MONTAZU');
  const [notes, setNotes] = useState('');
  const [documentDate, setDocumentDate] = useState(new Date().toISOString().slice(0, 10));
  const [tagText, setTagText] = useState('');
  const [visibleToClient, setVisibleToClient] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] || null;
    setFile(selected);
    if (selected && !title) setTitle(selected.name.replace(/\.[^.]+$/, ''));
  }

  async function upload() {
    if (!file || !title.trim()) return;
    const convertedFromHeic = isHeicFile(file);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('type', type);
      form.set('title', title.trim());
      form.set('clientId', clientId);
      if (projectId) form.set('projectId', projectId);
      form.set('notes', notes);
      form.set('documentDate', documentDate);
      form.set('tags', tagText);
      form.set('visibleToClient', String(visibleToClient));
      await readResponse(await fetch('/api/documents/upload', { method: 'POST', body: form }));
      setFile(null);
      setFileInputKey((value) => value + 1);
      setTitle('');
      setNotes('');
      setTagText('');
      setMessage(convertedFromHeic ? 'Dodano zdjęcie po konwersji do JPG.' : 'Dodano plik.');
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const shown = useMemo(
    () => documents.filter((document) => !['FAKTURA_PRAD', 'ENEA_ZUZYCIE', 'ENEA_PRODUKCJA'].includes(document.type)),
    [documents],
  );

  return (
    <Flex direction="column" gap="20px">
      <Card p="22px">
        <Text color={textColor} fontSize="lg" fontWeight="800">Dodaj zdjęcie lub plik</Text>
        <Text color={mutedColor} mb="16px">Plik można opisać, datować, oznaczyć i udostępnić klientowi.</Text>
        {error ? <Alert status="error" mb="12px"><AlertIcon />{error}</Alert> : null}
        {message ? <Alert status="success" mb="12px"><AlertIcon />{message}</Alert> : null}
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="12px">
          <FormControl isRequired>
            <FormLabel>Plik</FormLabel>
            <Input
              key={fileInputKey}
              type="file"
              p="5px"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.xlsx,.xls,.ods,.docx,.doc,.csv,.txt,image/heic,image/heif"
              onChange={selectFile}
            />
            {isHeicFile(file) ? (
              <Text color={mutedColor} fontSize="sm" mt="6px">
                Zdjęcie HEIC zostanie automatycznie zapisane jako JPG.
              </Text>
            ) : null}
          </FormControl>
          <FormControl isRequired>
            <FormLabel>Nazwa</FormLabel>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </FormControl>
          <FormControl>
            <FormLabel>Rodzaj</FormLabel>
            <Select value={type} onChange={(event) => setType(event.target.value)}>
              {fileTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </FormControl>
          <FormControl>
            <FormLabel>Data dokumentu</FormLabel>
            <Input type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} />
          </FormControl>
          <FormControl>
            <FormLabel>Oznaczenia</FormLabel>
            <Input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="np. dach, przed montażem, ważne" />
          </FormControl>
        </SimpleGrid>
        <FormControl mt="12px">
          <FormLabel>Opis</FormLabel>
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </FormControl>
        <Checkbox mt="10px" isChecked={visibleToClient} onChange={(event) => setVisibleToClient(event.target.checked)}>
          Widoczny dla klienta
        </Checkbox>
        <Button
          mt="14px"
          colorScheme="purple"
          leftIcon={<Icon as={MdUploadFile} />}
          onClick={upload}
          isLoading={busy}
          isDisabled={!file || !title.trim()}
        >
          Dodaj
        </Button>
      </Card>
      <DocumentsList mode="files" documents={shown} onChanged={onChanged} />
    </Flex>
  );
}

function ClientInvoicesPanel({
  clientId,
  projectId,
  documents,
  onChanged,
  expectedPpeNumber,
  expectedTariff,
}: PanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [recognition, setRecognition] = useState<InvoiceRecognitionResult | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [amountGross, setAmountGross] = useState('');
  const [amountDue, setAmountDue] = useState('');
  const [billingCycleMonths, setBillingCycleMonths] = useState('');
  const [billingPeriodFrom, setBillingPeriodFrom] = useState('');
  const [billingPeriodTo, setBillingPeriodTo] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [invoicePpeNumber, setInvoicePpeNumber] = useState('');
  const [invoiceTariff, setInvoiceTariff] = useState('');
  const [energyConsumptionKwh, setEnergyConsumptionKwh] = useState('');
  const [notes, setNotes] = useState('');
  const [tagText, setTagText] = useState('');
  const [visibleToClient, setVisibleToClient] = useState(false);
  const [assignmentMismatchConfirmed, setAssignmentMismatchConfirmed] = useState(false);
  const [duplicateInvoice, setDuplicateInvoice] = useState<InvoiceDuplicate | null>(null);
  const [replaceExistingConfirmed, setReplaceExistingConfirmed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');

  const shown = useMemo(
    () => documents.filter((document) => document.type === 'FAKTURA_PRAD'),
    [documents],
  );
  const ppeMismatch = Boolean(
    normalizedPpe(expectedPpeNumber)
      && normalizedPpe(invoicePpeNumber)
      && normalizedPpe(expectedPpeNumber) !== normalizedPpe(invoicePpeNumber),
  );
  const tariffMismatch = Boolean(
    normalizedTariff(expectedTariff)
      && normalizedTariff(invoiceTariff)
      && normalizedTariff(expectedTariff) !== normalizedTariff(invoiceTariff),
  );
  const assignmentMismatch = ppeMismatch || tariffMismatch;

  function populate(result: InvoiceRecognitionResult) {
    const fields = result.fields;
    setRecognition(result);
    setInvoiceNumber(fields.invoiceNumber || '');
    setAmountGross(fields.amountGross == null ? '' : String(fields.amountGross));
    setAmountDue(fields.amountDue == null ? '' : String(fields.amountDue));
    setBillingCycleMonths(fields.billingCycleMonths == null ? '' : String(fields.billingCycleMonths));
    setBillingPeriodFrom(fields.periodFrom || '');
    setBillingPeriodTo(fields.periodTo || '');
    setDocumentDate(fields.issueDate || '');
    setInvoicePpeNumber(fields.ppeNumber || '');
    setInvoiceTariff(fields.tariff || '');
    setEnergyConsumptionKwh(
      fields.consumption.totalAfterBalancingKwh == null
        ? ''
        : String(fields.consumption.totalAfterBalancingKwh),
    );
    setAssignmentMismatchConfirmed(false);
    setReplaceExistingConfirmed(false);
  }

  async function selectInvoice(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] || null;
    setFile(selected);
    setRecognition(null);
    setDuplicateInvoice(null);
    setReplaceExistingConfirmed(false);
    setError('');
    setMessage('');
    setNotice('');
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.pdf')) {
      setError('Rozpoznawanie obsługuje obecnie tylko faktury PDF.');
      return;
    }

    setBusy('recognize');
    try {
      const form = new FormData();
      form.set('file', selected);
      form.set('clientId', clientId);
      if (projectId) form.set('projectId', projectId);
      const result = await readResponse(
        await fetch('/api/invoices/recognize', { method: 'POST', body: form }),
      ) as InvoiceRecognitionPayload;
      if (result.duplicate?.kind === 'IDENTICAL') {
        setFile(null);
        setFileInputKey((value) => value + 1);
        setNotice(
          `Ta sama faktura jest już zapisana jako „${result.duplicate.document.title}”. Nie dodano drugiej kopii.`,
        );
        return;
      }
      populate(result.recognition);
      setDuplicateInvoice(result.duplicate);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  async function upload() {
    if (!file || !recognition) return;
    setBusy('upload');
    setError('');
    setMessage('');
    try {
      const confirmedRecognition: InvoiceRecognitionResult = {
        ...recognition,
        fields: {
          ...recognition.fields,
          invoiceNumber,
          issueDate: documentDate,
          periodFrom: billingPeriodFrom,
          periodTo: billingPeriodTo,
          billingCycleMonths: Number(billingCycleMonths),
          amountGross: Number(amountGross),
          amountDue: Number(amountDue),
          ppeNumber: invoicePpeNumber,
          tariff: invoiceTariff,
          consumption: {
            ...recognition.fields.consumption,
            totalAfterBalancingKwh: Number(energyConsumptionKwh),
          },
        },
      };
      const form = new FormData();
      form.set('file', file);
      form.set('type', 'FAKTURA_PRAD');
      form.set('title', `Faktura ENEA ${invoiceNumber || file.name}`);
      form.set('clientId', clientId);
      if (projectId) form.set('projectId', projectId);
      form.set('notes', notes);
      form.set('documentDate', documentDate);
      form.set('tags', tagText);
      form.set('visibleToClient', String(visibleToClient));
      form.set('invoiceNumber', invoiceNumber);
      form.set('amountGross', amountGross);
      form.set('amountDue', amountDue);
      form.set('billingCycleMonths', billingCycleMonths);
      form.set('billingPeriodFrom', billingPeriodFrom);
      form.set('billingPeriodTo', billingPeriodTo);
      form.set('invoicePpeNumber', invoicePpeNumber);
      form.set('invoiceTariff', invoiceTariff);
      form.set('energyConsumptionKwh', energyConsumptionKwh);
      form.set('invoiceRecognition', JSON.stringify(confirmedRecognition));
      form.set('assignmentMismatchConfirmed', String(assignmentMismatchConfirmed));
      if (duplicateInvoice?.kind === 'INVOICE_NUMBER') {
        form.set('replaceDocumentId', duplicateInvoice.document.id);
        form.set('replaceExistingInvoice', String(replaceExistingConfirmed));
      }
      await readResponse(await fetch('/api/documents/upload', { method: 'POST', body: form }));
      setFile(null);
      setRecognition(null);
      setDuplicateInvoice(null);
      setReplaceExistingConfirmed(false);
      setFileInputKey((value) => value + 1);
      setNotes('');
      setTagText('');
      setMessage(
        duplicateInvoice?.kind === 'INVOICE_NUMBER'
          ? 'Rozpoznano i zastąpiono istniejącą fakturę ENEA.'
          : 'Rozpoznano, zatwierdzono i dodano fakturę ENEA.',
      );
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  const requiredMissing = recognition && (
    !invoiceNumber
    || !amountGross
    || !billingPeriodFrom
    || !billingPeriodTo
    || !documentDate
    || !invoicePpeNumber
    || !invoiceTariff
  );

  return (
    <Flex direction="column" gap="20px">
      <Card p="22px">
        <Text color={textColor} fontSize="lg" fontWeight="800">Dodaj fakturę ENEA</Text>
        <Text color={mutedColor} mb="16px">
          Wybierz PDF. System rozpozna dane, które sprawdzisz przed zapisaniem.
        </Text>
        {error ? <Alert status="error" mb="12px"><AlertIcon />{error}</Alert> : null}
        {message ? <Alert status="success" mb="12px"><AlertIcon />{message}</Alert> : null}
        {notice ? <Alert status="info" mb="12px"><AlertIcon />{notice}</Alert> : null}
        <FormControl isRequired maxW="620px">
          <FormLabel>Faktura PDF</FormLabel>
          <Input key={fileInputKey} type="file" accept=".pdf,application/pdf" p="5px" onChange={selectInvoice} />
        </FormControl>

        {busy === 'recognize' ? (
          <Flex mt="18px" align="center" gap="10px">
            <Spinner size="sm" />
            <Text color={mutedColor}>Rozpoznawanie faktury ENEA...</Text>
          </Flex>
        ) : null}

        {recognition ? (
          <Box mt="20px" pt="18px" borderTop="1px solid" borderColor={borderColor}>
            <Flex gap="8px" wrap="wrap" mb="16px">
              <Badge colorScheme="blue">ENEA</Badge>
              <Badge>Parser {recognition.parser.version}</Badge>
              <Badge colorScheme={recognition.confidence >= 0.9 ? 'green' : 'orange'}>
                Pewność {Math.round(recognition.confidence * 100)}%
              </Badge>
            </Flex>

            {recognition.warnings.map((warning) => (
              <Alert key={warning} status="warning" mb="10px"><AlertIcon />{warning}</Alert>
            ))}

            {duplicateInvoice?.kind === 'INVOICE_NUMBER' ? (
              <Alert status="warning" mb="14px" alignItems="start">
                <AlertIcon mt="2px" />
                <Box>
                  <Text fontWeight="800">
                    Faktura nr {duplicateInvoice.document.invoiceNumber || invoiceNumber} już istnieje
                  </Text>
                  <Text fontSize="sm">
                    Zapisano ją wcześniej jako „{duplicateInvoice.document.title}”. Plik jest inny,
                    dlatego przed zastąpieniem potrzebne jest potwierdzenie.
                  </Text>
                  <Checkbox
                    mt="8px"
                    isChecked={replaceExistingConfirmed}
                    onChange={(event) => setReplaceExistingConfirmed(event.target.checked)}
                  >
                    Zastąp istniejącą fakturę tym plikiem
                  </Checkbox>
                </Box>
              </Alert>
            ) : null}

            <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap="12px">
              <FormControl isRequired>
                <FormLabel>Numer faktury</FormLabel>
                <Input
                  value={invoiceNumber}
                  onChange={(event) => {
                    const value = event.target.value;
                    setInvoiceNumber(value);
                    if (
                      duplicateInvoice
                      && value.trim() !== String(duplicateInvoice.document.invoiceNumber || '').trim()
                    ) {
                      setDuplicateInvoice(null);
                      setReplaceExistingConfirmed(false);
                    }
                  }}
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>Kwota brutto</FormLabel>
                <Input type="number" min="0" step="0.01" value={amountGross} onChange={(event) => setAmountGross(event.target.value)} />
              </FormControl>
              <FormControl>
                <FormLabel>Do zapłaty</FormLabel>
                <Input type="number" min="0" step="0.01" value={amountDue} onChange={(event) => setAmountDue(event.target.value)} />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>Data wystawienia</FormLabel>
                <Input type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>Okres od</FormLabel>
                <Input type="date" value={billingPeriodFrom} onChange={(event) => setBillingPeriodFrom(event.target.value)} />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>Okres do</FormLabel>
                <Input type="date" value={billingPeriodTo} onChange={(event) => setBillingPeriodTo(event.target.value)} />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>Częstotliwość</FormLabel>
                <Select value={billingCycleMonths} onChange={(event) => setBillingCycleMonths(event.target.value)}>
                  {cycles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </FormControl>
              <FormControl isRequired>
                <FormLabel>PPE z faktury</FormLabel>
                <Input value={invoicePpeNumber} onChange={(event) => setInvoicePpeNumber(event.target.value)} />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>Grupa taryfowa</FormLabel>
                <Input value={invoiceTariff} onChange={(event) => setInvoiceTariff(event.target.value)} />
              </FormControl>
              <FormControl>
                <FormLabel>Zużycie po bilansowaniu</FormLabel>
                <Input type="number" min="0" step="0.001" value={energyConsumptionKwh} onChange={(event) => setEnergyConsumptionKwh(event.target.value)} />
              </FormControl>
            </SimpleGrid>

            <SimpleGrid columns={{ base: 1, lg: 2 }} gap="12px" mt="14px">
              <Box p="12px" border="1px solid" borderColor={ppeMismatch ? 'red.300' : borderColor} borderRadius="8px">
                <Text color={mutedColor} fontSize="sm">PPE zapisane w CRM</Text>
                <Text color={textColor} fontWeight="800">{expectedPpeNumber || 'Nie uzupełniono'}</Text>
                {expectedPpeNumber ? (
                  <Badge mt="6px" colorScheme={ppeMismatch ? 'red' : 'green'}>
                    {ppeMismatch ? 'Niezgodne PPE' : 'PPE zgodne'}
                  </Badge>
                ) : null}
              </Box>
              <Box p="12px" border="1px solid" borderColor={tariffMismatch ? 'red.300' : borderColor} borderRadius="8px">
                <Text color={mutedColor} fontSize="sm">Taryfa zapisana w CRM</Text>
                <Text color={textColor} fontWeight="800">{expectedTariff || 'Nie uzupełniono'}</Text>
                {expectedTariff ? (
                  <Badge mt="6px" colorScheme={tariffMismatch ? 'red' : 'green'}>
                    {tariffMismatch ? 'Niezgodna taryfa' : 'Taryfa zgodna'}
                  </Badge>
                ) : null}
              </Box>
            </SimpleGrid>

            {assignmentMismatch ? (
              <Alert status="error" mt="14px" alignItems="start">
                <AlertIcon mt="2px" />
                <Box>
                  <Text fontWeight="800">Faktura może należeć do innego klienta</Text>
                  <Text fontSize="sm">PPE lub grupa taryfowa różni się od danych zapisanych w CRM.</Text>
                  <Checkbox
                    mt="8px"
                    isChecked={assignmentMismatchConfirmed}
                    onChange={(event) => setAssignmentMismatchConfirmed(event.target.checked)}
                  >
                    Potwierdzam świadome przypisanie tej faktury
                  </Checkbox>
                </Box>
              </Alert>
            ) : null}

            {recognition.fields.consumption.monthly.length ? (
              <Box mt="18px" overflowX="auto">
                <Text color={textColor} fontWeight="800" mb="8px">Rozpoznane zużycie miesięczne</Text>
                <Table size="sm">
                  <Thead>
                    <Tr>
                      <Th>Miesiąc</Th>
                      <Th isNumeric>Pobrano</Th>
                      <Th isNumeric>Po bilansowaniu</Th>
                      <Th isNumeric>Oddano</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {recognition.fields.consumption.monthly.map((month) => (
                      <Tr key={month.period}>
                        <Td textTransform="capitalize">{monthLabel(month.period)}</Td>
                        <Td isNumeric>{kwh(month.consumptionBeforeBalancingKwh)}</Td>
                        <Td isNumeric>{kwh(month.consumptionAfterBalancingKwh)}</Td>
                        <Td isNumeric>{kwh(month.exportedAfterBalancingKwh)}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            ) : null}

            {recognition.fields.consumption.zones.length ? (
              <Flex mt="14px" gap="8px" wrap="wrap">
                {recognition.fields.consumption.zones.map((zone) => (
                  <Badge key={zone.name} colorScheme="teal" px="9px" py="5px">
                    {zone.name}: {kwh(zone.consumptionKwh)}
                  </Badge>
                ))}
              </Flex>
            ) : null}

            <SimpleGrid columns={{ base: 1, md: 2 }} gap="12px" mt="18px">
              <FormControl>
                <FormLabel>Oznaczenia</FormLabel>
                <Input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="np. rozliczenie roczne" />
              </FormControl>
              <FormControl>
                <FormLabel>Notatka</FormLabel>
                <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
              </FormControl>
            </SimpleGrid>
            <Checkbox mt="10px" isChecked={visibleToClient} onChange={(event) => setVisibleToClient(event.target.checked)}>
              Widoczna dla klienta
            </Checkbox>
            <Button
              mt="14px"
              colorScheme="purple"
              leftIcon={<Icon as={MdSave} />}
              onClick={upload}
              isLoading={busy === 'upload'}
              isDisabled={
                Boolean(requiredMissing)
                || (assignmentMismatch && !assignmentMismatchConfirmed)
                || (duplicateInvoice?.kind === 'INVOICE_NUMBER' && !replaceExistingConfirmed)
              }
            >
              {duplicateInvoice?.kind === 'INVOICE_NUMBER'
                ? 'Zatwierdź i zastąp fakturę'
                : 'Zatwierdź i dodaj fakturę'}
            </Button>
          </Box>
        ) : null}
      </Card>
      <DocumentsList mode="invoices" documents={shown} onChanged={onChanged} />
    </Flex>
  );
}

function DocumentsList({
  mode,
  documents,
  onChanged,
}: {
  mode: 'files' | 'invoices';
  documents: any[];
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState<any | null>(null);
  const [previewDocument, setPreviewDocument] = useState<any | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');

  function beginEdit(document: any) {
    setEditing({
      ...document,
      documentDate: inputDate(document.documentDate),
      billingPeriodFrom: inputDate(document.billingPeriodFrom),
      billingPeriodTo: inputDate(document.billingPeriodTo),
      tagsText: tags(document.tags).join(', '),
      amountGross: document.amountGross == null ? '' : String(document.amountGross),
      amountDue: document.amountDue == null ? '' : String(document.amountDue),
      energyConsumptionKwh: document.energyConsumptionKwh == null ? '' : String(document.energyConsumptionKwh),
    });
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(editing.id);
    setError('');
    try {
      await readResponse(await fetch('/api/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          title: editing.title,
          type: editing.type,
          notes: editing.notes,
          documentDate: editing.documentDate,
          tags: editing.tagsText.split(',').map((item: string) => item.trim()).filter(Boolean),
          visibleToClient: editing.visibleToClient,
          invoiceNumber: editing.invoiceNumber,
          amountGross: editing.amountGross,
          amountDue: editing.amountDue,
          billingCycleMonths: editing.billingCycleMonths,
          billingPeriodFrom: editing.billingPeriodFrom,
          billingPeriodTo: editing.billingPeriodTo,
          invoicePpeNumber: editing.invoicePpeNumber,
          invoiceTariff: editing.invoiceTariff,
          energyConsumptionKwh: editing.energyConsumptionKwh,
        }),
      }));
      setEditing(null);
      setMessage('Zapisano dane dokumentu.');
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  async function remove(document: any) {
    if (!window.confirm(`Usunąć plik „${document.title}”? Tej operacji nie można cofnąć.`)) return;
    setBusy(document.id);
    setError('');
    try {
      await readResponse(await fetch('/api/documents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: document.id }),
      }));
      setMessage('Usunięto dokument i plik.');
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <Card p="22px">
      <Flex justify="space-between" mb="14px">
        <Box>
          <Text color={textColor} fontSize="lg" fontWeight="800">{mode === 'invoices' ? 'Faktury' : 'Zdjęcia i pliki'}</Text>
          <Text color={mutedColor}>{documents.length} dokumentów</Text>
        </Box>
      </Flex>
      {error ? <Alert status="error" mb="12px"><AlertIcon />{error}</Alert> : null}
      {message ? <Alert status="success" mb="12px"><AlertIcon />{message}</Alert> : null}
      <Flex direction="column" gap="10px">
        {documents.map((document) => {
          const isEditing = editing?.id === document.id;
          const image = document.mimeType?.startsWith('image/');
          const recognition = recognitionOf(document);
          return (
            <Box key={document.id} border="1px solid" borderColor={borderColor} borderRadius="8px" p="12px">
              {isEditing ? (
                <>
                  <SimpleGrid columns={{ base: 1, md: 2 }} gap="10px">
                    <FormControl>
                      <FormLabel>Nazwa</FormLabel>
                      <Input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
                    </FormControl>
                    {mode === 'files' ? (
                      <FormControl>
                        <FormLabel>Rodzaj</FormLabel>
                        <Select value={editing.type} onChange={(event) => setEditing({ ...editing, type: event.target.value })}>
                          {fileTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </Select>
                      </FormControl>
                    ) : (
                      <>
                        <FormControl>
                          <FormLabel>Numer faktury</FormLabel>
                          <Input value={editing.invoiceNumber || ''} onChange={(event) => setEditing({ ...editing, invoiceNumber: event.target.value })} />
                        </FormControl>
                        <FormControl>
                          <FormLabel>Kwota brutto</FormLabel>
                          <Input type="number" value={editing.amountGross} onChange={(event) => setEditing({ ...editing, amountGross: event.target.value })} />
                        </FormControl>
                        <FormControl>
                          <FormLabel>Do zapłaty</FormLabel>
                          <Input type="number" value={editing.amountDue} onChange={(event) => setEditing({ ...editing, amountDue: event.target.value })} />
                        </FormControl>
                        <FormControl>
                          <FormLabel>Okres (miesiące)</FormLabel>
                          <Input type="number" min="1" max="24" value={editing.billingCycleMonths || ''} onChange={(event) => setEditing({ ...editing, billingCycleMonths: event.target.value })} />
                        </FormControl>
                        <FormControl>
                          <FormLabel>Od</FormLabel>
                          <Input type="date" value={editing.billingPeriodFrom} onChange={(event) => setEditing({ ...editing, billingPeriodFrom: event.target.value })} />
                        </FormControl>
                        <FormControl>
                          <FormLabel>Do</FormLabel>
                          <Input type="date" value={editing.billingPeriodTo} onChange={(event) => setEditing({ ...editing, billingPeriodTo: event.target.value })} />
                        </FormControl>
                        <FormControl>
                          <FormLabel>PPE</FormLabel>
                          <Input value={editing.invoicePpeNumber || ''} onChange={(event) => setEditing({ ...editing, invoicePpeNumber: event.target.value })} />
                        </FormControl>
                        <FormControl>
                          <FormLabel>Grupa taryfowa</FormLabel>
                          <Input value={editing.invoiceTariff || ''} onChange={(event) => setEditing({ ...editing, invoiceTariff: event.target.value })} />
                        </FormControl>
                        <FormControl>
                          <FormLabel>Zużycie po bilansowaniu</FormLabel>
                          <Input type="number" value={editing.energyConsumptionKwh} onChange={(event) => setEditing({ ...editing, energyConsumptionKwh: event.target.value })} />
                        </FormControl>
                      </>
                    )}
                    <FormControl>
                      <FormLabel>Data dokumentu</FormLabel>
                      <Input type="date" value={editing.documentDate} onChange={(event) => setEditing({ ...editing, documentDate: event.target.value })} />
                    </FormControl>
                    <FormControl>
                      <FormLabel>Oznaczenia</FormLabel>
                      <Input value={editing.tagsText} onChange={(event) => setEditing({ ...editing, tagsText: event.target.value })} />
                    </FormControl>
                  </SimpleGrid>
                  <FormControl mt="10px">
                    <FormLabel>Opis</FormLabel>
                    <Textarea value={editing.notes || ''} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} />
                  </FormControl>
                  <Checkbox mt="8px" isChecked={editing.visibleToClient} onChange={(event) => setEditing({ ...editing, visibleToClient: event.target.checked })}>
                    Widoczny dla klienta
                  </Checkbox>
                  <Flex gap="8px" mt="10px">
                    <Button size="sm" colorScheme="purple" leftIcon={<MdSave />} onClick={saveEdit} isLoading={busy === document.id}>
                      Zapisz
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Anuluj</Button>
                  </Flex>
                </>
              ) : (
                <Flex gap="12px" align="start">
                  {image ? (
                    <Box
                      as="button"
                      type="button"
                      aria-label={`Podejrzyj zdjęcie ${document.fileName}`}
                      w="86px"
                      h="64px"
                      borderRadius="6px"
                      overflow="hidden"
                      flexShrink="0"
                      onClick={() => setPreviewDocument(document)}
                    >
                      <Box
                        as="img"
                        src={`/api/documents/${document.id}/file`}
                        alt={document.title}
                        w="100%"
                        h="100%"
                        objectFit="cover"
                      />
                    </Box>
                  ) : null}
                  <Box flex="1" minW="0">
                    <Flex gap="8px" wrap="wrap">
                      <Text color={textColor} fontWeight="800">{document.title}</Text>
                      {document.visibleToClient ? <Badge colorScheme="green">Dla klienta</Badge> : null}
                      {document.invoiceParserVersion ? <Badge colorScheme="blue">Parser {document.invoiceParserVersion}</Badge> : null}
                      {tags(document.tags).map((tag) => <Badge key={tag} colorScheme="blue">{tag}</Badge>)}
                    </Flex>
                    <Text color={mutedColor} fontSize="sm">{document.fileName} · {dateLabel(document.documentDate || document.createdAt)}</Text>
                    {mode === 'invoices' ? (
                      <>
                        <Text color={textColor} fontSize="sm" mt="4px">
                          {document.invoiceNumber || 'Bez numeru'} · {money(document.amountGross)} · {cycleLabel(document.billingCycleMonths)} · {dateLabel(document.billingPeriodFrom)}–{dateLabel(document.billingPeriodTo)}
                        </Text>
                        <Text color={mutedColor} fontSize="sm" mt="3px">
                          PPE: {document.invoicePpeNumber || '-'} · taryfa: {document.invoiceTariff || '-'} · zużycie: {kwh(document.energyConsumptionKwh)}
                        </Text>
                        {recognition?.fields.consumption.monthly?.length ? (
                          <Flex gap="6px" wrap="wrap" mt="6px">
                            {recognition.fields.consumption.monthly.map((month) => (
                              <Badge key={month.period} colorScheme="teal">
                                {month.period}: {kwh(month.consumptionAfterBalancingKwh)}
                              </Badge>
                            ))}
                          </Flex>
                        ) : null}
                      </>
                    ) : null}
                    {document.notes ? <Text color={mutedColor} mt="5px">{document.notes}</Text> : null}
                  </Box>
                  <Flex gap="4px">
                    {image ? (
                      <Tooltip label="Podejrzyj zdjęcie">
                        <IconButton
                          aria-label="Podejrzyj zdjęcie"
                          icon={<MdVisibility />}
                          size="sm"
                          variant="outline"
                          onClick={() => setPreviewDocument(document)}
                        />
                      </Tooltip>
                    ) : (
                      <Tooltip label="Otwórz">
                        <IconButton as="a" href={`/api/documents/${document.id}/file`} target="_blank" aria-label="Otwórz plik" icon={<MdOpenInNew />} size="sm" variant="outline" />
                      </Tooltip>
                    )}
                    <Tooltip label="Pobierz">
                      <IconButton as="a" href={`/api/documents/${document.id}/file?download=1`} aria-label="Pobierz plik" icon={<MdDownload />} size="sm" variant="outline" />
                    </Tooltip>
                    <Tooltip label="Edytuj">
                      <IconButton aria-label="Edytuj opis" icon={<MdEdit />} size="sm" variant="outline" onClick={() => beginEdit(document)} />
                    </Tooltip>
                    <Tooltip label="Usuń">
                      <IconButton aria-label="Usuń plik" icon={<MdDeleteOutline />} size="sm" variant="outline" colorScheme="red" onClick={() => remove(document)} isLoading={busy === document.id} />
                    </Tooltip>
                  </Flex>
                </Flex>
              )}
            </Box>
          );
        })}
        {!documents.length ? <Text color={mutedColor}>Brak dokumentów w tej sekcji.</Text> : null}
      </Flex>
      <DocumentImagePreviewModal
        document={previewDocument}
        isOpen={Boolean(previewDocument)}
        onClose={() => setPreviewDocument(null)}
      />
    </Card>
  );
}
