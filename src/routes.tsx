import { Icon } from '@chakra-ui/react';
import {
  MdDashboard,
  MdHome,
  MdLock,
  MdOutlineShoppingCart,
} from 'react-icons/md';

// Auth Imports
import { IRoute } from 'types/navigation';

import { MdShield, MdPersonAdd, MdList } from 'react-icons/md';
import { visibility } from 'html2canvas/dist/types/css/property-descriptors/visibility';

const routes: IRoute[] = [
  // --- Dashboards ---
  {
    name: 'Dashboards',
    layout: '/admin',
    path: '/dashboards/default',
    icon: <Icon as={MdHome} width="20px" height="20px" color="inherit" />,
  },
  {
    name: 'Baza Klientów',
    path: '/dashboards',
    icon: (
      <Icon
        as={MdOutlineShoppingCart}
        width="20px"
        height="20px"
        color="inherit"
      />
    ),
    collapse: true,
    roles: [0, 1],
    items: [
      {
        name: 'New Deal',
        layout: '/admin',
        path: '/main/users/new-user',
      },
      {
        name: 'Deals List',
        layout: '/admin',
        path: '/main/users/users-overview',
      },
      {
        name: 'Baza Klientów / Edytor',
        layout: '/admin',
        path: '/main/users/user-offer',
        hidden: true,
        // reszta bez zmian / wg potrzeb
      },
    ],
  },
  {
    name: 'Super User',
    path: '/super',
    icon: <Icon as={MdLock} width="20px" height="20px" color="inherit" />,
    collapse: true,
    /** <-- widoczne tylko dla roli 1 */
    roles: [1],
    items: [
      {
        name: 'Edytor konfiguracji',
        layout: '/admin',
        path: '/main/users/config-editor',
      },
      {
        name: 'Add seller',
        layout: '/auth',
        path: '/sign-up',       // => /panel/auth/sign-up
      },
      {
        name: 'Sellers list',
        layout: '/admin',
        path: '/main/users/seller-list',       // na razie ten sam adres (placeholder)
      },
      {
        name: 'Fields Compare',
        layout: '/admin',
        path: '/main/users/fields-compare', // <-- nasza nowa strona
      },
      {
        name: 'Fields Organizing',
        layout: '/admin',
        path: '/main/users/fields-organizing', // <-- nasza nowa strona
      },
    ],
  },
  // // --- Main pages ---
  {
    name: 'old',
    path: '/main',
    icon: <Icon as={MdDashboard} width="20px" height="20px" color="inherit" />,
    collapse: true,
    roles: [1],
    items: [
      {
        name: 'Account',
        path: '/main/account',
        collapse: true,
        items: [
          {
            name: 'Billing',
            layout: '/admin',
            path: '/main/account/billing',
          },
          {
            name: 'Application',
            layout: '/admin',
            path: '/main/account/application',
          },
          {
            name: 'Invoice',
            layout: '/admin',
            path: '/main/account/invoice',
          },
          {
            name: 'Settings',
            layout: '/admin',
            path: '/main/account/settings',
          },
          {
            name: 'All Courses',
            layout: '/admin',
            path: '/main/account/all-courses',
          },
          {
            name: 'Course Page',
            layout: '/admin',
            path: '/main/account/course-page',
          },
        ],
      },
      {
        name: 'Ecommerce',
        path: '/main/users',
        collapse: true,
        items: [
          {
            name: 'New Product',
            layout: '/admin',
            path: '/main/ecommerce/new-product',
          },
          {
            name: 'Product Settings',
            layout: '/admin',
            path: '/main/ecommerce/settings',
          },
          {
            name: 'Product Page',
            layout: '/admin',
            path: '/main/ecommerce/page-example',
          },
          {
            name: 'Order List',
            layout: '/admin',
            path: '/main/ecommerce/order-list',
          },
          {
            name: 'Order Details',
            layout: '/admin',
            path: '/main/ecommerce/order-details',
          },
          {
            name: 'Referrals',
            layout: '/admin',
            path: '/main/ecommerce/referrals',
          },
        ],
      },
      {
        name: 'Users',
        path: '/main/users',
        collapse: true,
        items: [
          {
            name: 'New User',
            layout: '/admin',
            path: '/main/users/new-user',
          },
          {
            name: 'Users Overview',
            layout: '/admin',
            path: '/main/users/users-overview',
          },
          {
            name: 'Fields Compare',
            layout: '/admin',
            path: '/main/users/fields-compare', // <-- nasza nowa strona
          },
          {
            name: 'Users Reports',
            layout: '/admin',
            path: '/main/users/users-reports',
          },
        ],
      },
      {
        name: 'Applications',
        path: '/main/applications',
        collapse: true,
        items: [
          {
            name: 'Kanban',
            layout: '/admin',
            path: '/main/applications/kanban',
          },
          {
            name: 'Data Tables',
            layout: '/admin',
            path: '/main/applications/data-tables',
          },
          {
            name: 'Calendar',
            layout: '/admin',
            path: '/main/applications/calendar',
          },
        ],
      },
      {
        name: 'Profile',
        path: '/main/profile',
        collapse: true,
        items: [
          {
            name: 'Profile Overview',
            layout: '/admin',
            path: '/main/profile/overview',
          },
          {
            name: 'Profile Settings',
            layout: '/admin',
            path: '/main/profile/settings',
          },
          {
            name: 'News Feed',
            layout: '/admin',
            path: '/main/profile/newsfeed',
          },
        ],
      },
      {
        name: 'Others',
        path: '/main/others',
        collapse: true,
        items: [
          {
            name: 'Notifications',
            layout: '/admin',
            path: '/main/others/notifications',
          },
          {
            name: 'Messages',
            layout: '/admin',
            path: '/main/others/messages',
          },
          {
            name: 'Pricing',
            layout: '/auth',
            path: '/main/others/pricing',
          },
          {
            name: '404',
            layout: '/admin',
            path: '/main/others/404',
          },
        ],
      },
      // // --- NFTs ---
      {
        name: 'OLD_NFTs',
        path: '/nfts',
        icon: (
          <Icon
            as={MdOutlineShoppingCart}
            width="20px"
            height="20px"
            color="inherit"
          />
        ),
        collapse: true,
        items: [
          {
            name: 'Marketplace',
            layout: '/admin',
            path: '/nfts/marketplace',
            secondary: true,
          },
          {
            name: 'Collection',
            layout: '/admin',
            path: '/nfts/collection',
            secondary: true,
          },
          {
            name: 'NFT Page',
            layout: '/admin',
            path: '/nfts/page',
            secondary: true,
          },
          {
            name: 'Profile',
            layout: '/admin',
            path: '/nfts/profile',
            secondary: true,
          },
        ],
      },
      {
        name: 'OLD_Dashboards',
        path: '/dashboards',
        icon: <Icon as={MdHome} width="20px" height="20px" color="inherit" />,
        collapse: true,
        items: [
          {
            name: 'Main Dashboard',
            layout: '/admin',
            path: '/dashboards/default',
          },
          {
            name: 'Car Interface',
            layout: '/admin',
            path: '/dashboards/car-interface',
          },
          {
            name: 'Smart Home',
            layout: '/admin',
            path: '/dashboards/smart-home',
          },
          {
            name: 'RTL',
            layout: '/rtl',
            path: '/dashboards/rtl',
          },
        ],
      },
      // --- Authentication ---
      {
        name: 'OLD_Authentication',
        path: '/auth',
        icon: <Icon as={MdLock} width="20px" height="20px" color="inherit" />,
        collapse: true,
        items: [
          {
            name: 'Default',
            layout: '/auth',
            path: '/sign-in/default',
          },
          {
            name: 'Centered',
            layout: '/auth',
            path: '/sign-in/centered',
          },
          {
            name: 'Default',
            layout: '/auth',
            path: '/sign-up',
          },
          {
            name: 'Centered',
            layout: '/auth',
            path: '/sign-up/centered',
          },
          {
            name: 'Default',
            layout: '/auth',
            path: '/verification/default',
          },
          {
            name: 'Centered',
            layout: '/auth',
            path: '/verification/centered',
          },
          {
            name: 'Default',
            layout: '/auth',
            path: '/lock/default',
          },
          {
            name: 'Centered',
            layout: '/auth',
            path: '/lock/centered',
          },
          {
            name: 'Default',
            layout: '/auth',
            path: '/forgot-password/default',
          },
          {
            name: 'Centered',
            layout: '/auth',
            path: '/forgot-password/centered',
          },
        ],
      },
    ],
  },
];

export default routes;
