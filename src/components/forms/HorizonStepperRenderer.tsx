"use client";

import {
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Progress,
  Radio,
  RadioGroup,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  useToast,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import Card from "../card/Card";

type UiField = {
  ref: string;
  label: string;
  uiType:
    | "text"
    | "textarea"
    | "email"
    | "number"
    | "phone"
    | "date"
    | "select"
    | "multiselect"
    | "radio"
    | "yesno"
    | "file"
    | "checkbox";
  options?: string[];
  multiple?: boolean;
};

type Schema =
  | { id: string; title: string; pages: { title?: string; fields: UiField[] }[] }
  | { id: string; title: string; fields: UiField[] };

const snake = (s: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

// aliasy do prefillu (PL/EN)
const ALIASES: Record<string, string[]> = {
  phone_number: ["phone", "telefon", "tel", "nr_telefonu", "numer", "numer_telefonu"],
  email: ["mail", "adres_email", "adres_mail"],
  first_name: ["imie", "imię"],
  last_name: ["nazwisko"],
};

function* keyCandidatesForField(f: UiField): Generator<string> {
  // 1) ref
  yield f.ref;

  // 2) snake(label)
  yield snake(f.label);

  // 3) jeżeli ref ma sufiks __coś (np. __first_name) → użyj kanonicznego sufiksu
  const mRef = /__([a-z0-9_]+)$/i.exec(f.ref);
  if (mRef?.[1]) yield snake(mRef[1]);

  // 4) jeżeli label ma dwukropek → część po dwukropku jako kanon (np. "…: first_name")
  const parts = f.label.split(":");
  if (parts.length > 1) {
    yield snake(parts[parts.length - 1]);
  }

  // 5) aliasy (np. telefon -> phone_number)
  const base = snake(f.label);
  for (const [canon, al] of Object.entries(ALIASES)) {
    if (canon === base) {
      for (const a of al) yield a;
    }
  }
  // oraz aliasy dla sufiksu z ref/label (first_name, last_name etc.)
  const suffix = mRef?.[1] || snake(parts.length > 1 ? parts[parts.length - 1] : "");
  if (suffix && ALIASES[suffix]) for (const a of ALIASES[suffix]) yield a;
}

export default function HorizonStepperRenderer({
  schema,
  hidden,
  onSubmit,
}: {
  schema: Schema;
  hidden: Record<string, string>;
  onSubmit: (payload: { values: Record<string, any>; hidden: Record<string, string> }) => Promise<void>;
}) {
  const toast = useToast();

  // Normalizacja do pages[]
  const pages = useMemo(() => {
    if ("pages" in schema) return schema.pages;
    return [{ title: undefined, fields: (schema as any).fields || [] }];
  }, [schema]);

  const allFields = useMemo(() => pages.flatMap((p) => p.fields), [pages]);

  const [values, setValues] = useState<Record<string, any>>({});
  const [step, setStep] = useState(0);

  // Prefill z hidden z rozszerzonym dopasowaniem kluczy
  useEffect(() => {
    const start: Record<string, any> = {};
    for (const f of allFields) {
      let v: any = "";

      // kolejno próbujemy różne klucze
      for (const k of keyCandidatesForField(f)) {
        if (hidden[k] != null) {
          v = hidden[k];
          break;
        }
      }

      // normalizacje typów
      if (f.uiType === "multiselect") {
        v =
          typeof v === "string" && v.includes(",")
            ? v.split(",").map((s) => s.trim()).filter(Boolean)
            : Array.isArray(v)
            ? v
            : [];
      }
      if (f.uiType === "yesno" && v !== "Yes" && v !== "No" && v !== "") {
        const s = String(v).toLowerCase();
        v = s.startsWith("t") || s === "1" || s === "yes" ? "Yes" : "No";
      }

      start[f.ref] = v;
    }
    setValues(start);
    setStep(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema as any, hidden]);

  const set = (ref: string, v: any) => setValues((s) => ({ ...s, [ref]: v }));

  const totalSteps = pages.length;
  const isLast = step === totalSteps - 1;
  const canPrev = step > 0;
  const canNext = step < totalSteps - 1;
  const progress = Math.round(((step + 1) / totalSteps) * 100);

  async function handleSubmit() {
    const byRef = { ...values };
    const byName: Record<string, any> = {};
    allFields.forEach((f) => (byName[snake(f.label)] = values[f.ref]));
    await onSubmit({ values: { ...byRef, ...byName }, hidden });
    toast({ title: "Saved", description: "Dane zostały zaktualizowane.", status: "success" });
  }

  const current = pages[step];

  // ===== BULLETS (pozycje możesz dalej regulować: top / width) =====
  const Bullets = () => (
    <Box
      position="absolute"
      left="50%"
      transform="translateX(-50%)"
      top={{ base: "64%", md: "22%" }}   // <- Twoje ustawienie
      w={{ base: "92vw", md: "min(1040px, 92vw)" }}
      overflowX="auto"
      px={{ base: 2, md: 4 }}
    >
      <Box position="absolute" left="0" right="0" top="50%" transform="translateY(-50%)" h="2px" bg="whiteAlpha.600" />
      <Flex position="relative" align="center" justify="space-between">
        {pages.map((p, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <Flex key={i} direction="column" align="center" gap="1" minW="80px" px={1}>
              <Box
                w="16px"
                h="16px"
                rounded="full"
                border="2px solid"
                borderColor={done || active ? "white" : "whiteAlpha.700"}
                bgGradient={done || active ? "linear(to-b, brand.400, brand.600)" : "none"}
              />
              <Text
                color="white"
                opacity={active ? 1 : 0.9}
                fontWeight={active ? "700" : "500"}
                fontSize="sm"
                noOfLines={1}
                maxW="140px"
                textAlign="center"
              >
                {p.title || `Step ${i + 1}`}
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
          {current?.title || "Form"}
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
                  <FormLabel fontWeight="700">{f.label}</FormLabel>

                  {["text", "email", "phone", "date", "number"].includes(f.uiType) ? (
                    <Input
                      type={f.uiType === "phone" ? "tel" : f.uiType === "text" ? "text" : f.uiType}
                      value={values[f.ref] ?? ""}
                      onChange={(e) => set(f.ref, e.target.value)}
                    />
                  ) : f.uiType === "textarea" ? (
                    <Textarea rows={4} value={values[f.ref] ?? ""} onChange={(e) => set(f.ref, e.target.value)} />
                  ) : f.uiType === "select" ? (
                    <Select value={values[f.ref] ?? ""} onChange={(e) => set(f.ref, e.target.value)}>
                      <option value="">— Wybierz —</option>
                      {(f.options || []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : f.uiType === "multiselect" ? (
                    <Select
                      multiple
                      value={values[f.ref] ?? []}
                      onChange={(e) => set(f.ref, Array.from(e.target.selectedOptions).map((o: any) => o.value))}
                      h="auto"
                      minH="40px"
                    >
                      {(f.options || []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : f.uiType === "radio" ? (
                    <RadioGroup value={values[f.ref] ?? ""} onChange={(v) => set(f.ref, v)}>
                      <Stack direction={{ base: "column", md: "row" }} spacing={4}>
                        {(f.options || []).map((o) => (
                          <Radio key={o} value={o} colorScheme="purple">
                            {o}
                          </Radio>
                        ))}
                      </Stack>
                    </RadioGroup>
                  ) : f.uiType === "yesno" ? (
                    <RadioGroup value={values[f.ref] ?? ""} onChange={(v) => set(f.ref, v)}>
                      <HStack spacing={6}>
                        <Radio value="Yes" colorScheme="purple">
                          Tak
                        </Radio>
                        <Radio value="No" colorScheme="purple">
                          Nie
                        </Radio>
                      </HStack>
                    </RadioGroup>
                  ) : f.uiType === "checkbox" ? (
                    <Checkbox
                      isChecked={!!values[f.ref]}
                      onChange={(e) => set(f.ref, e.target.checked ? "Yes" : "")}
                      colorScheme="purple"
                    >
                      Wyrażam zgodę
                    </Checkbox>
                  ) : f.uiType === "file" ? (
                    <Input
                      type="url"
                      placeholder="Wklej URL pliku (np. link do PDF)"
                      value={values[f.ref] ?? ""}
                      onChange={(e) => set(f.ref, e.target.value)}
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
            <Button colorScheme="purple" onClick={() => canNext && setStep((s) => Math.min(totalSteps - 1, s + 1))}>
              Next
            </Button>
          ) : (
            <Button colorScheme="purple" onClick={handleSubmit}>
              Submit
            </Button>
          )}
        </Flex>
      </Card>
    </Flex>
  );
}
