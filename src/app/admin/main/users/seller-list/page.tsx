// app/admin/main/users/seller-list/page.tsx
"use client";

import { useEffect, useState } from "react";
import {
  Box,
  Flex,
  Text,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Spinner,
  Select,
  useColorModeValue,
} from "@chakra-ui/react";
import Card from "components/card/Card";

type PanelUser = {
  id: number;
  firstname: string;
  lastname: string;
  email: string;
  username: string;
  role: number; // 0=user, 1=admin
  access: number; // 0 brak, 1 tylko swoje, 2 wszystkie
};

export default function SellerListPage() {
  const [users, setUsers] = useState<PanelUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const subtleTextColor = useColorModeValue("gray.600", "gray.400");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/admin/users", {
          cache: "no-store",
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `HTTP ${res.status}`);
        }

        const data = (await res.json()) as PanelUser[];
        if (!cancelled) setUsers(data);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Błąd podczas pobierania");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ::::::::::::::::::::::::::::::::::
  // 🔧 Aktualizacja roli lub access
  // ::::::::::::::::::::::::::::::::::
  async function updateUser(id: number, role: number, access: number) {
    try {
      await fetch("/api/admin/users/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, role, access }),
      });

      // lokalny update bez przeładowania
      setUsers((prev) =>
        prev.map((u) =>
          u.id === id ? { ...u, role: role, access: access } : u
        )
      );
    } catch (e) {
      console.error("Update error:", e);
    }
  }

  const renderRoleBadge = (role: number) => {
    return role === 1 ? (
      <Badge colorScheme="purple" variant="solid" borderRadius="full">
        admin
      </Badge>
    ) : (
      <Badge colorScheme="gray" variant="subtle" borderRadius="full">
        user
      </Badge>
    );
  };

  const renderAccessBadge = (access: number) => {
    switch (access) {
      case 0:
        return (
          <Badge colorScheme="red" variant="subtle" borderRadius="full">
            brak
          </Badge>
        );
      case 1:
        return (
          <Badge colorScheme="blue" variant="subtle" borderRadius="full">
            tylko swoje
          </Badge>
        );
      case 2:
        return (
          <Badge colorScheme="green" variant="solid" borderRadius="full">
            wszystkie
          </Badge>
        );
    }
  };

  return (
    <Flex direction="column" pt={{ sm: "125px", lg: "75px" }}>
      {/* summary */}
      <Flex justify="space-between" align="center" mb="16px">
        <Text fontSize="sm" color={subtleTextColor}>
          Łącznie użytkowników: <b>{users.length}</b>
        </Text>
      </Flex>

      <Card px="20px" py="16px">
        {loading ? (
          <Flex align="center" justify="center" minH="120px">
            <Spinner mr={3} />
            <Text>Ładowanie…</Text>
          </Flex>
        ) : error ? (
          <Text color="red.300">{error}</Text>
        ) : (
          <Box overflowX="auto">
            <Table size="sm" variant="simple">
              <Thead>
                <Tr>
                  <Th>#</Th>
                  <Th>Użytkownik</Th>
                  <Th>Email</Th>
                  <Th>Rola</Th>
                  <Th>Access</Th>
                </Tr>
              </Thead>
              <Tbody>
                {users.map((u, idx) => (
                  <Tr key={u.id}>
                    <Td>{idx + 1}</Td>

                    <Td>
                      {u.firstname} {u.lastname} ({u.username})
                    </Td>

                    <Td>{u.email}</Td>

                    {/* ::::::::::::::::::::::::
                        ROLA — Select + Badge
                    :::::::::::::::::::::::: */}
                    <Td>
                      <Flex gap={2} align="center">
                        <Select
                          size="xs"
                          width="90px"
                          value={u.role}
                          onChange={(e) =>
                            updateUser(u.id, Number(e.target.value), u.access)
                          }
                        >
                          <option value={0}>user</option>
                          <option value={1}>admin</option>
                        </Select>
                        {renderRoleBadge(u.role)}
                      </Flex>
                    </Td>

                    {/* ::::::::::::::::::::::::
                        ACCESS — Select + Badge
                    :::::::::::::::::::::::: */}
                    <Td>
                      <Flex gap={2} align="center">
                        <Select
                          size="xs"
                          width="130px"
                          value={u.access}
                          onChange={(e) =>
                            updateUser(u.id, u.role, Number(e.target.value))
                          }
                        >
                          <option value={0}>brak</option>
                          <option value={1}>tylko swoje</option>
                          <option value={2}>wszystkie</option>
                        </Select>
                        {renderAccessBadge(u.access)}
                      </Flex>
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
