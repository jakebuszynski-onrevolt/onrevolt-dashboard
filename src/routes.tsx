import { Icon } from '@chakra-ui/react';
import {
  MdBarChart,
  MdBusinessCenter,
  MdConstruction,
  MdDashboard,
  MdEngineering,
  MdFolder,
  MdSettings,
  MdTune,
} from 'react-icons/md';
import { IRoute } from 'types/navigation';

const iconProps = {
  width: '20px',
  height: '20px',
  color: 'inherit',
};

const child = (name: string, path: string, requiredPermission?: string): IRoute => ({
  name,
  layout: '/admin',
  path,
  requiredPermission,
});

const routes: IRoute[] = [
  {
    name: 'Dashboard',
    layout: '/admin',
    path: '/dashboard',
    icon: <Icon as={MdDashboard} {...iconProps} />,
  },
  {
    name: 'Sprzedaż',
    path: '/sales',
    collapse: true,
    icon: <Icon as={MdBusinessCenter} {...iconProps} />,
    items: [
      child('Klienci i projekty', '/clients'),
      child('Lejek sprzedaży', '/pipeline'),
      {
        ...child('Zadania i aktywności', '/tasks'),
        href: '/admin/tasks?scope=assigned',
      },
      child('Oferty i umowy', '/offers', 'offers.manage'),
    ],
  },
  {
    name: 'Technika',
    path: '/technical',
    collapse: true,
    icon: <Icon as={MdTune} {...iconProps} />,
    items: [
      child('Audyty i energia', '/audits', 'energy.manage'),
      child('Konfigurator', '/configurator', 'configurations.manage'),
      child('Katalog urządzeń', '/catalog'),
    ],
  },
  {
    name: 'Realizacja',
    path: '/delivery',
    collapse: true,
    icon: <Icon as={MdConstruction} {...iconProps} />,
    items: [
      child('Zamówienia i dostawy', '/orders', 'installations.manage'),
      child('Montaże', '/installations', 'installations.manage'),
      child('OSD i odbiory', '/osd', 'installations.manage'),
    ],
  },
  {
    name: 'Posprzedaż',
    path: '/after-sales',
    collapse: true,
    icon: <Icon as={MdEngineering} {...iconProps} />,
    items: [
      child('Urządzenia klientów', '/devices'),
      child('Serwis i gwarancje', '/service', 'service.manage'),
    ],
  },
  {
    name: 'Dokumenty',
    layout: '/admin',
    path: '/documents',
    icon: <Icon as={MdFolder} {...iconProps} />,
  },
  {
    name: 'Raporty',
    layout: '/admin',
    path: '/reports',
    icon: <Icon as={MdBarChart} {...iconProps} />,
    requiredPermission: 'reports.read',
  },
  {
    name: 'Administracja',
    path: '/administration',
    collapse: true,
    icon: <Icon as={MdSettings} {...iconProps} />,
    items: [
      child('Synchronizacja', '/synchronization', 'synchronization.manage'),
      child('Użytkownicy i role', '/settings', 'users.manage'),
      child('Workflow i słowniki', '/workflow', 'settings.manage'),
    ],
  },
  {
    name: 'Profil',
    layout: '/admin',
    path: '/profile',
    hidden: true,
  },
];

export default routes;
