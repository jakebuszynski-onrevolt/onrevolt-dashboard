"use client";

import { useEffect, useState } from "react";
import NextLink from "next/link";
import { Box, Flex, Icon, Link, Text, VStack } from "@chakra-ui/react";
import { MdShield, MdPersonAdd, MdList } from "react-icons/md";
// UŻYJ TEJ SAMEJ POMOCNICZEJ FUNKCJI co gdzie indziej, żeby uwzględnić basePath '/panel'
import { apiPath } from "../../lib/basePath"; // <- dostosuj ścieżkę jeśli plik jest głębiej

export default function SuperUserMenu() {
  const [role, setRole] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(apiPath("/api/auth/me"), { cache: "no-store" });
        if (!r.ok) throw 0;
        const j = await r.json();
        setRole(Number(j.role));
      } catch {
        setRole(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return null;
  if (role !== 1) return null;

  return (
    <Box mt={4} pt={4} borderTop="1px" borderColor="gray.100">
      <Flex align="center" gap={2} mb={3}>
        <Icon as={MdShield} boxSize="18px" />
        <Text fontSize="sm" fontWeight="bold">
          Super User
        </Text>
      </Flex>

      <VStack align="stretch" spacing={1}>
        <Link
          as={NextLink}
          href="/auth/sign-up" // basePath zostanie dodany automatycznie
          px={3}
          py={2}
          rounded="md"
          _hover={{ bg: "gray.50" }}
          display="flex"
          alignItems="center"
          gap={2}
        >
          <Icon as={MdPersonAdd} />
          <Text>Add seller</Text>
        </Link>

        <Link
          as={NextLink}
          href="/auth/sign-up" // placeholder: na razie ten sam adres
          px={3}
          py={2}
          rounded="md"
          _hover={{ bg: "gray.50" }}
          display="flex"
          alignItems="center"
          gap={2}
        >
          <Icon as={MdList} />
          <Text>Sellers list</Text>
        </Link>
      </VStack>
    </Box>
  );
}
