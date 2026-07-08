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
  IconButton,
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
  Tooltip,
  useColorModeValue,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import { useCallback, useEffect, useState } from 'react';
import { MdAdd, MdAssignment, MdDeleteOutline, MdOpenInNew, MdRefresh } from 'react-icons/md';

type ClientProfileProps = {
  clientId: string;
};

type CurrentUser = {
  systemRole?: string | null;
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
  dashboardStationNumber: string;
  weatherStationNumber: string;
  notes: string;
};

type EnergyMeasurementFileRow = {
  id: string;
  kind: string;
  periodYear: number;
  periodMonth: number;
  status: string;
  fileName?: string | null;
  error?: string | null;
  downloadedAt?: string | null;
  document?: {
    id: string;
    title: string;
    fileName: string;
    storagePath: string;
  } | null;
};

type EnergyMonthRow = {
  key: string;
  year: number;
  month: number;
  label: string;
  importFile?: EnergyMeasurementFileRow;
  exportFile?: EnergyMeasurementFileRow;
};

type EnergyAccountForm = {
  id: string;
  operator: string;
  login: string;
  password: string;
  hasPassword: boolean;
  ppeNumber: string;
  portalPpeId: string;
  meterNumber: string;
  notes: string;
  lastSyncAt: string;
  lastSyncStatus: string;
  lastSyncMessage: string;
  measurementFiles: EnergyMeasurementFileRow[];
};

type EnergyUsageMonth = {
  key: string;
  year: number;
  month: number;
  label: string;
  totalKwh: number;
  sharePercent: number;
  hourly: number[];
  sourceFiles: number;
};

type EnergyUsageProfile = {
  annualKwh: number;
  months: EnergyUsageMonth[];
  warnings: string[];
};

type ClientTaskRow = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueAt?: string | null;
  assignedTo?: {
    id: string;
    name: string;
    email: string;
  } | null;
  createdBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
  commentsCount?: number;
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
  'EMS / Audyt',
  'Faktury iOSD',
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
  dashboardStationNumber: '',
  weatherStationNumber: '',
  notes: '',
};

const emptyEnergyAccount: EnergyAccountForm = {
  id: '',
  operator: 'ENEA',
  login: '',
  password: '',
  hasPassword: false,
  ppeNumber: '',
  portalPpeId: '',
  meterNumber: '',
  notes: '',
  lastSyncAt: '',
  lastSyncStatus: '',
  lastSyncMessage: '',
  measurementFiles: [],
};

const clientTypeOptions = [
  ['UNKNOWN', 'Nie określono'],
  ['B2C', 'B2C'],
  ['B2B', 'B2B'],
  ['B2C_B2B', 'B2C/B2B'],
] as const;

const energyOperators = [
  ['ENEA', 'ENEA'],
  ['PGE', 'PGE'],
  ['TAURON', 'Tauron'],
  ['ENERGA', 'Energa'],
  ['STOEN', 'Stoën'],
  ['INNY', 'Inny'],
] as const;

const taskStatuses = [
  ['OPEN', 'Nowe'],
  ['IN_PROGRESS', 'W trakcie'],
  ['DONE', 'Zrobione'],
  ['CANCELLED', 'Anulowane'],
] as const;

const taskPriorities = [
  ['LOW', 'Niski'],
  ['NORMAL', 'Normalny'],
  ['HIGH', 'Wysoki'],
  ['URGENT', 'Pilne'],
] as const;

function projectStatusLabel(value?: string | null) {
  return projectStatuses.find(([status]) => status === value)?.[1] || value || '-';
}

function clientTypeLabel(value?: string | null) {
  return clientTypeOptions.find(([type]) => type === value)?.[1] || value || 'Nie określono';
}

function taskStatusLabel(value?: string | null) {
  return taskStatuses.find(([status]) => status === value)?.[1] || value || 'Nie określono';
}

function taskPriorityLabel(value?: string | null) {
  return taskPriorities.find(([priority]) => priority === value)?.[1] || value || 'Normalny';
}

function taskStatusColor(value?: string | null) {
  if (value === 'DONE') return 'green';
  if (value === 'IN_PROGRESS') return 'blue';
  if (value === 'CANCELLED') return 'gray';
  return 'purple';
}

function taskPriorityColor(value?: string | null) {
  if (value === 'URGENT') return 'red';
  if (value === 'HIGH') return 'orange';
  if (value === 'LOW') return 'gray';
  return 'blue';
}

function energyAccountFromRecord(account: any): EnergyAccountForm {
  if (!account) return { ...emptyEnergyAccount };
  return {
    id: account.id || '',
    operator: account.operator || 'ENEA',
    login: account.login || '',
    password: '',
    hasPassword: Boolean(account.hasPassword || account.encryptedPassword),
    ppeNumber: account.ppeNumber || '',
    portalPpeId: account.portalPpeId || '',
    meterNumber: account.meterNumber || '',
    notes: account.notes || '',
    lastSyncAt: account.lastSyncAt || '',
    lastSyncStatus: account.lastSyncStatus || '',
    lastSyncMessage: account.lastSyncMessage || '',
    measurementFiles: account.measurementFiles || [],
  };
}

function energyAccountFromClient(client: any): EnergyAccountForm {
  const accounts = client?.energyPortalAccounts || [];
  const eneaAccount = accounts.find((account: any) => account.operator === 'ENEA');
  return energyAccountFromRecord(eneaAccount || accounts[0]);
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function closedEnergyMonths(count: number, now = new Date()): EnergyMonthRow[] {
  const months: EnergyMonthRow[] = [];
  const cursor = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  for (let index = 0; index < count; index += 1) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    months.push({
      key: `${year}-${String(month).padStart(2, '0')}`,
      year,
      month,
      label: `${String(month).padStart(2, '0')}.${year}`,
    });
    cursor.setMonth(cursor.getMonth() - 1);
  }

  return months;
}

function energyMonthRows(files: EnergyMeasurementFileRow[], count = 12) {
  const rows = closedEnergyMonths(count);
  const byKey = new Map(rows.map((row) => [row.key, row]));

  for (const file of files) {
    const key = `${file.periodYear}-${String(file.periodMonth).padStart(2, '0')}`;
    const row = byKey.get(key);
    if (!row) continue;
    if (file.kind === 'ACTIVE_IMPORT') row.importFile = file;
    if (file.kind === 'ACTIVE_EXPORT') row.exportFile = file;
  }

  return rows;
}

function measurementBadge(file?: EnergyMeasurementFileRow) {
  if (!file) return { label: 'Brak', colorScheme: 'gray' };
  if (file.status === 'DOWNLOADED') return { label: 'Pobrano', colorScheme: 'green' };
  if (file.status === 'FAILED') return { label: 'Błąd', colorScheme: 'orange' };
  return { label: file.status || 'Status', colorScheme: 'blue' };
}

function formatKwh(value?: number | null) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 }).format(Math.round(safeValue));
}

function formatKwhPrecise(value?: number | null) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  return new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(safeValue);
}

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
    dashboardStationNumber: project.dashboardStationNumber || '',
    weatherStationNumber: project.weatherStationNumber || '',
    notes: client?.notes || '',
  };
}

export default function ClientProfile({ clientId }: ClientProfileProps) {
  const [client, setClient] = useState<any>(null);
  const [clientTasks, setClientTasks] = useState<ClientTaskRow[]>([]);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [form, setForm] = useState<ClientFormState>(emptyForm);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [energyAccount, setEnergyAccount] = useState<EnergyAccountForm>(emptyEnergyAccount);
  const [energySaving, setEnergySaving] = useState(false);
  const [energySyncing, setEnergySyncing] = useState(false);
  const [energyMonthAction, setEnergyMonthAction] = useState('');
  const [energyMessage, setEnergyMessage] = useState('');
  const [energyError, setEnergyError] = useState('');
  const [energyProfile, setEnergyProfile] = useState<EnergyUsageProfile | null>(null);
  const [energyProfileLoading, setEnergyProfileLoading] = useState(false);
  const [energyProfileError, setEnergyProfileError] = useState('');
  const [selectedEnergyProfileMonth, setSelectedEnergyProfileMonth] = useState('');
  const [stationCreating, setStationCreating] = useState(false);
  const [stationMessage, setStationMessage] = useState('');
  const [stationError, setStationError] = useState('');
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [clientResponse, stagesResponse, tasksResponse, authResponse] = await Promise.all([
        fetch(`/api/crm/clients?id=${encodeURIComponent(clientId)}`, { cache: 'no-store' }),
        fetch('/api/crm/stages', { cache: 'no-store' }),
        fetch(`/api/tasks?clientId=${encodeURIComponent(clientId)}&scope=all`, { cache: 'no-store' }),
        fetch('/api/auth/me', { cache: 'no-store' }).catch(() => null),
      ]);
      const [clientPayload, stagesPayload, tasksPayload] = await Promise.all([
        clientResponse.json(),
        stagesResponse.json(),
        tasksResponse.json(),
      ]);
      if (!clientResponse.ok || !clientPayload.ok) throw new Error(clientPayload.message || clientPayload.error || `HTTP ${clientResponse.status}`);
      if (!stagesResponse.ok || !stagesPayload.ok) throw new Error(stagesPayload.message || stagesPayload.error || `HTTP ${stagesResponse.status}`);
      if (!tasksResponse.ok || !tasksPayload.ok) throw new Error(tasksPayload.message || tasksPayload.error || `HTTP ${tasksResponse.status}`);

      setClient(clientPayload.data);
      setClientTasks(tasksPayload.data?.tasks || []);
      setStages(stagesPayload.data || []);
      setForm(formFromClient(clientPayload.data));
      setEnergyAccount(energyAccountFromClient(clientPayload.data));
      if (authResponse?.ok) {
        const authPayload = await authResponse.json();
        setCurrentUser(authPayload.ok ? authPayload.data : null);
      } else {
        setCurrentUser(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  const loadEnergyProfile = useCallback(async () => {
    setEnergyProfileLoading(true);
    setEnergyProfileError('');
    try {
      const response = await fetch(`/api/integrations/enea/profile?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);

      const profile = payload.data as EnergyUsageProfile;
      setEnergyProfile(profile);
      setSelectedEnergyProfileMonth((current) => (
        profile.months?.some((month) => month.key === current)
          ? current
          : profile.months?.[profile.months.length - 1]?.key || ''
      ));
    } catch (e) {
      setEnergyProfile(null);
      setEnergyProfileError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnergyProfileLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
    loadEnergyProfile();
  }, [load, loadEnergyProfile]);

  function updateForm(key: keyof ClientFormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateEnergyAccount(
    key: 'operator' | 'login' | 'password' | 'ppeNumber' | 'portalPpeId' | 'meterNumber' | 'notes',
    value: string,
  ) {
    setEnergyAccount((current) => ({ ...current, [key]: value }));
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
            dashboardStationNumber: form.dashboardStationNumber,
            weatherStationNumber: form.weatherStationNumber,
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

  async function createStation() {
    setStationCreating(true);
    setStationError('');
    setStationMessage('');
    try {
      const project = client?.projects?.[0];
      const hadStationReference = Boolean(form.dashboardStation.trim() || form.dashboardStationNumber.trim());
      const response = await fetch('/api/integrations/re/station', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          projectId: project?.id,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);

      setForm((current) => ({
        ...current,
        dashboardStation: payload.data?.stationHash || current.dashboardStation,
        dashboardStationNumber: payload.data?.station || current.dashboardStationNumber,
        weatherStationNumber: payload.data?.weatherStation || current.weatherStationNumber,
      }));
      setStationMessage(`${hadStationReference ? 'Uzupełniono' : 'Utworzono'} stację RE ${payload.data?.station || ''}.`);
      await load();
    } catch (e) {
      setStationError(e instanceof Error ? e.message : String(e));
    } finally {
      setStationCreating(false);
    }
  }

  async function saveEnergyAccount(reloadAfter = true) {
    setEnergySaving(true);
    setEnergyError('');
    setEnergyMessage('');
    try {
      const project = client?.projects?.[0];
      const response = await fetch('/api/crm/clients/energy-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: energyAccount.id || undefined,
          clientId,
          projectId: project?.id,
          operator: energyAccount.operator,
          login: energyAccount.login,
          password: energyAccount.password || undefined,
          ppeNumber: energyAccount.ppeNumber,
          portalPpeId: energyAccount.portalPpeId,
          meterNumber: energyAccount.meterNumber,
          notes: energyAccount.notes,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);

      const saved = energyAccountFromRecord(payload.data);
      setEnergyAccount(saved);
      setEnergyMessage('Zapisano dostęp do operatora.');
      if (reloadAfter) await load();
      return saved;
    } catch (e) {
      setEnergyError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setEnergySaving(false);
    }
  }

  async function syncEnea() {
    setEnergySyncing(true);
    setEnergyError('');
    setEnergyMessage('');
    try {
      const accountForSync = (!energyAccount.id || energyAccount.password)
        ? await saveEnergyAccount(false)
        : energyAccount;
      if (!accountForSync?.id) return;

      const response = await fetch('/api/integrations/enea/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: accountForSync.id, months: 12 }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);

      setEnergyMessage(payload.data?.message || 'Synchronizacja ENEA zakończona.');
      await Promise.all([load(), loadEnergyProfile()]);
    } catch (e) {
      setEnergyError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnergySyncing(false);
    }
  }

  async function syncEneaMonth(year: number, month: number) {
    setEnergyMonthAction(`${year}-${month}-sync`);
    setEnergyError('');
    setEnergyMessage('');
    try {
      const accountForSync = (!energyAccount.id || energyAccount.password)
        ? await saveEnergyAccount(false)
        : energyAccount;
      if (!accountForSync?.id) return;

      const response = await fetch('/api/integrations/enea/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: accountForSync.id,
          periodYear: year,
          periodMonth: month,
          force: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);

      setEnergyMessage(payload.data?.message || `Pobrano ponownie ${String(month).padStart(2, '0')}.${year}.`);
      await Promise.all([load(), loadEnergyProfile()]);
    } catch (e) {
      setEnergyError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnergyMonthAction('');
    }
  }

  async function deleteEneaMonth(year: number, month: number) {
    if (!energyAccount.id) return;
    const label = `${String(month).padStart(2, '0')}.${year}`;
    if (!window.confirm(`Usunąć dane ENEA dla ${label}?`)) return;

    setEnergyMonthAction(`${year}-${month}-delete`);
    setEnergyError('');
    setEnergyMessage('');
    try {
      const response = await fetch('/api/integrations/enea/sync', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: energyAccount.id,
          periodYear: year,
          periodMonth: month,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);

      setEnergyMessage(`Usunięto dane ENEA dla ${label}.`);
      await Promise.all([load(), loadEnergyProfile()]);
    } catch (e) {
      setEnergyError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnergyMonthAction('');
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
  const projectStatus = projectStatusLabel(project.status || form.status);
  const energyFiles = energyAccount.measurementFiles || [];
  const energyMonths = energyMonthRows(energyFiles);
  const energyRange = energyMonths.length
    ? `${energyMonths[energyMonths.length - 1].label} - ${energyMonths[0].label}`
    : '';
  const stationToken = form.dashboardStation.trim();
  const stationDashboardUrl = stationToken
    ? `https://my.onrevolt.com/?station=${encodeURIComponent(stationToken)}`
    : '';
  const stationReUrl = stationToken
    ? `${stationDashboardUrl}&re`
    : '';
  const stationNumber = form.dashboardStationNumber.trim();
  const hasStationAssociation = Boolean(stationToken || stationNumber);
  const stationIdentityLocked = Boolean(stationToken && stationNumber);
  const isAdmin = currentUser?.systemRole === 'ADMIN';
  const canEditStationIdentity = isAdmin || !stationIdentityLocked;
  const stationActionLabel = hasStationAssociation ? 'Uzupełnij z RE' : 'Utwórz stację';
  const selectedUsageMonth = energyProfile?.months?.find((month) => month.key === selectedEnergyProfileMonth)
    || energyProfile?.months?.[energyProfile.months.length - 1];
  const maxMonthlyKwh = Math.max(1, ...(energyProfile?.months || []).map((month) => month.totalKwh));
  const maxHourlyKwh = Math.max(1, ...(selectedUsageMonth?.hourly || []).map((value) => value));
  const taskCreateParams = new URLSearchParams({ clientId, create: '1' });
  if (project?.id) taskCreateParams.set('projectId', project.id);
  const taskCreateUrl = `/admin/tasks?${taskCreateParams.toString()}`;
  const activeClientTasksCount = clientTasks.filter((task) => task.status !== 'DONE' && task.status !== 'CANCELLED').length;

  return (
    <Flex direction="column" pt={{ base: '130px', md: '80px', xl: '80px' }} gap="20px">
      <Card p={{ base: '20px', md: '28px' }}>
        <Flex direction={{ base: 'column', md: 'row' }} gap="16px" align={{ md: 'center' }}>
          <Box flex="1">
            <Flex gap="8px" wrap="wrap" mb="12px">
              <Badge colorScheme="purple">Klient: {clientTypeLabel(client.clientType)}</Badge>
              <Badge colorScheme="blue">Projekt: {clientTypeLabel(project.clientType || 'UNKNOWN')}</Badge>
            </Flex>
            <Text color={textColor} fontSize="2xl" fontWeight="800">{client.displayName}</Text>
            <Text color={mutedColor}>{project.title || 'Projekt do utworzenia'} · {project.stage?.name || projectStatus || 'Brak etapu'}</Text>
          </Box>
          <Flex gap="10px" align="center">
            <Badge colorScheme={project.status === 'ZAKONCZONY' ? 'green' : 'blue'} px="12px" py="6px" borderRadius="8px">
              {projectStatus}
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
            <Card p="20px" mt="20px">
              <Text color={mutedColor} mb="6px">Status projektu</Text>
              <Badge colorScheme={project.status === 'ZAKONCZONY' ? 'green' : 'blue'} px="12px" py="6px" borderRadius="8px">
                {projectStatus}
              </Badge>
              <Text color={mutedColor} mt="18px" mb="6px">Notatki</Text>
              <Text color={textColor} whiteSpace="pre-wrap">{form.notes || 'Brak notatek'}</Text>
            </Card>
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
          {tabs.slice(3).map((tab) => {
            if (tab === 'Zadania') {
              return (
                <TabPanel key={tab} px="0">
                  <Card p="22px">
                    <Flex direction={{ base: 'column', md: 'row' }} justify="space-between" gap="14px" align={{ md: 'center' }} mb="18px">
                      <Box>
                        <Flex align="center" gap="10px" mb="6px">
                          <MdAssignment />
                          <Text color={textColor} fontSize="lg" fontWeight="800">Zadania klienta</Text>
                        </Flex>
                        <Text color={mutedColor}>
                          {clientTasks.length} razem · {activeClientTasksCount} aktywnych
                        </Text>
                      </Box>
                      <Flex gap="10px" wrap="wrap">
                        <Button
                          leftIcon={<MdAdd />}
                          colorScheme="purple"
                          onClick={() => { window.location.href = taskCreateUrl; }}
                        >
                          Utwórz nowe zadanie
                        </Button>
                        <Button
                          rightIcon={<MdOpenInNew />}
                          variant="outline"
                          onClick={() => { window.location.href = `/admin/tasks?clientId=${encodeURIComponent(clientId)}&scope=all`; }}
                        >
                          Otwórz w zadaniach
                        </Button>
                      </Flex>
                    </Flex>

                    {clientTasks.length === 0 ? (
                      <Box border="1px solid" borderColor={borderColor} borderRadius="12px" p="18px">
                        <Text color={mutedColor}>
                          Brak zadań przypisanych do tego klienta.
                        </Text>
                      </Box>
                    ) : (
                      <Flex direction="column" gap="10px">
                        {clientTasks.map((task) => (
                          <Flex
                            key={task.id}
                            direction={{ base: 'column', xl: 'row' }}
                            gap="12px"
                            align={{ xl: 'center' }}
                            justify="space-between"
                            border="1px solid"
                            borderColor={borderColor}
                            borderRadius="12px"
                            p="14px"
                          >
                            <Box minW="0" flex="1">
                              <Flex align="center" gap="8px" wrap="wrap" mb="6px">
                                <Text color={textColor} fontWeight="800" noOfLines={1}>
                                  {task.title}
                                </Text>
                                <Badge colorScheme={taskStatusColor(task.status)}>
                                  {taskStatusLabel(task.status)}
                                </Badge>
                                <Badge colorScheme={taskPriorityColor(task.priority)}>
                                  {taskPriorityLabel(task.priority)}
                                </Badge>
                              </Flex>
                              {task.description ? (
                                <Text color={mutedColor} fontSize="sm" noOfLines={2}>
                                  {task.description}
                                </Text>
                              ) : null}
                            </Box>
                            <Flex gap="14px" align="center" wrap="wrap">
                              <Box minW="130px">
                                <Text color={mutedColor} fontSize="xs" fontWeight="700">Termin</Text>
                                <Text color={textColor} fontWeight="700">{formatDateTime(task.dueAt)}</Text>
                              </Box>
                              <Box minW="150px">
                                <Text color={mutedColor} fontSize="xs" fontWeight="700">Osoba</Text>
                                <Text color={textColor} fontWeight="700">{task.assignedTo?.name || 'Nieprzypisane'}</Text>
                              </Box>
                              <Tooltip label="Otwórz zadanie">
                                <IconButton
                                  aria-label="Otwórz zadanie"
                                  icon={<MdOpenInNew />}
                                  variant="outline"
                                  onClick={() => { window.location.href = `/admin/tasks?taskId=${encodeURIComponent(task.id)}&clientId=${encodeURIComponent(clientId)}&scope=all`; }}
                                />
                              </Tooltip>
                            </Flex>
                          </Flex>
                        ))}
                      </Flex>
                    )}
                  </Card>
                </TabPanel>
              );
            }

            if (tab === 'EMS / Audyt') {
              return (
                <TabPanel key={tab} px="0">
                  <Flex direction="column" gap="20px">
                    <Card p="22px">
                      <Flex direction={{ base: 'column', lg: 'row' }} justify="space-between" gap="16px" mb="18px">
                        <Box>
                          <Text color={textColor} fontSize="lg" fontWeight="800">{tab}</Text>
                          <Text color={mutedColor}>{project.title || 'Projekt do utworzenia'}</Text>
                        </Box>
                        <Flex gap="10px" align="center" wrap="wrap">
                          {!stationIdentityLocked ? (
                            <Button leftIcon={<MdAdd />} colorScheme="blue" variant="outline" onClick={createStation} isLoading={stationCreating}>
                              {stationActionLabel}
                            </Button>
                          ) : null}
                          <Button colorScheme="purple" onClick={saveClient} isLoading={saving}>
                            Zapisz powiązanie
                          </Button>
                        </Flex>
                      </Flex>

                      {stationError ? (
                        <Alert status="error" borderRadius="8px" mb="16px">
                          <AlertIcon />
                          {stationError}
                        </Alert>
                      ) : null}
                      {stationMessage ? (
                        <Alert status="success" borderRadius="8px" mb="16px">
                          <AlertIcon />
                          {stationMessage}
                        </Alert>
                      ) : null}

                      <SimpleGrid columns={{ base: 1, md: 3 }} gap="16px">
                        <FormControl>
                          <FormLabel>Numer stacji RE</FormLabel>
                          <Input
                            value={form.dashboardStationNumber}
                            onChange={(event) => updateForm('dashboardStationNumber', event.target.value)}
                            placeholder={stationToken ? 'Do uzupełnienia z bazy RE' : 'Brak powiązania'}
                            isDisabled={!canEditStationIdentity}
                          />
                        </FormControl>
                        <FormControl>
                          <FormLabel>Token dashboardu</FormLabel>
                          <Input
                            value={form.dashboardStation}
                            onChange={(event) => updateForm('dashboardStation', event.target.value)}
                            placeholder="np. z68ohrxd"
                            isDisabled={!canEditStationIdentity}
                          />
                        </FormControl>
                        <FormControl>
                          <FormLabel>Numer stacji pogody</FormLabel>
                          <Input
                            value={form.weatherStationNumber}
                            onChange={(event) => updateForm('weatherStationNumber', event.target.value)}
                            placeholder="-"
                          />
                          <Text color={mutedColor} fontSize="xs" mt="6px">
                            Uzupełni się, gdy stacja pogody wyśle własny numer.
                          </Text>
                        </FormControl>
                      </SimpleGrid>

                      {stationIdentityLocked && !isAdmin ? (
                        <Text color={mutedColor} fontSize="sm" mt="10px">
                          Numer stacji RE i token dashboardu może zmienić tylko administrator.
                        </Text>
                      ) : null}

                      <Box mt="18px" pt="16px" borderTop="1px solid" borderColor="whiteAlpha.200">
                        <Text color={mutedColor} fontSize="sm" fontWeight="700" mb="10px">Linki</Text>
                        <SimpleGrid columns={{ base: 1, lg: 2 }} gap="12px">
                          <Box>
                            <Text color={mutedColor} fontSize="sm">Dashboard</Text>
                            {stationDashboardUrl ? (
                              <Text
                                as="a"
                                href={stationDashboardUrl}
                                target="_blank"
                                rel="noreferrer"
                                color="blue.300"
                                fontWeight="700"
                                wordBreak="break-all"
                              >
                                {stationDashboardUrl}
                              </Text>
                            ) : (
                              <Text color={textColor} fontWeight="700">-</Text>
                            )}
                          </Box>
                          <Box>
                            <Text color={mutedColor} fontSize="sm">RE / Audyt</Text>
                            {stationReUrl ? (
                              <Text
                                as="a"
                                href={stationReUrl}
                                target="_blank"
                                rel="noreferrer"
                                color="blue.300"
                                fontWeight="700"
                                wordBreak="break-all"
                              >
                                {stationReUrl}
                              </Text>
                            ) : (
                              <Text color={textColor} fontWeight="700">-</Text>
                            )}
                          </Box>
                        </SimpleGrid>
                      </Box>
                    </Card>

                    <Card p="22px">
                      <Flex justify="space-between" gap="16px" align="start" mb="14px">
                        <Box>
                          <Text color={textColor} fontSize="lg" fontWeight="800">Profil zużycia</Text>
                          <Text color={mutedColor}>
                            {energyProfile ? `Suma: ${formatKwh(energyProfile.annualKwh)} kWh/rok (profil godzinowy)` : 'Profil godzinowy z plików XLSX'}
                          </Text>
                        </Box>
                        {energyProfileLoading ? <Spinner size="sm" /> : null}
                      </Flex>

                      {energyProfileError ? (
                        <Alert status="warning" borderRadius="8px" mb="16px">
                          <AlertIcon />
                          {energyProfileError}
                        </Alert>
                      ) : null}

                      {energyProfileLoading && !energyProfile ? (
                        <Text color={mutedColor}>Ładowanie profilu zużycia...</Text>
                      ) : !energyProfile?.months?.length ? (
                        <Text color={mutedColor}>Brak pobranych plików XLSX ENEA do profilu zużycia.</Text>
                      ) : (
                        <>
                          <SimpleGrid columns={{ base: 2, md: 4, xl: 6 }} gap="10px">
                            {energyProfile.months.map((month) => {
                              const active = selectedUsageMonth?.key === month.key;
                              const height = Math.max(8, Math.round((month.totalKwh / maxMonthlyKwh) * 100));
                              return (
                                <Box
                                  as="button"
                                  type="button"
                                  key={month.key}
                                  onClick={() => setSelectedEnergyProfileMonth(month.key)}
                                  textAlign="left"
                                  border="1px solid"
                                  borderColor={active ? 'yellow.400' : 'whiteAlpha.200'}
                                  borderRadius="8px"
                                  p="10px"
                                  bg={active ? 'whiteAlpha.100' : 'transparent'}
                                >
                                  <Text color={textColor} fontSize="lg" fontWeight="800" textAlign="center">
                                    {formatKwh(month.totalKwh)}
                                  </Text>
                                  <Flex h="92px" align="end" justify="center" bg="blackAlpha.200" borderRadius="6px" overflow="hidden" mt="8px">
                                    <Box
                                      w="58%"
                                      h={`${height}%`}
                                      bgGradient="linear(to-t, cyan.400, yellow.300)"
                                      borderTopRadius="6px"
                                    />
                                  </Flex>
                                  <Text color={textColor} fontWeight="800" mt="8px" textAlign="center">
                                    {month.label}
                                  </Text>
                                  <Text color={mutedColor} fontSize="sm" textAlign="center">
                                    {month.sharePercent}%
                                  </Text>
                                </Box>
                              );
                            })}
                          </SimpleGrid>

                          {selectedUsageMonth ? (
                            <Box mt="22px">
                              <Text color={textColor} fontWeight="800" mb="12px">
                                Rozkład zużycia w trakcie dnia - {selectedUsageMonth.label}
                              </Text>
                              <SimpleGrid columns={{ base: 12, md: 24 }} gap="6px">
                                {selectedUsageMonth.hourly.map((value, hour) => {
                                  const height = Math.max(6, Math.round((value / maxHourlyKwh) * 100));
                                  return (
                                    <Box key={hour}>
                                      <Tooltip label={`${String(hour).padStart(2, '0')}:00 - ${formatKwhPrecise(value)} kWh`}>
                                        <Flex h="98px" align="end" justify="center" bg="blackAlpha.200" borderRadius="6px" overflow="hidden">
                                          <Box w="100%" h={`${height}%`} bg="teal.400" />
                                        </Flex>
                                      </Tooltip>
                                      <Text color={mutedColor} fontSize="xs" textAlign="center" mt="6px">
                                        {String(hour).padStart(2, '0')}
                                      </Text>
                                    </Box>
                                  );
                                })}
                              </SimpleGrid>
                            </Box>
                          ) : null}

                          {energyProfile.warnings?.length ? (
                            <Text color={mutedColor} fontSize="sm" mt="14px">
                              Pominięto część plików: {energyProfile.warnings.slice(0, 2).join('; ')}
                            </Text>
                          ) : null}
                        </>
                      )}
                    </Card>
                  </Flex>
                </TabPanel>
              );
            }

            if (tab === 'Faktury iOSD') {
              return (
                <TabPanel key={tab} px="0">
                  <Card p="22px">
                    <Flex direction={{ base: 'column', lg: 'row' }} justify="space-between" gap="16px" mb="18px">
                      <Box>
                        <Text color={textColor} fontSize="lg" fontWeight="800">{tab}</Text>
                        <Text color={mutedColor}>Ostatnia synchronizacja: {formatDateTime(energyAccount.lastSyncAt)}</Text>
                      </Box>
                      <Flex gap="10px" align="center" wrap="wrap">
                        {energyAccount.lastSyncStatus ? (
                          <Badge colorScheme={energyAccount.lastSyncStatus === 'OK' ? 'green' : 'orange'} px="10px" py="6px" borderRadius="8px">
                            {energyAccount.lastSyncStatus}
                          </Badge>
                        ) : null}
                        <Button
                          colorScheme="purple"
                          onClick={() => saveEnergyAccount()}
                          isLoading={energySaving}
                        >
                          Zapisz dostęp
                        </Button>
                        <Button
                          colorScheme="blue"
                          variant="outline"
                          onClick={syncEnea}
                          isLoading={energySyncing}
                          isDisabled={energyAccount.operator !== 'ENEA'}
                        >
                          Uzupełnij braki ENEA
                        </Button>
                      </Flex>
                    </Flex>

                    {energyError ? (
                      <Alert status="error" borderRadius="8px" mb="16px">
                        <AlertIcon />
                        {energyError}
                      </Alert>
                    ) : null}
                    {energyMessage ? (
                      <Alert status="success" borderRadius="8px" mb="16px">
                        <AlertIcon />
                        {energyMessage}
                      </Alert>
                    ) : null}

                    <SimpleGrid columns={{ base: 1, md: 2 }} gap="16px">
                      <FormControl>
                        <FormLabel>Operator</FormLabel>
                        <Select value={energyAccount.operator} onChange={(event) => updateEnergyAccount('operator', event.target.value)}>
                          {energyOperators.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </Select>
                      </FormControl>
                      <FormControl>
                        <FormLabel>Numer PPE</FormLabel>
                        <Input value={energyAccount.ppeNumber} onChange={(event) => updateEnergyAccount('ppeNumber', event.target.value)} />
                      </FormControl>

                      {energyAccount.operator === 'ENEA' ? (
                        <>
                          <FormControl>
                            <FormLabel>Użytkownik ENEA</FormLabel>
                            <Input value={energyAccount.login} onChange={(event) => updateEnergyAccount('login', event.target.value)} />
                          </FormControl>
                          <FormControl>
                            <FormLabel>Hasło ENEA {energyAccount.hasPassword ? '(zapisane)' : ''}</FormLabel>
                            <Input
                              type="password"
                              value={energyAccount.password}
                              onChange={(event) => updateEnergyAccount('password', event.target.value)}
                              placeholder={energyAccount.hasPassword ? 'Pozostaw puste, aby nie zmieniać' : ''}
                            />
                          </FormControl>
                          <FormControl>
                            <FormLabel>ID PPE w portalu</FormLabel>
                            <Input value={energyAccount.portalPpeId} onChange={(event) => updateEnergyAccount('portalPpeId', event.target.value)} />
                          </FormControl>
                          <FormControl>
                            <FormLabel>Numer licznika</FormLabel>
                            <Input value={energyAccount.meterNumber} onChange={(event) => updateEnergyAccount('meterNumber', event.target.value)} />
                          </FormControl>
                        </>
                      ) : (
                        <Box>
                          <Text color={mutedColor} fontWeight="700">Automatyczna synchronizacja</Text>
                          <Text color={mutedColor}>Aktualnie wdrożona jest dla ENEA. Pozostali operatorzy mogą być zapisani przy kliencie do późniejszego podpięcia.</Text>
                        </Box>
                      )}
                    </SimpleGrid>

                    <FormControl mt="16px">
                      <FormLabel>Notatki do konta operatora</FormLabel>
                      <Textarea value={energyAccount.notes} onChange={(event) => updateEnergyAccount('notes', event.target.value)} rows={3} />
                    </FormControl>

                    <Box mt="22px">
                      <Text color={textColor} fontSize="md" fontWeight="800" mb="10px">Dane pomiarowe ENEA</Text>
                      {energyRange ? (
                        <Text color={mutedColor} mb="10px">Zakres 12 pełnych miesięcy: {energyRange}</Text>
                      ) : null}
                      {energyAccount.lastSyncMessage ? (
                        <Text color={mutedColor} mb="10px">{energyAccount.lastSyncMessage}</Text>
                      ) : null}
                      {energyMonths.length ? (
                        <SimpleGrid columns={{ base: 1, xl: 2 }} gap="12px">
                          {energyMonths.map((row) => {
                            const importBadge = measurementBadge(row.importFile);
                            const exportBadge = measurementBadge(row.exportFile);
                            const hasAnyFile = Boolean(row.importFile || row.exportFile);
                            const syncKey = `${row.year}-${row.month}-sync`;
                            const deleteKey = `${row.year}-${row.month}-delete`;

                            return (
                              <Box key={row.key} border="1px solid" borderColor="whiteAlpha.200" borderRadius="8px" p="12px">
                                <Flex justify="space-between" gap="12px" align="start">
                                  <Box flex="1" minW="0">
                                    <Text color={textColor} fontWeight="800">{row.label}</Text>
                                    <Flex gap="8px" wrap="wrap" mt="8px">
                                      <Badge colorScheme={importBadge.colorScheme}>Pobrana: {importBadge.label}</Badge>
                                      <Badge colorScheme={exportBadge.colorScheme}>Oddana: {exportBadge.label}</Badge>
                                    </Flex>
                                    {row.importFile?.error ? <Text color="orange.300" fontSize="sm" mt="6px">{row.importFile.error}</Text> : null}
                                    {row.exportFile?.error ? <Text color="orange.300" fontSize="sm" mt="6px">{row.exportFile.error}</Text> : null}
                                  </Box>
                                  <Flex gap="6px" flexShrink={0}>
                                    <Tooltip label="Pobierz ponownie miesiąc">
                                      <IconButton
                                        aria-label={`Pobierz ponownie ENEA ${row.label}`}
                                        icon={<MdRefresh />}
                                        size="sm"
                                        variant="outline"
                                        colorScheme="blue"
                                        onClick={() => syncEneaMonth(row.year, row.month)}
                                        isLoading={energyMonthAction === syncKey}
                                        isDisabled={Boolean(energyMonthAction) && energyMonthAction !== syncKey}
                                      />
                                    </Tooltip>
                                    <Tooltip label="Usuń miesiąc">
                                      <IconButton
                                        aria-label={`Usuń ENEA ${row.label}`}
                                        icon={<MdDeleteOutline />}
                                        size="sm"
                                        variant="outline"
                                        colorScheme="red"
                                        onClick={() => deleteEneaMonth(row.year, row.month)}
                                        isLoading={energyMonthAction === deleteKey}
                                        isDisabled={!hasAnyFile || (Boolean(energyMonthAction) && energyMonthAction !== deleteKey)}
                                      />
                                    </Tooltip>
                                  </Flex>
                                </Flex>
                              </Box>
                            );
                          })}
                        </SimpleGrid>
                      ) : (
                        <Text color={mutedColor}>Brak pobranych plików ENEA.</Text>
                      )}
                    </Box>
                  </Card>
                </TabPanel>
              );
            }

            return (
              <TabPanel key={tab} px="0">
                <Card p="22px">
                  <Text color={textColor} fontSize="lg" fontWeight="800" mb="10px">{tab}</Text>
                  <Text color={mutedColor}>
                    Sekcja korzysta z lokalnych encji CRM i jest gotowa do podpięcia kolejnego formularza lub listy.
                  </Text>
                </Card>
              </TabPanel>
            );
          })}
        </TabPanels>
      </Tabs>
    </Flex>
  );
}
