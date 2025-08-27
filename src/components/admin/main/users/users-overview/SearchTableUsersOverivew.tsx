"use client";

import {
  Box,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Avatar,
  Flex,
  Text,
  Button,
  Input,
  HStack,
  Select,
  IconButton,
  Spacer,
} from "@chakra-ui/react";
import { useMemo, useState, useEffect, MouseEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  TriangleDownIcon,
  TriangleUpIcon,
} from "@chakra-ui/icons";

type Row = {
  name: [fullName: string, avatarUrl: string];
  email: string;
  username: string;
  date: string; // np. "Sep 12, 2024"
  type: string;
  editHref?: string; // jeżeli brak, zbudujemy fallback
  actions?: any;     // legacy
};

type SortKey = "name" | "email" | "username" | "date" | "type";
type SortDir = "asc" | "desc";
type SortState = { key: SortKey; dir: SortDir } | null;

const LS_KEY = "usersOverview.sortAndPageSize.v1";

function normalize(s: any) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function buildEditHrefFallback(row: Row) {
  const [fullName] = row.name || ["", ""];
  const parts = (fullName || "").trim().split(/\s+/);
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ") || "";
  const params = new URLSearchParams({
    first_name: firstName,
    last_name: lastName,
    email: row.email || "",
  }).toString();
  return `/admin/main/users/edit-user?${params}`;
}

export default function SearchTableUsersOverivew({
  tableData,
  initialPageSize = 10,
}: {
  tableData: Row[];
  initialPageSize?: number;
}) {
  const router = useRouter();

  // --- UI state ---
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>(null);

  // Load persisted sort + pageSize (bez query)
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
      if (raw) {
        const saved = JSON.parse(raw);
        if (typeof saved?.pageSize === "number") setPageSize(saved.pageSize);
        if (saved?.sort?.key && saved?.sort?.dir) setSort(saved.sort as SortState);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist sort + pageSize
  useEffect(() => {
    try {
      const payload = JSON.stringify({ sort, pageSize });
      localStorage.setItem(LS_KEY, payload);
    } catch {}
  }, [sort, pageSize]);

  // reset strony po zmianie filtra/rozmiaru
  useEffect(() => {
    setPage(1);
  }, [query, pageSize]);

  // --- Filtrowanie ---
  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return tableData;
    return tableData.filter((row) => {
      const [fullName] = row.name || ["", ""];
      return (
        normalize(fullName).includes(q) ||
        normalize(row.email).includes(q) ||
        normalize(row.username).includes(q) ||
        normalize(row.type).includes(q)
      );
    });
  }, [tableData, query]);

  // --- Sortowanie ---
  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (!sort) return arr;

    const { key, dir } = sort;

    const getVal = (r: Row) => {
      switch (key) {
        case "name":
          return normalize(r.name?.[0] || "");
        case "email":
          return normalize(r.email);
        case "username":
          return normalize(r.username);
        case "type":
          return normalize(r.type);
        case "date": {
          const ts = Date.parse(r.date);
          return isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
        }
      }
    };

    arr.sort((a, b) => {
      const va = getVal(a);
      const vb = getVal(b);

      if (typeof va === "number" || typeof vb === "number") {
        const na = typeof va === "number" ? va : Number.NEGATIVE_INFINITY;
        const nb = typeof vb === "number" ? vb : Number.NEGATIVE_INFINITY;
        return dir === "asc" ? na - nb : nb - na;
      }

      const sa = String(va);
      const sb = String(vb);
      const cmp = sa.localeCompare(sb);
      return dir === "asc" ? cmp : -cmp;
    });

    return arr;
  }, [filtered, sort]);

  // --- Paginacja (client-side) ---
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const pageRows = sorted.slice(start, end);

  const canPrev = safePage > 1;
  const canNext = safePage < totalPages;

  // --- Handlery sortowania ---
  const toggleSort = (key: SortKey) => (e: MouseEvent) => {
    e.preventDefault();
    setPage(1);
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (!sort || sort.key !== column) return null;
    return sort.dir === "asc" ? (
      <TriangleUpIcon ml={1} boxSize="3" />
    ) : (
      <TriangleDownIcon ml={1} boxSize="3" />
    );
  };

  const thProps = {
    cursor: "pointer",
    userSelect: "none" as const,
    onMouseDown: (e: MouseEvent) => e.preventDefault(),
  };

  return (
    <Box p="6" w="100%" overflowX="auto">
      {/* Toolbar: search + page size */}
      <Flex mb={4} gap={3} wrap="wrap" align="center">
        <Input
          placeholder="Szukaj: imię/nazwisko, email, username, typ…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxW="360px"
        />
        <Spacer />
        <HStack>
          <Text fontSize="sm" color="gray.600">
            Rows per page
          </Text>
          <Select
            size="sm"
            value={pageSize}
            onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
            w="80px"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </Select>
        </HStack>
      </Flex>

      {/* Tabela */}
      <Table variant="simple" size="md">
        <Thead>
          <Tr>
            <Th {...thProps} onClick={toggleSort("name")}>
              User <SortIcon column="name" />
            </Th>
            <Th {...thProps} onClick={toggleSort("email")}>
              Email <SortIcon column="email" />
            </Th>
            <Th {...thProps} onClick={toggleSort("username")}>
              Username <SortIcon column="username" />
            </Th>
            <Th {...thProps} onClick={toggleSort("date")}>
              Date <SortIcon column="date" />
            </Th>
            <Th {...thProps} onClick={toggleSort("type")}>
              Type <SortIcon column="type" />
            </Th>
            <Th isNumeric>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {pageRows.map((row, idx) => {
            const [fullName, avatarUrl] = row.name || ["", ""];
            const key = `${start}-${idx}-${fullName}`;
            const href = row.editHref || buildEditHrefFallback(row);

            return (
              <Tr key={key}>
                <Td>
                  <Flex align="center" gap="3">
                    <Avatar size="sm" src={avatarUrl} name={fullName} />
                    <Text fontWeight="600">{fullName || "—"}</Text>
                  </Flex>
                </Td>
                <Td>{row.email || "—"}</Td>
                <Td>{row.username || "—"}</Td>
                <Td>{row.date || "—"}</Td>
                <Td>{row.type || "—"}</Td>
                <Td isNumeric>
                  <Button size="sm" onClick={() => router.push(href)}>
                    Edit user
                  </Button>
                </Td>
              </Tr>
            );
          })}
          {pageRows.length === 0 && (
            <Tr>
              <Td colSpan={6}>
                <Text color="gray.500">Brak wyników.</Text>
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>

      {/* Stopka paginacji */}
      <Flex align="center" justify="space-between" mt={4} gap={3} wrap="wrap">
        <Text fontSize="sm" color="gray.600">
          Showing <b>{total === 0 ? 0 : start + 1}</b>–<b>{end}</b> of <b>{total}</b>
        </Text>

        <HStack>
          <IconButton
            aria-label="Previous"
            icon={<ChevronLeftIcon />}
            size="sm"
            onClick={() => canPrev && setPage((p) => Math.max(1, p - 1))}
            isDisabled={!canPrev}
          />
          <Text fontSize="sm">
            Page <b>{safePage}</b> / <b>{totalPages}</b>
          </Text>
          <IconButton
            aria-label="Next"
            icon={<ChevronRightIcon />}
            size="sm"
            onClick={() => canNext && setPage((p) => Math.min(totalPages, p + 1))}
            isDisabled={!canNext}
          />
        </HStack>
      </Flex>
    </Box>
  );
}
