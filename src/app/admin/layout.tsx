'use client';
// Chakra imports
import { Portal, Box, useDisclosure } from '@chakra-ui/react';
import Footer from 'components/footer/FooterAdmin';
// Layout components
import Navbar from 'components/navbar/NavbarAdmin';
import Sidebar from 'components/sidebar/Sidebar';
import { usePathname } from 'next/navigation';
import { useContext, useState } from 'react';
import { ConfiguratorContext } from 'contexts/ConfiguratorContext';
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
  if (isWindowAvailable()) document.documentElement.dir = 'ltr';
  const { onOpen } = useDisclosure();
  const context = useContext(ConfiguratorContext);
  const { mini, hovered, setHovered } = context;
  return (
    <Box>
      <Sidebar
        mini={mini}
        routes={routes}
        hovered={hovered}
        setHovered={setHovered}
      />
      <Box
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
