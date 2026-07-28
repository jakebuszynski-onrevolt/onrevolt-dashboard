'use client';

import {
  Alert,
  AlertIcon,
  Avatar,
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
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SimpleGrid,
  Switch,
  Table,
  Tbody,
  Td,
  Text,
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
  MdDelete,
  MdEdit,
  MdLockReset,
  MdOpenInNew,
  MdRefresh,
  MdSave,
} from 'react-icons/md';

type CompanyRole = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
};

type StaffUser = {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  active: boolean;
  systemRole: string;
  positionTitle?: string | null;
  avatarUrl?: string | null;
  passwordResetRequired: boolean;
  lastLoginAt?: string | null;
  companyRoles: CompanyRole[];
};

type UserFormState = {
  id: string;
  email: string;
  name: string;
  phone: string;
  active: boolean;
  systemRole: string;
  positionTitle: string;
  avatarUrl: string;
  companyRoleIds: string[];
};

const emptyForm: UserFormState = {
  id: '',
  email: '',
  name: '',
  phone: '',
  active: true,
  systemRole: 'USER',
  positionTitle: '',
  avatarUrl: '',
  companyRoleIds: [],
};

const systemRoleLabels: Record<string, string> = {
  ADMIN: 'Admin',
  MODERATOR: 'Moderator',
  USER: 'Użytkownik',
};

function displayRoles(user: StaffUser) {
  return user.companyRoles?.length ? user.companyRoles.map((role) => role.name).join(', ') : 'Brak roli firmowej';
}

function formFromUser(user: StaffUser): UserFormState {
  return {
    id: user.id,
    email: user.email || '',
    name: user.name || '',
    phone: user.phone || '',
    active: user.active,
    systemRole: user.systemRole || 'USER',
    positionTitle: user.positionTitle || '',
    avatarUrl: user.avatarUrl || '',
    companyRoleIds: user.companyRoles?.map((role) => role.id) || [],
  };
}

export default function UserSettingsWorkspace() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [currentUser, setCurrentUser] = useState<StaffUser | null>(null);
  const [companyRoles, setCompanyRoles] = useState<CompanyRole[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [form, setForm] = useState<UserFormState>(emptyForm);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const panelBg = useColorModeValue('white', 'navy.800');
  const isAdmin = currentUser?.systemRole === 'ADMIN';

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/staff/users', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setCurrentUser(payload.data.currentUser || null);
      setUsers(payload.data.users || []);
      setCompanyRoles(payload.data.companyRoles || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return users;
    return users.filter((user) =>
      [
        user.name,
        user.email,
        user.phone,
        user.systemRole,
        systemRoleLabels[user.systemRole],
        user.positionTitle,
        displayRoles(user),
      ]
        .join(' ')
        .toLowerCase()
        .includes(text),
    );
  }, [query, users]);

  function updateForm<K extends keyof UserFormState>(key: K, value: UserFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleCompanyRole(roleId: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      companyRoleIds: checked
        ? [...new Set([...current.companyRoleIds, roleId])]
        : current.companyRoleIds.filter((id) => id !== roleId),
    }));
  }

  function openCreateModal() {
    setModalMode('create');
    setForm(emptyForm);
    setFormError('');
    setTemporaryPassword('');
    onOpen();
  }

  function openEditModal(user: StaffUser) {
    setModalMode('edit');
    setForm(formFromUser(user));
    setFormError('');
    setTemporaryPassword('');
    onOpen();
  }

  async function saveUser() {
    setSaving(true);
    setFormError('');
    setTemporaryPassword('');
    try {
      const body: Record<string, any> = {
        email: form.email,
        name: form.name,
        phone: form.phone,
        active: form.active,
        systemRole: form.systemRole,
        positionTitle: form.positionTitle,
        avatarUrl: form.avatarUrl,
        companyRoleIds: form.companyRoleIds,
      };
      if (modalMode === 'edit') body.id = form.id;
      const response = await fetch('/api/staff/users', {
        method: modalMode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      const emailSuffix = payload.emailDelivery?.status === 'SENT'
        ? ' Email z danymi dostępowymi został wysłany.'
        : payload.emailDelivery?.status === 'QUEUED'
          ? ' Google chwilowo odroczył wiadomość. System ponowi wysyłkę automatycznie.'
        : payload.emailDelivery?.status === 'FAILED'
          ? ` Nie udało się wysłać emaila: ${payload.emailDelivery.error}`
          : '';
      setNotice((modalMode === 'edit' ? `Zapisano użytkownika: ${payload.data.name}` : `Dodano użytkownika: ${payload.data.name}`) + emailSuffix);
      if (payload.tempPassword) setTemporaryPassword(payload.tempPassword);
      await loadUsers();
      if (modalMode === 'edit') onClose();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(user: StaffUser) {
    const confirmed = window.confirm(`Wygenerować nowe hasło tymczasowe dla ${user.name}?`);
    if (!confirmed) return;
    setTemporaryPassword('');
    setNotice('');
    try {
      const response = await fetch('/api/staff/users/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setTemporaryPassword(payload.tempPassword || '');
      setNotice(payload.emailDelivery?.status === 'SENT'
        ? `Wygenerowano nowe hasło dla ${payload.data.name} i wysłano je emailem.`
        : payload.emailDelivery?.status === 'QUEUED'
          ? `Wygenerowano nowe hasło dla ${payload.data.name}. Google chwilowo odroczył wiadomość, więc system ponowi wysyłkę automatycznie.`
          : `Wygenerowano nowe hasło dla ${payload.data.name}, ale email nie został wysłany: ${payload.emailDelivery?.error || 'nieznany błąd'}`);
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteUser(user: StaffUser) {
    const confirmed = window.confirm(`Usunąć użytkownika ${user.name}?`);
    if (!confirmed) return;
    setError('');
    try {
      const response = await fetch('/api/staff/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setNotice(`Usunięto użytkownika: ${user.name}`);
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Flex direction="column" pt={{ base: '130px', md: '80px', xl: '80px' }} gap="20px">
      <Card p={{ base: '20px', md: '28px' }}>
        <Flex direction={{ base: 'column', xl: 'row' }} gap="16px" align={{ xl: 'center' }}>
          <Box flex="1">
            <Badge colorScheme="purple" mb="12px" borderRadius="8px" px="10px" py="4px">
              Ustawienia
            </Badge>
            <Text color={textColor} fontSize="2xl" fontWeight="800">
              Użytkownicy i role
            </Text>
            <Text color={mutedColor} mt="6px">
              Role systemowe sterują dostępem do administracji, a role firmowe opisują funkcję operatora w zespole.
            </Text>
          </Box>
          <Flex gap="10px" wrap="wrap">
            <Button leftIcon={<Icon as={MdRefresh} />} variant="outline" onClick={loadUsers} isLoading={loading}>
              Odśwież
            </Button>
            <Button as={Link} href="/admin/profile" leftIcon={<Icon as={MdOpenInNew} />} variant="outline">
              Mój profil
            </Button>
            <Button leftIcon={<Icon as={MdAdd} />} colorScheme="purple" onClick={openCreateModal} isDisabled={!isAdmin}>
              Nowy użytkownik
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
      {notice ? (
        <Alert status="success" borderRadius="8px">
          <AlertIcon />
          {notice}
        </Alert>
      ) : null}
      {temporaryPassword ? (
        <Alert status="warning" borderRadius="8px">
          <AlertIcon />
          <Box>
            <Text fontWeight="800">Hasło tymczasowe</Text>
            <Text fontFamily="mono" fontSize="md" wordBreak="break-all">{temporaryPassword}</Text>
          </Box>
        </Alert>
      ) : null}

      {!isAdmin && !loading ? (
        <Alert status="info" borderRadius="8px">
          <AlertIcon />
          Zarządzanie użytkownikami jest dostępne tylko dla administratora.
        </Alert>
      ) : null}

      <Card p="22px">
        <Flex mb="18px" gap="12px" align="center" wrap="wrap">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Szukaj po użytkowniku, emailu, telefonie lub roli..."
            maxW="460px"
          />
          <Text ml="auto" color={mutedColor} fontSize="sm">
            {filteredUsers.length} / {users.length}
          </Text>
        </Flex>
        <Box overflowX="auto">
          <Table variant="simple">
            <Thead>
              <Tr>
                <Th>Użytkownik</Th>
                <Th>Rola w systemie</Th>
                <Th>Role w firmie</Th>
                <Th>Status</Th>
                <Th>Ostatnie logowanie</Th>
                <Th textAlign="right">Akcje</Th>
              </Tr>
            </Thead>
            <Tbody>
              {filteredUsers.map((user) => (
                <Tr key={user.id}>
                  <Td>
                    <Flex align="center" gap="12px">
                      <Avatar size="sm" name={user.name} src={user.avatarUrl || undefined} />
                      <Box>
                        <Text color={textColor} fontWeight="800">{user.name}</Text>
                        <Text color={mutedColor} fontSize="sm">{user.email}</Text>
                        {user.phone ? <Text color={mutedColor} fontSize="xs">{user.phone}</Text> : null}
                      </Box>
                    </Flex>
                  </Td>
                  <Td>
                    <Badge colorScheme={user.systemRole === 'ADMIN' ? 'purple' : 'blue'}>
                      {systemRoleLabels[user.systemRole] || user.systemRole}
                    </Badge>
                    {user.positionTitle ? <Text color={mutedColor} fontSize="xs" mt="6px">{user.positionTitle}</Text> : null}
                  </Td>
                  <Td maxW="360px">
                    <Flex gap="6px" wrap="wrap">
                      {user.companyRoles?.length ? user.companyRoles.map((role) => (
                        <Badge key={role.id} colorScheme="cyan">{role.name}</Badge>
                      )) : <Text color={mutedColor}>Brak</Text>}
                    </Flex>
                  </Td>
                  <Td>
                    <Badge colorScheme={user.active ? 'green' : 'gray'}>{user.active ? 'Aktywny' : 'Nieaktywny'}</Badge>
                    {user.passwordResetRequired ? <Badge colorScheme="orange" ml="6px">Hasło tymczasowe</Badge> : null}
                  </Td>
                  <Td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('pl-PL') : '-'}</Td>
                  <Td textAlign="right">
                    <Flex justify="flex-end" gap="8px">
                      <Tooltip label="Edytuj">
                        <IconButton
                          aria-label="Edytuj użytkownika"
                          icon={<Icon as={MdEdit} />}
                          size="sm"
                          variant="outline"
                          onClick={() => openEditModal(user)}
                          isDisabled={!isAdmin}
                        />
                      </Tooltip>
                      <Tooltip label="Nowe hasło">
                        <IconButton
                          aria-label="Wygeneruj nowe hasło"
                          icon={<Icon as={MdLockReset} />}
                          size="sm"
                          variant="outline"
                          onClick={() => resetPassword(user)}
                          isDisabled={!isAdmin}
                        />
                      </Tooltip>
                      <Tooltip label="Usuń">
                        <IconButton
                          aria-label="Usuń użytkownika"
                          icon={<Icon as={MdDelete} />}
                          size="sm"
                          colorScheme="red"
                          variant="outline"
                          onClick={() => deleteUser(user)}
                          isDisabled={!isAdmin || currentUser?.id === user.id}
                        />
                      </Tooltip>
                    </Flex>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      </Card>

      <Card p="22px">
        <Text color={textColor} fontWeight="800" mb="12px">Role firmowe</Text>
        <Flex gap="8px" wrap="wrap">
          {companyRoles.map((role) => (
            <Badge key={role.id} colorScheme="purple" px="10px" py="6px" borderRadius="8px">
              {role.name}
            </Badge>
          ))}
        </Flex>
      </Card>

      <Modal isOpen={isOpen} onClose={onClose} size="4xl">
        <ModalOverlay />
        <ModalContent borderRadius="8px" bg={panelBg}>
          <ModalHeader color={textColor}>{modalMode === 'edit' ? 'Edytuj użytkownika' : 'Nowy użytkownik'}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {formError ? (
              <Alert status="error" borderRadius="8px" mb="18px">
                <AlertIcon />
                {formError}
              </Alert>
            ) : null}
            {temporaryPassword ? (
              <Alert status="warning" borderRadius="8px" mb="18px">
                <AlertIcon />
                <Box>
                  <Text fontWeight="800">Hasło tymczasowe</Text>
                  <Text fontFamily="mono" wordBreak="break-all">{temporaryPassword}</Text>
                </Box>
              </Alert>
            ) : null}
            <SimpleGrid columns={{ base: 1, md: 2 }} gap="16px">
              <FormControl isRequired>
                <FormLabel>Imię i nazwisko</FormLabel>
                <Input value={form.name} onChange={(event) => updateForm('name', event.target.value)} />
              </FormControl>
              <FormControl isRequired>
                <FormLabel>Email</FormLabel>
                <Input type="email" value={form.email} onChange={(event) => updateForm('email', event.target.value)} />
              </FormControl>
              <FormControl>
                <FormLabel>Telefon</FormLabel>
                <Input value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} />
              </FormControl>
              <FormControl>
                <FormLabel>Stanowisko / opis roli</FormLabel>
                <Input value={form.positionTitle} onChange={(event) => updateForm('positionTitle', event.target.value)} />
              </FormControl>
              <FormControl>
                <FormLabel>Rola w systemie</FormLabel>
                <Select value={form.systemRole} onChange={(event) => updateForm('systemRole', event.target.value)}>
                  <option value="MODERATOR">Moderator</option>
                  <option value="ADMIN">Admin</option>
                  <option value="USER">Użytkownik</option>
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>URL avatara</FormLabel>
                <Input value={form.avatarUrl} onChange={(event) => updateForm('avatarUrl', event.target.value)} />
              </FormControl>
              <FormControl display="flex" alignItems="center" gap="10px">
                <Switch isChecked={form.active} onChange={(event) => updateForm('active', event.target.checked)} colorScheme="green" />
                <FormLabel mb="0">Konto aktywne</FormLabel>
              </FormControl>
            </SimpleGrid>

            <Box mt="20px">
              <FormLabel>Role w firmie</FormLabel>
              <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap="10px">
                {companyRoles.map((role) => (
                  <Checkbox
                    key={role.id}
                    isChecked={form.companyRoleIds.includes(role.id)}
                    onChange={(event) => toggleCompanyRole(role.id, event.target.checked)}
                  >
                    {role.name}
                  </Checkbox>
                ))}
              </SimpleGrid>
            </Box>
          </ModalBody>
          <ModalFooter gap="10px">
            <Button variant="ghost" onClick={onClose}>Anuluj</Button>
            <Button leftIcon={<Icon as={MdSave} />} colorScheme="purple" onClick={saveUser} isLoading={saving}>
              {modalMode === 'edit' ? 'Zapisz' : 'Dodaj użytkownika'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Flex>
  );
}
