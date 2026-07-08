'use client';
// Chakra Imports
import {
  Avatar,
  Box,
  Button,
  Flex,
  Icon,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Text,
  useColorMode,
  useColorModeValue,
} from '@chakra-ui/react';
import Link from 'components/link/Link';
// Custom Components
import { Image } from 'components/image/Image';
import { SearchBar } from 'components/navbar/searchBar/SearchBar';
import { SidebarResponsive } from 'components/sidebar/Sidebar';
import Configurator from 'components/navbar/Configurator';
import NextLink from 'next/link';
// Assets
import navImage from '/public/img/layout/Navbar.png';
import { FaEthereum } from 'react-icons/fa';
import { IoMdMoon, IoMdSunny } from 'react-icons/io';
import { MdInfoOutline, MdNotificationsNone } from 'react-icons/md';
import { useEffect, useState, useContext } from 'react';
import { ConfiguratorContext } from 'contexts/ConfiguratorContext';
import routes from 'routes';

type CurrentStaffUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  positionTitle?: string | null;
  systemRole: string;
  companyRoles?: Array<{ name: string }>;
};

type PanelNotification = {
  id: string;
  title: string;
  message?: string | null;
  href?: string | null;
  readAt?: string | null;
  createdAt: string;
  task?: { title?: string | null; dueAt?: string | null } | null;
  actor?: { name?: string | null } | null;
};

type NotificationsState = {
  items: PanelNotification[];
  unreadCount: number;
  todayCount: number;
  overdueCount: number;
};

const emptyNotifications: NotificationsState = {
  items: [],
  unreadCount: 0,
  todayCount: 0,
  overdueCount: 0,
};

function firstName(name?: string | null) {
  return (name || '').trim().split(/\s+/)[0] || 'Operator';
}

function formatNotificationTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function HeaderLinks(props: { secondary: boolean }) {
  const { secondary } = props;
  const [user, setUser] = useState<CurrentStaffUser | null>(null);
  const [notifications, setNotifications] = useState<NotificationsState>(emptyNotifications);
  const { colorMode, toggleColorMode } = useColorMode();
  // Chakra Color Mode
  const navbarIcon = useColorModeValue('gray.400', 'white');
  let menuBg = useColorModeValue('white', 'navy.800');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const textColorBrand = useColorModeValue('brand.700', 'brand.400');
  const ethColor = useColorModeValue('gray.700', 'white');
  const borderColor = useColorModeValue('#E6ECFA', 'rgba(135, 140, 189, 0.3)');
  const ethBg = useColorModeValue('secondaryGray.300', 'navy.900');
  const ethBox = useColorModeValue('white', 'navy.800');
  const shadow = useColorModeValue(
    '14px 17px 40px 4px rgba(112, 144, 176, 0.18)',
    '14px 17px 40px 4px rgba(112, 144, 176, 0.06)',
  );
  const borderButton = useColorModeValue('secondaryGray.500', 'whiteAlpha.200');

  async function loadCurrentUser() {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      const payload = await response.json();
      setUser(response.ok && payload.ok ? payload.data : null);
    } catch {
      setUser(null);
    }
  }

  async function loadNotifications() {
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' });
      const payload = await response.json();
      setNotifications(response.ok && payload.ok ? payload.data : emptyNotifications);
    } catch {
      setNotifications(emptyNotifications);
    }
  }

  useEffect(() => {
    loadCurrentUser();
    loadNotifications();
    const handler = () => loadCurrentUser();
    const notificationsHandler = () => loadNotifications();
    window.addEventListener('onrevolt:staff-user-updated', handler);
    window.addEventListener('onrevolt:notifications-updated', notificationsHandler);
    const interval = window.setInterval(loadNotifications, 60000);
    return () => {
      window.removeEventListener('onrevolt:staff-user-updated', handler);
      window.removeEventListener('onrevolt:notifications-updated', notificationsHandler);
      window.clearInterval(interval);
    };
  }, []);

  async function markNotificationsRead(id?: string) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(id ? { id } : { all: true }),
    }).catch(() => undefined);
    loadNotifications();
  }

  function openNotification(notification: PanelNotification) {
    markNotificationsRead(notification.id);
    if (notification.href) window.location.href = notification.href;
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    setNotifications(emptyNotifications);
    window.location.href = '/auth/sign-in/default';
  }

  return (
    <Flex
      w={{ sm: '100%', md: 'auto' }}
      alignItems="center"
      flexDirection="row"
      bg={menuBg}
      flexWrap={secondary ? { base: 'wrap', md: 'nowrap' } : 'unset'}
      p="10px"
      borderRadius="30px"
      boxShadow={shadow}
    >
      <SearchBar
        mb={() => {
          if (secondary) {
            return { base: '10px', md: 'unset' };
          }
          return 'unset';
        }}
        me="10px"
        borderRadius="30px"
      />
      <Flex
        bg={ethBg}
        display={secondary ? 'flex' : 'none'}
        borderRadius="30px"
        ms="auto"
        p="6px"
        align="center"
        me="6px"
      >
        <Flex
          align="center"
          justify="center"
          bg={ethBox}
          h="29px"
          w="29px"
          borderRadius="30px"
          me="7px"
        >
          <Icon color={ethColor} w="9px" h="14px" as={FaEthereum} />
        </Flex>
        <Text
          w="max-content"
          color={ethColor}
          fontSize="sm"
          fontWeight="700"
          me="6px"
        >
          1,924
          <Text as="span" display={{ base: 'none', md: 'unset' }}>
            {' '}
            ETH
          </Text>
        </Text>
      </Flex>
      <SidebarResponsive routes={routes} />
      <Menu>
        <MenuButton p="0px">
          <Box position="relative" me="10px" mt="6px">
            <Icon
              as={MdNotificationsNone}
              color={notifications.unreadCount > 0 ? textColorBrand : navbarIcon}
              w="18px"
              h="18px"
            />
            {notifications.unreadCount > 0 ? (
              <Flex
                position="absolute"
                top="-8px"
                right="-8px"
                minW="16px"
                h="16px"
                px="4px"
                align="center"
                justify="center"
                borderRadius="999px"
                bg="red.400"
                color="white"
                fontSize="10px"
                fontWeight="800"
                lineHeight="16px"
              >
                {notifications.unreadCount > 9 ? '9+' : notifications.unreadCount}
              </Flex>
            ) : null}
          </Box>
        </MenuButton>
        <MenuList
          boxShadow={shadow}
          p="20px"
          borderRadius="20px"
          bg={menuBg}
          border="none"
          mt="22px"
          me={{ base: '30px', md: 'unset' }}
          minW={{ base: 'unset', md: '400px', xl: '450px' }}
          maxW={{ base: '360px', md: 'unset' }}
        >
          <Flex w="100%" mb="20px">
            <Text fontSize="md" fontWeight="600" color={textColor}>
              Powiadomienia
            </Text>
            <Text
              fontSize="sm"
              fontWeight="500"
              color={textColorBrand}
              ms="auto"
              cursor="pointer"
              onClick={() => markNotificationsRead()}
            >
              Oznacz jako przeczytane
            </Text>
          </Flex>
          <Flex gap="10px" mb="18px" flexWrap="wrap">
            <MenuItem
              as={NextLink}
              href="/admin/tasks?scope=today"
              _hover={{ bg: 'whiteAlpha.100' }}
              _focus={{ bg: 'whiteAlpha.100' }}
              borderRadius="12px"
              px="12px"
              py="10px"
              flex="1"
              minW="145px"
            >
              <Box>
                <Text fontSize="xs" color={mutedColor} fontWeight="700">
                  Zadania dzisiaj
                </Text>
                <Text color={textColor} fontWeight="800">
                  {notifications.todayCount}
                </Text>
              </Box>
            </MenuItem>
            <MenuItem
              as={NextLink}
              href="/admin/tasks?scope=overdue"
              _hover={{ bg: 'whiteAlpha.100' }}
              _focus={{ bg: 'whiteAlpha.100' }}
              borderRadius="12px"
              px="12px"
              py="10px"
              flex="1"
              minW="145px"
            >
              <Box>
                <Text fontSize="xs" color={mutedColor} fontWeight="700">
                  Zaległe
                </Text>
                <Text color={notifications.overdueCount > 0 ? 'red.300' : textColor} fontWeight="800">
                  {notifications.overdueCount}
                </Text>
              </Box>
            </MenuItem>
          </Flex>
          <Flex flexDirection="column">
            {notifications.items.length === 0 ? (
              <Box px="4px" py="16px">
                <Text color={mutedColor} fontSize="sm">
                  Brak nowych powiadomień.
                </Text>
              </Box>
            ) : notifications.items.map((notification) => (
              <MenuItem
                key={notification.id}
                _hover={{ bg: 'whiteAlpha.100' }}
                _focus={{ bg: 'whiteAlpha.100' }}
                px="12px"
                py="11px"
                borderRadius="12px"
                mb="8px"
                onClick={() => openNotification(notification)}
              >
                <Box w="100%">
                  <Flex align="center" gap="8px">
                    <Text color={textColor} fontSize="sm" fontWeight="800" noOfLines={1}>
                      {notification.title}
                    </Text>
                    {!notification.readAt ? (
                      <Box w="8px" h="8px" borderRadius="999px" bg="brand.400" flexShrink={0} />
                    ) : null}
                    <Text color={mutedColor} fontSize="xs" ms="auto" flexShrink={0}>
                      {formatNotificationTime(notification.createdAt)}
                    </Text>
                  </Flex>
                  <Text color={mutedColor} fontSize="xs" noOfLines={2}>
                    {notification.message || notification.task?.title || 'Zdarzenie w panelu'}
                  </Text>
                </Box>
              </MenuItem>
            ))}
          </Flex>
        </MenuList>
      </Menu>

      <Menu>
        <MenuButton p="0px">
          <Icon
            mt="6px"
            as={MdInfoOutline}
            color={navbarIcon}
            w="18px"
            h="18px"
            me="10px"
          />
        </MenuButton>
        <MenuList
          boxShadow={shadow}
          p="20px"
          me={{ base: '30px', md: 'unset' }}
          borderRadius="20px"
          bg={menuBg}
          border="none"
          mt="22px"
          minW={{ base: 'unset' }}
          maxW={{ base: '360px', md: 'unset' }}
        >
          <Image src={navImage} borderRadius="16px" mb="28px" alt="" />
          <Flex flexDirection="column">
            <Link w="100%" href="https://horizon-ui.com/pro">
              <Button w="100%" h="44px" mb="10px" variant="brand">
                Buy Horizon UI PRO
              </Button>
            </Link>
            <Link
              w="100%"
              href="https://horizon-ui.com/documentation/docs/introduction"
            >
              <Button
                w="100%"
                h="44px"
                mb="10px"
                border="1px solid"
                bg="transparent"
                borderColor={borderButton}
              >
                See Documentation
              </Button>
            </Link>
            <Link
              w="100%"
              href="https://github.com/horizon-ui/horizon-ui-chakra-nextjs"
            >
              <Button
                w="100%"
                h="44px"
                variant="no-hover"
                color={textColor}
                bg="transparent"
              >
                Try Horizon Free
              </Button>
            </Link>
          </Flex>
        </MenuList>
      </Menu>
      <Configurator />
      <Menu>
        <MenuButton p="0px" style={{ position: 'relative' }}>
          <Avatar
            name={user?.name || 'onRevolt'}
            src={user?.avatarUrl || undefined}
            bg="#11047A"
            color="white"
            w="40px"
            h="40px"
            _hover={{ cursor: 'pointer' }}
          />
        </MenuButton>
        <MenuList
          boxShadow={shadow}
          p="0px"
          mt="10px"
          borderRadius="20px"
          bg={menuBg}
          border="none"
        >
          <Flex w="100%" mb="0px">
            <Text
              ps="20px"
              pt="16px"
              pb="10px"
              w="100%"
              borderBottom="1px solid"
              borderColor={borderColor}
              fontSize="sm"
              fontWeight="700"
              color={textColor}
            >
              Cześć, {firstName(user?.name)}
            </Text>
          </Flex>
          <Flex flexDirection="column" p="10px">
            <MenuItem
              as={NextLink}
              href="/admin/profile"
              _hover={{ bg: 'none' }}
              _focus={{ bg: 'none' }}
              borderRadius="8px"
              px="14px"
            >
              <Text fontSize="sm">Ustawienia profilu</Text>
            </MenuItem>
            <MenuItem
              as={NextLink}
              href="/admin/settings"
              _hover={{ bg: 'none' }}
              _focus={{ bg: 'none' }}
              borderRadius="8px"
              px="14px"
            >
              <Text fontSize="sm">Użytkownicy i role</Text>
            </MenuItem>
            <MenuItem
              _hover={{ bg: 'none' }}
              _focus={{ bg: 'none' }}
              color="red.400"
              borderRadius="8px"
              px="14px"
              onClick={handleLogout}
            >
              <Text fontSize="sm">Wyloguj</Text>
            </MenuItem>
          </Flex>
        </MenuList>
      </Menu>
    </Flex>
  );
}
