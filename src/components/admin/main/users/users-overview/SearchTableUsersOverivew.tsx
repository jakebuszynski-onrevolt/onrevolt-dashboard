'use client';

import {
  Box,
  Button,
  Flex,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Text,
  Input,
} from '@chakra-ui/react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

type Row = {
  name: [string, string];
  email: string;
  username: string;
  date: string;
  type: string;
  editHref: string;
};

export default function SearchTableUsersOverivew({ tableData }: { tableData: Row[] }) {
  // proste wyszukiwanie + sort + paginacja (client-side)
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState<keyof Row>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    const rows = !text
      ? tableData
      : tableData.filter((r) =>
          [r.name[0], r.email, r.username, r.type]
            .join(' ')
            .toLowerCase()
            .includes(text)
        );
    const sorted = [...rows].sort((a, b) => {
      const av = a[sortBy] as any;
      const bv = b[sortBy] as any;
      if (av === bv) return 0;
      const res = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? res : -res;
    });
    return sorted;
  }, [tableData, q, sortBy, sortDir]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  const view = filtered.slice(start, start + pageSize);

  const toggleSort = (key: keyof Row) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  return (
    <Box p={6}>
      <Flex mb={4} align="center" gap={3}>
        <Input
          placeholder="Search users…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          maxW="320px"
        />
        <Text ml="auto" fontSize="sm" color="gray.500">
          {total} wyników
        </Text>
      </Flex>

      <Table variant="simple">
        <Thead>
          <Tr>
            <Th cursor="pointer" onClick={() => toggleSort('name')}>Name</Th>
            <Th cursor="pointer" onClick={() => toggleSort('email')}>Email</Th>
            <Th cursor="pointer" onClick={() => toggleSort('username')}>Owner</Th>
            <Th cursor="pointer" onClick={() => toggleSort('date')}>Date</Th>
            <Th cursor="pointer" onClick={() => toggleSort('type')}>Type</Th>
            <Th>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {view.map((row, idx) => (
            <Tr key={idx}>
              <Td>
                <Text fontWeight="600">{row.name[0]}</Text>
              </Td>
              <Td>{row.email}</Td>
              <Td>{row.username}</Td>
              <Td>{row.date}</Td>
              <Td>{row.type}</Td>
              <Td>
                <Button as={Link} href={row.editHref} colorScheme="purple" size="sm">
                  Edit user
                </Button>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>

      {/* paginacja */}
      <Flex mt={4} gap={2} align="center" justify="flex-end">
        <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} isDisabled={current <= 1}>
          Prev
        </Button>
        <Text fontSize="sm">
          {current} / {pages}
        </Text>
        <Button size="sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} isDisabled={current >= pages}>
          Next
        </Button>
      </Flex>
    </Box>
  );
}
