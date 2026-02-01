"use client";

import {
  Box, Button, Checkbox, Flex, FormControl, FormLabel, HStack, Input,
  Progress, Radio, RadioGroup, Select, SimpleGrid, Stack, Text, Textarea, useToast,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import Card from "../card/Card";

type UiField = {
  ref: string;
  label: string;
  uiType:
    | "text" | "textarea" | "email" | "number" | "phone" | "date"
    | "select" | "multiselect" | "radio" | "yesno" | "file" | "checkbox";
  options?: string[];
  multiple?: boolean;
};

type Schema =
  | { id: string; title: string; pages: { title?: string; fields: UiField[] }[] }
  | { id: string; title: string; fields: UiField[] };

const snake = (s: string) =>
  (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function stripRaportPrefix(k: string) {
  let s = k;
  while (s.toLowerCase().startsWith("raport_")) s = s.slice(7);
  return s;
}

const LABEL_OVERRIDES: Record<string, string> = {
  first_name: "Imię",
  last_name: "Nazwisko",
  email: "E-mail",
  phone_number: "Telefon",
};

function prettyLabel(f: UiField) {
  const raw = (f.label || "").trim();

  // jeśli etykieta ma dwukropek -> weź część po, np. "Podaj swoje dane: first_name"
  const afterColon = raw.includes(":") ? raw.split(":").slice(-1)[0].trim() : raw;

  // kandydaci klucza do mapy
  const fromLabel = snake(afterColon);           // np. first_name
  const refSuffix = /__([a-z0-9_]+)$/i.exec(f.ref || "")?.[1];
  const fromRef = refSuffix ? snake(refSuffix) : "";

  // 1) dopasuj override
  if (fromLabel && LABEL_OVERRIDES[fromLabel]) return LABEL_OVERRIDES[fromLabel];
  if (fromRef && LABEL_OVERRIDES[fromRef]) return LABEL_OVERRIDES[fromRef];

  // 2) domyślnie: usuń prefiks "Podaj swoje dane:", zamień _ na spacje i kapitalizuj 1. literę
  const nice = afterColon
    .replace(/^podaj swoje dane:\s*/i, "")
    .replace(/_/g, " ");
  return nice.charAt(0).toUpperCase() + nice.slice(1);
}

const PAGE_TITLE_OVERRIDES: Record<number, string> = {
  0: "Dane kontaktowe",
  1: "Lokalizacja instalacji",
  2: "Dane środowiskowe",
  3: "Opis miejsca instalacji",
  4: "Energia elektryczna",
  5: "Rachunek za prąd",
  6: "Energia cieplna",
  7: "Rachunek za ciepło",
  8: "Źródła OZE",
  9: "Prosument",
  10:"Zapis"
};

function pageTitle(i: number, fallback?: string) {
  return PAGE_TITLE_OVERRIDES[i] || fallback || `Krok ${i + 1}`;
}

const PAGE_TITLE_OVERRIDES_B: Record<number, string> = {
  0: "Kontakt",
  1: "Lokalizacja",
  2: "Dane środowiskowe",
  3: "Instalacja",
  4: "Energia Elektryczna",
  5: "Rachunek",
  6: "Ciepło",
  7: "Rachunek",
  8: "OZE",
  9: "Prosument",
  10:"Zapis"
};

function pageTitle_B(i: number, fallback?: string) {
  return PAGE_TITLE_OVERRIDES_B[i] || fallback || `Krok ${i + 1}`;
}


const ALIASES: Record<string, string[]> = {
  phone_number: ["phone", "telefon", "tel", "nr_telefonu", "numer", "numer_telefonu"],
  email: ["mail", "adres_email", "adres_mail"],
  first_name: ["imie", "imię"],
  last_name: ["nazwisko"],

  // ⬇️ NOWE – mapowanie Miasto/Miejscowość <-> miasto/miejscowosc
  miasto_miejscowosc: ["miasto", "miejscowosc"],
  miasto: ["miasto_miejscowosc", "miejscowosc"],
  miejscowosc: ["miasto", "miasto_miejscowosc"],
};

function* keyCandidatesForField(f: UiField): Generator<string> {
  yield f.ref;
  const sLabel = snake(f.label);
  yield sLabel;
  const mRef = /__([a-z0-9_]+)$/i.exec(f.ref);
  if (mRef?.[1]) yield snake(mRef[1]);
  const parts = f.label.split(":");
  if (parts.length > 1) yield snake(parts[parts.length - 1]);
  for (const [canon, list] of Object.entries(ALIASES)) {
    if (canon === sLabel) for (const a of list) yield a;
  }
  const suffix = mRef?.[1] || snake(parts.length > 1 ? parts[parts.length - 1] : "");
  if (suffix && ALIASES[suffix]) for (const a of ALIASES[suffix]) yield a;
}

function normalizeYesNo(v: any) {
  if (v === "Yes" || v === "No") return v;
  const s = String(v).toLowerCase();
  if (v === true || s === "true" || s === "1" || s === "tak" || s === "yes") return "Yes";
  if (v === false || s === "false" || s === "0" || s === "nie" || s === "no") return "No";
  return s ? "No" : "";
}

export default function HorizonStepperRenderer({
  schema,
  hidden,
  initialValues = {},
  onSubmit,
}: {
  schema: Schema;
  hidden: Record<string, string>;
  initialValues?: Record<string, any>;
  onSubmit: (payload: { values: Record<string, any>; hidden: Record<string, string> }) => Promise<void>;
}) {
  const toast = useToast();

  const pages = useMemo(() => {
    if ("pages" in schema) return schema.pages;
    return [{ title: undefined, fields: (schema as any).fields || [] }];
  }, [schema]);

  const allFields = useMemo(() => pages.flatMap((p) => p.fields), [pages]);

  const sourceMap = useMemo(() => {
    const map = new Map<string, any>();
    const add = (obj: Record<string, any>) => {
      for (const [k, v] of Object.entries(obj || {})) {
        const rawSnake = snake(k);
        const noRap = snake(stripRaportPrefix(k));
        if (!map.has(noRap)) map.set(noRap, v);
        if (!map.has(rawSnake)) map.set(rawSnake, v);
      }
    };
    add(initialValues); // priorytet
    add(hidden);
    return map;
  }, [initialValues, hidden]);

  const pickFromSources = (f: UiField): any => {
    for (const cand of keyCandidatesForField(f)) {
      const key = snake(stripRaportPrefix(cand));
      if (sourceMap.has(key)) return sourceMap.get(key);
      const rawKey = snake(cand);
      if (sourceMap.has(rawKey)) return sourceMap.get(rawKey);
    }
    return undefined;
  };

  const [values, setValues] = useState<Record<string, any>>({});
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false); // ⬅️ NEW

  useEffect(() => {
    const start: Record<string, any> = {};
    for (const f of allFields) {
      let v = pickFromSources(f);

      if (f.uiType === "multiselect") {
        if (Array.isArray(v)) {
          // ok
        } else if (typeof v === "string") {
          v = v.includes(",") ? v.split(",").map(s => s.trim()).filter(Boolean) : (v ? [v] : []);
        } else if (v == null) {
          v = [];
        }
        if (Array.isArray(v) && f.options?.length) {
          const low = new Map(f.options.map(o => [o.toLowerCase(), o]));
          v = v.map((x: string) => low.get(String(x).toLowerCase()) || x);
        }
      } else if (f.uiType === "yesno") {
        v = normalizeYesNo(v ?? "");
      } else if (f.uiType === "radio" || f.uiType === "select") {
        if (v != null && f.options?.length) {
          const low = new Map(f.options.map(o => [o.toLowerCase(), o]));
          v = low.get(String(v).toLowerCase()) ?? "";
        } else {
          v = v ?? "";
        }
      } else if (f.uiType === "checkbox") {
        v = v ? "Yes" : "";
      } else {
        v = v ?? "";
      }

      start[f.ref] = v;
    }
    setValues(start);
    setStep(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFields, sourceMap]);

  const set = (ref: string, v: any) => setValues((s) => ({ ...s, [ref]: v }));

  const totalSteps = pages.length;
  const isLast = step === totalSteps - 1;
  const canPrev = step > 0 && !submitting;
  const canNext = step < totalSteps - 1 && !submitting;
  const progress = Math.round(((step + 1) / totalSteps) * 100);
  const current = pages[step];

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const byRef = { ...values };
      const byName: Record<string, any> = {};
      allFields.forEach((f) => (byName[snake(f.label)] = values[f.ref]));

      await onSubmit({ values: { ...byRef, ...byName }, hidden });
      toast({ title: "Zapisano", description: "Dane zostały zaktualizowane w Pipedrive.", status: "success" });
    } catch (e: any) {
      console.error("Submit error:", e);
      const msg = e?.message || "Nie udało się zapisać danych.";
      toast({ title: "Błąd zapisu", description: msg, status: "error" });
    } finally {
      setSubmitting(false);
    }
  }

// ===== BULLETS (klikane) =====
const Bullets = () => (
  <Box
    position="absolute"
    left="50%"
    transform="translateX(-50%)"
    top={{ base: "64%", md: "22%" }}
    w={{ base: "92vw", md: "min(1040px, 92vw)" }}
    overflowX="auto"
    px={{ base: 2, md: 4 }}
  >
    <Box
      position="absolute"
      left="0"
      right="0"
      top="50%"
      transform="translateY(-50%)"
      h="2px"
      bg="whiteAlpha.600"
    />
    <Flex position="relative" align="center" justify="space-between">
      {pages.map((p, i) => {
        const active = i === step;
        const done = i < step;

        return (
          <Flex
            key={i}
            direction="column"
            align="center"
            gap="1"
            minW="80px"
            px={1}
          >
            {/* kropka jako przycisk */}
            <Box
              as="button"
              type="button"
              onClick={() => setStep(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setStep(i);
              }}
              cursor="pointer"
              w="16px"
              h="16px"
              rounded="full"
              border="2px solid"
              borderColor={done || active ? "white" : "whiteAlpha.700"}
              bgGradient={
                done || active ? "linear(to-b, brand.400, brand.600)" : "none"
              }
              aria-label={pageTitle(i, p.title)}
              aria-current={active ? "step" : undefined}
              _hover={{ transform: "scale(1.08)" }}
              _focusVisible={{ boxShadow: "0 0 0 2px white" }}
            />

            {/* etykieta też klikalna */}
            <Text
              as="button"
              type="button"
              onClick={() => setStep(i)}
              cursor="pointer"
              bg="none"
              border="0"
              color="white"
              opacity={active ? 1 : 0.9}
              fontWeight={active ? "700" : "500"}
              fontSize="sm"
              noOfLines={1}
              maxW="140px"
              textAlign="center"
              _hover={{ textDecoration: "underline" }}
            >
              {pageTitle_B(i, p.title)}
            </Text>
          </Flex>
        );
      })}
    </Flex>
  </Box>
);


  return (
    <Flex direction="column" gap={6}>
      <Box position="relative" w="100%" h={{ base: "220px", md: "260px" }} rounded="30px" bgGradient="linear(to-b, brand.400, brand.600)">
        <Box position="absolute" left="50%" transform="translateX(-50%)" top="18px" w="min(1120px, 94vw)">
          <Progress value={progress} size="xs" colorScheme="purple" rounded="full" opacity={0.35} />
        </Box>
        <Bullets />
      </Box>

      <Card
        px={{ base: "16px", md: "24px" }}
        py={{ base: "16px", md: "24px" }}
        mx="auto"
        w="100%"
        maxW="920px"
        mt="-120px"
        position="relative"
        zIndex={1}
      >
        <Text fontSize="lg" fontWeight="800" mb="6">
          {pageTitle(step, current?.title)}
        </Text>

        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
          {current.fields.map((f) => {
            const full =
              f.uiType === "textarea" ||
              (f.uiType === "radio" && (f.options || []).length > 4);
            const gridProps = full ? { gridColumn: { base: "span 1", md: "span 2" } } : {};

            return (
              <Box key={f.ref} {...gridProps}>
                <FormControl>
                  <FormLabel fontWeight="700">{prettyLabel(f)}</FormLabel>

                  {["text", "email", "phone", "date", "number"].includes(f.uiType) ? (
                    <Input
                      type={f.uiType === "phone" ? "tel" : f.uiType === "text" ? "text" : f.uiType}
                      value={values[f.ref] ?? ""}
                      onChange={(e) => set(f.ref, e.target.value)}
                      isDisabled={submitting}
                    />
                  ) : f.uiType === "textarea" ? (
                    <Textarea rows={4} value={values[f.ref] ?? ""} onChange={(e) => set(f.ref, e.target.value)} isDisabled={submitting} />
                  ) : f.uiType === "select" ? (
                    <Select value={values[f.ref] ?? ""} onChange={(e) => set(f.ref, e.target.value)} isDisabled={submitting}>
                      <option value="">— Wybierz —</option>
                      {(f.options || []).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </Select>
                  ) : f.uiType === "multiselect" ? (
                    <Select
                      multiple
                      value={values[f.ref] ?? []}
                      onChange={(e) => set(f.ref, Array.from(e.target.selectedOptions).map((o: any) => o.value))}
                      h="auto" minH="40px"
                      isDisabled={submitting}
                    >
                      {(f.options || []).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </Select>
                  ) : f.uiType === "radio" ? (
                    <RadioGroup value={values[f.ref] ?? ""} onChange={(v) => set(f.ref, v)}>
                      <Stack direction={{ base: "column", md: "row" }} spacing={4}>
                        {(f.options || []).map((o) => (
                          <Radio key={o} value={o} colorScheme="purple" isDisabled={submitting}>{o}</Radio>
                        ))}
                      </Stack>
                    </RadioGroup>
                  ) : f.uiType === "yesno" ? (
                    <RadioGroup value={values[f.ref] ?? ""} onChange={(v) => set(f.ref, v)}>
                      <HStack spacing={6}>
                        <Radio value="Yes" colorScheme="purple" isDisabled={submitting}>Tak</Radio>
                        <Radio value="No" colorScheme="purple" isDisabled={submitting}>Nie</Radio>
                      </HStack>
                    </RadioGroup>
                  ) : f.uiType === "checkbox" ? (
                    <Checkbox
                      isChecked={!!values[f.ref]}
                      onChange={(e) => set(f.ref, e.target.checked ? "Yes" : "")}
                      colorScheme="purple"
                      isDisabled={submitting}
                    >
                      Wyrażam zgodę
                    </Checkbox>
                  ) : f.uiType === "file" ? (
                    <Input
                      type="url"
                      placeholder="Wklej URL pliku (np. link do PDF)"
                      value={values[f.ref] ?? ""}
                      onChange={(e) => set(f.ref, e.target.value)}
                      isDisabled={submitting}
                    />
                  ) : null}
                </FormControl>
              </Box>
            );
          })}
        </SimpleGrid>

        <Flex mt={8} justify="space-between">
          <Button variant="outline" onClick={() => canPrev && setStep((s) => Math.max(0, s - 1))} isDisabled={!canPrev}>
            Prev
          </Button>
          {!isLast ? (
            <Button colorScheme="purple" onClick={() => canNext && setStep((s) => Math.min(totalSteps - 1, s + 1))} isDisabled={!canNext}>
              Next
            </Button>
          ) : (
            <Button colorScheme="purple" onClick={handleSubmit} isLoading={submitting} isDisabled={submitting}>
              Submit
            </Button>
          )}
        </Flex>
      </Card>
    </Flex>
  );
}
