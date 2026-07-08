import { Icon } from '@chakra-ui/react';
import {
  MdAssignment,
  MdBarChart,
  MdBuild,
  MdConstruction,
  MdDashboard,
  MdDescription,
  MdFolder,
  MdInventory,
  MdPeople,
  MdSettings,
  MdSync,
  MdTune,
  MdViewColumn,
} from 'react-icons/md';

import { IRoute } from 'types/navigation';

const iconProps = {
  width: '20px',
  height: '20px',
  color: 'inherit',
};

const routes: IRoute[] = [
  {
    name: 'Dashboard',
    layout: '/admin',
    path: '/dashboard',
    icon: <Icon as={MdDashboard} {...iconProps} />,
  },
  {
    name: 'Klienci',
    layout: '/admin',
    path: '/clients',
    icon: <Icon as={MdPeople} {...iconProps} />,
  },
  {
    name: 'Lejek / Etapy',
    layout: '/admin',
    path: '/pipeline',
    icon: <Icon as={MdViewColumn} {...iconProps} />,
  },
  {
    name: 'Konfigurator',
    layout: '/admin',
    path: '/configurator',
    icon: <Icon as={MdTune} {...iconProps} />,
  },
  {
    name: 'Katalog urządzeń',
    layout: '/admin',
    path: '/catalog',
    icon: <Icon as={MdInventory} {...iconProps} />,
  },
  {
    name: 'Oferty i umowy',
    layout: '/admin',
    path: '/offers',
    icon: <Icon as={MdDescription} {...iconProps} />,
  },
  {
    name: 'Montaże',
    layout: '/admin',
    path: '/installations',
    icon: <Icon as={MdConstruction} {...iconProps} />,
  },
  {
    name: 'Serwis',
    layout: '/admin',
    path: '/service',
    icon: <Icon as={MdBuild} {...iconProps} />,
  },
  {
    name: 'Dokumenty',
    layout: '/admin',
    path: '/documents',
    icon: <Icon as={MdFolder} {...iconProps} />,
  },
  {
    name: 'Zadania i przypomnienia',
    layout: '/admin',
    path: '/tasks',
    icon: <Icon as={MdAssignment} {...iconProps} />,
  },
  {
    name: 'Synchronizacja',
    layout: '/admin',
    path: '/synchronization',
    icon: <Icon as={MdSync} {...iconProps} />,
  },
  {
    name: 'Raporty',
    layout: '/admin',
    path: '/reports',
    icon: <Icon as={MdBarChart} {...iconProps} />,
  },
  {
    name: 'Ustawienia',
    layout: '/admin',
    path: '/settings',
    icon: <Icon as={MdSettings} {...iconProps} />,
  },
  {
    name: 'Profil',
    layout: '/admin',
    path: '/profile',
    hidden: true,
  },
];

export default routes;
