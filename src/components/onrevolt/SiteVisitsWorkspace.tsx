'use client';

import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Input,
  Select,
  Spinner,
  Text,
  useColorModeValue,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import ClientSiteAuditPanel from 'components/onrevolt/ClientSiteAuditPanel';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MdArrowBack, MdRefresh, MdSearch } from 'react-icons/md';

type SiteVisitContact = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
};

type SiteVisitClient = {
  id: string;
  displayName: string;
  clientType: string;
  contacts?: SiteVisitContact[];
};

type SiteVisitProject = {
  id: string;
  title: string;
  clientId: string;
  clientType?: string | null;
  locationAddress?: string | null;
  investmentSite?: { fullAddress?: string | null; addressLine?: string | null } | null;
  client?: SiteVisitClient;
  energyAudits?: unknown[];
  existingAssets?: unknown[];
  configurations?: Array<{ id: string; projectId: string; name: string; kind: string }>;
};

type SiteVisitList = {
  projects: Array<SiteVisitProject & { client: SiteVisitClient }>;
  stage: { name: string };
};

type SiteVisitDetail = {
  client: SiteVisitClient;
  projects: SiteVisitProject[];
  staffUsers: Array<{ id: string; name: string }>;
  configurations: Array<{ id: string; projectId: string; name: string; kind: string }>;
  currentUser: { id?: string | null; systemRole?: string | null } | null;
};

function responseData<T>(payload: any, response: Response): T {
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  }
  return payload.data as T;
}

function projectAddress(project: SiteVisitProject) {
  return project.investmentSite?.fullAddress
    || project.investmentSite?.addressLine
    || project.locationAddress
    || 'Adres inwestycji do uzupełnienia';
}

export default function SiteVisitsWorkspace({ clientId }: { clientId?: string }) {
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('site-visit');
  const [refreshKey, setRefreshKey] = useState(0);
  const [list, setList] = useState<SiteVisitList | null>(null);
  const [detail, setDetail] = useState<SiteVisitDetail | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const textColor = useColorModeValue('secondaryGray.900', 'white');
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const inputBg = useColorModeValue('white', 'navy.800');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      setList(null);
      setDetail(null);
      setSelectedProjectId('');
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      else if (query.trim()) params.set('q', query.trim());
      const queryString = params.toString();
      const suffix = queryString ? `?${queryString}` : '';
      try {
        const response = await fetch(`/api/site-visits${suffix}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!active) return;
        const data = responseData<SiteVisitList | SiteVisitDetail>(payload, response);
        if (clientId) setDetail(data as SiteVisitDetail);
        else setList(data as SiteVisitList);
      } catch (reason) {
        if (active && !(reason instanceof Error && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (active) setLoading(false);
      }
    }, clientId || !query.trim() ? 0 : 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [clientId, query, refreshKey]);

  const projects = detail?.projects || [];
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || projects[0];

  if (clientId) {
    return (
      <Flex direction="column" pt={{ base: '110px', md: '70px' }} gap="18px">
        <Card p={{ base: '18px', md: '24px' }}>
          <Flex align="center" gap="12px" mb="14px">
            <Button as={Link} href="/admin/clients" variant="outline" leftIcon={<MdArrowBack />}>
              Lista wizji
            </Button>
            <Badge colorScheme="purple" borderRadius="8px" px="10px" py="4px">
              Wizja Lokalna
            </Badge>
            <Button ms="auto" variant="ghost" leftIcon={<MdRefresh />} onClick={() => setRefreshKey((value) => value + 1)} isLoading={loading}>
              Odśwież
            </Button>
          </Flex>
          {loading ? (
            <Flex justify="center" py="10"><Spinner color="brand.500" /></Flex>
          ) : error ? (
            <Alert status="error" borderRadius="10px"><AlertIcon />{error}</Alert>
          ) : !detail?.client ? (
            <Alert status="info" borderRadius="10px"><AlertIcon />Nie znaleziono klienta z projektem na etapie Wizja Lokalna.</Alert>
          ) : (
            <>
              <Text color={textColor} fontSize="2xl" fontWeight="800">{detail.client.displayName}</Text>
              <Text color={mutedColor} mt="4px">
                {detail.client.contacts?.[0]?.name || 'Kontakt'}
                {detail.client.contacts?.[0]?.phone ? ` · ${detail.client.contacts[0].phone}` : ''}
                {detail.client.contacts?.[0]?.email ? ` · ${detail.client.contacts[0].email}` : ''}
              </Text>
              {projects.length === 0 ? (
                <Alert status="info" borderRadius="10px" mt="16px">
                  <AlertIcon />Ten klient nie ma projektu na etapie Wizja Lokalna.
                </Alert>
              ) : (
                <FormControl mt="18px" maxW="720px">
                  <FormLabel color={textColor} fontWeight="700">Projekt i adres inwestycji</FormLabel>
                  <Select
                    value={selectedProject?.id || ''}
                    onChange={(event) => setSelectedProjectId(event.target.value)}
                    bg={inputBg}
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title} · {projectAddress(project)}
                      </option>
                    ))}
                  </Select>
                </FormControl>
              )}
            </>
          )}
        </Card>

        {detail?.client && selectedProject ? (
          <ClientSiteAuditPanel
            key={selectedProject.id}
            clientId={detail.client.id}
            client={detail.client}
            project={{
              ...selectedProject,
              configurations: detail.configurations.filter((configuration) => configuration.projectId === selectedProject.id),
            }}
            staffUsers={(detail.staffUsers || []).map((user) => ({ ...user, email: '' }))}
            currentUser={detail.currentUser}
          />
        ) : null}
      </Flex>
    );
  }

  return (
    <Flex direction="column" pt={{ base: '110px', md: '70px' }} gap="18px">
      <Card p={{ base: '18px', md: '24px' }}>
        <Flex direction={{ base: 'column', md: 'row' }} align={{ md: 'center' }} gap="14px">
          <Box flex="1">
            <Badge colorScheme="purple" mb="10px" borderRadius="8px" px="10px" py="4px">
              CRM
            </Badge>
            <Text color={textColor} fontSize="2xl" fontWeight="800">Klienci i projekty</Text>
            <Text color={mutedColor} mt="4px">Projekty oczekujące na wizję lokalną.</Text>
          </Box>
          <Button variant="outline" leftIcon={<MdRefresh />} onClick={() => setRefreshKey((value) => value + 1)} isLoading={loading}>
            Odśwież
          </Button>
        </Flex>
        <FormControl mt="18px" maxW="720px">
          <FormLabel color={textColor} fontWeight="700">Szukaj klienta lub projektu</FormLabel>
          <Flex align="center" gap="9px">
            <MdSearch aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nazwa, kontakt, telefon, adres lub projekt"
              bg={inputBg}
            />
          </Flex>
        </FormControl>
        <FormControl mt="18px" maxW="360px">
          <FormLabel color={textColor} fontWeight="700">Etap procesu</FormLabel>
          <Select aria-label="Etap procesu" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)} bg={inputBg}>
            <option value="all">Wszystkie</option>
            <option value="site-visit">Wizja Lokalna</option>
          </Select>
          <Text color={mutedColor} fontSize="sm" mt="6px">Wszystkie obejmuje tylko projekty dostępne w ramach wizji lokalnych.</Text>
        </FormControl>
      </Card>

      {error ? <Alert status="error" borderRadius="10px"><AlertIcon />{error}</Alert> : null}
      <Card p={{ base: '18px', md: '24px' }}>
        {loading ? (
          <Flex justify="center" py="12"><Spinner color="brand.500" /></Flex>
        ) : list?.projects.length ? (
          <Flex direction="column" gap="10px">
            {list.projects.map((project) => (
              <Flex
                key={project.id}
                as={Link}
                href={`/admin/clients/${encodeURIComponent(project.clientId)}`}
                direction={{ base: 'column', md: 'row' }}
                align={{ md: 'center' }}
                gap="10px"
                p="14px 16px"
                border="1px solid"
                borderColor="secondaryGray.200"
                borderRadius="12px"
                _hover={{ bg: 'blackAlpha.50', textDecoration: 'none' }}
              >
                <Box flex="1" minW="0">
                  <Text color={textColor} fontWeight="800" noOfLines={1}>{project.client.displayName}</Text>
                  <Text color={mutedColor} fontSize="sm" noOfLines={1}>
                    {project.client.contacts?.[0]?.name || project.client.contacts?.[0]?.phone || project.client.contacts?.[0]?.email || 'Brak danych kontaktowych'}
                  </Text>
                </Box>
                <Box flex="1" minW="0">
                  <Text color={textColor} fontWeight="700" noOfLines={1}>{project.title}</Text>
                  <Text color={mutedColor} fontSize="sm" noOfLines={1}>{projectAddress(project)}</Text>
                </Box>
                <Badge colorScheme="purple" alignSelf={{ base: 'start', md: 'center' }}>
                  {list.stage?.name || 'Wizja Lokalna'}
                </Badge>
              </Flex>
            ))}
          </Flex>
        ) : (
          <Text color={mutedColor} py="10" textAlign="center">
            Brak projektów na etapie Wizja Lokalna.
          </Text>
        )}
      </Card>
    </Flex>
  );
}
