'use client';

// chakra imports
import {
  Avatar,
  Box,
  Flex,
  Stack,
  Text,
  useColorModeValue,
} from '@chakra-ui/react';
//   Custom components
import Brand from 'components/sidebar/components/Brand';
import Links from 'components/sidebar/components/Links';
import SidebarCard from 'components/sidebar/components/SidebarCard';
import { useEffect, useMemo, useState } from 'react';
import { IRoute } from 'types/navigation';

// FUNCTIONS
type CurrentStaffUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  positionTitle?: string | null;
  systemRole: string;
  permissions?: string[];
  companyRoles?: Array<{ name: string }>;
};

function visibleRoutes(routes: IRoute[], user: CurrentStaffUser | null): IRoute[] {
  const permissions = new Set(user?.permissions || []);
  return routes.flatMap((route) => {
    if (route.requiredPermission && !permissions.has(route.requiredPermission)) return [];
    if (!route.items) return [route];
    const items = visibleRoutes(route.items, user);
    return items.length ? [{ ...route, items }] : [];
  });
}

function userSubtitle(user: CurrentStaffUser | null) {
  if (!user) return 'Panel onRevolt';
  if (user.positionTitle) return user.positionTitle;
  if (user.companyRoles?.length) return user.companyRoles.map((role) => role.name).join(', ');
  if (user.systemRole === 'ADMIN') return 'Admin';
  if (user.systemRole === 'MODERATOR') return 'Moderator';
  return 'Użytkownik';
}

function SidebarContent(props: {
  routes: IRoute[];
  hovered?: boolean;
  mini?: boolean;
}) {
  const { routes, mini, hovered } = props;
  const [user, setUser] = useState<CurrentStaffUser | null>(null);
  const textColor = useColorModeValue('navy.700', 'white');
  const navigationRoutes = useMemo(() => visibleRoutes(routes, user), [routes, user]);

  async function loadCurrentUser() {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      const payload = await response.json();
      setUser(response.ok && payload.ok ? payload.data : null);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    loadCurrentUser();
    const handler = () => loadCurrentUser();
    window.addEventListener('onrevolt:staff-user-updated', handler);
    return () => window.removeEventListener('onrevolt:staff-user-updated', handler);
  }, []);

  // SIDEBAR
  return (
    <Flex direction="column" height="100%" pt="25px" borderRadius="30px">
      <Brand mini={mini} hovered={hovered} />
      <Stack direction="column" mb="auto" mt="8px">
        <Box
          ps={
            mini === false
              ? '20px'
              : mini === true && hovered === true
              ? '20px'
              : '16px'
          }
          pe={{ md: '16px', '2xl': '1px' }}
          ms={mini && hovered === false ? '-16px' : 'unset'}
        >
          <Links mini={mini} hovered={hovered} routes={navigationRoutes} />
        </Box>
      </Stack>

      <Flex
        ps="20px"
        pe={{ md: '20px', '2xl': '20px' }}
        mt="60px"
        borderRadius="30px"
        justifyContent={'center'}
        alignItems="center"
      >
        <SidebarCard mini={mini} hovered={hovered} />
      </Flex>
      <Flex mt="75px" mb="56px" justifyContent="center" alignItems="center">
        <Avatar
          h="48px"
          w="48px"
          name={user?.name || 'onRevolt'}
          src={user?.avatarUrl || undefined}
          me={
            mini === false
              ? '20px'
              : mini === true && hovered === true
              ? '20px'
              : '0px'
          }
        />
        <Box
          display={
            mini === false
              ? 'block'
              : mini === true && hovered === true
              ? 'block'
              : 'none'
          }
        >
          <Text color={textColor} fontSize="md" fontWeight="700">
            {user?.name || 'Nie zalogowano'}
          </Text>
          <Text color="secondaryGray.600" fontSize="sm" fontWeight="400">
            {userSubtitle(user)}
          </Text>
        </Box>
      </Flex>
    </Flex>
  );
}

export default SidebarContent;
