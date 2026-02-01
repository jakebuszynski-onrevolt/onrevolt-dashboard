"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
    Box,
    Button,
    Flex,
    Heading,
    Input,
    Select,
    Table,
    Tbody,
    Td,
    Th,
    Thead,
    Tr,
    Text,
    Spinner,
    useToast,
} from "@chakra-ui/react";

import Card from "components/card/Card";

type FieldRow = {
    id: number;
    name: string;
    field_type: string;
    options_count: number;
};

type ItemRow = {
    pd_option_id: number;
    label: string;
    item_type: "towar" | "usluga" | "kredyt" | "dotacja" | string;
    price1: string;
    price2: string;
    price3plus: string;
    percent: string;
    maxdot: string;
    par1: string;
    par2: string;
};

function toNumOrNull(v: string): number | null {
  const s = v.trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return null;

  // pozwól użytkownikowi pisać "12." albo "." albo "-" bez psucia inputa
  if (s === "." || s === "-" || s === "-." || s.endsWith(".")) return null;

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function numToStr(v: any): string {
  if (v === null || v === undefined) return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : "";
}

function strToNumOrNull(v: string): number | null {
  const s = (v ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export default function ConfigEditorPage() {
    const toast = useToast();

    const [fields, setFields] = useState<FieldRow[]>([]);
    const [pdFieldId, setPdFieldId] = useState<number | null>(null);
    const [loadingFields, setLoadingFields] = useState(false);

    const [loadingItems, setLoadingItems] = useState(false);
    const [items, setItems] = useState<ItemRow[]>([]);
    const [newLabel, setNewLabel] = useState("");

    const selectedField = useMemo(
        () => (pdFieldId ? fields.find((f) => f.id === pdFieldId) ?? null : null),
        [fields, pdFieldId]
    );

async function loadFields() {
  setLoadingFields(true);
  try {
    const r = await fetch("/api/config-editor/fields", { cache: "no-store" });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Błąd pobierania pól");

    const arr: FieldRow[] = Array.isArray(j.fields) ? j.fields : [];
    setFields(arr);

    // ustaw domyślne pole tylko jeśli jeszcze nie wybrano
    setPdFieldId((prev) => (prev == null && arr?.[0]?.id ? arr[0].id : prev));
  } catch (e: any) {
    toast({ status: "error", title: "Błąd", description: e?.message ?? String(e) });
  } finally {
    setLoadingFields(false);
  }
}

async function loadItems(fieldId: number) {
  if (!fieldId) return;
  setLoadingItems(true);
  try {
    const r = await fetch(
      `/api/config-editor/items?pd_field_id=${encodeURIComponent(String(fieldId))}`,
      { cache: "no-store" }
    );
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "Błąd pobierania pozycji");

    const arr: any[] = Array.isArray(j.items) ? j.items : [];

    // UWAGA: trzymamy liczby w UI jako string, żeby dało się wpisywać "," i "."
    const mapped: ItemRow[] = arr.map((row) => ({
      pd_option_id: Number(row.pd_option_id),
      label: String(row.label ?? ""),
      item_type: row.item_type ?? "towar",

      price1: numToStr(row.price1),
      price2: numToStr(row.price2),
      price3plus: numToStr(row.price3plus),
      percent: numToStr(row.percent),
      maxdot: numToStr(row.maxdot),

      par1: String(row.par1 ?? ""),
      par2: String(row.par2 ?? ""),
    }));

    setItems(mapped);
  } catch (e: any) {
    toast({ status: "error", title: "Błąd", description: e?.message ?? String(e) });
    setItems([]);
  } finally {
    setLoadingItems(false);
  }
}
    useEffect(() => {
        loadFields();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (pdFieldId) loadItems(pdFieldId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pdFieldId]);

    async function postAction(payload: any) {
        const r = await fetch("/api/config-editor/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "Błąd operacji");
        return j;
    }

    async function onAdd() {
        const label = newLabel.trim();
        if (!label || !pdFieldId) return;

        try {
            await postAction({ action: "add", pd_field_id: pdFieldId, label });
            setNewLabel("");
            await loadItems(pdFieldId);
            toast({ status: "success", title: "Dodano pozycję" });
        } catch (e: any) {
            toast({ status: "error", title: "Błąd dodawania", description: e?.message ?? String(e) });
        }
    }

    async function onDelete(pd_option_id: number) {
        if (!pdFieldId) return;
        try {
            await postAction({ action: "delete", pd_field_id: pdFieldId, pd_option_id });
            await loadItems(pdFieldId);
            toast({ status: "success", title: "Usunięto pozycję" });
        } catch (e: any) {
            toast({ status: "error", title: "Błąd usuwania", description: e?.message ?? String(e) });
        }
    }

    async function onRename(pd_option_id: number, label: string) {
        if (!pdFieldId) return;
        try {
            await postAction({ action: "rename", pd_field_id: pdFieldId, pd_option_id, label });
            await loadItems(pdFieldId);
            toast({ status: "success", title: "Zmieniono nazwę" });
        } catch (e: any) {
            toast({ status: "error", title: "Błąd zmiany nazwy", description: e?.message ?? String(e) });
        }
    }

    async function onSaveMeta(row: ItemRow) {
        if (!pdFieldId) return;
        try {
            await postAction({
                action: "update_meta",
                pd_field_id: pdFieldId,
                pd_option_id: row.pd_option_id,
                item_type: row.item_type,
                price1: strToNumOrNull(row.price1),
                price2: strToNumOrNull(row.price2),
                price3plus: strToNumOrNull(row.price3plus),
                percent: strToNumOrNull(row.percent),
                maxdot: strToNumOrNull(row.maxdot),
                par1: row.par1,
                par2: row.par2,
            });
            toast({ status: "success", title: "Zapisano metadane" });
        } catch (e: any) {
            toast({ status: "error", title: "Błąd zapisu", description: e?.message ?? String(e) });
        }
    }

    return (
        <Box p={6} mt={{ base: "70px", md: "50px" }}>
        <Card px="20px" py="16px" mb="16px">
            <Flex align="center" justify="space-between" mb={4} gap={4} wrap="wrap">
                <Box>
                    <Text opacity={0.8} fontSize="sm">
                        Źródło listy opcji: Pipedrive (dealFields enum). Metadane: lokalny SQL.
                    </Text>
                </Box>

                <Button onClick={() => loadFields()} isLoading={loadingFields}>
                    Odśwież pola
                </Button>
            </Flex>

            <Flex gap={3} align="center" mb={4} wrap="wrap">
                <Text fontWeight="600">Pole:</Text>

                <Select
                    value={pdFieldId ?? ""}
                    onChange={(e) => setPdFieldId(Number(e.target.value))}
                    minW="360px"
                    maxW="680px"
                    isDisabled={loadingFields || fields.length === 0}
                >
                    {fields.map((f) => (
                        <option key={f.id} value={f.id}>
                            {f.name} (options: {f.options_count})
                        </option>
                    ))}
                </Select>

                {selectedField && (
                    <Text fontSize="sm" opacity={0.8}>
                        PD field id: {selectedField.id} • type: {selectedField.field_type}
                    </Text>
                )}
            </Flex>

            <Flex gap={3} align="center" mb={6} wrap="wrap" fontSize="sm">
                <Input
                    placeholder="Dodaj nową pozycję (label w Pipedrive)"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    minW="360px"
                    maxW="680px"
                />
                <Button onClick={onAdd} isDisabled={!pdFieldId || !newLabel.trim()} colorScheme="purple">
                    Dodaj
                </Button>

                {loadingItems && (
                    <Flex align="center" gap={2}>
                        <Spinner size="sm" />
                        <Text fontSize="sm" opacity={0.8}>
                            Ładuję…
                        </Text>
                    </Flex>
                )}
            </Flex>

            <Box overflowX="auto" fontSize="sm">
                <Table size="sm" variant="simple">
                    <Thead>
                        <Tr>
                            <Th>Nazwa (PD)</Th>
                            <Th>Typ</Th>
                            <Th>Cena 1</Th>
                            <Th>Cena 2</Th>
                            <Th>Cena 3+</Th>
                            <Th>Par1</Th>
                            <Th>Par2</Th>
                            <Th>% (kredyt)</Th>
                            <Th>Max dot (dotacja)</Th>
                            <Th>Akcje</Th>
                        </Tr>
                    </Thead>

                    <Tbody>
                        {items.map((row) => (
                            <Tr key={row.pd_option_id}>
                                <Td minW="280px">
                                    <Input
                                        size="sm"
                                        defaultValue={row.label}
                                        onBlur={(e) => {
                                            const v = e.target.value.trim();
                                            if (v && v !== row.label) onRename(row.pd_option_id, v);
                                        }}
                                    />
                                </Td>

                                <Td minW="120px">
                                    <Select
                                        size="sm"
                                        value={row.item_type}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setItems((prev) =>
                                                prev.map((x) => (x.pd_option_id === row.pd_option_id ? { ...x, item_type: v } : x))
                                            );
                                        }}
                                    >
                                        <option value="towar">towar</option>
                                        <option value="usluga">usluga</option>
                                        <option value="kredyt">kredyt</option>
                                        <option value="dotacja">dotacja</option>
                                    </Select>
                                </Td>

                                <Td minW="125px">
                                    <Input
                                        size="sm"
                                        value={row.price1 ?? ""}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setItems((prev) =>
                                                prev.map((x) => (x.pd_option_id === row.pd_option_id ? { ...x, price1: v } : x))
                                            );
                                        }}
                                        placeholder="0"
                                    />
                                </Td>

                                <Td minW="125px">
                                    <Input
                                        size="sm"
                                        value={row.price2 ?? ""}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setItems((prev) =>
                                                prev.map((x) => (x.pd_option_id === row.pd_option_id ? { ...x, price2: v } : x))
                                            );
                                        }}
                                        placeholder="0"
                                    />
                                </Td>

                                <Td minW="125px">
                                    <Input
                                        size="sm"
                                        value={row.price3plus ?? ""}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setItems((prev) =>
                                                prev.map((x) => (x.pd_option_id === row.pd_option_id ? { ...x, price3plus: v } : x))
                                            );
                                        }}
                                        placeholder="0"
                                    />
                                </Td>

                                <Td minW="125px">
                                    <Input
                                        size="sm"
                                        value={row.par1 ?? ""}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setItems((prev) =>
                                                prev.map((x) => (x.pd_option_id === row.pd_option_id ? { ...x, par1: v } : x))
                                            );
                                        }}
                                    />
                                </Td>

                                <Td minW="125px">
                                    <Input
                                        size="sm"
                                        value={row.par2 ?? ""}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setItems((prev) =>
                                                prev.map((x) => (x.pd_option_id === row.pd_option_id ? { ...x, par2: v } : x))
                                            );
                                        }}
                                    />
                                </Td>


                                <Td minW="120px">
                                    <Input
                                        size="sm"
                                        inputMode="decimal"
                                        value={row.percent ?? ""}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setItems((prev) =>
                                                prev.map((x) => (x.pd_option_id === row.pd_option_id ? { ...x, percent: v } : x))
                                            );
                                        }}
                                    />
                                </Td>

                                <Td minW="100px">
                                    <Input
                                        size="sm"
                                        value={row.maxdot ?? ""}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setItems((prev) =>
                                                prev.map((x) => (x.pd_option_id === row.pd_option_id ? { ...x, maxdot: v } : x))
                                            );
                                        }}
                                    />
                                </Td>

                                <Td minW="150px">
                                    <Flex gap={2} wrap="wrap">
                                        <Button size="xs" onClick={() => onSaveMeta(row)}>
                                            Zapisz
                                        </Button>
                                        <Button size="xs" colorScheme="red" variant="outline" onClick={() => onDelete(row.pd_option_id)}>
                                            Usuń
                                        </Button>
                                    </Flex>
                                </Td>
                            </Tr>
                        ))}

                        {items.length === 0 && !loadingItems && (
                            <Tr>
                                <Td colSpan={9}>
                                    <Text opacity={0.7}>
                                        Brak danych – wybierz pole lub sprawdź czy w Pipedrive to pole ma opcje (enum/set).
                                    </Text>
                                </Td>
                            </Tr>
                        )}
                    </Tbody>
                </Table>
            </Box>
            </Card>
        </Box>
    );
}
