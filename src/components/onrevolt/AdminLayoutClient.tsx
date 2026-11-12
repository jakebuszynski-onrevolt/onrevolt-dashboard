'use client';
// Chakra imports
import { Portal, Box, Flex, Spinner, useDisclosure } from '@chakra-ui/react';
import Footer from 'components/footer/FooterAdmin';
// Layout components
import Navbar from 'components/navbar/NavbarAdmin';
import Sidebar from 'components/sidebar/Sidebar';
import { usePathname, useRouter } from 'next/navigation';
import { useContext, useEffect, useState } from 'react';
import { ConfiguratorContext } from 'contexts/ConfiguratorContext';
import { isSiteVisitPage } from 'lib/onrevolt/site-visit-navigation';
import routes from 'routes';
import {
  getActiveNavbar,
  getActiveRoute,
  isWindowAvailable,
} from 'utils/navigation';

// Custom Chakra thems
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // states and functions
  const [fixed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const currentPath = pathname || '';
  const [validatedPath, setValidatedPath] = useState<string | null>(null);
  if (isWindowAvailable()) document.documentElement.dir = 'ltr';
  const { onOpen } = useDisclosure();
  const context = useContext(ConfiguratorContext);
  const { mini, hovered, setHovered } = context;

  useEffect(() => {
    let active = true;
    setValidatedPath(null);
    void (async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || !payload?.ok || !payload.data) {
          throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
        }
        if (!active) return;
        if (payload.data.siteVisitsOnly && !isSiteVisitPage(currentPath)) {
          router.replace('/admin/clients');
          return;
        }
        setValidatedPath(currentPath);
      } catch {
        if (active) router.replace('/auth/sign-in/default');
      }
    })();
    return () => { active = false; };
  }, [currentPath, router]);

  if (validatedPath !== currentPath) {
    return <Flex minH="100vh" align="center" justify="center"><Spinner color="brand.500" /></Flex>;
  }

  return (
    <Box>
      <Sidebar
        mini={mini}
        routes={routes}
        hovered={hovered}
        setHovered={setHovered}
      />
      <Box
        data-crm-content="true"
        float="right"
        minHeight="100vh"
        height="100%"
        overflow="auto"
        position="relative"
        maxHeight="100%"
        w={
          mini === false
            ? { base: '100%', xl: 'calc( 100% - 290px )' }
            : mini === true && hovered === true
            ? { base: '100%', xl: 'calc( 100% - 290px )' }
            : { base: '100%', xl: 'calc( 100% - 120px )' }
        }
        maxWidth={
          mini === false
            ? { base: '100%', xl: 'calc( 100% - 290px )' }
            : mini === true && hovered === true
            ? { base: '100%', xl: 'calc( 100% - 290px )' }
            : { base: '100%', xl: 'calc( 100% - 120px )' }
        }
        transition="all 0.33s cubic-bezier(0.685, 0.0473, 0.346, 1)"
        transitionDuration=".2s, .2s, .35s"
        transitionProperty="top, bottom, width"
        transitionTimingFunction="linear, linear, ease"
      >
        <Portal>
          <Box>
            <Navbar
              onOpen={onOpen}
              logoText={'Horizon UI Dashboard PRO'}
              brandText={getActiveRoute(routes, pathname)}
              secondary={getActiveNavbar(routes, pathname)}
              fixed={fixed}
            />
          </Box>
        </Portal>

        <Box
          mx="auto"
          p={{ base: '20px', md: '30px' }}
          pe="20px"
          minH="100vh"
          pt="50px"
        >
          {children}
        </Box>
        <Box>
          <Footer />
        </Box>
      </Box>
    </Box>
  );
}
