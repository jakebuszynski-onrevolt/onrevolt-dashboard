"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Heading,
  Text,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Tag,
  TagLabel,
  Spinner,
  Flex,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Input,
  RadioGroup,
  Radio,
  HStack,
  Button,
  useToast,
} from "@chakra-ui/react";

type Entity = "deal" | "person";

type TFField = {
  ref: string;
  title: string;
  tf_type: string;
  pd_type: string;
  options?: string[];
  suggested_name: string;
};

type PDField = {
  id: number | null;
  key: string;
  name: string;
  field_type: string;
  options: string[];
};

type MissingRow = {
  tf_ref: string;
  tf_title: string;
  tf_type: string;
  pd_suggested: { name: string; field_type: string; options?: string[] };
  exists_in_pipedrive?: boolean;
  existing_pd?: PDField;
};

export default function FieldsComparePage() {
  const [entity, setEntity] = useState<Entity>("deal");
  const [loading, setLoading] = useState(true);
  const [formTitle, setFormTitle] = useState<string>("");
  const [tfFields, setTfFields] = useState<TFField[]>([]);
  const [pdFields, setPdFields] = useState<PDField[]>([]);
  const [missing, setMissing] = useState<MissingRow[]>([]);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const toast = useToast();

  const fetchData = async (ent: Entity) => {
    setLoading(true);
    const r = await fetch(`/api/pipedrive/compare-typeform?entity=${ent}`);
    const j = await r.json();
    setFormTitle(`${j.form?.title || ""} (${j.form?.id || ""})`);
    setTfFields(j.typeform_fields || []);
    setPdFields(j.pipedrive_fields || []);
    setMissing(j.missing_on_pipedrive || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData(entity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  const qNorm = useMemo(() => q.trim().toLowerCase(), [q]);

  const tfFiltered = useMemo(
    () =>
      !qNorm
        ? tfFields
        : tfFields.filter(
            (f) =>
              f.title.toLowerCase().includes(qNorm) ||
              f.suggested_name.toLowerCase().includes(qNorm) ||
              f.tf_type.toLowerCase().includes(qNorm)
          ),
    [tfFields, qNorm]
  );

  const pdFiltered = useMemo(
    () =>
      !qNorm
        ? pdFields
        : pdFields.filter(
            (f) =>
              f.name.toLowerCase().includes(qNorm) ||
              f.key.toLowerCase().includes(qNorm) ||
              f.field_type.toLowerCase().includes(qNorm)
          ),
    [pdFields, qNorm]
  );

  const missingFiltered = useMemo(
    () =>
      !qNorm
        ? missing
        : missing.filter(
            (r) =>
              r.pd_suggested.name.toLowerCase().includes(qNorm) ||
              r.tf_title.toLowerCase().includes(qNorm) ||
              r.tf_type.toLowerCase().includes(qNorm)
          ),
    [missing, qNorm]
  );

  const createField = async (row: MissingRow) => {
    try {
      setCreating(row.tf_ref);
      const res = await fetch("/api/pipedrive/create-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity,
          name: row.pd_suggested.name,
          field_type: row.pd_suggested.field_type,
          options: row.pd_suggested.options,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt);
      }
      const j = await res.json();
      toast({
        title: "Field created",
        description: `Pipedrive key: ${j.key}`,
        status: "success",
        duration: 4000,
        isClosable: true,
      });
      // odśwież porównanie — nowo utworzone pole zniknie z "brakujących"
      await fetchData(entity);
    } catch (e: any) {
      toast({
        title: "Create failed",
        description: e?.message || String(e),
        status: "error",
        duration: 6000,
        isClosable: true,
      });
    } finally {
      setCreating(null);
    }
  };

  return (
    <Box p={6}>
      <Flex justify="space-between" align="center" mb={4} wrap="wrap" gap={3}>
        <Heading size="md">Fields compare</Heading>
        <HStack>
          <Text>Entity:</Text>
          <RadioGroup
            onChange={(val) => setEntity(val as Entity)}
            value={entity}
          >
            <HStack spacing="16px">
              <Radio value="deal">Deal</Radio>
              <Radio value="person">Person</Radio>
            </HStack>
          </RadioGroup>
        </HStack>
        <Input
          placeholder="Szukaj (nazwa, typ, klucz)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxW="360px"
        />
      </Flex>

      {loading ? (
        <Flex align="center" gap={3}>
          <Spinner /> <Text>Ładowanie pól…</Text>
        </Flex>
      ) : (
        <>
          <Text mb={4}>
            Typeform: <b>{formTitle}</b>
          </Text>

          <Tabs variant="enclosed" colorScheme="purple">
            <TabList>
              <Tab>Brakujące w Pipedrive ({missingFiltered.length})</Tab>
              <Tab>Typeform → mapowanie ({tfFiltered.length})</Tab>
              <Tab>Pipedrive – {entity} fields ({pdFiltered.length})</Tab>
            </TabList>
            <TabPanels>
              {/* MISSING */}
              <TabPanel>
                <Table size="sm" variant="simple">
                  <Thead>
                    <Tr>
                      <Th>TF: title</Th>
                      <Th>TF: ref</Th>
                      <Th>TF: type</Th>
                      <Th>PD: suggested name</Th>
                      <Th>PD: type</Th>
                      <Th>PD: options</Th>
                      <Th isNumeric>Action</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {missingFiltered.map((r) => (
                      <Tr key={r.tf_ref}>
                        <Td>{r.tf_title}</Td>
                        <Td>{r.tf_ref}</Td>
                        <Td>
                          <Tag size="sm">
                            <TagLabel>{r.tf_type}</TagLabel>
                          </Tag>
                        </Td>
                        <Td>
                          <b>{r.pd_suggested.name}</b>
                        </Td>
                        <Td>
                          <Tag size="sm" variant="subtle">
                            <TagLabel>{r.pd_suggested.field_type}</TagLabel>
                          </Tag>
                        </Td>
                        <Td>{r.pd_suggested.options?.join(", ") || "—"}</Td>
                        <Td isNumeric>
                          <Button
                            size="sm"
                            onClick={() => createField(r)}
                            isLoading={creating === r.tf_ref}
                          >
                            Create in Pipedrive
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                    {missingFiltered.length === 0 && (
                      <Tr>
                        <Td colSpan={7}>
                          <Text>Brak brakujących pól – wszystko jest w Pipedrive.</Text>
                        </Td>
                      </Tr>
                    )}
                  </Tbody>
                </Table>
              </TabPanel>

              {/* TYPEFORM */}
              <TabPanel>
                <Table size="sm" variant="simple">
                  <Thead>
                    <Tr>
                      <Th>TF: title</Th>
                      <Th>TF: ref</Th>
                      <Th>TF: type</Th>
                      <Th>PD: mapped type</Th>
                      <Th>PD: suggested name</Th>
                      <Th>options</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {tfFiltered.map((f) => (
                      <Tr key={f.ref}>
                        <Td>{f.title}</Td>
                        <Td>{f.ref}</Td>
                        <Td>
                          <Tag size="sm">
                            <TagLabel>{f.tf_type}</TagLabel>
                          </Tag>
                        </Td>
                        <Td>
                          <Tag size="sm" variant="subtle">
                            <TagLabel>{f.pd_type}</TagLabel>
                          </Tag>
                        </Td>
                        <Td>{f.suggested_name}</Td>
                        <Td>{f.options?.join(", ") || "—"}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </TabPanel>

              {/* PIPEDRIVE */}
              <TabPanel>
                <Table size="sm" variant="simple">
                  <Thead>
                    <Tr>
                      <Th>PD: name</Th>
                      <Th>PD: key</Th>
                      <Th>PD: type</Th>
                      <Th>options</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {pdFiltered.map((f) => (
                      <Tr key={`${f.key}`}>
                        <Td>{f.name}</Td>
                        <Td>
                          <code>{f.key}</code>
                        </Td>
                        <Td>
                          <Tag size="sm" variant="subtle">
                            <TagLabel>{f.field_type}</TagLabel>
                          </Tag>
                        </Td>
                        <Td>{f.options?.join(", ") || "—"}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </>
      )}
    </Box>
  );
}
