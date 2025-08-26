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
} from "@chakra-ui/react";
import { useRouter } from "next/navigation";

type Row = {
  name: [fullName: string, avatarUrl: string];
  email: string;
  username: string;
  date: string;
  type: string;
  editHref: string; // URL do /admin/main/users/edit-user?... z parametrami
};

export default function SearchTableUsersOverivew({
  tableData,
}: {
  tableData: Row[];
}) {
  const router = useRouter();

  return (
    <Box p="6" w="100%" overflowX="auto">
      <Table variant="simple" size="md">
        <Thead>
          <Tr>
            <Th>User</Th>
            <Th>Email</Th>
            <Th>Username</Th>
            <Th>Date</Th>
            <Th>Type</Th>
            <Th isNumeric>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {tableData.map((row, idx) => {
            const [fullName, avatarUrl] = row.name || ["", ""];
            return (
              <Tr key={idx}>
                <Td>
                  <Flex align="center" gap="3">
                    <Avatar size="sm" src={avatarUrl} name={fullName} />
                    <Text fontWeight="600">{fullName}</Text>
                  </Flex>
                </Td>
                <Td>{row.email}</Td>
                <Td>{row.username}</Td>
                <Td>{row.date}</Td>
                <Td>{row.type}</Td>
                <Td isNumeric>
                  <Button size="sm" onClick={() => router.push(row.editHref)}>
                    Edit user
                  </Button>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </Box>
  );
}
