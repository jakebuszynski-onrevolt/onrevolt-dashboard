"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Box, Center, Spinner, Text } from "@chakra-ui/react";
import HorizonStepperRenderer from "../../../../../components/forms/HorizonStepperRenderer";

export default function Page() {
  const sp = useSearchParams();
  const [schema, setSchema] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // hidden z query (?a=1&b=2)
  const hidden = useMemo(() => {
    const obj: Record<string, string> = {};
    sp.forEach((v, k) => (obj[k] = v));
    return obj;
  }, [sp]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const formId = sp.get("form_id") || process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID || "";
      const r = await fetch(`/api/typeform/form-schema?form_id=${formId}`, { cache: "no-store" });
      const j = await r.json();
      setSchema(j);
      setLoading(false);
    })();
  }, [sp]);

  if (loading || !schema) {
    return (
      <Center minH="50vh" flexDir="column" gap={3}>
        <Spinner />
        <Text color="gray.600">Ładowanie formularza…</Text>
      </Center>
    );
  }

  return (
    <Box pt={{ sm: "125px", lg: "75px" }}>
      <HorizonStepperRenderer
        schema={schema}
        hidden={hidden}
        onSubmit={async ({ values, hidden }) => {
          const r = await fetch("/api/native-form/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ values, hidden }),
          });
          if (!r.ok) throw new Error(await r.text());
        }}
      />
    </Box>
  );
}
