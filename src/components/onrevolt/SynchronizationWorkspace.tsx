'use client';

import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Code,
  Flex,
  FormControl,
  FormLabel,
  Icon,
  Input,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useColorModeValue,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import { useEffect, useState } from 'react';
import { FiRefreshCw, FiUploadCloud } from 'react-icons/fi';

const CONFIRM_TEXT = 'SYNC_TO_LOCAL';
const OSW_CONFIRM_TEXT = 'OSW_SYNC_TO_LOCAL';

type ImportMode = 'dry-run' | 'sync-to-local';

type PipedriveImportResult = {
  stagesSeen: number;
  stagesImported: number;
  stagesWouldImport: number;
  stagesExisting: number;
  dealsSeen: number;
  clientsImported: number;
  clientsWouldImport: number;
  existingClients: number;
  projectsImported: number;
  projectsWouldImport: number;
  skippedExisting: number;
  duplicatePersonDeals: Array<{ personId: string; name?: string; dealIds: string[] }>;
  requiresReview: Array<{ pipedriveId: string; reason: string; title?: string }>;
};

type PipedriveImportPayload = {
  ok: boolean;
  mode?: ImportMode;
  data?: PipedriveImportResult;
  error?: string;
  message?: string;
};

type OswSyncStatus = {
  lastSyncedAt: string | null;
  syncedProducts: number;
};

type OswSyncResult = {
  productsSeen: number;
  matchedProducts: number;
  pricesWouldUpdate: number;
  pricesUpdated: number;
  availabilityWouldUpdate: number;
  availabilityUpdated: number;
  availableCount: number;
  unavailableCount: number;
  requiresReview: Array<{
    supplierSku?: string;
    name?: string;
    reason: string;
  }>;
};

type OswSyncPayload = {
  ok: boolean;
  mode?: ImportMode;
  data?: OswSyncResult;
  error?: string;
  message?: string;
};

type OswStatusPayload = {
  ok: boolean;
  data?: OswSyncStatus;
  error?: string;
  message?: string;
};

function metricItems(result: PipedriveImportResult, mode: ImportMode) {
  const applied = mode === 'sync-to-local';

  return [
    ['Stage w Pipedrive', result.stagesSeen],
    [applied ? 'Stage zapisane' : 'Stage do importu', applied ? result.stagesImported : result.stagesWouldImport],
    ['Stage istniejące', result.stagesExisting],
    ['Deale / projekty', result.dealsSeen],
    [applied ? 'Projekty zapisane' : 'Projekty do importu', applied ? result.projectsImported : result.projectsWouldImport],
    [applied ? 'Klienci zapisani' : 'Klienci do importu', applied ? result.clientsImported : result.clientsWouldImport],
    ['Istniejący klienci', result.existingClients],
    ['Klienci z wieloma dealami', result.duplicatePersonDeals.length],
    ['Pominięte projekty', result.skippedExisting],
    ['Do weryfikacji', result.requiresReview.length],
  ] as const;
}

async function readImportPayload(response: Response): Promise<PipedriveImportPayload> {
  const payload = await response.json() as PipedriveImportPayload;
  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function readOswPayload(response: Response): Promise<OswSyncPayload> {
  const payload = await response.json() as OswSyncPayload;
  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function readOswStatusPayload(response: Response): Promise<OswStatusPayload> {
  const payload = await response.json() as OswStatusPayload;
  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function formatSyncDate(value: string | null | undefined) {
  if (!value) return 'Brak synchronizacji';
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function SynchronizationWorkspace() {
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [oswDryRunLoading, setOswDryRunLoading] = useState(false);
  const [oswSyncLoading, setOswSyncLoading] = useState(false);
  const [oswStatusLoading, setOswStatusLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [oswConfirmation, setOswConfirmation] = useState('');
  const [mode, setMode] = useState<ImportMode>('dry-run');
  const [result, setResult] = useState<PipedriveImportResult | null>(null);
  const [oswMode, setOswMode] = useState<ImportMode>('dry-run');
  const [oswResult, setOswResult] = useState<OswSyncResult | null>(null);
  const [oswStatus, setOswStatus] = useState<OswSyncStatus | null>(null);
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const confirmationMatches = confirmation.trim() === CONFIRM_TEXT;
  const oswConfirmationMatches = oswConfirmation.trim() === OSW_CONFIRM_TEXT;
  const canSync = Boolean(result) && confirmationMatches && !dryRunLoading && !syncLoading;
  const canOswSync = Boolean(oswResult) && oswConfirmationMatches && !oswDryRunLoading && !oswSyncLoading;

  async function loadOswStatus() {
    setOswStatusLoading(true);
    try {
      const response = await fetch('/api/integrations/osw/sync', { cache: 'no-store' });
      const payload = await readOswStatusPayload(response);
      setOswStatus(payload.data || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOswStatusLoading(false);
    }
  }

  useEffect(() => {
    loadOswStatus();
  }, []);

  async function runDryRun() {
    setDryRunLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/integrations/pipedrive/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const payload = await readImportPayload(response);
      setMode(payload.mode || 'dry-run');
      setResult(payload.data);
      setConfirmation('');
      setSuccess('Dry-run Pipedrive zakończony.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDryRunLoading(false);
    }
  }

  async function runSyncToLocal() {
    if (!confirmationMatches) {
      setError(`Zapis wymaga potwierdzenia ${CONFIRM_TEXT}.`);
      return;
    }

    setSyncLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/integrations/pipedrive/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: CONFIRM_TEXT }),
      });
      const payload = await readImportPayload(response);
      setMode(payload.mode || 'sync-to-local');
      setResult(payload.data);
      setConfirmation('');
      setSuccess('Import Pipedrive do lokalnej bazy zakończony.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncLoading(false);
    }
  }

  async function runOswDryRun() {
    setOswDryRunLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/integrations/osw/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const payload = await readOswPayload(response);
      setOswMode(payload.mode || 'dry-run');
      setOswResult(payload.data);
      setOswConfirmation('');
      setSuccess('Dry-run OSW zakończony.');
      await loadOswStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOswDryRunLoading(false);
    }
  }

  async function runOswSyncToLocal() {
    if (!oswConfirmationMatches) {
      setError(`Zapis OSW wymaga potwierdzenia ${OSW_CONFIRM_TEXT}.`);
      return;
    }

    setOswSyncLoading(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/integrations/osw/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, confirm: OSW_CONFIRM_TEXT }),
      });
      const payload = await readOswPayload(response);
      setOswMode(payload.mode || 'sync-to-local');
      setOswResult(payload.data);
      setOswConfirmation('');
      setSuccess('Synchronizacja OSW do lokalnej bazy zakończona.');
      await loadOswStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOswSyncLoading(false);
    }
  }

  return (
    <Flex direction="column" pt={{ base: '130px', md: '80px', xl: '80px' }} gap="20px">
      <Card p={{ base: '20px', md: '28px' }}>
        <Flex direction={{ base: 'column', xl: 'row' }} gap="16px" align={{ xl: 'center' }}>
          <Box flex="1">
            <Badge colorScheme="purple" mb="12px" borderRadius="8px" px="10px" py="4px">
              Integracje
            </Badge>
            <Text color={textColor} fontSize="2xl" fontWeight="800">
              Synchronizacja
            </Text>
            <Text color={mutedColor} mt="6px">
              Dry-run Pipedrive czyta dane i porównuje je z lokalnym CRM bez zapisu do bazy.
            </Text>
          </Box>
          <Button
            colorScheme="purple"
            leftIcon={<Icon as={FiRefreshCw} />}
            onClick={runDryRun}
            isLoading={dryRunLoading}
            isDisabled={syncLoading}
          >
            Uruchom dry-run Pipedrive
          </Button>
        </Flex>
      </Card>

      {error ? (
        <Alert status="error" borderRadius="8px">
          <AlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {success ? (
        <Alert status="success" borderRadius="8px">
          <AlertIcon />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <Card p="22px">
        <Flex direction={{ base: 'column', xl: 'row' }} gap="18px" align={{ xl: 'flex-end' }}>
          <Box flex="1">
            <Badge colorScheme="green" mb="10px" borderRadius="8px" px="10px" py="4px">
              OSW
            </Badge>
            <Text color={textColor} fontSize="lg" fontWeight="800" mb="6px">
              Synchronizacja cen i dostępności
            </Text>
            <Text color={mutedColor}>
              Ostatnia synchronizacja: {formatSyncDate(oswStatus?.lastSyncedAt)}
              {oswStatus ? ` · produkty zsynchronizowane: ${oswStatus.syncedProducts}` : ''}
            </Text>
          </Box>
          <Flex
            direction={{ base: 'column', md: 'row' }}
            gap="12px"
            align={{ md: 'flex-end' }}
            w={{ base: '100%', xl: 'auto' }}
          >
            <Button
              variant="outline"
              leftIcon={<Icon as={FiRefreshCw} />}
              onClick={runOswDryRun}
              isLoading={oswDryRunLoading}
              isDisabled={oswSyncLoading || oswStatusLoading}
              w={{ base: '100%', md: 'auto' }}
            >
              Dry-run OSW
            </Button>
            <FormControl w={{ base: '100%', md: '260px' }}>
              <FormLabel color={mutedColor} fontSize="sm" mb="6px">
                Potwierdzenie OSW
              </FormLabel>
              <Input
                value={oswConfirmation}
                onChange={(event) => setOswConfirmation(event.target.value)}
                placeholder={OSW_CONFIRM_TEXT}
                borderColor={oswConfirmation && !oswConfirmationMatches ? 'red.300' : borderColor}
                autoComplete="off"
              />
            </FormControl>
            <Button
              colorScheme="green"
              leftIcon={<Icon as={FiUploadCloud} />}
              onClick={runOswSyncToLocal}
              isLoading={oswSyncLoading}
              isDisabled={!canOswSync}
              w={{ base: '100%', md: 'auto' }}
            >
              Zapisz OSW do DB
            </Button>
          </Flex>
        </Flex>

        {oswResult ? (
          <Box mt="18px">
            <SimpleGrid columns={{ base: 1, md: 3, xl: 6 }} gap="12px">
              {[
                ['Tryb', oswMode],
                ['OSW rekordy', oswResult.productsSeen],
                ['Dopasowane', oswResult.matchedProducts],
                ['Ceny', oswMode === 'sync-to-local' ? oswResult.pricesUpdated : oswResult.pricesWouldUpdate],
                ['Dostępność', oswMode === 'sync-to-local' ? oswResult.availabilityUpdated : oswResult.availabilityWouldUpdate],
                ['Do weryfikacji', oswResult.requiresReview.length],
              ].map(([label, value]) => (
                <Box key={label} border="1px solid" borderColor={borderColor} borderRadius="8px" p="12px">
                  <Text color={mutedColor} fontSize="xs">{label}</Text>
                  <Text color={textColor} fontWeight="700">{value}</Text>
                </Box>
              ))}
            </SimpleGrid>

            {oswResult.requiresReview.length ? (
              <Alert status="warning" borderRadius="8px" mt="12px" alignItems="flex-start">
                <AlertIcon />
                <AlertDescription>
                  {oswResult.requiresReview.slice(0, 6).map((item, index) => (
                    <Text key={`${item.supplierSku || item.name || 'osw'}-${index}`} fontSize="sm">
                      {[item.supplierSku, item.name].filter(Boolean).join(' · ') || 'OSW'}: {item.reason}
                    </Text>
                  ))}
                  {oswResult.requiresReview.length > 6 ? (
                    <Text fontSize="sm">Pozostałe rekordy do weryfikacji: {oswResult.requiresReview.length - 6}</Text>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
          </Box>
        ) : null}
      </Card>

      {result ? (
        <>
          <SimpleGrid columns={{ base: 1, md: 2, xl: 5 }} gap="20px">
            {metricItems(result, mode).map(([label, value]) => (
              <Card key={label} p="20px">
                <Stat>
                  <StatLabel color={mutedColor}>{label}</StatLabel>
                  <StatNumber color={textColor}>{value}</StatNumber>
                </Stat>
              </Card>
            ))}
          </SimpleGrid>

          <Card p="22px">
            <Flex direction={{ base: 'column', xl: 'row' }} gap="18px" align={{ xl: 'flex-end' }}>
              <Box flex="1">
                <Text color={textColor} fontSize="lg" fontWeight="800" mb="6px">
                  Kontrolowany import lokalny
                </Text>
                <Text color={mutedColor}>
                  Zapis jest dostępny po dry-run i wymaga wpisania <Code>{CONFIRM_TEXT}</Code>.
                </Text>
              </Box>
              <Flex
                direction={{ base: 'column', md: 'row' }}
                gap="12px"
                align={{ md: 'flex-end' }}
                w={{ base: '100%', xl: 'auto' }}
              >
                <FormControl w={{ base: '100%', md: '260px' }}>
                  <FormLabel color={mutedColor} fontSize="sm" mb="6px">
                    Potwierdzenie
                  </FormLabel>
                  <Input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    placeholder={CONFIRM_TEXT}
                    borderColor={confirmation && !confirmationMatches ? 'red.300' : borderColor}
                    autoComplete="off"
                  />
                </FormControl>
                <Button
                  colorScheme="green"
                  leftIcon={<Icon as={FiUploadCloud} />}
                  onClick={runSyncToLocal}
                  isLoading={syncLoading}
                  isDisabled={!canSync}
                  w={{ base: '100%', md: 'auto' }}
                >
                  Importuj do lokalnej bazy
                </Button>
              </Flex>
            </Flex>
          </Card>

          <Card p="22px">
            <Text color={textColor} fontSize="lg" fontWeight="800" mb="12px">
              Rekordy wymagające weryfikacji
            </Text>
            <Box overflowX="auto">
              <Table variant="simple">
                <Thead>
                  <Tr>
                    <Th>Pipedrive deal</Th>
                    <Th>Tytuł</Th>
                    <Th>Powód</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {result.requiresReview.length ? result.requiresReview.map((item) => (
                    <Tr key={item.pipedriveId}>
                      <Td>{item.pipedriveId}</Td>
                      <Td>{item.title || '-'}</Td>
                      <Td>{item.reason}</Td>
                    </Tr>
                  )) : (
                    <Tr>
                      <Td colSpan={3}>
                        <Text color={mutedColor}>Brak rekordów wymagających ręcznej weryfikacji w tym dry-run.</Text>
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </Table>
            </Box>
          </Card>

          <Card p="22px">
            <Text color={textColor} fontSize="lg" fontWeight="800" mb="12px">
              Osoby z wieloma dealami
            </Text>
            <Box overflowX="auto">
              <Table variant="simple">
                <Thead>
                  <Tr>
                    <Th>Person ID</Th>
                    <Th>Nazwa</Th>
                    <Th>Deale</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {result.duplicatePersonDeals.length ? result.duplicatePersonDeals.map((item) => (
                    <Tr key={item.personId}>
                      <Td>{item.personId}</Td>
                      <Td>{item.name || '-'}</Td>
                      <Td>{item.dealIds.join(', ')}</Td>
                    </Tr>
                  )) : (
                    <Tr>
                      <Td colSpan={3}>
                        <Text color={mutedColor}>Brak powtarzających się person_id w pobranych dealach.</Text>
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </Table>
            </Box>
          </Card>
        </>
      ) : (
        <Card p="22px">
          <Text color={mutedColor}>
            Dla Pipedrive najpierw uruchom dry-run. Import do lokalnej bazy pojawi się po raporcie i będzie wymagał potwierdzenia.
          </Text>
        </Card>
      )}
    </Flex>
  );
}
