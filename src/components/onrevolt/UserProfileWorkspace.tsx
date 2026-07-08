'use client';

import {
  Alert,
  AlertIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Icon,
  Input,
  SimpleGrid,
  Text,
  useColorModeValue,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import Link from 'next/link';
import type { ChangeEvent } from 'react';
import { useEffect, useState } from 'react';
import { MdArrowBack, MdLock, MdSave } from 'react-icons/md';

type CompanyRole = {
  id: string;
  code: string;
  name: string;
};

type StaffUser = {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  systemRole: string;
  positionTitle?: string | null;
  avatarUrl?: string | null;
  passwordResetRequired: boolean;
  companyRoles: CompanyRole[];
};

const systemRoleLabels: Record<string, string> = {
  ADMIN: 'Admin',
  MODERATOR: 'Moderator',
  USER: 'Użytkownik',
};

export default function UserProfileWorkspace() {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [positionTitle, setPositionTitle] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');

  function applyUser(nextUser: StaffUser) {
    setUser(nextUser);
    setName(nextUser.name || '');
    setPhone(nextUser.phone || '');
    setPositionTitle(nextUser.positionTitle || '');
    setAvatarUrl(nextUser.avatarUrl || '');
    window.dispatchEvent(new CustomEvent('onrevolt:staff-user-updated'));
  }

  async function loadProfile() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/staff/profile', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      applyUser(payload.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  async function saveProfile() {
    setSavingProfile(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/staff/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, positionTitle, avatarUrl }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      applyUser(payload.data);
      setNotice('Profil został zapisany.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    setSavingPassword(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/staff/profile/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmation }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      applyUser(payload.data);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setNotice('Hasło zostało zmienione.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPassword(false);
    }
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    setError('');
    setNotice('');
    try {
      const data = new FormData();
      data.append('file', file);
      const response = await fetch('/api/staff/profile/avatar', { method: 'POST', body: data });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      applyUser(payload.data);
      setNotice('Zdjęcie profilowe zostało zapisane.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingAvatar(false);
      event.target.value = '';
    }
  }

  return (
    <Flex direction="column" pt={{ base: '130px', md: '80px', xl: '80px' }} gap="20px">
      <Card p={{ base: '20px', md: '28px' }}>
        <Flex direction={{ base: 'column', xl: 'row' }} gap="16px" align={{ xl: 'center' }}>
          <Box flex="1">
            <Badge colorScheme="purple" mb="12px" borderRadius="8px" px="10px" py="4px">
              Profil
            </Badge>
            <Text color={textColor} fontSize="2xl" fontWeight="800">
              Ustawienia profilu
            </Text>
            <Text color={mutedColor} mt="6px">
              Dane operatora widoczne w panelu, zdjęcie profilowe i hasło.
            </Text>
          </Box>
          <Button as={Link} href="/admin/settings" leftIcon={<Icon as={MdArrowBack} />} variant="outline">
            Ustawienia
          </Button>
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
      {!user && !loading ? (
        <Alert status="info" borderRadius="8px">
          <AlertIcon />
          Zaloguj się, aby edytować profil.
        </Alert>
      ) : null}

      <SimpleGrid columns={{ base: 1, xl: 2 }} gap="20px">
        <Card p="22px">
          <Flex align={{ base: 'flex-start', md: 'center' }} direction={{ base: 'column', md: 'row' }} gap="18px" mb="22px">
            <Avatar size="xl" name={name || user?.email || 'OR'} src={avatarUrl || undefined} />
            <Box>
              <Text color={textColor} fontWeight="900" fontSize="xl">{name || 'Użytkownik'}</Text>
              <Text color={mutedColor}>{user?.email || '-'}</Text>
              <Flex gap="6px" wrap="wrap" mt="8px">
                <Badge colorScheme={user?.systemRole === 'ADMIN' ? 'purple' : 'blue'}>
                  {systemRoleLabels[user?.systemRole || ''] || user?.systemRole || 'Brak roli'}
                </Badge>
                {user?.companyRoles?.map((role) => (
                  <Badge key={role.id} colorScheme="cyan">{role.name}</Badge>
                ))}
              </Flex>
            </Box>
          </Flex>
          <SimpleGrid columns={{ base: 1, md: 2 }} gap="16px">
            <FormControl>
              <FormLabel>Imię i nazwisko</FormLabel>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </FormControl>
            <FormControl>
              <FormLabel>Email</FormLabel>
              <Input value={user?.email || ''} isReadOnly />
            </FormControl>
            <FormControl>
              <FormLabel>Telefon</FormLabel>
              <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
            </FormControl>
            <FormControl>
              <FormLabel>Stanowisko / opis roli</FormLabel>
              <Input value={positionTitle} onChange={(event) => setPositionTitle(event.target.value)} />
            </FormControl>
            <FormControl>
              <FormLabel>URL avatara</FormLabel>
              <Input value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} />
            </FormControl>
            <FormControl>
              <FormLabel>Wgraj zdjęcie</FormLabel>
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={uploadAvatar}
                pt="8px"
                isDisabled={uploadingAvatar}
              />
            </FormControl>
          </SimpleGrid>
          <Flex mt="20px" gap="10px" justify="flex-end">
            <Button leftIcon={<Icon as={MdSave} />} colorScheme="purple" onClick={saveProfile} isLoading={savingProfile} isDisabled={!user}>
              Zapisz profil
            </Button>
          </Flex>
        </Card>

        <Card p="22px">
          <Text color={textColor} fontWeight="900" fontSize="lg">Hasło</Text>
          <Text color={mutedColor} mt="6px" mb="20px">
            {user?.passwordResetRequired
              ? 'Konto ma hasło tymczasowe, więc możesz od razu ustawić nowe hasło.'
              : 'Podaj aktualne hasło i nowe hasło.'}
          </Text>
          <SimpleGrid columns={{ base: 1 }} gap="16px">
            {!user?.passwordResetRequired ? (
              <FormControl>
                <FormLabel>Aktualne hasło</FormLabel>
                <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              </FormControl>
            ) : null}
            <FormControl>
              <FormLabel>Nowe hasło</FormLabel>
              <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </FormControl>
            <FormControl>
              <FormLabel>Powtórz nowe hasło</FormLabel>
              <Input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
            </FormControl>
          </SimpleGrid>
          <Flex mt="20px" justify="flex-end">
            <Button leftIcon={<Icon as={MdLock} />} colorScheme="purple" onClick={changePassword} isLoading={savingPassword} isDisabled={!user}>
              Zmień hasło
            </Button>
          </Flex>
        </Card>
      </SimpleGrid>
    </Flex>
  );
}
