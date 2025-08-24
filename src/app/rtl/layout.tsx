'use client';
// Chakra imports
import { Portal, Box, useDisclosure } from '@chakra-ui/react';
import Footer from 'components/footer/FooterAdmin';
// Layout components
import Navbar from 'components/navbar/NavbarRTL';
import Sidebar from 'components/sidebar/Sidebar';
import { RtlProvider } from 'components/rtlProvider/RtlProvider';
import { SidebarContext } from 'contexts/SidebarContext';
import { useContext, useState } from 'react';
import { ConfiguratorContext } from 'contexts/ConfiguratorContext';
import routes from 'routes';
import { usePathname } from 'next/navigation';
import {
  getActiveNavbar,
  getActiveRoute,
  isWindowAvailable,
} from 'utils/navigation';

// Custom Chakra theme
export default function Dashboard({ children }: { children: React.ReactNode }) {
  // states and functions
  const [fixed] = useState(false);
  const [toggleSidebar, setToggleSidebar] = useState(false);
  const context = useContext(ConfiguratorContext);
  const { mini, hovered, setHovered } = context;
  const pathname = usePathname();
  if (isWindowAvailable()) document.documentElement.dir = 'rtl';
  const { onOpen } = useDisclosure();
  return (
    <RtlProvider>
      <SidebarContext.Provider
        value={{
          toggleSidebar,
          setToggleSidebar,
        }}
      >
        <Sidebar
          routes={routes}
          display="none"
          hovered={hovered}
          setHovered={setHovered}
          mini={mini}
        />
        <Box
          float="left"
          minHeight="100vh"
          height="100%"
          overflow="auto"
          position="relative"
          maxHeight="100%"
          w={
            mini === false
              ? { base: '100%', xl: 'calc( 100% - 325px )' }
              : mini === true && hovered === true
              ? { base: '100%', xl: 'calc( 100% - 325px )' }
              : { base: '100%', xl: 'calc( 100% - 155px )' }
          }
          maxWidth={
            mini === false
              ? { base: '100%', xl: 'calc( 100% - 325px )' }
              : mini === true && hovered === true
              ? { base: '100%', xl: 'calc( 100% - 325px )' }
              : { base: '100%', xl: 'calc( 100% - 155px )' }
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

          {children}
          <Box>
            <Footer />
          </Box>
        </Box>
      </SidebarContext.Provider>
    </RtlProvider>
  );
}
