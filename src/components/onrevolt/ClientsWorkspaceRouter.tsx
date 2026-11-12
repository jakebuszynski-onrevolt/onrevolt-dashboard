'use client';

import { Alert, AlertIcon, Flex, Spinner } from '@chakra-ui/react';
import ClientProfile from 'components/onrevolt/ClientProfile';
import ClientsWorkspace from 'components/onrevolt/ClientsWorkspace';
import SiteVisitsWorkspace from 'components/onrevolt/SiteVisitsWorkspace';
import { useEffect, useState } from 'react';

type CurrentStaffUser = {
  siteVisitsOnly?: boolean;
};

export default function ClientsWorkspaceRouter({ clientId }: { clientId?: string }) {
  const [user, setUser] = useState<CurrentStaffUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok || !payload?.ok || !payload.data) {
          throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
        }
        if (active) setUser(payload.data);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  if (loading) {
    return <Flex justify="center" pt={{ base: '150px', md: '110px' }}><Spinner color="brand.500" /></Flex>;
  }
  if (error || !user) {
    return (
      <Alert status="error" borderRadius="10px" mt={{ base: '110px', md: '70px' }}>
        <AlertIcon />Nie udało się potwierdzić dostępu do widoku klientów. {error}
      </Alert>
    );
  }

  if (user.siteVisitsOnly) return <SiteVisitsWorkspace clientId={clientId} />;
  return clientId ? <ClientProfile clientId={clientId} /> : <ClientsWorkspace />;
}
