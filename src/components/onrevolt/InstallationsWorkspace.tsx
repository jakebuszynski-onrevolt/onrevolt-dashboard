'use client';

import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Icon,
  IconButton,
  Input,
  Link,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Progress,
  Select,
  SimpleGrid,
  Table,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tr,
  useColorModeValue,
  useDisclosure,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import { useEffect, useMemo, useState } from 'react';
import {
  MdAdd,
  MdAssignmentTurnedIn,
  MdBuild,
  MdCalendarToday,
  MdCheckCircle,
  MdChecklist,
  MdClose,
  MdDelete,
  MdDownloadDone,
  MdGroup,
  MdKeyboardArrowDown,
  MdOpenInNew,
  MdOutlineInventory2,
  MdPhotoCamera,
  MdPlayArrow,
  MdRefresh,
  MdSave,
  MdSearch,
  MdUploadFile,
  MdWarning,
} from 'react-icons/md';

type StaffOption = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  positionTitle?: string | null;
  systemRole?: string;
};

type ProjectOption = {
  id: string;
  clientId: string;
  title: string;
  status: string;
  locationAddress?: string | null;
  client: {
    id: string;
    displayName: string;
    clientType: string;
  };
  investmentSite?: {
    fullAddress?: string | null;
    addressLine?: string | null;
    postalCode?: string | null;
    city?: string | null;
  } | null;
  offers: Array<{
    id: string;
    number?: string | null;
    title?: string | null;
    status: string;
    configurationId?: string | null;
  }>;
  configurations: Array<{
    id: string;
    name: string;
    status: string;
    kind: string;
  }>;
  installations: Array<{
    id: string;
    status: string;
    plannedAt?: string | null;
  }>;
};

type InstallationStats = {
  total: number;
  toSchedule: number;
  planned: number;
  today: number;
  inProgress: number;
  needsCompletion: number;
  completed: number;
};

type FiltersState = {
  q: string;
  scope: string;
  status: string;
  teamLeadId: string;
  projectId: string;
};

type InstallationForm = {
  id?: string;
  projectId: string;
  offerId: string;
  configurationId: string;
  status: string;
  plannedAt: string;
  plannedEndAt: string;
  teamLeadId: string;
  teamMemberIds: string[];
  address: string;
  contactName: string;
  contactPhone: string;
  notes: string;
  internalNotes: string;
  createTasks: boolean;
};

type ChecklistItem = {
  id: string;
  title: string;
  required: boolean;
  completed: boolean;
  completedAt?: string | null;
  notes?: string | null;
};

type PlannedItem = {
  id: string;
  productId?: string | null;
  position: number;
  name: string;
  quantity: string | number;
  role: string;
  supplyMode: string;
  product?: {
    id: string;
    sku?: string | null;
    name: string;
    producer?: string | null;
    category: string;
  } | null;
  installedDevices?: Array<{ id: string; serialNumber?: string | null }>;
};

type InstalledDevice = {
  id: string;
  plannedItemId?: string | null;
  productId?: string | null;
  name: string;
  serialNumber?: string | null;
  installedAt?: string | null;
  notes?: string | null;
  product?: PlannedItem['product'];
  plannedItem?: { id: string; name: string; position: number } | null;
};

type InstallationItem = {
  id: string;
  projectId: string;
  offerId?: string | null;
  configurationId?: string | null;
  status: string;
  plannedAt?: string | null;
  plannedEndAt?: string | null;
  confirmedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  teamLeadId?: string | null;
  address?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  internalNotes?: string | null;
  project: ProjectOption;
  offer?: {
    id: string;
    number?: string | null;
    title?: string | null;
    status: string;
    totalGross?: string | number | null;
  } | null;
  configuration?: {
    id: string;
    name: string;
    status: string;
    kind: string;
  } | null;
  teamLead?: StaffOption | null;
  teamMembers: Array<{
    staffUserId: string;
    role?: string | null;
    isLead: boolean;
    staffUser?: StaffOption | null;
  }>;
  checklistItems: ChecklistItem[];
  plannedItems: PlannedItem[];
  installedDevices: InstalledDevice[];
  documents: Array<{
    id: string;
    type: string;
    title: string;
    fileName: string;
    storagePath: string;
    createdAt: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueAt?: string | null;
    assignedTo?: StaffOption | null;
  }>;
  progress: {
    checklistDone: number;
    checklistTotal: number;
    plannedItems: number;
    installedDevices: number;
    documents: number;
  };
};

type DeviceForm = {
  plannedItemId: string;
  productId: string;
  name: string;
  serialNumber: string;
  installedAt: string;
  notes: string;
};

type UploadForm = {
  type: string;
  title: string;
  file: File | null;
};

const emptyStats: InstallationStats = {
  total: 0,
  toSchedule: 0,
  planned: 0,
  today: 0,
  inProgress: 0,
  needsCompletion: 0,
  completed: 0,
};

const emptyFilters: FiltersState = {
  q: '',
  scope: 'active',
  status: '',
  teamLeadId: '',
  projectId: '',
};

const emptyForm: InstallationForm = {
  projectId: '',
  offerId: '',
  configurationId: '',
  status: 'TO_SCHEDULE',
  plannedAt: '',
  plannedEndAt: '',
  teamLeadId: '',
  teamMemberIds: [],
  address: '',
  contactName: '',
  contactPhone: '',
  notes: '',
  internalNotes: '',
  createTasks: true,
};

const emptyDeviceForm: DeviceForm = {
  plannedItemId: '',
  productId: '',
  name: '',
  serialNumber: '',
  installedAt: '',
  notes: '',
};

const statusOptions = [
  ['TO_SCHEDULE', 'Do zaplanowania'],
  ['PLANNED', 'Zaplanowany'],
  ['CONFIRMED', 'Potwierdzony'],
  ['IN_PROGRESS', 'W trakcie'],
  ['NEEDS_COMPLETION', 'Do uzupełnienia'],
  ['WAITING_OSD', 'Oczekuje OSD'],
  ['COMPLETED', 'Zakończony'],
  ['SERVICE_REQUIRED', 'Wymaga serwisu'],
] as const;

const scopeOptions = [
  ['active', 'Aktywne'],
  ['mine', 'Moje / moja ekipa'],
  ['to_schedule', 'Do zaplanowania'],
  ['planned', 'Zaplanowane'],
  ['in_progress', 'W trakcie'],
  ['today', 'Na dziś'],
  ['overdue', 'Po terminie'],
  ['needs', 'Do uzupełnienia'],
  ['completed', 'Zakończone'],
] as const;

const documentTypeOptions = [
  ['ZDJECIE_MONTAZU', 'Zdjęcie montażu'],
  ['PROTOKOL', 'Protokół'],
  ['DOKUMENT_OSD', 'Dokument OSD'],
  ['INNE', 'Inny dokument'],
] as const;

function labelFor(options: readonly (readonly [string, string])[], value?: string | null) {
  return options.find(([key]) => key === value)?.[1] || value || 'Nie określono';
}

function normalizeSearch(value: unknown) {
  return String(value ?? '')
    .replace(/[Łł]/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function statusColor(status: string) {
  if (status === 'COMPLETED') return 'green';
  if (status === 'IN_PROGRESS') return 'blue';
  if (status === 'NEEDS_COMPLETION' || status === 'SERVICE_REQUIRED') return 'red';
  if (status === 'CONFIRMED') return 'cyan';
  if (status === 'PLANNED') return 'purple';
  if (status === 'WAITING_OSD') return 'orange';
  return 'gray';
}

function supplyModeLabel(value?: string | null) {
  if (value === 'CLIENT_OWNED_USED') return 'Sprzęt klienta';
  if (value === 'CLIENT_SUPPLIED_NEW') return 'Dostarczone przez klienta';
  if (value === 'SERVICE_ONLY') return 'Usługa';
  if (value === 'NOT_INCLUDED') return 'Poza zakresem';
  return 'onRevolt';
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Bez terminu';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Bez terminu';
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function toLocalInputValue(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function nowLocalInputValue() {
  return toLocalInputValue(new Date().toISOString());
}

function formatQuantity(value: string | number) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 }).format(number);
}

function projectAddress(project?: ProjectOption | null) {
  if (!project) return '';
  return project.investmentSite?.fullAddress
    || [project.investmentSite?.addressLine, project.investmentSite?.postalCode, project.investmentSite?.city].filter(Boolean).join(', ')
    || project.locationAddress
    || '';
}

function bestOffer(project?: ProjectOption | null) {
  if (!project) return null;
  return project.offers.find((offer) => offer.status === 'ACCEPTED') || project.offers[0] || null;
}

function bestConfiguration(project?: ProjectOption | null, offerId?: string) {
  if (!project) return null;
  const offer = offerId ? project.offers.find((item) => item.id === offerId) : bestOffer(project);
  if (offer?.configurationId) {
    const linked = project.configurations.find((configuration) => configuration.id === offer.configurationId);
    if (linked) return linked;
  }
  return project.configurations.find((configuration) => configuration.status === 'ACCEPTED') || project.configurations[0] || null;
}

function updateUrl(filters: FiltersState) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  window.history.replaceState(null, '', query ? `/admin/installations?${query}` : '/admin/installations');
}

export default function InstallationsWorkspace() {
  const [installations, setInstallations] = useState<InstallationItem[]>([]);
  const [stats, setStats] = useState<InstallationStats>(emptyStats);
  const [users, setUsers] = useState<StaffOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [currentUser, setCurrentUser] = useState<StaffOption | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filters, setFilters] = useState<FiltersState>(emptyFilters);
  const [selectedInstallation, setSelectedInstallation] = useState<InstallationItem | null>(null);
  const [form, setForm] = useState<InstallationForm>(emptyForm);
  const [deviceForm, setDeviceForm] = useState<DeviceForm>(emptyDeviceForm);
  const [uploadForm, setUploadForm] = useState<UploadForm>({ type: 'ZDJECIE_MONTAZU', title: '', file: null });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const { isOpen, onOpen, onClose } = useDisclosure();

  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const fieldBg = useColorModeValue('white', 'rgba(17, 27, 66, 0.72)');
  const modalBg = useColorModeValue('white', 'navy.800');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const rowHover = useColorModeValue('secondaryGray.100', 'whiteAlpha.100');

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === form.projectId) || null,
    [form.projectId, projects],
  );
  const selectedOffer = useMemo(
    () => selectedProject?.offers.find((offer) => offer.id === form.offerId) || null,
    [form.offerId, selectedProject],
  );
  const selectedConfiguration = useMemo(
    () => selectedProject?.configurations.find((configuration) => configuration.id === form.configurationId) || null,
    [form.configurationId, selectedProject],
  );

  const checklistProgress = selectedInstallation?.progress.checklistTotal
    ? Math.round((selectedInstallation.progress.checklistDone / selectedInstallation.progress.checklistTotal) * 100)
    : 0;

  async function loadInstallations(nextFilters = filters) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const response = await fetch(`/api/installations?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);

      const nextInstallations = payload.data.installations || [];
      const nextProjects = payload.data.meta?.projects || [];
      setInstallations(nextInstallations);
      setStats(payload.data.stats || emptyStats);
      setUsers(payload.data.meta?.users || []);
      setProjects(nextProjects);
      setCurrentUser(payload.data.currentUser);
      setIsAdmin(Boolean(payload.data.isAdmin));

      const searchParams = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
      const createRequested = searchParams.get('create') === '1';
      const requestedProjectId = searchParams.get('projectId') || nextFilters.projectId || '';
      if (createRequested && !selectedInstallation) {
        const project = nextProjects.find((item: ProjectOption) => item.id === requestedProjectId) || null;
        const offer = bestOffer(project);
        const configuration = bestConfiguration(project, offer?.id);
        setForm({
          ...emptyForm,
          projectId: requestedProjectId,
          offerId: offer?.id || '',
          configurationId: configuration?.id || '',
          address: projectAddress(project),
        });
        setFormError('');
        onOpen();
      }

      if (selectedInstallation) {
        const fresh = nextInstallations.find((item: InstallationItem) => item.id === selectedInstallation.id);
        if (fresh) {
          setSelectedInstallation(fresh);
          setForm(installationToForm(fresh));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const initialFilters = {
      ...emptyFilters,
      q: params.get('q') || '',
      scope: params.get('scope') || emptyFilters.scope,
      status: params.get('status') || '',
      teamLeadId: params.get('teamLeadId') || '',
      projectId: params.get('projectId') || '',
    };
    setFilters(initialFilters);
    loadInstallations(initialFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      updateUrl(filters);
      loadInstallations(filters);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.scope, filters.status, filters.teamLeadId, filters.projectId]);

  function setFilter(key: keyof FiltersState, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function installationToForm(installation: InstallationItem): InstallationForm {
    return {
      id: installation.id,
      projectId: installation.projectId,
      offerId: installation.offerId || '',
      configurationId: installation.configurationId || '',
      status: installation.status || 'TO_SCHEDULE',
      plannedAt: toLocalInputValue(installation.plannedAt),
      plannedEndAt: toLocalInputValue(installation.plannedEndAt),
      teamLeadId: installation.teamLeadId || '',
      teamMemberIds: installation.teamMembers.map((member) => member.staffUserId),
      address: installation.address || '',
      contactName: installation.contactName || '',
      contactPhone: installation.contactPhone || '',
      notes: installation.notes || '',
      internalNotes: installation.internalNotes || '',
      createTasks: false,
    };
  }

  function updateForm(key: keyof InstallationForm, value: string | boolean | string[]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'projectId' && typeof value === 'string') {
        const project = projects.find((item) => item.id === value) || null;
        const offer = bestOffer(project);
        const configuration = bestConfiguration(project, offer?.id);
        next.offerId = offer?.id || '';
        next.configurationId = configuration?.id || '';
        next.address = projectAddress(project);
      }
      if (key === 'offerId' && typeof value === 'string') {
        const configuration = bestConfiguration(selectedProject, value);
        next.configurationId = configuration?.id || '';
      }
      if (key === 'teamLeadId' && typeof value === 'string' && value && !next.teamMemberIds.includes(value)) {
        next.teamMemberIds = [value, ...next.teamMemberIds];
      }
      return next;
    });
  }

  function toggleTeamMember(userId: string, checked: boolean) {
    setForm((current) => {
      const ids = new Set(current.teamMemberIds);
      if (checked) ids.add(userId);
      else ids.delete(userId);
      if (current.teamLeadId) ids.add(current.teamLeadId);
      return { ...current, teamMemberIds: Array.from(ids) };
    });
  }

  function openCreateInstallation() {
    setSelectedInstallation(null);
    setForm(emptyForm);
    setDeviceForm(emptyDeviceForm);
    setFormError('');
    onOpen();
  }

  function openInstallation(installation: InstallationItem) {
    setSelectedInstallation(installation);
    setForm(installationToForm(installation));
    setDeviceForm(emptyDeviceForm);
    setUploadForm({ type: 'ZDJECIE_MONTAZU', title: '', file: null });
    setFormError('');
    onOpen();
  }

  function closeModal() {
    onClose();
    setFormError('');
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      params.delete('create');
      const query = params.toString();
      window.history.replaceState(null, '', query ? `/admin/installations?${query}` : '/admin/installations');
    }
  }

  async function saveInstallation() {
    setSaving(true);
    setFormError('');
    try {
      const body = {
        id: form.id,
        projectId: form.projectId,
        offerId: form.offerId || null,
        configurationId: form.configurationId || null,
        status: form.status,
        plannedAt: form.plannedAt ? new Date(form.plannedAt).toISOString() : null,
        plannedEndAt: form.plannedEndAt ? new Date(form.plannedEndAt).toISOString() : null,
        teamLeadId: form.teamLeadId || null,
        teamMemberIds: form.teamMemberIds,
        address: form.address,
        contactName: form.contactName,
        contactPhone: form.contactPhone,
        notes: form.notes,
        internalNotes: form.internalNotes,
        createTasks: form.createTasks,
      };
      const response = await fetch('/api/installations', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      window.dispatchEvent(new Event('onrevolt:notifications-updated'));
      setSelectedInstallation(payload.data);
      setForm(installationToForm(payload.data));
      await loadInstallations();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function updateInstallationStatus(installation: InstallationItem, status: string) {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/installations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: installation.id, status }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      await loadInstallations();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleChecklist(item: ChecklistItem, completed: boolean) {
    if (!selectedInstallation) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch('/api/installations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedInstallation.id,
          checklistItems: [{ id: item.id, completed, notes: item.notes || '' }],
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setSelectedInstallation(payload.data);
      setForm(installationToForm(payload.data));
      await loadInstallations();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function startAddDevice(item?: PlannedItem) {
    setDeviceForm({
      plannedItemId: item?.id || '',
      productId: item?.productId || '',
      name: item?.product?.name || item?.name || '',
      serialNumber: '',
      installedAt: nowLocalInputValue(),
      notes: '',
    });
  }

  async function addInstalledDevice() {
    if (!selectedInstallation) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch('/api/installed-devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationId: selectedInstallation.id,
          plannedItemId: deviceForm.plannedItemId || null,
          productId: deviceForm.productId || null,
          name: deviceForm.name,
          serialNumber: deviceForm.serialNumber,
          installedAt: deviceForm.installedAt ? new Date(deviceForm.installedAt).toISOString() : null,
          notes: deviceForm.notes,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setDeviceForm(emptyDeviceForm);
      await loadInstallations();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function uploadDocument() {
    if (!selectedInstallation || !uploadForm.file) return;
    setSaving(true);
    setFormError('');
    try {
      const data = new FormData();
      data.set('file', uploadForm.file);
      data.set('type', uploadForm.type);
      data.set('title', uploadForm.title || uploadForm.file.name);
      data.set('installationId', selectedInstallation.id);
      data.set('projectId', selectedInstallation.projectId);
      data.set('clientId', selectedInstallation.project.clientId);
      data.set('uploadedById', currentUser?.id || '');

      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        body: data,
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setUploadForm({ type: 'ZDJECIE_MONTAZU', title: '', file: null });
      await loadInstallations();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box pt={{ base: '120px', md: '95px' }}>
      <Flex align={{ base: 'flex-start', md: 'center' }} justify="space-between" gap="16px" flexWrap="wrap" mb="20px">
        <Box>
          <Text color={textColor} fontSize={{ base: '28px', md: '34px' }} fontWeight="800">
            Montaże
          </Text>
          <Text color={mutedColor} fontSize="sm">
            Planowanie ekip, checklisty, zdjęcia, protokoły i faktycznie zamontowane urządzenia.
          </Text>
        </Box>
        <Flex gap="10px" flexWrap="wrap">
          <Button leftIcon={<Icon as={MdRefresh} />} variant="outline" onClick={() => loadInstallations()} isLoading={loading}>
            Odśwież
          </Button>
          <Button leftIcon={<Icon as={MdAdd} />} variant="brand" onClick={openCreateInstallation}>
            Utwórz montaż
          </Button>
        </Flex>
      </Flex>

      {error ? (
        <Alert status="error" borderRadius="12px" mb="18px">
          <AlertIcon />
          {error}
        </Alert>
      ) : null}

      <SimpleGrid columns={{ base: 1, md: 3, xl: 7 }} gap="14px" mb="18px">
        <Metric title="Wszystkie" value={stats.total} icon={MdBuild} active={filters.scope === 'active'} onClick={() => setFilter('scope', 'active')} />
        <Metric title="Do zaplanowania" value={stats.toSchedule} icon={MdCalendarToday} active={filters.scope === 'to_schedule'} onClick={() => setFilter('scope', 'to_schedule')} />
        <Metric title="Zaplanowane" value={stats.planned} icon={MdGroup} active={filters.scope === 'planned'} onClick={() => setFilter('scope', 'planned')} />
        <Metric title="Na dziś" value={stats.today} icon={MdAssignmentTurnedIn} active={filters.scope === 'today'} onClick={() => setFilter('scope', 'today')} />
        <Metric title="W trakcie" value={stats.inProgress} icon={MdPlayArrow} active={filters.scope === 'in_progress'} onClick={() => setFilter('scope', 'in_progress')} />
        <Metric title="Do uzupełnienia" value={stats.needsCompletion} icon={MdWarning} active={filters.scope === 'needs'} alert={stats.needsCompletion > 0} onClick={() => setFilter('scope', 'needs')} />
        <Metric title="Zakończone" value={stats.completed} icon={MdDownloadDone} active={filters.scope === 'completed'} onClick={() => setFilter('scope', 'completed')} />
      </SimpleGrid>

      <Card p="18px" mb="18px">
        <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} gap="12px">
          <FormControl>
            <FormLabel color={textColor} fontWeight="700">Szukaj</FormLabel>
            <Flex align="center" border="1px solid" borderColor={borderColor} borderRadius="12px" px="12px" bg={fieldBg}>
              <Icon as={MdSearch} color={mutedColor} me="8px" />
              <Input
                value={filters.q}
                onChange={(event) => setFilter('q', event.target.value)}
                placeholder="Klient, projekt, adres, PPE..."
                border="0"
                bg="transparent"
                color={textColor}
                _focus={{ boxShadow: 'none' }}
              />
            </Flex>
          </FormControl>
          <FormControl>
            <FormLabel color={textColor} fontWeight="700">Widok</FormLabel>
            <Select value={filters.scope} onChange={(event) => setFilter('scope', event.target.value)} bg={fieldBg} color={textColor}>
              {scopeOptions.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <FormLabel color={textColor} fontWeight="700">Status</FormLabel>
            <Select value={filters.status} onChange={(event) => setFilter('status', event.target.value)} bg={fieldBg} color={textColor}>
              <option value="">Wszystkie</option>
              {statusOptions.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <FormLabel color={textColor} fontWeight="700">Ekipa / osoba</FormLabel>
            <Select value={filters.teamLeadId} onChange={(event) => setFilter('teamLeadId', event.target.value)} bg={fieldBg} color={textColor}>
              <option value="">Wszyscy</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </Select>
          </FormControl>
        </SimpleGrid>
      </Card>

      <Card p="0" overflowX="auto">
        <Table variant="simple">
          <Thead>
            <Tr>
              <Th>Klient / projekt</Th>
              <Th>Termin</Th>
              <Th>Ekipa</Th>
              <Th>Zakres</Th>
              <Th>Status</Th>
              <Th>Kompletność</Th>
              <Th textAlign="right">Akcje</Th>
            </Tr>
          </Thead>
          <Tbody>
            {installations.length === 0 ? (
              <Tr>
                <Td colSpan={7}>
                  <Text color={mutedColor} py="30px" textAlign="center">
                    Brak montaży dla wybranych filtrów.
                  </Text>
                </Td>
              </Tr>
            ) : installations.map((installation) => (
              <Tr key={installation.id} _hover={{ bg: rowHover }}>
                <Td minW="280px">
                  <Flex direction="column" gap="4px">
                    <Link href={`/admin/clients/${installation.project.client.id}`}>
                      <Text color="brand.300" fontWeight="800">
                        {installation.project.client.displayName}
                      </Text>
                    </Link>
                    <Text color={textColor} fontWeight="800" cursor="pointer" onClick={() => openInstallation(installation)}>
                      {installation.project.title}
                    </Text>
                    <Text color={mutedColor} fontSize="xs" noOfLines={1}>
                      {installation.address || projectAddress(installation.project) || 'Bez adresu'}
                    </Text>
                  </Flex>
                </Td>
                <Td minW="170px">
                  <Text color={textColor} fontWeight="800">{formatDateTime(installation.plannedAt)}</Text>
                  {installation.plannedEndAt ? (
                    <Text color={mutedColor} fontSize="xs">do {formatDateTime(installation.plannedEndAt)}</Text>
                  ) : null}
                </Td>
                <Td minW="190px">
                  <Text color={textColor} fontWeight="800">
                    {installation.teamLead?.name || 'Bez kierownika'}
                  </Text>
                  <Text color={mutedColor} fontSize="xs">
                    {installation.teamMembers.length ? `${installation.teamMembers.length} osób w ekipie` : 'Nieprzypisane'}
                  </Text>
                </Td>
                <Td minW="220px">
                  <Text color={textColor} fontWeight="800" noOfLines={1}>
                    {installation.configuration?.name || installation.offer?.number || 'Zakres ręczny'}
                  </Text>
                  <Text color={mutedColor} fontSize="xs">
                    {installation.progress.plannedItems} pozycji · {installation.progress.installedDevices} urządzeń
                  </Text>
                </Td>
                <Td>
                  <Badge colorScheme={statusColor(installation.status)}>{labelFor(statusOptions, installation.status)}</Badge>
                </Td>
                <Td minW="180px">
                  <Flex direction="column" gap="6px">
                    <Text color={textColor} fontWeight="800">
                      {installation.progress.checklistDone}/{installation.progress.checklistTotal || 0} checklisty
                    </Text>
                    <Progress value={installation.progress.checklistTotal ? (installation.progress.checklistDone / installation.progress.checklistTotal) * 100 : 0} size="sm" colorScheme="green" borderRadius="999px" />
                  </Flex>
                </Td>
                <Td textAlign="right" minW="250px">
                  <Flex justify="flex-end" gap="8px" flexWrap="wrap">
                    {installation.status === 'PLANNED' || installation.status === 'CONFIRMED' ? (
                      <Button size="sm" leftIcon={<Icon as={MdPlayArrow} />} onClick={() => updateInstallationStatus(installation, 'IN_PROGRESS')} isDisabled={saving}>
                        Start
                      </Button>
                    ) : null}
                    {installation.status !== 'COMPLETED' ? (
                      <Button size="sm" colorScheme="green" leftIcon={<Icon as={MdCheckCircle} />} onClick={() => updateInstallationStatus(installation, 'COMPLETED')} isDisabled={saving}>
                        Zakończ
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" rightIcon={<Icon as={MdOpenInNew} />} onClick={() => openInstallation(installation)}>
                      Otwórz
                    </Button>
                  </Flex>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>

      <Modal isOpen={isOpen} onClose={closeModal} size="6xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent bg={modalBg} borderRadius="18px">
          <ModalHeader color={textColor}>
            {selectedInstallation ? 'Montaż' : 'Nowy montaż'}
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {formError ? (
              <Alert status="error" borderRadius="12px" mb="16px">
                <AlertIcon />
                {formError}
              </Alert>
            ) : null}

            <SimpleGrid columns={{ base: 1, xl: 2 }} gap="18px" alignItems="start">
              <Flex direction="column" gap="16px">
                <Card p="18px">
                  <Text color={textColor} fontSize="lg" fontWeight="900" mb="14px">
                    Podstawy
                  </Text>
                  <SimpleGrid columns={{ base: 1, md: 2 }} gap="14px">
                    <FormControl gridColumn={{ base: 'auto', md: '1 / -1' }} isRequired>
                      <FormLabel color={textColor} fontWeight="700">Projekt</FormLabel>
                      <SearchablePicker
                        value={form.projectId}
                        placeholder="Wybierz projekt z konfiguracją"
                        searchPlaceholder="Szukaj klienta lub projektu..."
                        isDisabled={Boolean(form.id)}
                        options={projects.map((project) => ({
                          value: project.id,
                          label: project.title,
                          meta: `${project.client.displayName} · ${project.offers.some((offer) => offer.status === 'ACCEPTED') ? 'zaakceptowana oferta' : 'konfiguracja'}`,
                        }))}
                        onChange={(value) => updateForm('projectId', value)}
                      />
                    </FormControl>
                    <FormControl>
                      <FormLabel color={textColor} fontWeight="700">Oferta źródłowa</FormLabel>
                      <Select value={form.offerId} onChange={(event) => updateForm('offerId', event.target.value)} bg={fieldBg} color={textColor} isDisabled={Boolean(form.id) || !selectedProject}>
                        <option value="">Bez oferty</option>
                        {selectedProject?.offers.map((offer) => (
                          <option key={offer.id} value={offer.id}>
                            {offer.number || offer.title || offer.id} {offer.status === 'ACCEPTED' ? '(zaakceptowana)' : ''}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl>
                      <FormLabel color={textColor} fontWeight="700">Konfiguracja</FormLabel>
                      <Select value={form.configurationId} onChange={(event) => updateForm('configurationId', event.target.value)} bg={fieldBg} color={textColor} isDisabled={Boolean(form.id) || !selectedProject}>
                        <option value="">Bez konfiguracji</option>
                        {selectedProject?.configurations.map((configuration) => (
                          <option key={configuration.id} value={configuration.id}>
                            {configuration.name}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl>
                      <FormLabel color={textColor} fontWeight="700">Status</FormLabel>
                      <Select value={form.status} onChange={(event) => updateForm('status', event.target.value)} bg={fieldBg} color={textColor}>
                        {statusOptions.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl>
                      <FormLabel color={textColor} fontWeight="700">Termin start</FormLabel>
                      <Input type="datetime-local" value={form.plannedAt} onChange={(event) => updateForm('plannedAt', event.target.value)} bg={fieldBg} color={textColor} />
                    </FormControl>
                    <FormControl>
                      <FormLabel color={textColor} fontWeight="700">Termin koniec</FormLabel>
                      <Input type="datetime-local" value={form.plannedEndAt} onChange={(event) => updateForm('plannedEndAt', event.target.value)} bg={fieldBg} color={textColor} />
                    </FormControl>
                    <FormControl>
                      <FormLabel color={textColor} fontWeight="700">Kierownik ekipy</FormLabel>
                      <Select value={form.teamLeadId} onChange={(event) => updateForm('teamLeadId', event.target.value)} bg={fieldBg} color={textColor}>
                        <option value="">Bez kierownika</option>
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>{user.name}</option>
                        ))}
                      </Select>
                    </FormControl>
                    {!form.id ? (
                      <FormControl display="flex" alignItems="center" gap="10px" pt={{ md: '34px' }}>
                        <Checkbox isChecked={form.createTasks} onChange={(event) => updateForm('createTasks', event.target.checked)}>
                          <Text color={textColor} fontWeight="700">Utwórz zadania dla ekipy</Text>
                        </Checkbox>
                      </FormControl>
                    ) : null}
                  </SimpleGrid>
                </Card>

                <Card p="18px">
                  <Text color={textColor} fontSize="lg" fontWeight="900" mb="14px">
                    Kontakt i miejsce
                  </Text>
                  <SimpleGrid columns={{ base: 1, md: 2 }} gap="14px">
                    <FormControl gridColumn={{ base: 'auto', md: '1 / -1' }}>
                      <FormLabel color={textColor} fontWeight="700">Adres montażu</FormLabel>
                      <Input value={form.address} onChange={(event) => updateForm('address', event.target.value)} bg={fieldBg} color={textColor} />
                    </FormControl>
                    <FormControl>
                      <FormLabel color={textColor} fontWeight="700">Kontakt na miejscu</FormLabel>
                      <Input value={form.contactName} onChange={(event) => updateForm('contactName', event.target.value)} bg={fieldBg} color={textColor} />
                    </FormControl>
                    <FormControl>
                      <FormLabel color={textColor} fontWeight="700">Telefon</FormLabel>
                      <Input value={form.contactPhone} onChange={(event) => updateForm('contactPhone', event.target.value)} bg={fieldBg} color={textColor} />
                    </FormControl>
                    <FormControl gridColumn={{ base: 'auto', md: '1 / -1' }}>
                      <FormLabel color={textColor} fontWeight="700">Uwagi dla ekipy</FormLabel>
                      <Textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} bg={fieldBg} color={textColor} rows={3} />
                    </FormControl>
                    <FormControl gridColumn={{ base: 'auto', md: '1 / -1' }}>
                      <FormLabel color={textColor} fontWeight="700">Notatki wewnętrzne</FormLabel>
                      <Textarea value={form.internalNotes} onChange={(event) => updateForm('internalNotes', event.target.value)} bg={fieldBg} color={textColor} rows={3} />
                    </FormControl>
                  </SimpleGrid>
                </Card>

                <Card p="18px">
                  <Text color={textColor} fontSize="lg" fontWeight="900" mb="14px">
                    Ekipa
                  </Text>
                  <SimpleGrid columns={{ base: 1, md: 2 }} gap="10px">
                    {users.map((user) => (
                      <Checkbox
                        key={user.id}
                        isChecked={form.teamMemberIds.includes(user.id)}
                        onChange={(event) => toggleTeamMember(user.id, event.target.checked)}
                      >
                        <Flex direction="column">
                          <Text color={textColor} fontWeight="800">{user.name}</Text>
                          <Text color={mutedColor} fontSize="xs">{user.positionTitle || user.email}</Text>
                        </Flex>
                      </Checkbox>
                    ))}
                  </SimpleGrid>
                </Card>
              </Flex>

              <Flex direction="column" gap="16px">
                {selectedInstallation ? (
                  <>
                    <Card p="18px">
                      <Flex justify="space-between" align="center" gap="12px" mb="12px">
                        <Box>
                          <Text color={textColor} fontSize="lg" fontWeight="900">Checklista</Text>
                          <Text color={mutedColor} fontSize="sm">
                            {selectedInstallation.progress.checklistDone}/{selectedInstallation.progress.checklistTotal} wykonane
                          </Text>
                        </Box>
                        <Badge colorScheme={checklistProgress === 100 ? 'green' : 'blue'} borderRadius="8px" px="10px" py="6px">
                          {checklistProgress}%
                        </Badge>
                      </Flex>
                      <Progress value={checklistProgress} size="sm" colorScheme="green" borderRadius="999px" mb="14px" />
                      <Flex direction="column" gap="10px">
                        {selectedInstallation.checklistItems.map((item) => (
                          <Flex key={item.id} gap="10px" align="flex-start" border="1px solid" borderColor={borderColor} borderRadius="8px" p="10px">
                            <Checkbox isChecked={item.completed} onChange={(event) => toggleChecklist(item, event.target.checked)} isDisabled={saving} mt="2px" />
                            <Box flex="1">
                              <Text color={textColor} fontWeight="800">{item.title}</Text>
                              {item.completedAt ? (
                                <Text color={mutedColor} fontSize="xs">{formatDateTime(item.completedAt)}</Text>
                              ) : null}
                            </Box>
                          </Flex>
                        ))}
                      </Flex>
                    </Card>

                    <Card p="18px">
                      <Flex justify="space-between" align="center" gap="12px" mb="12px">
                        <Box>
                          <Text color={textColor} fontSize="lg" fontWeight="900">Planowane pozycje</Text>
                          <Text color={mutedColor} fontSize="sm">
                            Źródło: {selectedInstallation.configuration?.name || selectedInstallation.offer?.number || 'zakres ręczny'}
                          </Text>
                        </Box>
                        {selectedInstallation.offer ? (
                          <Button as="a" href={`/offer-print/${selectedInstallation.offer.id}`} target="_blank" size="sm" rightIcon={<Icon as={MdOpenInNew} />} variant="outline">
                            Oferta
                          </Button>
                        ) : null}
                      </Flex>
                      <Flex direction="column" gap="8px">
                        {selectedInstallation.plannedItems.length === 0 ? (
                          <Text color={mutedColor}>Brak pozycji planowanych.</Text>
                        ) : selectedInstallation.plannedItems.map((item) => (
                          <Flex key={item.id} border="1px solid" borderColor={borderColor} borderRadius="8px" p="10px" gap="10px" justify="space-between" align="center">
                            <Box minW="0">
                              <Text color={textColor} fontWeight="900" noOfLines={1}>
                                {item.position}. {item.name}
                              </Text>
                              <Text color={mutedColor} fontSize="xs">
                                {formatQuantity(item.quantity)} szt. · {supplyModeLabel(item.supplyMode)} · {item.product?.sku || item.product?.producer || 'bez SKU'}
                              </Text>
                            </Box>
                            <Button size="sm" leftIcon={<Icon as={MdOutlineInventory2} />} onClick={() => startAddDevice(item)}>
                              Nr seryjny
                            </Button>
                          </Flex>
                        ))}
                      </Flex>
                    </Card>

                    <Card p="18px">
                      <Flex justify="space-between" align="center" gap="12px" mb="12px">
                        <Box>
                          <Text color={textColor} fontSize="lg" fontWeight="900">Zamontowane urządzenia</Text>
                          <Text color={mutedColor} fontSize="sm">{selectedInstallation.installedDevices.length} rekordów</Text>
                        </Box>
                        <Button size="sm" leftIcon={<Icon as={MdAdd} />} onClick={() => startAddDevice()}>
                          Dodaj ręcznie
                        </Button>
                      </Flex>
                      {deviceForm.name || deviceForm.plannedItemId ? (
                        <Box border="1px solid" borderColor={borderColor} borderRadius="8px" p="12px" mb="14px">
                          <SimpleGrid columns={{ base: 1, md: 2 }} gap="10px">
                            <FormControl>
                              <FormLabel color={textColor} fontWeight="700">Nazwa</FormLabel>
                              <Input value={deviceForm.name} onChange={(event) => setDeviceForm((current) => ({ ...current, name: event.target.value }))} bg={fieldBg} color={textColor} />
                            </FormControl>
                            <FormControl>
                              <FormLabel color={textColor} fontWeight="700">Numer seryjny</FormLabel>
                              <Input value={deviceForm.serialNumber} onChange={(event) => setDeviceForm((current) => ({ ...current, serialNumber: event.target.value }))} bg={fieldBg} color={textColor} />
                            </FormControl>
                            <FormControl>
                              <FormLabel color={textColor} fontWeight="700">Data montażu</FormLabel>
                              <Input type="datetime-local" value={deviceForm.installedAt} onChange={(event) => setDeviceForm((current) => ({ ...current, installedAt: event.target.value }))} bg={fieldBg} color={textColor} />
                            </FormControl>
                            <FormControl>
                              <FormLabel color={textColor} fontWeight="700">Uwagi</FormLabel>
                              <Input value={deviceForm.notes} onChange={(event) => setDeviceForm((current) => ({ ...current, notes: event.target.value }))} bg={fieldBg} color={textColor} />
                            </FormControl>
                          </SimpleGrid>
                          <Flex justify="flex-end" gap="8px" mt="12px">
                            <IconButton aria-label="Anuluj urządzenie" icon={<Icon as={MdClose} />} variant="outline" onClick={() => setDeviceForm(emptyDeviceForm)} />
                            <Button leftIcon={<Icon as={MdSave} />} colorScheme="green" onClick={addInstalledDevice} isLoading={saving}>
                              Zapisz urządzenie
                            </Button>
                          </Flex>
                        </Box>
                      ) : null}

                      <Flex direction="column" gap="8px">
                        {selectedInstallation.installedDevices.length === 0 ? (
                          <Text color={mutedColor}>Po montażu dopisz numery seryjne i realnie zamontowane urządzenia.</Text>
                        ) : selectedInstallation.installedDevices.map((device) => (
                          <Flex key={device.id} border="1px solid" borderColor={borderColor} borderRadius="8px" p="10px" justify="space-between" gap="10px">
                            <Box>
                              <Text color={textColor} fontWeight="900">{device.name}</Text>
                              <Text color={mutedColor} fontSize="xs">
                                {device.plannedItem?.name || device.product?.sku || 'pozycja ręczna'}
                              </Text>
                            </Box>
                            <Box textAlign="right">
                              <Text color={textColor} fontWeight="900">{device.serialNumber || '-'}</Text>
                              <Text color={mutedColor} fontSize="xs">{formatDateTime(device.installedAt)}</Text>
                            </Box>
                          </Flex>
                        ))}
                      </Flex>
                    </Card>

                    <Card p="18px">
                      <Text color={textColor} fontSize="lg" fontWeight="900" mb="12px">Zdjęcia i protokoły</Text>
                      <SimpleGrid columns={{ base: 1, md: 2 }} gap="10px" mb="12px">
                        <FormControl>
                          <FormLabel color={textColor} fontWeight="700">Typ dokumentu</FormLabel>
                          <Select value={uploadForm.type} onChange={(event) => setUploadForm((current) => ({ ...current, type: event.target.value }))} bg={fieldBg} color={textColor}>
                            {documentTypeOptions.map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </Select>
                        </FormControl>
                        <FormControl>
                          <FormLabel color={textColor} fontWeight="700">Tytuł</FormLabel>
                          <Input value={uploadForm.title} onChange={(event) => setUploadForm((current) => ({ ...current, title: event.target.value }))} bg={fieldBg} color={textColor} placeholder="np. Protokół odbioru" />
                        </FormControl>
                        <FormControl gridColumn={{ base: 'auto', md: '1 / -1' }}>
                          <FormLabel color={textColor} fontWeight="700">Plik</FormLabel>
                          <Input
                            type="file"
                            onChange={(event) => setUploadForm((current) => ({ ...current, file: event.target.files?.[0] || null }))}
                            bg={fieldBg}
                            color={textColor}
                          />
                        </FormControl>
                      </SimpleGrid>
                      <Button leftIcon={<Icon as={MdUploadFile} />} onClick={uploadDocument} isDisabled={!uploadForm.file} isLoading={saving}>
                        Dodaj dokument
                      </Button>
                      <Divider my="14px" />
                      <Flex direction="column" gap="8px">
                        {selectedInstallation.documents.length === 0 ? (
                          <Text color={mutedColor}>Brak dokumentów przy montażu.</Text>
                        ) : selectedInstallation.documents.map((document) => (
                          <Flex key={document.id} justify="space-between" gap="10px" border="1px solid" borderColor={borderColor} borderRadius="8px" p="10px">
                            <Box minW="0">
                              <Text color={textColor} fontWeight="900" noOfLines={1}>{document.title}</Text>
                              <Text color={mutedColor} fontSize="xs">{labelFor(documentTypeOptions, document.type)} · {document.fileName}</Text>
                            </Box>
                            <Icon as={document.type === 'ZDJECIE_MONTAZU' ? MdPhotoCamera : MdUploadFile} color="brand.300" boxSize="22px" />
                          </Flex>
                        ))}
                      </Flex>
                    </Card>

                    <Card p="18px">
                      <Text color={textColor} fontSize="lg" fontWeight="900" mb="12px">Zadania montażowe</Text>
                      <Flex direction="column" gap="8px">
                        {selectedInstallation.tasks.length === 0 ? (
                          <Text color={mutedColor}>Brak zadań przypiętych do tego montażu.</Text>
                        ) : selectedInstallation.tasks.map((task) => (
                          <Flex key={task.id} justify="space-between" gap="10px" border="1px solid" borderColor={borderColor} borderRadius="8px" p="10px">
                            <Box minW="0">
                              <Link href={`/admin/tasks?taskId=${task.id}&installationId=${selectedInstallation.id}`}>
                                <Text color="brand.300" fontWeight="900" noOfLines={1}>{task.title}</Text>
                              </Link>
                              <Text color={mutedColor} fontSize="xs">{task.assignedTo?.name || 'Nieprzypisane'} · {formatDateTime(task.dueAt)}</Text>
                            </Box>
                            <Badge colorScheme={task.status === 'DONE' ? 'green' : task.status === 'IN_PROGRESS' ? 'blue' : 'purple'}>
                              {task.status}
                            </Badge>
                          </Flex>
                        ))}
                      </Flex>
                    </Card>
                  </>
                ) : (
                  <Card p="18px">
                    <Text color={textColor} fontSize="lg" fontWeight="900" mb="10px">
                      Co powstanie po zapisaniu?
                    </Text>
                    <Flex direction="column" gap="10px" color={mutedColor}>
                      <Text>• montaż powiązany z projektem, ofertą i konfiguracją,</Text>
                      <Text>• planowane pozycje skopiowane z konfiguracji/oferty,</Text>
                      <Text>• checklista realizacyjna,</Text>
                      <Text>• zadania dla wybranej ekipy, jeśli opcja jest zaznaczona.</Text>
                    </Flex>
                    {selectedProject ? (
                      <Box mt="16px" border="1px solid" borderColor={borderColor} borderRadius="8px" p="12px">
                        <Text color={textColor} fontWeight="900">{selectedProject.client.displayName}</Text>
                        <Text color={mutedColor}>{selectedProject.title}</Text>
                        <Text color={mutedColor} fontSize="sm">
                          Oferta: {selectedOffer?.number || selectedOffer?.title || 'brak'} · Konfiguracja: {selectedConfiguration?.name || 'brak'}
                        </Text>
                      </Box>
                    ) : null}
                  </Card>
                )}
              </Flex>
            </SimpleGrid>
          </ModalBody>
          <ModalFooter gap="10px">
            <Button variant="outline" onClick={closeModal} leftIcon={<Icon as={MdClose} />}>
              Zamknij
            </Button>
            <Button variant="brand" onClick={saveInstallation} isLoading={saving} leftIcon={<Icon as={MdSave} />}>
              Zapisz montaż
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}

function Metric({
  title,
  value,
  icon,
  active,
  alert,
  onClick,
}: {
  title: string;
  value: number;
  icon: any;
  active?: boolean;
  alert?: boolean;
  onClick: () => void;
}) {
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  return (
    <Card
      as="button"
      type="button"
      p="16px"
      textAlign="left"
      border="1px solid"
      borderColor={active ? 'brand.400' : alert ? 'red.400' : 'transparent'}
      onClick={onClick}
    >
      <Flex align="center" gap="10px" mb="10px">
        <Icon as={icon} color={alert ? 'red.300' : active ? 'brand.300' : mutedColor} boxSize="20px" />
        <Text color={mutedColor} fontSize="sm" fontWeight="800" noOfLines={1}>
          {title}
        </Text>
      </Flex>
      <Text color={textColor} fontSize="2xl" fontWeight="900">
        {value}
      </Text>
    </Card>
  );
}

function SearchablePicker({
  value,
  options,
  placeholder,
  searchPlaceholder,
  isDisabled,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string; meta?: string }>;
  placeholder: string;
  searchPlaceholder: string;
  isDisabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const fieldBg = useColorModeValue('white', 'rgba(17, 27, 66, 0.72)');
  const menuBg = useColorModeValue('white', 'navy.800');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const selected = options.find((option) => option.value === value);
  const normalizedQuery = normalizeSearch(query);
  const visibleOptions = normalizedQuery
    ? options.filter((option) => normalizeSearch(`${option.label} ${option.meta || ''}`).includes(normalizedQuery))
    : options;

  return (
    <Menu matchWidth closeOnSelect>
      <MenuButton
        as={Button}
        w="100%"
        rightIcon={<Icon as={MdKeyboardArrowDown} />}
        bg={fieldBg}
        border="1px solid"
        borderColor={borderColor}
        color={selected ? textColor : mutedColor}
        fontWeight="800"
        textAlign="left"
        justifyContent="space-between"
        isDisabled={isDisabled}
      >
        <Text as="span" noOfLines={1}>
          {selected?.label || placeholder}
        </Text>
      </MenuButton>
      <MenuList bg={menuBg} borderColor={borderColor} maxH="360px" overflowY="auto" zIndex={2000} p="8px">
        <Box px="4px" pb="8px">
          <Flex align="center" border="1px solid" borderColor={borderColor} borderRadius="10px" px="10px" bg={fieldBg}>
            <Icon as={MdSearch} color={mutedColor} me="6px" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              border="0"
              bg="transparent"
              color={textColor}
              _focus={{ boxShadow: 'none' }}
            />
            {query ? (
              <IconButton aria-label="Wyczyść" size="sm" icon={<Icon as={MdDelete} />} variant="ghost" onClick={() => setQuery('')} />
            ) : null}
          </Flex>
        </Box>
        {visibleOptions.length === 0 ? (
          <Box px="10px" py="8px">
            <Text color={mutedColor} fontSize="sm">Brak wyników.</Text>
          </Box>
        ) : visibleOptions.map((option) => (
          <MenuItem key={option.value} bg="transparent" borderRadius="8px" onClick={() => onChange(option.value)}>
            <Flex direction="column" align="flex-start">
              <Text color={textColor} fontWeight="800">{option.label}</Text>
              {option.meta ? <Text color={mutedColor} fontSize="xs">{option.meta}</Text> : null}
            </Flex>
          </MenuItem>
        ))}
      </MenuList>
    </Menu>
  );
}
