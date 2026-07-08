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
  Input,
  Select,
  SimpleGrid,
  Spinner,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  Textarea,
  useColorModeValue,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import { useCallback, useEffect, useState } from 'react';

type ClientProfileProps = {
  clientId: string;
};

type StageRow = {
  id: string;
  name: string;
};

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

const tabs = [
  'Podsumowanie',
  'Kontakt i adres',
  'Etap',
  'Zadania',
  'Konfiguracje',
  'Oferta / umowa',
  'Urządzenia',
  'Zdjęcia / pliki',
  'Faktury i Enea/Re',
  'Historia',
];

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

const emptyForm: ClientFormState = {
  displayName: '',
  clientType: 'B2C',
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

const clientTypeOptions = [
  ['UNKNOWN', 'Nieustalony'],
  ['B2C', 'B2C'],
  ['B2B', 'B2B'],
  ['B2C_B2B', 'B2C/B2B'],
] as const;

function formFromClient(client: any): ClientFormState {
  const contact = client?.contacts?.[0] || {};
  const project = client?.projects?.[0] || {};
  const site = project?.investmentSite || client?.investmentSites?.[0] || {};
  return {
    displayName: client?.displayName || '',
    clientType: client?.clientType || 'UNKNOWN',
    taxId: client?.taxId || '',
    phone: contact.phone || '',
    email: contact.email || '',
    addressLine: contact.addressLine || '',
    postalCode: contact.postalCode || '',
    city: contact.city || '',
    investmentAddress: site.fullAddress || site.addressLine || contact.investmentAddress || project.locationAddress || '',
    projectTitle: project.title || '',
    projectClientType: project.clientType || client?.clientType || 'UNKNOWN',
    status: project.status || 'LEAD',
    stageId: project.stageId || '',
    dashboardStation: project.dashboardStation || '',
    notes: client?.notes || '',
  };
}

export default function ClientProfile({ clientId }: ClientProfileProps) {
  const [client, setClient] = useState<any>(null);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [form, setForm] = useState<ClientFormState>(emptyForm);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [clientResponse, stagesResponse] = await Promise.all([
        fetch(`/api/crm/clients?id=${encodeURIComponent(clientId)}`, { cache: 'no-store' }),
        fetch('/api/crm/stages', { cache: 'no-store' }),
      ]);
      const [clientPayload, stagesPayload] = await Promise.all([
        clientResponse.json(),
        stagesResponse.json(),
      ]);
      if (!clientResponse.ok || !clientPayload.ok) throw new Error(clientPayload.message || clientPayload.error || `HTTP ${clientResponse.status}`);
      if (!stagesResponse.ok || !stagesPayload.ok) throw new Error(stagesPayload.message || stagesPayload.error || `HTTP ${stagesResponse.status}`);

      setClient(clientPayload.data);
      setStages(stagesPayload.data || []);
      setForm(formFromClient(clientPayload.data));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  function updateForm(key: keyof ClientFormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveClient() {
    setSaving(true);
    setSaveError('');
    try {
      const contact = client?.contacts?.[0];
      const project = client?.projects?.[0];
      const response = await fetch('/api/crm/clients', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: clientId,
          contactId: contact?.id,
          projectId: project?.id,
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
            source: project?.source || 'manual',
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Flex pt={{ base: '130px', md: '80px', xl: '80px' }} minH="50vh" align="center" justify="center">
        <Spinner />
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex pt={{ base: '130px', md: '80px', xl: '80px' }}>
        <Alert status="error" borderRadius="8px"><AlertIcon />{error}</Alert>
      </Flex>
    );
  }

  const contact = client?.contacts?.[0] || {};
  const project = client?.projects?.[0] || {};
  const site = project?.investmentSite || client?.investmentSites?.[0] || {};

  return (
    <Flex direction="column" pt={{ base: '130px', md: '80px', xl: '80px' }} gap="20px">
      <Card p={{ base: '20px', md: '28px' }}>
        <Flex direction={{ base: 'column', md: 'row' }} gap="16px" align={{ md: 'center' }}>
          <Box flex="1">
            <Flex gap="8px" wrap="wrap" mb="12px">
              <Badge colorScheme="purple">Klient: {client.clientType}</Badge>
              <Badge colorScheme="blue">Projekt: {project.clientType || 'UNKNOWN'}</Badge>
            </Flex>
            <Text color={textColor} fontSize="2xl" fontWeight="800">{client.displayName}</Text>
            <Text color={mutedColor}>{project.title || 'Projekt do utworzenia'} · {project.stage?.name || project.status || 'Brak etapu'}</Text>
          </Box>
          <Flex gap="10px" align="center">
            <Badge colorScheme={project.status === 'ZAKONCZONY' ? 'green' : 'blue'} px="12px" py="6px" borderRadius="8px">
              {project.status || 'LEAD'}
            </Badge>
            <Button colorScheme="purple" onClick={saveClient} isLoading={saving}>
              Zapisz zmiany
            </Button>
          </Flex>
        </Flex>
      </Card>

      {saveError ? (
        <Alert status="error" borderRadius="8px">
          <AlertIcon />
          {saveError}
        </Alert>
      ) : null}

      <Tabs colorScheme="purple" variant="soft-rounded">
        <TabList overflowX="auto" pb="8px">
          {tabs.map((tab) => <Tab key={tab} whiteSpace="nowrap">{tab}</Tab>)}
        </TabList>
        <TabPanels>
          <TabPanel px="0">
            <SimpleGrid columns={{ base: 1, xl: 3 }} gap="20px">
              <Card p="20px"><Text color={mutedColor}>Telefon</Text><Text color={textColor} fontWeight="800">{contact.phone || '-'}</Text></Card>
              <Card p="20px"><Text color={mutedColor}>Email</Text><Text color={textColor} fontWeight="800">{contact.email || '-'}</Text></Card>
              <Card p="20px"><Text color={mutedColor}>Adres inwestycji</Text><Text color={textColor} fontWeight="800">{site.fullAddress || site.addressLine || contact.investmentAddress || project.locationAddress || '-'}</Text></Card>
            </SimpleGrid>
          </TabPanel>
          <TabPanel px="0">
            <Card p="22px">
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
              </SimpleGrid>
              <FormControl mt="16px">
                <FormLabel>Notatki</FormLabel>
                <Textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} rows={4} />
              </FormControl>
            </Card>
          </TabPanel>
          <TabPanel px="0">
            <Card p="22px">
              <SimpleGrid columns={{ base: 1, md: 2 }} gap="16px">
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
                  <Select value={form.status} onChange={(event) => updateForm('status', event.target.value)}>
                    {projectStatuses.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Etap</FormLabel>
                  <Select value={form.stageId} onChange={(event) => updateForm('stageId', event.target.value)}>
                    <option value="">Brak etapu</option>
                    {stages.map((stage) => (
                      <option key={stage.id} value={stage.id}>{stage.name}</option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>Adres inwestycji projektu</FormLabel>
                  <Input value={form.investmentAddress} onChange={(event) => updateForm('investmentAddress', event.target.value)} />
                </FormControl>
              </SimpleGrid>
            </Card>
          </TabPanel>
          {tabs.slice(3).map((tab) => (
            <TabPanel key={tab} px="0">
              <Card p="22px">
                <Text color={textColor} fontSize="lg" fontWeight="800" mb="10px">{tab}</Text>
                <Text color={mutedColor}>
                  Sekcja korzysta z lokalnych encji CRM i jest gotowa do podpięcia kolejnego formularza lub listy.
                </Text>
              </Card>
            </TabPanel>
          ))}
        </TabPanels>
      </Tabs>
    </Flex>
  );
}
