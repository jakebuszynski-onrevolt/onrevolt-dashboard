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
import { invoiceImportField, invoiceImportKwh } from 'lib/onrevolt/invoice-recognition/consumption';
import { ChangeEvent, DragEvent, useMemo, useRef, useState } from 'react';
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
  mode: 'files' | 'formal' | 'invoices';
  variant?: 'default' | 'energy';
  clientId: string;
  projectId?: string;
  documents: any[];
  onChanged: () => Promise<void> | void;
  expectedPpeNumber?: string;
  expectedTariff?: string;
};

type PanelProps = Omit<Props, 'mode' | 'variant'>;

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

const workingFileTypes = [
  ['ZDJECIE_MONTAZU', 'Zdjęcie'],
  ['INNE', 'Inny materiał roboczy'],
] as const;

const formalDocumentTypes = [
  ['OFERTA', 'Oferta'],
  ['UMOWA', 'Umowa'],
  ['PROTOKOL', 'Protokół'],
  ['DOKUMENT_OSD', 'Dokument OSD'],
  ['RE_DOKUMENT', 'Dokument RE'],
  ['PROJEKT_INSTALACJI', 'Projekt instalacji'],
  ['DECYZJA_POZWOLENIE', 'Decyzja / pozwolenie'],
  ['FAKTURA_USLUGOWA', 'Faktura związana z usługą'],
  ['DOKUMENT_TECHNICZNY', 'Dokument techniczny'],
  ['INNE', 'Inny dokument'],
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
  const { mode, variant, ...panelProps } = props;
  if (mode === 'invoices') {
    return <ClientInvoicesPanel {...panelProps} variant={variant || 'default'} />;
  }
  return <ClientFilesPanel {...panelProps} documentMode={mode} />;
}

function ClientFilesPanel({
  clientId,
  projectId,
  documents,
  onChanged,
  documentMode,
}: PanelProps & { documentMode: 'files' | 'formal' }) {
  const typeOptions = documentMode === 'formal' ? formalDocumentTypes : workingFileTypes;
  const defaultType = documentMode === 'formal' ? 'PROJEKT_INSTALACJI' : 'ZDJECIE_MONTAZU';
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [title, setTitle] = useState('');
  const [type, setType] = useState(defaultType);
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

  const shown = useMemo(() => documents.filter((document) => {
    if (documentMode === 'files') {
      return document.type === 'ZDJECIE_MONTAZU'
        || (document.type === 'INNE' && document.mimeType?.startsWith('image/'));
    }
    if (['FAKTURA_PRAD', 'ENEA_ZUZYCIE', 'ENEA_PRODUKCJA', 'ZDJECIE_MONTAZU'].includes(document.type)) return false;
    if (document.type === 'INNE' && document.mimeType?.startsWith('image/')) return false;
    return true;
  }), [documentMode, documents]);

  const isFormal = documentMode === 'formal';

  return (
    <Flex direction="column" gap="20px">
      <Card p="22px">
        <Text color={textColor} fontSize="lg" fontWeight="800">
          {isFormal ? 'Dodaj dokument formalny' : 'Dodaj zdjęcie lub plik'}
        </Text>
        <Text color={mutedColor} mb="16px">
          Plik można opisać, datować, oznaczyć i udostępnić klientowi.
        </Text>
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
              {typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
      <DocumentsList mode={documentMode} documents={shown} onChanged={onChanged} />
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
  variant,
}: PanelProps & { variant: 'default' | 'energy' }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const compactEnergy = variant === 'energy';

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
      invoiceImportKwh(fields.consumption) == null
        ? ''
        : String(invoiceImportKwh(fields.consumption)),
    );
    setAssignmentMismatchConfirmed(false);
    setReplaceExistingConfirmed(false);
  }

  async function recognizeInvoice(selected: File | null) {
    setFile(selected);
    setRecognition(null);
    setDuplicateInvoice(null);
    setReplaceExistingConfirmed(false);
    setError('');
    setMessage('');
    setNotice('');
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.pdf')) {
      setFile(null);
      setFileInputKey((value) => value + 1);
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

  function selectInvoice(event: ChangeEvent<HTMLInputElement>) {
    void recognizeInvoice(event.target.files?.[0] || null);
  }

  function dropInvoice(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingFile(false);
    void recognizeInvoice(event.dataTransfer.files?.[0] || null);
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
            [invoiceImportField(recognition.fields.consumption)]: Number(energyConsumptionKwh),
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
    <Flex direction="column" gap={compactEnergy ? '14px' : '20px'}>
      <Card
        p={compactEnergy ? '0' : '22px'}
        bg={compactEnergy ? 'transparent' : undefined}
        boxShadow={compactEnergy ? 'none' : undefined}
        border={compactEnergy ? '0' : undefined}
      >
        {compactEnergy ? (
          <Box mb="12px">
            <Text color={textColor} fontSize="md" fontWeight="800">Faktury za energię</Text>
            <Text color={mutedColor} fontSize="sm">Dodaj dokumenty, sprawdź okresy i zatwierdź wartości.</Text>
          </Box>
        ) : (
          <>
            <Text color={textColor} fontSize="lg" fontWeight="800">Dodaj fakturę ENEA</Text>
            <Text color={mutedColor} mb="16px">
              Wybierz PDF. System rozpozna dane, które sprawdzisz przed zapisaniem.
            </Text>
          </>
        )}
        {error ? <Alert status="error" mb="12px"><AlertIcon />{error}</Alert> : null}
        {message ? <Alert status="success" mb="12px"><AlertIcon />{message}</Alert> : null}
        {notice ? <Alert status="info" mb="12px"><AlertIcon />{notice}</Alert> : null}
        {compactEnergy ? (
          <Box
            onDragEnter={(event) => { event.preventDefault(); setIsDraggingFile(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingFile(false);
            }}
            onDrop={dropInvoice}
            border="1px dashed"
            borderColor={isDraggingFile ? 'purple.500' : 'purple.300'}
            bg={isDraggingFile ? 'purple.100' : 'purple.50'}
            borderRadius="8px"
            px={{ base: '12px', md: '16px' }}
            py="12px"
            transition="background 120ms ease, border-color 120ms ease"
          >
            <Input
              key={fileInputKey}
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              display="none"
              onChange={selectInvoice}
            />
            <Flex align="center" gap="12px" wrap="wrap">
              <Icon as={MdUploadFile} boxSize="24px" color="purple.600" flexShrink={0} />
              <Box flex="1" minW="180px">
                <Text color={textColor} fontWeight="700" fontSize="sm">Wgraj faktury</Text>
                <Text color={mutedColor} fontSize="xs">PDF (jedyny obsługiwany format)</Text>
                {file ? <Text color="purple.700" fontSize="xs" mt="2px" noOfLines={1}>{file.name}</Text> : null}
              </Box>
              <Button
                size="sm"
                colorScheme="purple"
                variant="outline"
                leftIcon={<Icon as={MdUploadFile} />}
                onClick={() => fileInputRef.current?.click()}
              >
                Wybierz plik
              </Button>
            </Flex>
          </Box>
        ) : (
          <FormControl isRequired maxW="620px">
            <FormLabel>Faktura PDF</FormLabel>
            <Input
              key={fileInputKey}
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              p="5px"
              onChange={selectInvoice}
            />
          </FormControl>
        )}

        {busy === 'recognize' ? (
          <Flex mt="18px" align="center" gap="10px">
            <Spinner size="sm" />
            <Text color={mutedColor}>Rozpoznawanie faktury ENEA...</Text>
          </Flex>
        ) : null}

        {recognition ? (
          <Box
            mt={compactEnergy ? '14px' : '20px'}
            pt={compactEnergy ? '14px' : '18px'}
            borderTop="1px solid"
            borderColor={borderColor}
            sx={compactEnergy ? {
              '& .chakra-form__label': { fontSize: 'xs', mb: '4px' },
              '& .chakra-input, & .chakra-select': { minHeight: '36px', fontSize: 'sm' },
            } : undefined}
          >
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
                <FormLabel>{invoiceImportField(recognition.fields.consumption) === 'meteredImportKwh' ? 'Zużycie z licznika' : 'Zużycie po bilansowaniu'}</FormLabel>
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

            {recognition.fields.consumption.billedAfterDiscountKwh != null ? (
              <Text mt="14px" fontSize="sm">
                Pobór z sieci po bilansowaniu godzinowym: {kwh(recognition.fields.consumption.totalAfterBalancingKwh)}.
                {' '}Oddanie: {kwh(recognition.fields.consumption.exportedAfterBalancingKwh)}.
                {' '}Do rozliczenia po opuście {recognition.fields.consumption.netMeteringFactor?.toLocaleString('pl-PL')}: {kwh(recognition.fields.consumption.billedAfterDiscountKwh)}.
              </Text>
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
      <DocumentsList
        mode="invoices"
        documents={shown}
        onChanged={onChanged}
        compactEnergy={compactEnergy}
      />
    </Flex>
  );
}

function DocumentsList({
  mode,
  documents,
  onChanged,
  compactEnergy = false,
}: {
  mode: 'files' | 'formal' | 'invoices';
  documents: any[];
  onChanged: () => Promise<void> | void;
  compactEnergy?: boolean;
}) {
  const [editing, setEditing] = useState<any | null>(null);
  const [previewDocument, setPreviewDocument] = useState<any | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const tableHeaderBg = useColorModeValue('white', 'gray.800');

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
    <Card
      p={compactEnergy ? '0' : '22px'}
      bg={compactEnergy ? 'transparent' : undefined}
      boxShadow={compactEnergy ? 'none' : undefined}
      border={compactEnergy ? '0' : undefined}
    >
      {!compactEnergy ? (
        <Flex justify="space-between" mb="14px">
          <Box>
            <Text color={textColor} fontSize="lg" fontWeight="800">
              {mode === 'invoices' ? 'Faktury' : mode === 'formal' ? 'Dokumenty formalne' : 'Zdjęcia i pliki'}
            </Text>
            <Text color={mutedColor}>{documents.length} dokumentów</Text>
          </Box>
        </Flex>
      ) : null}
      {error ? <Alert status="error" mb="12px"><AlertIcon />{error}</Alert> : null}
      {message ? <Alert status="success" mb="12px"><AlertIcon />{message}</Alert> : null}
      {compactEnergy ? (
        <Box maxH="370px" overflow="auto" border="1px solid" borderColor={borderColor} borderRadius="8px">
          <Table size="sm" minW="820px">
            <Thead position="sticky" top="0" zIndex="1" bg={tableHeaderBg}>
              <Tr>
                <Th fontSize="xs" textTransform="none">Dokument / okres</Th>
                <Th fontSize="xs" textTransform="none">Pobór / oddanie</Th>
                <Th fontSize="xs" textTransform="none" isNumeric>Rachunek brutto</Th>
                <Th fontSize="xs" textTransform="none">Status</Th>
                <Th fontSize="xs" textTransform="none" textAlign="right">Działania</Th>
              </Tr>
            </Thead>
            <Tbody>
              {documents.map((document) => {
                const recognition = recognitionOf(document);
                const consumption = recognition?.fields?.consumption;
                const totalFromMonths = (field: 'consumptionBeforeBalancingKwh' | 'exportedAfterBalancingKwh') => {
                  const monthly = consumption?.monthly || [];
                  const values = monthly.map((month) => month[field]);
                  if (!values.length || values.some((value) => value == null)) return null;
                  return values.reduce((total, value) => total + Number(value), 0);
                };
                const purchasedEnergy = consumption?.meteredImportKwh ?? consumption?.totalBeforeBalancingKwh
                  ?? totalFromMonths('consumptionBeforeBalancingKwh');
                const exportedEnergy = consumption?.exportedAfterBalancingKwh
                  ?? totalFromMonths('exportedAfterBalancingKwh');
                const complete = Boolean(
                  document.invoiceNumber
                  && document.amountGross != null
                  && document.billingPeriodFrom
                  && document.billingPeriodTo
                  && document.documentDate
                  && document.invoicePpeNumber
                  && document.invoiceTariff,
                );
                const period = document.billingPeriodFrom && document.billingPeriodTo
                  ? `${dateLabel(document.billingPeriodFrom)} – ${dateLabel(document.billingPeriodTo)}`
                  : 'Uzupełnij okres rozliczeniowy';
                return (
                  <Tr key={document.id}>
                    <Td maxW="260px">
                      <Text color={textColor} fontWeight="700" fontSize="sm" noOfLines={1} title={document.invoiceNumber || document.title}>
                        {document.invoiceNumber || document.title}
                      </Text>
                      <Text color={mutedColor} fontSize="xs" noOfLines={1}>{period}</Text>
                    </Td>
                    <Td>
                      <Text fontSize="xs" whiteSpace="nowrap">
                        Pobór: {purchasedEnergy == null ? '—' : kwh(purchasedEnergy)}
                      </Text>
                      <Text color={mutedColor} fontSize="xs" whiteSpace="nowrap">
                        Oddanie: {exportedEnergy == null ? '—' : kwh(exportedEnergy)}
                      </Text>
                    </Td>
                    <Td isNumeric whiteSpace="nowrap" fontWeight="700">
                      {document.amountGross == null ? '—' : money(document.amountGross)}
                    </Td>
                    <Td>
                      <Badge colorScheme={complete ? 'green' : 'orange'}>
                        {complete ? 'Zatwierdzona' : 'Do sprawdzenia'}
                      </Badge>
                    </Td>
                    <Td>
                      <Flex gap="4px" align="center" justify="flex-end" whiteSpace="nowrap">
                        <Button size="xs" variant="outline" onClick={() => beginEdit(document)}>
                          Podgląd / edytuj
                        </Button>
                        <Tooltip label="Pobierz fakturę">
                          <IconButton
                            as="a"
                            href={`/api/documents/${document.id}/file?download=1`}
                            aria-label="Pobierz fakturę"
                            icon={<MdDownload />}
                            size="sm"
                            variant="outline"
                          />
                        </Tooltip>
                        <Tooltip label="Usuń fakturę">
                          <IconButton
                            aria-label="Usuń fakturę"
                            icon={<MdDeleteOutline />}
                            size="sm"
                            variant="outline"
                            colorScheme="red"
                            onClick={() => remove(document)}
                            isLoading={busy === document.id}
                          />
                        </Tooltip>
                      </Flex>
                    </Td>
                  </Tr>
                );
              })}
              {!documents.length ? (
                <Tr><Td colSpan={5} color={mutedColor} textAlign="center" py="8">Brak dodanych faktur.</Td></Tr>
              ) : null}
            </Tbody>
          </Table>
        </Box>
      ) : null}
      {(!compactEnergy || editing) ? (
      <Flex direction="column" gap="10px" mt={compactEnergy ? '12px' : undefined}>
        {documents.filter((document) => !compactEnergy || editing?.id === document.id).map((document) => {
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
                    {mode !== 'invoices' ? (
                      <FormControl>
                        <FormLabel>Rodzaj</FormLabel>
                        <Select value={editing.type} onChange={(event) => setEditing({ ...editing, type: event.target.value })}>
                          {(mode === 'formal' ? formalDocumentTypes : workingFileTypes).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
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
                          <FormLabel>{invoiceImportField(recognition?.fields?.consumption) === 'meteredImportKwh' ? 'Zużycie z licznika' : 'Zużycie po bilansowaniu'}</FormLabel>
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
                    {compactEnergy ? (
                      <Button
                        as="a"
                        href={`/api/documents/${document.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                        size="sm"
                        variant="ghost"
                        leftIcon={<MdOpenInNew />}
                      >
                        Podgląd oryginału
                      </Button>
                    ) : null}
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
        {!documents.length && !compactEnergy ? <Text color={mutedColor}>Brak dokumentów w tej sekcji.</Text> : null}
      </Flex>
      ) : null}
      <DocumentImagePreviewModal
        document={previewDocument}
        isOpen={Boolean(previewDocument)}
        onClose={() => setPreviewDocument(null)}
      />
    </Card>
  );
}
