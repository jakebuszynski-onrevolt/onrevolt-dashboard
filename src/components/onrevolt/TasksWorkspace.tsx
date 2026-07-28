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
  Input,
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
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  MdAdd,
  MdAssignmentInd,
  MdCheckCircle,
  MdComment,
  MdDoneAll,
  MdKeyboardArrowDown,
  MdOpenInNew,
  MdPlayArrow,
  MdRefresh,
  MdSearch,
  MdDelete,
  MdToday,
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

type ClientOption = {
  id: string;
  displayName: string;
  clientType: string;
};

type ProjectOption = {
  id: string;
  clientId: string;
  title: string;
  status: string;
};

type TaskComment = {
  id: string;
  body: string;
  createdAt: string;
  author?: StaffOption | null;
};

type TaskItem = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueAt?: string | null;
  completedAt?: string | null;
  clientId?: string | null;
  projectId?: string | null;
  assignedToId?: string | null;
  createdById?: string | null;
  client?: ClientOption | null;
  project?: ProjectOption | null;
  assignedTo?: StaffOption | null;
  createdBy?: StaffOption | null;
  comments: TaskComment[];
  commentsCount: number;
  remindersCount: number;
  createdAt: string;
  updatedAt: string;
};

type TaskStats = {
  total: number;
  open: number;
  inProgress: number;
  today: number;
  overdue: number;
  done: number;
};

type FiltersState = {
  q: string;
  scope: string;
  status: string;
  priority: string;
  assignedToId: string;
  clientId: string;
  projectId: string;
};

type TaskFormState = {
  id?: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueAt: string;
  assignedToId: string;
  clientId: string;
  projectId: string;
};

const emptyStats: TaskStats = {
  total: 0,
  open: 0,
  inProgress: 0,
  today: 0,
  overdue: 0,
  done: 0,
};

const emptyFilters: FiltersState = {
  q: '',
  scope: 'all',
  status: '',
  priority: '',
  assignedToId: '',
  clientId: '',
  projectId: '',
};

const emptyForm: TaskFormState = {
  title: '',
  description: '',
  status: 'OPEN',
  priority: 'NORMAL',
  dueAt: '',
  assignedToId: '',
  clientId: '',
  projectId: '',
};

const statusOptions = [
  ['OPEN', 'Nowe'],
  ['IN_PROGRESS', 'W trakcie'],
  ['DONE', 'Zrobione'],
  ['CANCELLED', 'Anulowane'],
] as const;

const priorityOptions = [
  ['LOW', 'Niski'],
  ['NORMAL', 'Normalny'],
  ['HIGH', 'Wysoki'],
  ['URGENT', 'Pilne'],
] as const;

const scopeOptions = [
  ['all', 'Wszystkie widoczne'],
  ['mine', 'Moje'],
  ['assigned', 'Przypisane do mnie'],
  ['created', 'Utworzone przeze mnie'],
  ['new', 'Nowe'],
  ['in_progress', 'W trakcie'],
  ['today', 'Na dziś'],
  ['overdue', 'Zaległe'],
  ['done', 'Zrobione'],
  ['cancelled', 'Anulowane'],
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
  if (status === 'DONE') return 'green';
  if (status === 'IN_PROGRESS') return 'blue';
  if (status === 'CANCELLED') return 'gray';
  return 'purple';
}

function priorityColor(priority: string) {
  if (priority === 'URGENT') return 'red';
  if (priority === 'HIGH') return 'orange';
  if (priority === 'LOW') return 'gray';
  return 'blue';
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

function isOverdue(task: TaskItem) {
  if (!task.dueAt || task.status === 'DONE' || task.status === 'CANCELLED') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(task.dueAt).getTime() < today.getTime();
}

function isToday(task: TaskItem) {
  if (!task.dueAt || task.status === 'DONE' || task.status === 'CANCELLED') return false;
  const date = new Date(task.dueAt);
  const today = new Date();
  return date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
}

function updateUrl(filters: FiltersState) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  const url = query ? `/admin/tasks?${query}` : '/admin/tasks';
  window.history.replaceState(null, '', url);
}

export default function TasksWorkspace() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [stats, setStats] = useState<TaskStats>(emptyStats);
  const [users, setUsers] = useState<StaffOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [currentUser, setCurrentUser] = useState<StaffOption | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filters, setFilters] = useState<FiltersState>(emptyFilters);
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [form, setForm] = useState<TaskFormState>(emptyForm);
  const [commentText, setCommentText] = useState('');
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

  const projectOptions = useMemo(() => {
    if (!form.clientId) return projects;
    return projects.filter((project) => project.clientId === form.clientId);
  }, [form.clientId, projects]);

  const canManageSelected = selectedTask
    ? isAdmin || selectedTask.createdById === currentUser?.id
    : true;

  async function loadTasks(nextFilters = filters) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const searchParams = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
      const taskId = searchParams.get('taskId') || '';
      const createRequested = searchParams.get('create') === '1';
      if (taskId) params.set('taskId', taskId);

      const response = await fetch(`/api/tasks?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);

      const data = payload.data;
      setTasks(data.tasks || []);
      setStats(data.stats || emptyStats);
      setUsers(data.meta?.users || []);
      setClients(data.meta?.clients || []);
      setProjects(data.meta?.projects || []);
      setCurrentUser(data.currentUser);
      setIsAdmin(Boolean(data.isAdmin));

      const openedTask = data.selectedTask || (taskId ? (data.tasks || []).find((task: TaskItem) => task.id === taskId) : null);
      if (openedTask) openTask(openedTask);
      if (createRequested && !openedTask) {
        setSelectedTask(null);
        setForm({
          ...emptyForm,
          clientId: searchParams.get('clientId') || nextFilters.clientId || '',
          projectId: searchParams.get('projectId') || nextFilters.projectId || '',
        });
        setCommentText('');
        setFormError('');
        onOpen();
      }
      if (selectedTask) {
        const fresh = (data.tasks || []).find((task: TaskItem) => task.id === selectedTask.id) || data.selectedTask;
        if (fresh) {
          setSelectedTask(fresh);
          setForm(taskToForm(fresh));
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
      priority: params.get('priority') || '',
      assignedToId: params.get('assignedToId') || '',
      clientId: params.get('clientId') || '',
      projectId: params.get('projectId') || '',
    };
    setFilters(initialFilters);
    loadTasks(initialFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      updateUrl(filters);
      loadTasks(filters);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.scope, filters.status, filters.priority, filters.assignedToId]);

  function setFilter(key: keyof FiltersState, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function updateForm(key: keyof TaskFormState, value: string) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'projectId') {
        const project = projects.find((item) => item.id === value);
        if (project) next.clientId = project.clientId;
      }
      if (key === 'clientId' && current.projectId) {
        const project = projects.find((item) => item.id === current.projectId);
        if (project && project.clientId !== value) next.projectId = '';
      }
      return next;
    });
  }

  function taskToForm(task: TaskItem): TaskFormState {
    return {
      id: task.id,
      title: task.title || '',
      description: task.description || '',
      status: task.status || 'OPEN',
      priority: task.priority || 'NORMAL',
      dueAt: toLocalInputValue(task.dueAt),
      assignedToId: task.assignedToId || '',
      clientId: task.clientId || task.client?.id || '',
      projectId: task.projectId || task.project?.id || '',
    };
  }

  function openCreateTask() {
    setSelectedTask(null);
    setForm({
      ...emptyForm,
      clientId: filters.clientId,
      projectId: filters.projectId,
    });
    setCommentText('');
    setFormError('');
    onOpen();
  }

  function openTask(task: TaskItem) {
    setSelectedTask(task);
    setForm(taskToForm(task));
    setCommentText('');
    setFormError('');
    onOpen();
  }

  function closeModal() {
    onClose();
    setFormError('');
    setCommentText('');
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      params.delete('taskId');
      params.delete('create');
      const query = params.toString();
      window.history.replaceState(null, '', query ? `/admin/tasks?${query}` : '/admin/tasks');
    }
  }

  async function saveTask() {
    setSaving(true);
    setFormError('');
    try {
      const body = {
        id: form.id,
        title: form.title,
        description: form.description,
        status: form.status,
        priority: form.priority,
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
        assignedToId: form.assignedToId || null,
        clientId: form.clientId || null,
        projectId: form.projectId || null,
      };
      const response = await fetch('/api/tasks', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      window.dispatchEvent(new Event('onrevolt:notifications-updated'));
      setSelectedTask(payload.data);
      setForm(taskToForm(payload.data));
      await loadTasks();
      if (!form.id) closeModal();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function updateTaskStatus(task: TaskItem, status: string) {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, status }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteTask() {
    if (!selectedTask) return;
    if (!window.confirm(`Usunąć zadanie „${selectedTask.title}”? Tej operacji nie można cofnąć.`)) return;

    setSaving(true);
    setFormError('');
    try {
      const response = await fetch('/api/tasks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedTask.id }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      closeModal();
      window.dispatchEvent(new Event('onrevolt:notifications-updated'));
      await loadTasks();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function addComment() {
    if (!selectedTask || !commentText.trim()) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await fetch('/api/tasks/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: selectedTask.id, body: commentText }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setCommentText('');
      window.dispatchEvent(new Event('onrevolt:notifications-updated'));
      await loadTasks();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function metricClick(scope: string) {
    setFilters((current) => ({ ...current, scope }));
  }

  return (
    <Box pt={{ base: '120px', md: '95px' }}>
      <Flex align={{ base: 'flex-start', md: 'center' }} justify="space-between" gap="16px" flexWrap="wrap" mb="20px">
        <Box>
          <Text color={textColor} fontSize={{ base: '28px', md: '34px' }} fontWeight="800">
            Zadania
          </Text>
          <Text color={mutedColor} fontSize="sm">
            Kontrola pracy zespołu, terminy, komentarze i powiadomienia panelowe.
          </Text>
        </Box>
        <Flex gap="10px" flexWrap="wrap">
          <Button leftIcon={<Icon as={MdRefresh} />} variant="outline" onClick={() => loadTasks()} isLoading={loading}>
            Odśwież
          </Button>
          <Button leftIcon={<Icon as={MdAdd} />} variant="brand" onClick={openCreateTask}>
            Nowe zadanie
          </Button>
        </Flex>
      </Flex>

      {error ? (
        <Alert status="error" borderRadius="12px" mb="18px">
          <AlertIcon />
          {error}
        </Alert>
      ) : null}

      <SimpleGrid columns={{ base: 1, md: 3, xl: 6 }} gap="14px" mb="18px">
        <Metric title="Wszystkie" value={stats.total} icon={MdAssignmentInd} active={filters.scope === 'all'} onClick={() => metricClick('all')} />
        <Metric title="Nowe" value={stats.open} icon={MdAdd} active={filters.scope === 'new'} onClick={() => metricClick('new')} />
        <Metric title="W trakcie" value={stats.inProgress} icon={MdPlayArrow} active={filters.scope === 'in_progress'} onClick={() => metricClick('in_progress')} />
        <Metric title="Na dziś" value={stats.today} icon={MdToday} active={filters.scope === 'today'} onClick={() => metricClick('today')} />
        <Metric title="Zaległe" value={stats.overdue} icon={MdWarning} active={filters.scope === 'overdue'} alert={stats.overdue > 0} onClick={() => metricClick('overdue')} />
        <Metric title="Zrobione" value={stats.done} icon={MdDoneAll} active={filters.scope === 'done'} onClick={() => metricClick('done')} />
      </SimpleGrid>

      <Card p="18px" mb="18px">
        <SimpleGrid columns={{ base: 1, md: 2, xl: isAdmin ? 5 : 4 }} gap="12px">
          <FormControl>
            <FormLabel color={textColor} fontWeight="700">
              Szukaj
            </FormLabel>
            <Flex align="center" border="1px solid" borderColor={borderColor} borderRadius="12px" px="12px" bg={fieldBg}>
              <Icon as={MdSearch} color={mutedColor} me="8px" />
              <Input
                value={filters.q}
                onChange={(event) => setFilter('q', event.target.value)}
                placeholder="Klient, opis, osoba..."
                border="0"
                bg="transparent"
                color={textColor}
                _focus={{ boxShadow: 'none' }}
              />
            </Flex>
          </FormControl>
          <FormControl>
            <FormLabel color={textColor} fontWeight="700">
              Widok
            </FormLabel>
            <Select value={filters.scope} onChange={(event) => setFilter('scope', event.target.value)} bg={fieldBg}>
              {scopeOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <FormLabel color={textColor} fontWeight="700">
              Status
            </FormLabel>
            <Select value={filters.status} onChange={(event) => setFilter('status', event.target.value)} bg={fieldBg}>
              <option value="">Wszystkie</option>
              {statusOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <FormLabel color={textColor} fontWeight="700">
              Priorytet
            </FormLabel>
            <Select value={filters.priority} onChange={(event) => setFilter('priority', event.target.value)} bg={fieldBg}>
              <option value="">Wszystkie</option>
              {priorityOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </FormControl>
          {isAdmin ? (
            <FormControl>
              <FormLabel color={textColor} fontWeight="700">
                Osoba
              </FormLabel>
              <Select value={filters.assignedToId} onChange={(event) => setFilter('assignedToId', event.target.value)} bg={fieldBg}>
                <option value="">Wszyscy</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            </FormControl>
          ) : null}
        </SimpleGrid>
      </Card>

      <Card p="0" overflowX="auto">
        <Table variant="simple">
          <Thead>
            <Tr>
              <Th>Zadanie</Th>
              <Th>Klient / projekt</Th>
              <Th>Odpowiedzialny</Th>
              <Th>Termin</Th>
              <Th>Status</Th>
              <Th>Komentarze</Th>
              <Th textAlign="right">Akcje</Th>
            </Tr>
          </Thead>
          <Tbody>
            {tasks.length === 0 ? (
              <Tr>
                <Td colSpan={7}>
                  <Text color={mutedColor} py="30px" textAlign="center">
                    Brak zadań dla wybranych filtrów.
                  </Text>
                </Td>
              </Tr>
            ) : tasks.map((task) => (
              <Tr key={task.id} _hover={{ bg: rowHover }}>
                <Td minW="290px">
                  <Flex direction="column" gap="6px">
                    <Flex align="center" gap="8px" flexWrap="wrap">
                      <Text color={textColor} fontWeight="800" cursor="pointer" onClick={() => openTask(task)}>
                        {task.title}
                      </Text>
                      <Badge colorScheme={priorityColor(task.priority)}>{labelFor(priorityOptions, task.priority)}</Badge>
                    </Flex>
                    {task.description ? (
                      <Text color={mutedColor} fontSize="sm" noOfLines={2}>
                        {task.description}
                      </Text>
                    ) : null}
                  </Flex>
                </Td>
                <Td minW="230px">
                  <Flex direction="column" gap="4px">
                    {task.client ? (
                      <Link href={`/admin/clients/${task.client.id}`}>
                        <Text color="brand.300" fontWeight="700">
                          {task.client.displayName}
                        </Text>
                      </Link>
                    ) : (
                      <Text color={mutedColor}>Bez klienta</Text>
                    )}
                    <Text color={mutedColor} fontSize="sm">
                      {task.project?.title || 'Bez projektu'}
                    </Text>
                  </Flex>
                </Td>
                <Td minW="180px">
                  <Text color={textColor} fontWeight="700">
                    {task.assignedTo?.name || 'Nieprzypisane'}
                  </Text>
                  <Text color={mutedColor} fontSize="xs">
                    Utworzył: {task.createdBy?.name || 'System'}
                  </Text>
                </Td>
                <Td minW="160px">
                  <Text color={isOverdue(task) ? 'red.300' : isToday(task) ? 'blue.300' : textColor} fontWeight="700">
                    {formatDateTime(task.dueAt)}
                  </Text>
                </Td>
                <Td>
                  <Badge colorScheme={statusColor(task.status)}>{labelFor(statusOptions, task.status)}</Badge>
                </Td>
                <Td>
                  <Flex align="center" gap="6px" color={mutedColor}>
                    <Icon as={MdComment} />
                    <Text>{task.commentsCount}</Text>
                  </Flex>
                </Td>
                <Td textAlign="right" minW="250px">
                  <Flex justify="flex-end" gap="8px" flexWrap="wrap">
                    {task.status === 'OPEN' ? (
                      <Button size="sm" leftIcon={<Icon as={MdPlayArrow} />} onClick={() => updateTaskStatus(task, 'IN_PROGRESS')} isDisabled={saving}>
                        W trakcie
                      </Button>
                    ) : null}
                    {task.status !== 'DONE' && task.status !== 'CANCELLED' ? (
                      <Button size="sm" colorScheme="green" leftIcon={<Icon as={MdCheckCircle} />} onClick={() => updateTaskStatus(task, 'DONE')} isDisabled={saving}>
                        Zrobione
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" rightIcon={<Icon as={MdOpenInNew} />} onClick={() => openTask(task)}>
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
            {selectedTask ? 'Zadanie' : 'Nowe zadanie'}
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {formError ? (
              <Alert status="error" borderRadius="12px" mb="16px">
                <AlertIcon />
                {formError}
              </Alert>
            ) : null}
            <SimpleGrid columns={{ base: 1, lg: 2 }} gap="16px">
              <Box>
                <SimpleGrid columns={{ base: 1, md: 2 }} gap="14px">
                  <FormControl gridColumn={{ base: 'auto', md: '1 / -1' }} isRequired>
                    <FormLabel color={textColor} fontWeight="700">
                      Tytuł
                    </FormLabel>
                    <Input value={form.title} onChange={(event) => updateForm('title', event.target.value)} bg={fieldBg} color={textColor} isDisabled={!canManageSelected} />
                  </FormControl>
                  <FormControl>
                    <FormLabel color={textColor} fontWeight="700">
                      Status
                    </FormLabel>
                    <Select value={form.status} onChange={(event) => updateForm('status', event.target.value)} bg={fieldBg} color={textColor}>
                      {statusOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel color={textColor} fontWeight="700">
                      Priorytet
                    </FormLabel>
                    <Select value={form.priority} onChange={(event) => updateForm('priority', event.target.value)} bg={fieldBg} color={textColor} isDisabled={!canManageSelected}>
                      {priorityOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel color={textColor} fontWeight="700">
                      Termin
                    </FormLabel>
                    <Input type="datetime-local" value={form.dueAt} onChange={(event) => updateForm('dueAt', event.target.value)} bg={fieldBg} color={textColor} isDisabled={!canManageSelected} />
                  </FormControl>
                  <FormControl>
                    <FormLabel color={textColor} fontWeight="700">
                      Odpowiedzialny
                    </FormLabel>
                    <Select value={form.assignedToId} onChange={(event) => updateForm('assignedToId', event.target.value)} bg={fieldBg} color={textColor} isDisabled={!canManageSelected}>
                      <option value="">Nieprzypisane</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel color={textColor} fontWeight="700">
                      Klient
                    </FormLabel>
                    <SearchablePicker
                      value={form.clientId}
                      placeholder="Bez klienta"
                      searchPlaceholder="Szukaj klienta..."
                      isDisabled={!canManageSelected}
                      options={clients.map((client) => ({
                        value: client.id,
                        label: client.displayName,
                        meta: client.clientType === 'UNKNOWN' ? 'Nie określono' : client.clientType,
                      }))}
                      onChange={(value) => updateForm('clientId', value)}
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel color={textColor} fontWeight="700">
                      Projekt
                    </FormLabel>
                    <SearchablePicker
                      value={form.projectId}
                      placeholder="Bez projektu"
                      searchPlaceholder="Szukaj projektu..."
                      isDisabled={!canManageSelected}
                      options={projectOptions.map((project) => ({
                        value: project.id,
                        label: project.title,
                        meta: clients.find((client) => client.id === project.clientId)?.displayName || labelFor(statusOptions, project.status),
                      }))}
                      onChange={(value) => updateForm('projectId', value)}
                    />
                  </FormControl>
                  <FormControl gridColumn={{ base: 'auto', md: '1 / -1' }}>
                    <FormLabel color={textColor} fontWeight="700">
                      Opis
                    </FormLabel>
                    <Textarea minH="130px" value={form.description} onChange={(event) => updateForm('description', event.target.value)} bg={fieldBg} color={textColor} isDisabled={!canManageSelected} />
                  </FormControl>
                </SimpleGrid>
              </Box>

              <Box>
                <Flex align="center" justify="space-between" mb="12px">
                  <Text color={textColor} fontSize="lg" fontWeight="800">
                    Komentarze
                  </Text>
                  <Badge colorScheme="purple">{selectedTask?.commentsCount || 0}</Badge>
                </Flex>
                {selectedTask ? (
                  <Flex direction="column" gap="10px" maxH="380px" overflowY="auto" pe="4px" mb="14px">
                    {selectedTask.comments?.length ? selectedTask.comments.map((comment) => (
                      <Box key={comment.id} border="1px solid" borderColor={borderColor} borderRadius="12px" p="12px">
                        <Flex justify="space-between" gap="12px" mb="6px">
                          <Text color={textColor} fontWeight="800">
                            {comment.author?.name || 'System'}
                          </Text>
                          <Text color={mutedColor} fontSize="xs" flexShrink={0}>
                            {formatDateTime(comment.createdAt)}
                          </Text>
                        </Flex>
                        <Text color={mutedColor} whiteSpace="pre-wrap">
                          {comment.body}
                        </Text>
                      </Box>
                    )) : (
                      <Text color={mutedColor}>Brak komentarzy przy tym zadaniu.</Text>
                    )}
                  </Flex>
                ) : (
                  <Text color={mutedColor} mb="14px">
                    Komentarze będą dostępne po zapisaniu zadania.
                  </Text>
                )}
                {selectedTask ? (
                  <Box>
                    <Textarea
                      minH="110px"
                      value={commentText}
                      onChange={(event) => setCommentText(event.target.value)}
                      placeholder="Dodaj komentarz..."
                      bg={fieldBg}
                      color={textColor}
                    />
                    <Button mt="10px" leftIcon={<Icon as={MdComment} />} onClick={addComment} isLoading={saving} isDisabled={!commentText.trim()}>
                      Dodaj komentarz
                    </Button>
                  </Box>
                ) : null}
              </Box>
            </SimpleGrid>
          </ModalBody>
          <ModalFooter gap="10px" flexWrap="wrap">
            {selectedTask && isAdmin ? (
              <Button
                variant="outline"
                colorScheme="red"
                leftIcon={<Icon as={MdDelete} />}
                onClick={deleteTask}
                isLoading={saving}
              >
                Usuń zadanie
              </Button>
            ) : null}
            <Button variant="ghost" onClick={closeModal}>
              Zamknij
            </Button>
            <Button variant="brand" onClick={saveTask} isLoading={saving} isDisabled={!form.title.trim()}>
              {selectedTask ? 'Zapisz zmiany' : 'Utwórz zadanie'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}

function SearchablePicker(props: {
  value: string;
  placeholder: string;
  searchPlaceholder: string;
  options: Array<{ value: string; label: string; meta?: string }>;
  isDisabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const { isOpen, onOpen, onClose } = useDisclosure();
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const bg = useColorModeValue('white', 'rgba(17, 27, 66, 0.96)');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const hoverBg = useColorModeValue('secondaryGray.100', 'whiteAlpha.100');
  const selected = props.options.find((option) => option.value === props.value);
  const filteredOptions = props.options.filter((option) => {
    const searchText = normalizeSearch([option.label, option.meta].filter(Boolean).join(' '));
    return searchText.includes(normalizeSearch(query));
  });

  function openMenu() {
    setQuery('');
    onOpen();
  }

  function choose(value: string) {
    props.onChange(value);
    onClose();
  }

  return (
    <Menu isOpen={isOpen} onOpen={openMenu} onClose={onClose} closeOnSelect={false} matchWidth>
      <MenuButton
        as={Button}
        w="100%"
        h="46px"
        px="14px"
        justifyContent="space-between"
        textAlign="left"
        bg={bg}
        color={selected ? textColor : mutedColor}
        border="1px solid"
        borderColor={borderColor}
        borderRadius="12px"
        fontWeight="700"
        isDisabled={props.isDisabled}
        rightIcon={<Icon as={MdKeyboardArrowDown} />}
        _hover={{ borderColor: 'brand.400' }}
        _active={{ bg }}
      >
        <Text noOfLines={1} as="span">
          {selected?.label || props.placeholder}
        </Text>
      </MenuButton>
      <MenuList bg={bg} borderColor={borderColor} p="8px" maxH="320px" overflowY="auto" zIndex={1600}>
        <Box pb="8px" position="sticky" top="-8px" bg={bg} zIndex={1}>
          <Flex align="center" border="1px solid" borderColor={borderColor} borderRadius="10px" px="10px">
            <Icon as={MdSearch} color={mutedColor} me="8px" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder={props.searchPlaceholder}
              autoFocus
              border="0"
              bg="transparent"
              color={textColor}
              _focus={{ boxShadow: 'none' }}
            />
          </Flex>
        </Box>
        <MenuItem
          onClick={() => choose('')}
          bg="transparent"
          color={!props.value ? textColor : mutedColor}
          borderRadius="10px"
          fontWeight={!props.value ? '800' : '600'}
          _hover={{ bg: hoverBg }}
          _focus={{ bg: hoverBg }}
        >
          {props.placeholder}
        </MenuItem>
        {filteredOptions.length === 0 ? (
          <Box px="12px" py="14px">
            <Text color={mutedColor} fontSize="sm">
              Brak wyników.
            </Text>
          </Box>
        ) : filteredOptions.map((option) => (
          <MenuItem
            key={option.value}
            onClick={() => choose(option.value)}
            bg="transparent"
            borderRadius="10px"
            _hover={{ bg: hoverBg }}
            _focus={{ bg: hoverBg }}
          >
            <Box minW="0">
              <Text color={textColor} fontWeight={option.value === props.value ? '800' : '700'} noOfLines={1}>
                {option.label}
              </Text>
              {option.meta ? (
                <Text color={mutedColor} fontSize="xs" noOfLines={1}>
                  {option.meta}
                </Text>
              ) : null}
            </Box>
          </MenuItem>
        ))}
      </MenuList>
    </Menu>
  );
}

function Metric(props: {
  title: string;
  value: number;
  icon: any;
  active?: boolean;
  alert?: boolean;
  onClick: () => void;
}) {
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const bg = useColorModeValue('white', 'navy.800');
  const activeBorder = props.alert ? 'red.300' : 'brand.400';

  return (
    <Button
      h="104px"
      p="16px"
      bg={bg}
      border="1px solid"
      borderColor={props.active ? activeBorder : 'transparent'}
      borderRadius="18px"
      boxShadow="none"
      justifyContent="flex-start"
      textAlign="left"
      onClick={props.onClick}
      _hover={{ borderColor: activeBorder }}
    >
      <Flex w="100%" align="center" justify="space-between">
        <Box>
          <Text color={mutedColor} fontSize="sm" fontWeight="800">
            {props.title}
          </Text>
          <Text color={props.alert ? 'red.300' : textColor} fontSize="30px" fontWeight="900" lineHeight="1.1">
            {props.value}
          </Text>
        </Box>
        <Flex align="center" justify="center" w="38px" h="38px" borderRadius="12px" bg={props.alert ? 'red.400' : 'brand.500'} color="white">
          <Icon as={props.icon} w="20px" h="20px" />
        </Flex>
      </Flex>
    </Button>
  );
}
