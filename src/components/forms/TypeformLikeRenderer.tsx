"use client";

import {
  Box, Button, FormControl, FormLabel, Input, Textarea, Select,
  Checkbox, Radio, RadioGroup, Stack, useToast, Text, Flex, Progress, HStack
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

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
  | { id: string; title: string; fields: UiField[] }; // fallback, gdy ktoś poda starszą wersję

export default function TypeformLikeRenderer({
  schema,
  hidden,
  onSubmit,
}: {
  schema: Schema;
  hidden: Record<string, string>;
  onSubmit: (payload: { values: Record<string, any>; hidden: Record<string, string> }) => Promise<void>;
}) {
  const toast = useToast();

  // Ujednolicamy: zawsze pracujemy na pages[].
  const pages = useMemo(() => {
    if ("pages" in schema) return schema.pages;
    return [{ title: undefined, fields: (schema as any).fields || [] }];
  }, [schema]);

  const allFields = useMemo(() => pages.flatMap(p => p.fields), [pages]);

  const [values, setValues] = useState<Record<string, any>>({});
  const [step, setStep] = useState(0);

  // Prefill z hidden (po ref lub po snake(label)). Multiselect parsujemy po przecinku.
  useEffect(() => {
    const start: Record<string, any> = {};
    for (const f of allFields) {
      const snakeLabel = (f.label || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      let v: any = hidden[f.ref] ?? hidden[snakeLabel] ?? "";

      if (f.uiType === "multiselect") {
        v = typeof v === "string" && v.includes(",") ? v.split(",").map(s => s.trim()).filter(Boolean) : (Array.isArray(v) ? v : []);
      }
      if (f.uiType === "yesno" && v !== "Yes" && v !== "No" && v !== "") {
        v = String(v).toLowerCase().startsWith("t") ? "Yes" : "No";
      }

      start[f.ref] = v;
    }
    setValues(start);
    setStep(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema?.id]);

  const set = (ref: string, v: any) => setValues((s) => ({ ...s, [ref]: v }));

  const totalSteps = pages.length;
  const progress = Math.round(((step + 1) / totalSteps) * 100);

  const isLast = step === totalSteps - 1;
  const canPrev = step > 0;
  const canNext = step < totalSteps - 1;

  const submit = async () => {
    // wyślij wartości zarówno po ref jak i po „snake(label)”
    const byRef = { ...values };
    const byName: Record<string, any> = {};
    allFields.forEach((f) => {
      const key = (f.label || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      byName[key] = values[f.ref];
    });

    await onSubmit({ values: { ...byRef, ...byName }, hidden });
    toast({
      title: "Saved",
      description: "Dane zostały zaktualizowane.",
      status: "success",
    });
  };

  const current = pages[step];

  return (
    <Box minH="100vh" bgGradient="linear(to-b, #0b1220, #0b1220 20%, #151b2b 100%)" py={10}>
      <Box maxW="900px" mx="auto" px={4}>
        {/* Header */}
        <Box textAlign="center" mb={6}>
          <Text fontSize="3xl" fontWeight="700" color="whiteAlpha.900">
            {"title" in schema ? (schema as any).title : "Form"}
          </Text>
          <Text fontSize="md" color="whiteAlpha.700">
            Krok {step + 1} z {totalSteps}{current?.title ? ` — ${current.title}` : ""}
          </Text>
        </Box>

        {/* Progress */}
        <Box mb={6}>
          <Progress value={progress} size="sm" colorScheme="purple" rounded="full" />
        </Box>

        {/* Karta strony */}
        <Box
          bg="whiteAlpha.50"
          backdropFilter="blur(6px)"
          border="1px"
          borderColor="whiteAlpha.200"
          rounded="2xl"
          p={{ base: 6, md: 10 }}
          boxShadow="xl"
        >
          <Stack spacing={6}>
            {current.fields.map((f) => (
              <FormControl key={f.ref}>
                <FormLabel fontSize="lg" color="whiteAlpha.900">{f.label}</FormLabel>

                {["text","email","phone","date","number"].includes(f.uiType) ? (
                  <Input
                    type={f.uiType === "phone" ? "tel" : f.uiType === "text" ? "text" : f.uiType}
                    value={values[f.ref] ?? ""}
                    onChange={(e) => set(f.ref, e.target.value)}
                    bg="whiteAlpha.100" borderColor="whiteAlpha.300" color="white"
                    _placeholder={{ color: "whiteAlpha.600" }}
                  />
                ) : f.uiType === "textarea" ? (
                  <Textarea
                    value={values[f.ref] ?? ""}
                    onChange={(e) => set(f.ref, e.target.value)}
                    bg="whiteAlpha.100" borderColor="whiteAlpha.300" color="white"
                    _placeholder={{ color: "whiteAlpha.600" }}
                    rows={4}
                  />
                ) : f.uiType === "select" ? (
                  <Select
                    value={values[f.ref] ?? ""}
                    onChange={(e) => set(f.ref, e.target.value)}
                    bg="whiteAlpha.100" borderColor="whiteAlpha.300" color="white"
                  >
                    <option value="">— Wybierz —</option>
                    {(f.options || []).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </Select>
                ) : f.uiType === "multiselect" ? (
                  <Select
                    multiple
                    value={values[f.ref] ?? []}
                    onChange={(e) =>
                      set(
                        f.ref,
                        Array.from(e.target.selectedOptions).map((o: any) => o.value)
                      )
                    }
                    bg="whiteAlpha.100" borderColor="whiteAlpha.300" color="white"
                    height="auto"
                  >
                    {(f.options || []).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </Select>
                ) : f.uiType === "radio" ? (
                  <RadioGroup
                    value={values[f.ref] ?? ""}
                    onChange={(v) => set(f.ref, v)}
                  >
                    <Stack direction={{ base: "column", md: "row" }}>
                      {(f.options || []).map((o) => (
                        <Radio key={o} value={o} colorScheme="purple">
                          <Text color="whiteAlpha.900">{o}</Text>
                        </Radio>
                      ))}
                    </Stack>
                  </RadioGroup>
                ) : f.uiType === "yesno" ? (
                  <RadioGroup
                    value={values[f.ref] ?? ""}
                    onChange={(v) => set(f.ref, v)}
                  >
                    <Stack direction="row" spacing={6}>
                      <Radio value="Yes" colorScheme="purple"><Text color="whiteAlpha.900">Tak</Text></Radio>
                      <Radio value="No"  colorScheme="purple"><Text color="whiteAlpha.900">Nie</Text></Radio>
                    </Stack>
                  </RadioGroup>
                ) : f.uiType === "checkbox" ? (
                  <Checkbox
                    isChecked={!!values[f.ref]}
                    onChange={(e) => set(f.ref, e.target.checked ? "Yes" : "")}
                    colorScheme="purple"
                    color="whiteAlpha.900"
                  >
                    <Text color="whiteAlpha.900">Wyrażam zgodę</Text>
                  </Checkbox>
                ) : f.uiType === "file" ? (
                  <Flex direction="column" gap={2}>
                    <Input
                      type="url"
                      placeholder="Wklej URL pliku (np. link do PDF)"
                      value={values[f.ref] ?? ""}
                      onChange={(e) => set(f.ref, e.target.value)}
                      bg="whiteAlpha.100" borderColor="whiteAlpha.300" color="white"
                    />
                    <Text fontSize="sm" color="whiteAlpha.700">
                      (Wersja podstawowa: przyjmujemy link; upload S3 mogę dopisać)
                    </Text>
                  </Flex>
                ) : null}
              </FormControl>
            ))}

            {/* Nawigacja */}
            <HStack justify="space-between" pt={2}>
              <Button
                variant="outline"
                onClick={() => canPrev && setStep((s) => Math.max(0, s - 1))}
                isDisabled={!canPrev}
              >
                Wstecz
              </Button>

              {!isLast ? (
                <Button colorScheme="purple" onClick={() => canNext && setStep((s) => Math.min(totalSteps - 1, s + 1))}>
                  Dalej
                </Button>
              ) : (
                <Button colorScheme="purple" onClick={submit}>
                  Zapisz zmiany
                </Button>
              )}
            </HStack>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
