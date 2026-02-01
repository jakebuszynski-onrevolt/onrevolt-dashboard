'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Badge, Box, Button, Flex, Heading, HStack, Select, Spinner, Table,
  Tbody, Td, Th, Thead, Tr, Text, useToast,
} from '@chakra-ui/react';
import Card from 'components/card/Card';
import { useSearchParams, useRouter } from 'next/navigation';

type MissingRow = {
  tf_ref: string;
  tf_title: string;
  tf_type: string;
  pd_suggested: { name: string; field_type: string; options?: string[] };
  exists_in_pipedrive?: boolean;
};

const BASE = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, ''); // np. "/panel"

export default function Page() {
  const sp = useSearchParams();
  const router = useRouter();
  const toast = useToast();

  const defaultFormId = process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID;
  const [formId, setFormId] = useState<string>(sp.get('form_id') || defaultFormId);
  const [entity, setEntity] = useState<'deal' | 'person'>((sp.get('entity') as any) || 'deal');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [missing, setMissing] = useState<MissingRow[]>([]);
  const [tfCount, setTfCount] = useState(0);
  const [pdCount, setPdCount] = useState(0);

  const query = useMemo(
    () =>
      `${BASE}/api/pipedrive/compare-typeform?form_id=${encodeURIComponent(
        formId
      )}&entity=${entity}`,
    [formId, entity]
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(query, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const data = await r.json();

      const rows: MissingRow[] = data.missing_on_pipedrive ?? data.missing ?? [];
      setMissing(rows);
      setTfCount((data.typeform_fields || []).length);
      setPdCount((data.pipedrive_fields || []).length);
    } catch (e: any) {
      setError(e?.message || 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // aktualizuj ładnie URL i odświeżaj dane
    const usp = new URLSearchParams(sp.toString());
    usp.set('form_id', formId);
    usp.set('entity', entity);
    router.replace(`?${usp.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, entity]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function createField(row: MissingRow) {
    try {
      const body = {
        entity,
        name: row.pd_suggested.name,              // już zawiera 'raport_'
        field_type: row.pd_suggested.field_type,
        options: row.pd_suggested.options ?? [],
      };
      const r = await fetch(`${BASE}/api/pipedrive/create-field`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`${r.status} ${t}`);
      }
      toast({ title: `Field "${body.name}" created`, status: 'success', duration: 3000 });
      // lokalnie zdejmij wiersz z listy
      setMissing((prev) => prev.filter((m) => m.pd_suggested.name !== row.pd_suggested.name));
    } catch (e: any) {
      toast({ title: 'Create failed', description: e?.message, status: 'error', duration: 5000 });
    }
  }

  return (
    <Flex direction="column" pt={{ sm: '125px', lg: '75px' }}>
      <Card px="24px" py="24px" mb="16px">
        <HStack justify="space-between" align="center" wrap="wrap" gap={4}>
          <Heading size="md">Fields Compare</Heading>
          <HStack>
            <Box>
              <Text fontSize="sm" mb="1">Form ID</Text>
              <Select size="sm" value={formId} onChange={(e) => setFormId(e.target.value)} minW="260px">
                <option value={defaultFormId}>{defaultFormId}</option>
              </Select>
            </Box>
            <Box>
              <Text fontSize="sm" mb="1">Entity</Text>
              <Select size="sm" value={entity} onChange={(e) => setEntity(e.target.value as any)} minW="140px">
                <option value="deal">deal</option>
                <option value="person">person</option>
              </Select>
            </Box>
            <Button size="sm" onClick={load} isLoading={loading}>Refresh</Button>
          </HStack>
        </HStack>
        <HStack mt="12px" spacing={6}>
          <Badge colorScheme="purple">TF FIELDS: {tfCount}</Badge>
          <Badge colorScheme="blue">PD FIELDS: {pdCount}</Badge>
          <Badge colorScheme={missing.length ? 'orange' : 'green'}>MISSING: {missing.length}</Badge>
        </HStack>
      </Card>

      <Card px="0">
        {loading && (
          <Flex p="24px" align="center" gap="10px">
            <Spinner /> <Text>Loading…</Text>
          </Flex>
        )}

        {!loading && error && (
          <Box p="24px"><Text color="red.400">{error}</Text></Box>
        )}

        {!loading && !error && missing.length === 0 && (
          <Box p="24px">
            <Text>Brak brakujących pól – wszystko jest w Pipedrive.</Text>
          </Box>
        )}

        {!loading && !error && missing.length > 0 && (
          <Box p="12px 24px 24px">
            <Table variant="simple">
              <Thead>
                <Tr>
                  <Th>Typeform field</Th>
                  <Th>TF type</Th>
                  <Th>Suggested PD name</Th>
                  <Th>PD type</Th>
                  <Th>Options</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <Tbody>
                {missing.map((row) => (
                  <Tr key={row.tf_ref}>
                    <Td>{row.tf_title}</Td>
                    <Td><Badge>{row.tf_type}</Badge></Td>
                    <Td><Text fontFamily="mono">{row.pd_suggested.name}</Text></Td>
                    <Td><Badge colorScheme="cyan">{row.pd_suggested.field_type}</Badge></Td>
                    <Td>{(row.pd_suggested.options ?? []).slice(0, 6).join(', ')}
                      {(row.pd_suggested.options ?? []).length > 6 ? '…' : ''}</Td>
                    <Td textAlign="right">
                      <Button size="sm" onClick={() => createField(row)}>Create</Button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        )}
      </Card>
    </Flex>
  );
}
