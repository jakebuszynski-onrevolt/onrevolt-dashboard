'use client';
import {
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  Menu,
  MenuList,
  Stack,
  Text,
  useColorModeValue,
  useDisclosure,
  SimpleGrid,
} from '@chakra-ui/react';
import Link from 'components/link/Link';
import { Image } from 'components/image/Image';
import { HorizonLogo } from 'components/icons/Icons';
import { SidebarResponsive } from 'components/sidebar/Sidebar';
import { SidebarContext } from 'contexts/SidebarContext';
import dropdownMain from '/public/img/layout/dropdownMain.png';
import dropdown from '/public/img/layout/dropdown.png';
import { GoChevronDown } from 'react-icons/go';
import routes from 'routes';
import { IRoute } from 'types/navigation';
import { usePathname } from 'next/navigation';

export default function AuthNavbar(props: {
  logo?: JSX.Element | string;
  logoText?: string;
  secondary?: boolean;
  sidebarWidth?: any;
}) {
  const { logoText, sidebarWidth } = props;

  // router → czy jesteśmy w części admina?
  const pathname = usePathname();
  const isAdmin = Boolean(pathname && pathname.startsWith('/panel/admin'));

  // Menus state
  const { isOpen: isOpenAuth, onOpen: onOpenAuth, onClose: onCloseAuth } = useDisclosure();
  const { isOpen: isOpenDashboards, onOpen: onOpenDashboards, onClose: onCloseDashboards } = useDisclosure();
  const { isOpen: isOpenMain, onOpen: onOpenMain, onClose: onCloseMain } = useDisclosure();
  const { isOpen: isOpenNft, onOpen: onOpenNft, onClose: onCloseNft } = useDisclosure();

  // Helpers: routes safe access
  function getGroupItems(routeName: string): IRoute[] {
    const group = (routes as IRoute[]).find((r) => Array.isArray(r.items) && r.name === routeName);
    return Array.isArray(group?.items) ? group!.items! : [];
  }
  function flattenGroup(routeName: string): IRoute[] {
    const out: IRoute[] = [];
    for (const it of getGroupItems(routeName)) out.push(it);
    return out;
  }

  const authObject = flattenGroup('Authentication');
  const mainObject = flattenGroup('Main Pages');
  const dashboardsObject = getGroupItems('Dashboards');
  const nftsObject = getGroupItems('NFTs');

  const logoColor = useColorModeValue('white', 'white');
  const textColor = useColorModeValue('navy.700', 'white');
  const menuBg = useColorModeValue('white', 'navy.900');

  // Navbar visuals
  const mainText = '#fff';
  const navbarBg = 'none';
  const navbarShadow = 'initial';
  const bgButton = 'white';
  const colorButton = 'brand.500';
  const navbarPosition = 'absolute' as const;

  let brand = (
    <Link
      href={`/`}
      display="flex"
      lineHeight="100%"
      fontWeight="bold"
      justifyContent="center"
      alignItems="center"
      color={mainText}
    >
      <Stack direction="row" spacing="12px" alignItems="center" justify="left">
        <HorizonLogo h="26px" w="175px" color={logoColor} />
      </Stack>
      <Text fontSize="sm" mt="3px">
        {logoText}
      </Text>
    </Link>
  );

  if (props.secondary === true) {
    brand = (
      <Link
        minW="109px"
        href={`${process.env.PUBLIC_URL}/#/`}
        display="flex"
        lineHeight="100%"
        fontWeight="bold"
        justifyContent="center"
        alignItems="center"
        color={mainText}
      >
        <HorizonLogo h="19px" w="109px" my="32px" color={logoColor} />
      </Link>
    );
  }

  // Render helpers
  const createLinksFlat = (arr: IRoute[]) =>
    (arr || []).map((link, key) => (
      <Link key={key} href={(link.layout || '') + (link.path || '')} style={{ maxWidth: 'max-content' }}>
        <Text color="gray.400" fontSize="sm" fontWeight="500">
          {link.name}
        </Text>
      </Link>
    ));

  const createMainLinks = (arr: IRoute[]): JSX.Element[] =>
    (arr || []).map((link, key) => {
      if (link.collapse && Array.isArray(link.items)) {
        return (
          <Stack key={key} direction="column" maxW="max-content">
            <Stack direction="row" spacing="0px" alignItems="center" cursor="default">
              <Text textTransform="uppercase" fontWeight="bold" fontSize="sm" me="auto" color={textColor}>
                {link.name}
              </Text>
            </Stack>
            <Stack direction="column" bg={menuBg}>
              {createMainLinks(link.items)}
            </Stack>
          </Stack>
        );
      }
      return (
        <Link key={key} href={(link.layout || '') + (link.path || '')}>
          <Text color="gray.400" fontSize="sm" fontWeight="normal">
            {link.name}
          </Text>
        </Link>
      );
    });

  const createAuthLinks = (arr: IRoute[]): JSX.Element[] =>
    (arr || []).map((link, key) => {
      if (link.collapse && Array.isArray(link.items)) {
        return (
          <Stack key={key} direction="column" maxW="max-content">
            <Stack direction="row" spacing="0px" alignItems="center" cursor="default">
              <Text textTransform="uppercase" fontWeight="bold" fontSize="sm" me="auto" color={textColor}>
                {link.name}
              </Text>
            </Stack>
            <Stack direction="column" bg={menuBg}>
              {createAuthLinks(link.items)}
            </Stack>
          </Stack>
        );
      }
      return (
        <Link key={key} href={(link.layout || '') + (link.path || '')}>
          <Text color="gray.400" fontSize="sm" fontWeight="normal">
            {link.name}
          </Text>
        </Link>
      );
    });

  // Sekcja menu – renderowana TYLKO w admin
  const linksAuth = !isAdmin ? null : (
    <HStack display={{ sm: 'none', lg: 'flex' }} spacing="20px">
      {/* Dashboards */}
      <Stack
        direction="row"
        spacing="4px"
        alignItems="center"
        color="#fff"
        fontWeight="bold"
        onMouseEnter={onOpenDashboards}
        onMouseLeave={onCloseDashboards}
        cursor="pointer"
        position="relative"
      >
        <Text fontSize="sm" color={mainText}>
          Dashboards
        </Text>
        <Box>
          <Icon mt="8px" as={GoChevronDown} color={mainText} w="14px" h="14px" fontWeight="2000" />
        </Box>
        <Menu isOpen={isOpenDashboards}>
          <MenuList
            bg={menuBg}
            p="22px"
            cursor="default"
            borderRadius="15px"
            position="absolute"
            w="max-content"
            top="30px"
            left="-10px"
            display="flex"
          >
            <SimpleGrid columns={1} gap="8px" w="150px">
              {createLinksFlat(dashboardsObject)}
            </SimpleGrid>
            <Image w="110px" h="110px" borderRadius="16px" src={dropdown} alt="" />
          </MenuList>
        </Menu>
      </Stack>

      {/* NFTs */}
      <Stack
        direction="row"
        spacing="4px"
        alignItems="center"
        color="#fff"
        fontWeight="bold"
        onMouseEnter={onOpenNft}
        onMouseLeave={onCloseNft}
        cursor="pointer"
        position="relative"
      >
        <Text fontSize="sm" color={mainText}>
          NFTs
        </Text>
        <Box>
          <Icon mt="8px" as={GoChevronDown} color={mainText} w="14px" h="14px" fontWeight="2000" />
        </Box>
        <Menu isOpen={isOpenNft}>
          <MenuList
            bg={menuBg}
            p="22px"
            cursor="default"
            borderRadius="15px"
            position="absolute"
            w="max-content"
            top="30px"
            left="-10px"
            display="flex"
          >
            <SimpleGrid columns={1} gap="8px" w="150px">
              {createLinksFlat(nftsObject)}
            </SimpleGrid>
            <Image w="110px" h="110px" borderRadius="16px" src={dropdown} alt="" />
          </MenuList>
        </Menu>
      </Stack>

      {/* Main Pages */}
      <Stack
        direction="row"
        spacing="4px"
        alignItems="center"
        color="#fff"
        fontWeight="bold"
        onMouseEnter={onOpenMain}
        onMouseLeave={onCloseMain}
        cursor="pointer"
        position="relative"
      >
        <Text fontSize="sm" color={mainText}>
          Main Pages
        </Text>
        <Box>
          <Icon mt="8px" as={GoChevronDown} color={mainText} w="14px" h="14px" fontWeight="2000" />
        </Box>
        <Menu isOpen={isOpenMain}>
          <MenuList
            bg={menuBg}
            p="18px"
            ps="24px"
            cursor="default"
            borderRadius="15px"
            position="absolute"
            w="max-content"
            top="30px"
            left="-10px"
            display="flex"
          >
            <SimpleGrid me="50px" columns={2} alignItems="start" minW="280px" gap="24px">
              {createMainLinks(mainObject)}
            </SimpleGrid>
            <Image borderRadius="16px" src={dropdownMain} alt="" />
          </MenuList>
        </Menu>
      </Stack>

      {/* Authentications */}
      <Stack
        direction="row"
        spacing="4px"
        alignItems="center"
        color="#fff"
        fontWeight="bold"
        onMouseEnter={onOpenAuth}
        onMouseLeave={onCloseAuth}
        cursor="pointer"
        position="relative"
      >
        <Text fontSize="sm" color={mainText}>
          Authentications
        </Text>
        <Box>
          <Icon mt="8px" as={GoChevronDown} color={mainText} w="14px" h="14px" fontWeight="2000" />
        </Box>
        <Menu isOpen={isOpenAuth}>
          <MenuList
            bg={menuBg}
            p="22px"
            cursor="default"
            borderRadius="15px"
            position="absolute"
            top="30px"
            left="-10px"
            display="flex"
            w="max-content"
          >
            <SimpleGrid me="20px" columns={2} alignItems="start" minW="180px" gap="24px">
              {createAuthLinks(authObject)}
            </SimpleGrid>
            <Image borderRadius="16px" src={dropdown} alt="" />
          </MenuList>
        </Menu>
      </Stack>
    </HStack>
  );

  return (
    <SidebarContext.Provider value={{ sidebarWidth }}>
      <Flex
        position={navbarPosition}
        top="16px"
        left="50%
        "
        transform="translate(-50%, 0px)"
        background={navbarBg}
        boxShadow={navbarShadow}
        borderRadius="15px"
        px="16px"
        py="22px"
        mx="auto"
        width="1200px"
        maxW="100%"
        alignItems="center"
        zIndex="3"
      >
        <Flex w="100%" justifyContent={{ sm: 'start', lg: 'space-between' }}>
          {brand}

{/* show dropdown links only in admin */}
{isAdmin && linksAuth}


<HStack ms="auto" spacing="10px" align="center">
  {/* Burger only on mobile, only in admin */}
  {isAdmin && (
    <Box display={{ base: 'flex', lg: 'none' }} justifyContent="center" alignItems="center">
      <SidebarResponsive display="none" routes={routes} />
    </Box>
  )}

  {/* UE button – rightmost */}
  <Link href="/ue">
    <Button
      bg="white"
      color={colorButton}
      fontSize="xs"
      variant="no-effects"
      borderRadius="40px"
      h="46px"
      display={{ sm: 'flex', lg: 'flex' }}
    >
      <Image src="/img/onrevolt/ue_logo.png" w="150px" h="44px" alt="UE" />
    </Button>
  </Link>
</HStack>


        </Flex>
      </Flex>
    </SidebarContext.Provider>
  );
}
