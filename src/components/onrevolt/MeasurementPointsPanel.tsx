'use client';

import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  IconButton,
  Input,
  Spinner,
  Text,
  useColorModeValue,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MdAdd, MdArrowDownward, MdArrowUpward, MdClose, MdDeleteOutline, MdSearch } from 'react-icons/md';

type MeasurementPoint = {
  station: string;
  stationHash: string | null;
  name: string;
  location: string | null;
  order: number;
  parentStation: string | null;
  main: boolean;
  latestDataAt: string | null;
  fresh: boolean;
};

type PointDraft = { name: string; location: string };

type Props = {
  clientId: string;
  projectId: string;
  stationRef: string;
  canManage: boolean;
};

export default function MeasurementPointsPanel({ clientId, projectId, stationRef, canManage }: Props) {
  const [points, setPoints] = useState<MeasurementPoint[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PointDraft>>({});
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<MeasurementPoint[]>([]);
  const mutedColor = useColorModeValue('secondaryGray.600', 'secondaryGray.400');
  const borderColor = useColorModeValue('secondaryGray.200', 'whiteAlpha.200');
  const panelBg = useColorModeValue('secondaryGray.50', 'whiteAlpha.50');

  const syncPoints = useCallback((next: MeasurementPoint[]) => {
    setPoints(next);
    setDrafts(Object.fromEntries(next.map((point) => [point.station, {
      name: point.name,
      location: point.location || '',
    }])));
  }, []);

  const endpoint = useMemo(() => {
    const params = new URLSearchParams({ clientId, projectId });
    return `/api/integrations/re/measurement-points?${params.toString()}`;
  }, [clientId, projectId]);

  const load = useCallback(async () => {
    if (!stationRef) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      syncPoints(payload.data?.points || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [endpoint, stationRef, syncPoints]);

  useEffect(() => { load(); }, [load]);

  async function mutate(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>, actionKey: string) {
    setAction(actionKey);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/integrations/re/measurement-points', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, projectId, ...body }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      syncPoints(payload.data?.points || []);
      setMessage('Konfiguracja punktów pomiarowych została zapisana.');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setAction('');
    }
  }

  async function search() {
    const value = query.trim();
    if (!value) {
      setCandidates([]);
      setError('Wpisz numer lub nazwę stacji.');
      return;
    }
    setAction('search');
    setError('');
    try {
      const params = new URLSearchParams({ clientId, projectId, query: value });
      const response = await fetch(`/api/integrations/re/measurement-points?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
      setCandidates(payload.data?.candidates || []);
    } catch (cause) {
      setCandidates([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAction('');
    }
  }

  async function move(station: string, direction: -1 | 1) {
    const children = points.filter((point) => !point.main);
    const index = children.findIndex((point) => point.station === station);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= children.length) return;
    const ordered = [...children];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await mutate('PATCH', { orderedStations: ordered.map((point) => point.station) }, `order:${station}`);
  }

  if (!stationRef) return null;

  return (
    <Card p="22px">
      <Flex justify="space-between" align={{ base: 'stretch', md: 'center' }} direction={{ base: 'column', md: 'row' }} gap="12px" mb="16px">
        <Box>
          <Text fontSize="lg" fontWeight="800">Punkty pomiarowe</Text>
          <Text color={mutedColor} fontSize="sm">Stacja główna i przypisane do niej podstacje.</Text>
        </Box>
        {canManage ? (
          <Button
            leftIcon={searchOpen ? <MdClose /> : <MdAdd />}
            variant="outline"
            colorScheme="blue"
            onClick={() => setSearchOpen((current) => !current)}
          >
            {searchOpen ? 'Zamknij' : 'Dodaj podstację'}
          </Button>
        ) : null}
      </Flex>

      {error ? <Alert status="error" borderRadius="8px" mb="14px"><AlertIcon />{error}</Alert> : null}
      {message ? <Alert status="success" borderRadius="8px" mb="14px"><AlertIcon />{message}</Alert> : null}

      {searchOpen && canManage ? (
        <Box bg={panelBg} borderRadius="8px" p="14px" mb="16px">
          <Flex gap="10px" align="end" direction={{ base: 'column', md: 'row' }}>
            <FormControl>
              <FormLabel>Numer lub nazwa wolnej stacji</FormLabel>
              <Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') search(); }} />
            </FormControl>
            <Button leftIcon={<MdSearch />} onClick={search} isLoading={action === 'search'} minW="130px">Szukaj</Button>
          </Flex>
          {candidates.length ? (
            <Flex direction="column" mt="12px" gap="8px">
              {candidates.map((candidate) => (
                <Flex key={candidate.station} align="center" justify="space-between" gap="12px" borderTop="1px solid" borderColor={borderColor} pt="8px">
                  <Box>
                    <Text fontWeight="700">{candidate.name}</Text>
                    <Text color={mutedColor} fontSize="sm">Stacja {candidate.station}{candidate.location ? ` · ${candidate.location}` : ''}</Text>
                  </Box>
                  <Button
                    size="sm"
                    colorScheme="blue"
                    onClick={async () => {
                      if (await mutate('POST', { station: candidate.station }, `attach:${candidate.station}`)) {
                        setCandidates((current) => current.filter((item) => item.station !== candidate.station));
                      }
                    }}
                    isLoading={action === `attach:${candidate.station}`}
                  >
                    Dodaj
                  </Button>
                </Flex>
              ))}
            </Flex>
          ) : null}
        </Box>
      ) : null}

      {loading ? (
        <Flex justify="center" py="24px"><Spinner /></Flex>
      ) : (
        <Flex direction="column" gap="12px">
          {points.map((point, index) => {
            const draft = drafts[point.station] || { name: point.name, location: point.location || '' };
            const childIndex = points.filter((item) => !item.main).findIndex((item) => item.station === point.station);
            const childCount = points.filter((item) => !item.main).length;
            return (
              <Box key={point.station} border="1px solid" borderColor={borderColor} borderRadius="8px" p="14px">
                <Flex justify="space-between" align="center" mb="12px" gap="10px" wrap="wrap">
                  <Box>
                    <Text fontWeight="800">{point.main ? 'Punkt główny' : `Podstacja ${index}`}</Text>
                    <Text color={mutedColor} fontSize="sm">Stacja {point.station} · {point.fresh ? 'dane aktualne' : 'brak świeżych danych'}</Text>
                  </Box>
                  {canManage && !point.main ? (
                    <Flex gap="6px">
                      <IconButton aria-label="Przenieś wyżej" icon={<MdArrowUpward />} size="sm" variant="outline" isDisabled={childIndex <= 0} isLoading={action === `order:${point.station}`} onClick={() => move(point.station, -1)} />
                      <IconButton aria-label="Przenieś niżej" icon={<MdArrowDownward />} size="sm" variant="outline" isDisabled={childIndex < 0 || childIndex >= childCount - 1} isLoading={action === `order:${point.station}`} onClick={() => move(point.station, 1)} />
                      <IconButton aria-label="Odepnij podstację" icon={<MdDeleteOutline />} size="sm" colorScheme="red" variant="outline" isLoading={action === `detach:${point.station}`} onClick={() => mutate('DELETE', { station: point.station }, `detach:${point.station}`)} />
                    </Flex>
                  ) : null}
                </Flex>
                <Flex gap="12px" direction={{ base: 'column', lg: 'row' }} align="end">
                  <FormControl>
                    <FormLabel>Nazwa punktu</FormLabel>
                    <Input value={draft.name} isReadOnly={!canManage} onChange={(event) => setDrafts((current) => ({ ...current, [point.station]: { ...draft, name: event.target.value } }))} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Lokalizacja</FormLabel>
                    <Input value={draft.location} placeholder="—" isReadOnly={!canManage} onChange={(event) => setDrafts((current) => ({ ...current, [point.station]: { ...draft, location: event.target.value } }))} />
                  </FormControl>
                  {canManage ? (
                    <Button minW="110px" colorScheme="purple" isLoading={action === `save:${point.station}`} onClick={() => mutate('PATCH', { station: point.station, ...draft }, `save:${point.station}`)}>Zapisz</Button>
                  ) : null}
                </Flex>
              </Box>
            );
          })}
        </Flex>
      )}
    </Card>
  );
}
