'use client';

import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Icon,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SimpleGrid,
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
  useDisclosure,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  MdAdd,
  MdArrowDownward,
  MdArrowUpward,
  MdOpenInNew,
  MdRefresh,
  MdSearch,
  MdUnfoldMore,
} from 'react-icons/md';

type ClientRow = {
  id: string;
  displayName: string;
  clientType: string;
  contacts: Array<{ email?: string; phone?: string; investmentAddress?: string }>;
  investmentSites?: Array<{ fullAddress?: string | null; addressLine?: string | null }>;
  projects: Array<{
    title: string;
    status: string;
    clientType: string;
    source?: string | null;
    stage?: { id?: string; name: string; sortOrder?: number | null } | null;
    owner?: { name: string } | null;
    investmentSite?: { fullAddress?: string | null; addressLine?: string | null } | null;
  }>;
};

type StageRow = {
  id: string;
  name: string;
  sortOrder: number;
  status?: string;
};

type ClientSortKey = 'client' | 'project' | 'status' | 'type';
type SortDirection = 'asc' | 'desc';

type ClientFormState = {
  displayName: string;
  clientType: string;
  taxId: string;
  phone: string;
  email: string;
  addressLine: string;
  postalCode: string;
  city: string;
  investmentAddress: string;
  projectTitle: string;
  projectClientType: string;
  status: string;
  stageId: string;
  dashboardStation: string;
  notes: string;
};

const emptyForm: ClientFormState = {
  displayName: '',
  clientType: 'UNKNOWN',
  taxId: '',
  phone: '',
  email: '',
  addressLine: '',
  postalCode: '',
  city: '',
  investmentAddress: '',
  projectTitle: '',
  projectClientType: 'UNKNOWN',
  status: 'LEAD',
  stageId: '',
  dashboardStation: '',
  notes: '',
};

const projectStatuses = [
  ['LEAD', 'Lead'],
  ['CZEKA_NA_KALKULACJE', 'Czeka na kalkulację'],
  ['W_TRAKCIE_OBSLUGI', 'W trakcie obsługi'],
  ['OFERTA_PRZYGOTOWANA', 'Oferta przygotowana'],
  ['OFERTA_ZAAKCEPTOWANA', 'Oferta zaakceptowana'],
  ['ZALICZKA_MONTAZ', 'Zaliczka / montaż'],
  ['PROCEDURA_OSD', 'Procedura OSD'],
  ['ODBIOR', 'Odbiór'],
  ['ZAKONCZONY', 'Zakończony'],
  ['SERWIS', 'Serwis'],
  ['WSTRZYMANY', 'Wstrzymany'],
] as const;

const missingStatusValue = '__NO_STATUS__';
const activeServiceStatusValue = '__IN_SERVICE__';
const statusLabels = new Map<string, string>(projectStatuses.map(([value, label]) => [value, label]));
const statusSortOrder = new Map<string, number>(projectStatuses.map(([value], index) => [value, index]));
const statusFilterOptions = projectStatuses.map(([value, label]) => ({ value, label }));
const clientCollator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });

const clientTypeOptions = [
  ['UNKNOWN', 'Nieustalony'],
  ['B2C', 'B2C'],
  ['B2B', 'B2B'],
  ['B2C_B2B', 'B2C/B2B'],
] as const;
const pageSize = 50;

type SortableHeaderProps = {
  label: string;
  value: ClientSortKey;
  selected: ClientSortKey | null;
  direction: SortDirection;
  onSort: (value: ClientSortKey) => void;
};

function SortableHeader({ label, value, selected, direction, onSort }: SortableHeaderProps) {
  const isSelected = selected === value;
  const sortIcon = !isSelected
    ? MdUnfoldMore
    : direction === 'asc'
      ? MdArrowUpward
      : MdArrowDownward;

  return (
    <Th aria-sort={isSelected ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Button
        size="sm"
        variant="ghost"
        px="0"
        minW="0"
        height="30px"
        fontSize="xs"
        fontWeight="700"
        letterSpacing="0"
        textTransform="uppercase"
        rightIcon={<Icon as={sortIcon} boxSize="15px" />}
        onClick={() => onSort(value)}
      >
        {label}
      </Button>
    </Th>
  );
}

export default function ClientsWorkspace() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [query, setQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedClientType, setSelectedClientType] = useState('all');
  const [sortKey, setSortKey] = useState<ClientSortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState<ClientFormState>(emptyForm);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const fieldBg = useColorModeValue('white', 'rgba(17, 27, 66, 0.72)');
  const borderColor = useColorModeValue('secondaryGray.300', 'whiteAlpha.300');

  async function loadClients() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/crm/clients', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setClients(payload.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadStages() {
    const response = await fetch('/api/crm/stages', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
    setStages(payload.data || []);
  }

  useEffect(() => {
    loadClients();
    loadStages().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function projectStatusValue(project: ClientRow['projects'][number] | undefined) {
    return project?.status?.trim() || missingStatusValue;
  }

  function projectStatusLabel(value: string) {
    if (value === missingStatusValue) return 'Brak statusu';
    return statusLabels.get(value) || value;
  }

  function projectStatusColor(value: string) {
    if (value === 'ZAKONCZONY') return 'green';
    if (value === 'WSTRZYMANY') return 'orange';
    if (value === 'SERWIS') return 'blue';
    if (value === missingStatusValue) return 'gray';
    return 'purple';
  }

  function clientDisplayType(client: ClientRow) {
    return client.projects?.[0]?.clientType || client.clientType;
  }

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return clients.filter((client) => {
      const contact = client.contacts?.[0];
      const project = client.projects?.[0];
      const site = project?.investmentSite || client.investmentSites?.[0];
      const matchesStatus = selectedStatus === 'all'
        || (selectedStatus === activeServiceStatusValue
          && client.projects?.some((item) => {
            const status = projectStatusValue(item);
            return status !== 'LEAD' && status !== missingStatusValue;
          }))
        || client.projects?.some((item) => projectStatusValue(item) === selectedStatus)
        || (!client.projects?.length && selectedStatus === missingStatusValue);
      if (!matchesStatus) return false;
      if (selectedClientType !== 'all' && client.clientType !== selectedClientType) return false;
      if (!text) return true;
      return [
        client.displayName,
        client.clientType,
        contact?.email,
        contact?.phone,
        contact?.investmentAddress,
        site?.fullAddress,
        site?.addressLine,
        project?.title,
        project?.clientType,
        project?.source,
        project?.status,
        project ? projectStatusLabel(projectStatusValue(project)) : '',
      ].join(' ').toLowerCase().includes(text);
    });
  }, [clients, query, selectedClientType, selectedStatus]);
  const sortedClients = useMemo(() => {
    if (!sortKey) return filtered;
    const direction = sortDirection === 'asc' ? 1 : -1;
    return filtered
      .map((client, index) => ({ client, index }))
      .sort((left, right) => {
        const leftProject = left.client.projects?.[0];
        const rightProject = right.client.projects?.[0];
        let result = 0;

        if (sortKey === 'status') {
          const leftStatus = projectStatusValue(leftProject);
          const rightStatus = projectStatusValue(rightProject);
          result = (statusSortOrder.get(leftStatus) ?? Number.MAX_SAFE_INTEGER)
            - (statusSortOrder.get(rightStatus) ?? Number.MAX_SAFE_INTEGER);
        } else {
          const leftValue = sortKey === 'client'
            ? left.client.displayName
            : sortKey === 'project'
              ? leftProject?.title || ''
              : clientDisplayType(left.client);
          const rightValue = sortKey === 'client'
            ? right.client.displayName
            : sortKey === 'project'
              ? rightProject?.title || ''
              : clientDisplayType(right.client);
          result = clientCollator.compare(leftValue, rightValue);
        }

        return result === 0 ? left.index - right.index : result * direction;
      })
      .map(({ client }) => client);
  }, [filtered, sortDirection, sortKey]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleClients = sortedClients.slice(page * pageSize, (page + 1) * pageSize);

  useEffect(() => { setPage(0); }, [query, selectedClientType, selectedStatus, sortDirection, sortKey]);

  function changeSort(value: ClientSortKey) {
    if (sortKey === value) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(value);
    setSortDirection('asc');
  }

  function updateForm(key: keyof ClientFormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectStage(stageId: string) {
    const stage = stages.find((item) => item.id === stageId);
    setForm((current) => ({
      ...current,
      stageId,
      status: stage?.status || current.status,
    }));
  }

  function openCreateModal() {
    setForm(emptyForm);
    setFormError('');
    onOpen();
  }

  async function saveClient() {
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch('/api/crm/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: form.displayName,
          clientType: form.clientType,
          taxId: form.taxId,
          notes: form.notes,
          contact: {
            email: form.email,
            phone: form.phone,
            addressLine: form.addressLine,
            postalCode: form.postalCode,
            city: form.city,
            investmentAddress: form.investmentAddress,
          },
          project: {
            title: form.projectTitle || `Projekt - ${form.displayName}`,
            clientType: form.projectClientType,
            status: form.status,
            stageId: form.stageId,
            dashboardStation: form.dashboardStation,
            locationAddress: form.investmentAddress,
            source: 'manual',
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      onClose();
      await loadClients();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Flex direction="column" pt={{ base: '130px', md: '80px', xl: '80px' }} gap="20px">
      <Card p={{ base: '20px', md: '28px' }}>
        <Flex direction={{ base: 'column', xl: 'row' }} gap="16px" align={{ xl: 'center' }}>
          <Box flex="1">
            <Badge colorScheme="purple" mb="12px" borderRadius="8px" px="10px" py="4px">
              CRM
            </Badge>
            <Text color={textColor} fontSize="2xl" fontWeight="800">
              Klienci
            </Text>
            <Text color={mutedColor} mt="6px">
              Lokalna baza klientów, projektów, etapów i dokumentów. Dane Pipedrive trafiają tu przez import.
            </Text>
          </Box>
          <Flex gap="10px" wrap="wrap">
            <Button leftIcon={<Icon as={MdRefresh} />} variant="outline" onClick={loadClients} isLoading={loading}>
              Odśwież
            </Button>
            <Button leftIcon={<Icon as={MdAdd} />} colorScheme="purple" onClick={openCreateModal}>
              Nowy klient
            </Button>
          </Flex>
        </Flex>
      </Card>

      {error ? (
        <Alert status="error" borderRadius="8px">
          <AlertIcon />
          {error}
        </Alert>
      ) : null}

      <Card p="18px">
        <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap="12px">
          <FormControl>
            <FormLabel color={textColor} fontWeight="700">
              Szukaj
            </FormLabel>
            <Flex
              align="center"
              border="1px solid"
              borderColor={borderColor}
              borderRadius="12px"
              px="12px"
              bg={fieldBg}
            >
              <Icon as={MdSearch} color={mutedColor} me="8px" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Klient, telefon, adres, projekt..."
                border="0"
                bg="transparent"
                color={textColor}
                _focus={{ boxShadow: 'none' }}
              />
            </Flex>
          </FormControl>
          <FormControl>
            <FormLabel color={textColor} fontWeight="700">
              Typ klienta
            </FormLabel>
            <Select
              aria-label="Typ klienta"
              value={selectedClientType}
              onChange={(event) => setSelectedClientType(event.target.value)}
              bg={fieldBg}
            >
              <option value="all">Wszystkie</option>
              <option value="B2C">B2C</option>
              <option value="B2B">B2B</option>
            </Select>
          </FormControl>
          <FormControl>
            <FormLabel color={textColor} fontWeight="700">
              Etap procesu
            </FormLabel>
            <Select
              aria-label="Etap procesu"
              value={selectedStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
              bg={fieldBg}
            >
              <option value="all">Wszystkie</option>
              <option value={activeServiceStatusValue}>W obsłudze (bez Leadów)</option>
              {statusFilterOptions.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </Select>
          </FormControl>
        </SimpleGrid>
        <Text mt="12px" color={mutedColor} fontSize="sm" textAlign="right">
          Wyniki: {filtered.length} / {clients.length}
        </Text>
        <Box overflowX="auto">
          <Table variant="simple">
            <Thead>
              <Tr>
                <SortableHeader label="Klient" value="client" selected={sortKey} direction={sortDirection} onSort={changeSort} />
                <Th>Kontakt</Th>
                <SortableHeader label="Projekt" value="project" selected={sortKey} direction={sortDirection} onSort={changeSort} />
                <SortableHeader label="Etap procesu" value="status" selected={sortKey} direction={sortDirection} onSort={changeSort} />
                <SortableHeader label="Typ klienta" value="type" selected={sortKey} direction={sortDirection} onSort={changeSort} />
                <Th textAlign="right">Akcja</Th>
              </Tr>
            </Thead>
            <Tbody>
              {visibleClients.map((client) => {
                const contact: ClientRow['contacts'][number] = client.contacts?.[0] || {};
                const project = client.projects?.[0];
                const statusValue = projectStatusValue(project);
                const site = project?.investmentSite || client.investmentSites?.[0];
                return (
                  <Tr key={client.id}>
                    <Td>
                      <Text color={textColor} fontWeight="700">{client.displayName}</Text>
                      <Text color={mutedColor} fontSize="sm">
                        {site?.fullAddress || site?.addressLine || contact.investmentAddress || 'Adres inwestycji do uzupełnienia'}
                      </Text>
                    </Td>
                    <Td>
                      <Text>{contact.phone || '-'}</Text>
                      <Text color={mutedColor} fontSize="sm">{contact.email || '-'}</Text>
                    </Td>
                    <Td>{project?.title || '-'}</Td>
                    <Td>
                      <Badge colorScheme={projectStatusColor(statusValue)}>{projectStatusLabel(statusValue)}</Badge>
                    </Td>
                    <Td>
                      <Text>{project?.clientType || client.clientType}</Text>
                      <Text color={mutedColor} fontSize="xs">Klient: {client.clientType}</Text>
                    </Td>
                    <Td textAlign="right">
                      <Tooltip label="Otwórz kartę klienta" hasArrow>
                        <IconButton
                          as={Link}
                          href={`/admin/clients/${client.id}`}
                          aria-label="Otwórz kartę klienta"
                          icon={<Icon as={MdOpenInNew} />}
                          size="sm"
                          variant="ghost"
                          color={textColor}
                        />
                      </Tooltip>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </Box>
        <Flex mt="14px" justify="space-between" align="center" gap="10px">
          <Button size="sm" variant="outline" onClick={() => setPage((value) => Math.max(0, value - 1))} isDisabled={page === 0}>Poprzednia</Button>
          <Text color={mutedColor} fontSize="sm">Strona {page + 1} z {pageCount}</Text>
          <Button size="sm" variant="outline" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} isDisabled={page + 1 >= pageCount}>Następna</Button>
        </Flex>
      </Card>

      <Modal isOpen={isOpen} onClose={onClose} size="4xl">
        <ModalOverlay />
        <ModalContent borderRadius="8px">
          <ModalHeader>Nowy klient</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {formError ? (
              <Alert status="error" borderRadius="8px" mb="18px">
                <AlertIcon />
                {formError}
              </Alert>
            ) : null}
            <SimpleGrid columns={{ base: 1, md: 2 }} gap="16px">
              <FormControl isRequired>
                <FormLabel>Nazwa / imię i nazwisko</FormLabel>
                <Input value={form.displayName} onChange={(event) => updateForm('displayName', event.target.value)} />
              </FormControl>
              <FormControl>
                <FormLabel>Typ relacji klienta</FormLabel>
                <Select value={form.clientType} onChange={(event) => updateForm('clientType', event.target.value)}>
                  {clientTypeOptions.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>Telefon</FormLabel>
                <Input value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} />
              </FormControl>
              <FormControl>
                <FormLabel>Email</FormLabel>
                <Input value={form.email} onChange={(event) => updateForm('email', event.target.value)} />
              </FormControl>
              <FormControl>
                <FormLabel>NIP</FormLabel>
                <Input value={form.taxId} onChange={(event) => updateForm('taxId', event.target.value)} />
              </FormControl>
              <FormControl>
                <FormLabel>Stacja / dashboard klienta</FormLabel>
                <Input value={form.dashboardStation} onChange={(event) => updateForm('dashboardStation', event.target.value)} />
              </FormControl>
              <FormControl>
                <FormLabel>Adres korespondencyjny</FormLabel>
                <Input value={form.addressLine} onChange={(event) => updateForm('addressLine', event.target.value)} />
              </FormControl>
              <Flex gap="12px">
                <FormControl>
                  <FormLabel>Kod</FormLabel>
                  <Input value={form.postalCode} onChange={(event) => updateForm('postalCode', event.target.value)} />
                </FormControl>
                <FormControl>
                  <FormLabel>Miasto</FormLabel>
                  <Input value={form.city} onChange={(event) => updateForm('city', event.target.value)} />
                </FormControl>
              </Flex>
              <FormControl>
                <FormLabel>Adres inwestycji</FormLabel>
                <Input value={form.investmentAddress} onChange={(event) => updateForm('investmentAddress', event.target.value)} />
              </FormControl>
              <FormControl>
                <FormLabel>Nazwa projektu</FormLabel>
                <Input value={form.projectTitle} onChange={(event) => updateForm('projectTitle', event.target.value)} />
              </FormControl>
              <FormControl>
                <FormLabel>Typ projektu</FormLabel>
                <Select value={form.projectClientType} onChange={(event) => updateForm('projectClientType', event.target.value)}>
                  {clientTypeOptions.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>Status projektu</FormLabel>
                <Input value={projectStatusLabel(form.status)} isReadOnly />
              </FormControl>
              <FormControl>
                <FormLabel>Etap</FormLabel>
                <Select value={form.stageId} onChange={(event) => selectStage(event.target.value)}>
                  <option value="">Brak etapu</option>
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>{stage.name}</option>
                  ))}
                </Select>
              </FormControl>
            </SimpleGrid>
            <FormControl mt="16px">
              <FormLabel>Notatki</FormLabel>
              <Textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} rows={4} />
            </FormControl>
          </ModalBody>
          <ModalFooter gap="10px">
            <Button variant="outline" onClick={onClose}>Anuluj</Button>
            <Button colorScheme="purple" onClick={saveClient} isLoading={saving}>
              Zapisz klienta
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Flex>
  );
}
