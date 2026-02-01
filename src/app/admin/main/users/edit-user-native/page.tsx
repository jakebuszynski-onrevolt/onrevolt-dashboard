"use client";

import { useEffect, useMemo, useState, type FC } from "react";
import { useSearchParams } from "next/navigation";
import { Box, Center, Code, Spinner, Text } from "@chakra-ui/react";
import HorizonStepperRenderer from "@/components/forms/HorizonStepperRenderer";
import { apiPath } from "@/lib/basePath";

import dynamic from "next/dynamic";
const UserGeoSection = dynamic(
  () => import("@/components/users/UserGeoSection"),
  { ssr: false }
) as unknown as FC;

const CreateForm = dynamic(
  () => import("@/components/users/CreateForm"),
  { ssr: false }
) as unknown as FC;

/* ===================== helpers ===================== */
const ALIAS_MAXLEN = 57;

const snake = (s: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const ensureRaport = (ref: string) => {
  const s = snake(ref);
  return s.startsWith("raport_") ? s : `raport_${s}`;
};

const trunc57 = (s: string) => (s.length > ALIAS_MAXLEN ? s.slice(0, ALIAS_MAXLEN) : s);

/** Odczytaj wartość z custom_by_name wg pełnego refu (full),
 *  ucinając go do 57 znaków (tak jak zapisuje Pipedrive). */
function readRaportByFullRef(custom: Record<string, any>, fullRef: string) {
  if (!custom) return undefined;
  const full = ensureRaport(fullRef);          // pełny ref (znormalizowany, z "raport_")
  const cut = trunc57(full);                  // klucz jak w Pipedrive
  if (cut in custom) return custom[cut];
  // czasem w danych są też „pełne” lub inne warianty – spróbujmy jeszcze pełnego
  if (full in custom) return custom[full];
  return undefined;
}

/** Dla listy refów dopisz wartości do initialValues, biorąc z custom_by_name->[trunc57(ref)] */
function mapRefsIntoInitialValues(
  iv: Record<string, any>,
  custom: Record<string, any>,
  refs: string[],
  debugLabel?: string
) {
  const filled: string[] = [];
  for (const ref of refs) {
    if (!ref) continue;
    const val = readRaportByFullRef(custom, ref);
    if (val !== undefined && !(ref in iv)) {
      iv[ref] = val;
      filled.push(ref);
    }
  }
  if (debugLabel) {
    try {
      console.log(`${debugLabel} filled:`, filled);
    } catch { }
  }
}

/** jeśli mamy schema z Typeform — jedziemy po wszystkich polach ref zaczynających się na raport_ */
function mapSchemaRefs(iv: Record<string, any>, custom: Record<string, any>, schema: any) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  const refs = fields
    .map((f: any) => String(f?.ref || ""))
    .filter((r) => r && snake(r).startsWith("raport_"));
  mapRefsIntoInitialValues(iv, custom, refs, "SCHEMA-refs");
}

function firstLast(name?: string) {
  const s = (name || "").trim();
  if (!s) return { first_name: "", last_name: "" };
  const [f, ...r] = s.split(/\s+/);
  return { first_name: f || "", last_name: r.join(" ") || "" };
}

type PdDebug = {
  id?: number | string;
  title?: string;
  person?: any;
  custom_by_name?: Record<string, any>;
};

/* ===================== strona ===================== */
export default function Page() {
  const sp = useSearchParams();

  const [schema, setSchema] = useState<any>(null);
  const [initialValues, setInitialValues] = useState<Record<string, any>>({});
  const [pdDebug, setPdDebug] = useState<PdDebug | null>(null);
  const [loading, setLoading] = useState(true);

  const showDebugUI = sp.get("debug") === "1" || sp.get("debug") === "true";

  // tylko identyfikatory (deal_id/person_id) – NIE wysyłamy całych danych w URL
  const hidden = useMemo(() => {
    const obj: Record<string, string> = {};
    sp.forEach((v, k) => (obj[k] = v));
    return obj;
  }, [sp]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1) schema z Typeform (do renderera)
        const formId =
          sp.get("form_id") || process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID || "";
        const rSchema = await fetch(
          apiPath(`/api/typeform/form-schema?form_id=${formId}`),
          { cache: "no-store" }
        );
        const jSchema = await rSchema.json();

        // 2) prefill z Pipedrive po deal_id
        const dealId = sp.get("deal_id");
        let prefill: Record<string, any> = {};
        let pdDbg: PdDebug | null = null;

        if (dealId) {
          const rDeal = await fetch(apiPath(`/api/pipedrive/deals/${dealId}`), {
            cache: "no-store",
          });
          if (rDeal.ok) {
            const j = await rDeal.json();
            pdDbg = {
              id: j?.id,
              title: j?.title,
              person: j?.person,
              custom_by_name: j?.custom_by_name || {},
            };

            const c = j?.custom_by_name || {};
            const iv: Record<string, any> = {};

            // a) zasiej WSZYSTKO z custom_by_name (tak jak leci — to są klucze już 57/ucięte)
            for (const [k, v] of Object.entries(c)) iv[k] = v;

            // b) spróbuj przemapować WSZYSTKIE pola formularza (zaczynające się od raport_) z użyciem reguły 57
            mapSchemaRefs(iv, c, jSchema);

            // c) gdyby schema była pusta, dopisz kilka znanych długich refów
            const KNOWN_REFS = [
              // ELEKTR
              "raport_jaki_by_koszt_za_energie_elektryczna_w_ostatnich_2_miesiacach",
              "raport_czy_posiadasz_ostatni_rachunek_za_prad_w_postaci_pliku_pdf",

              "raport_podaj_kwote_ostatniego_rachunku_za_prad_za_dwa_miesiace",

              // CIEPŁO
              "raport_jaki_by_koszt_za_energie_cieplna_w_ostatnich_2_miesiacach",
              "raport_czy_posiadasz_ostatni_rachunek_za_energie_cieplna_w_postaci_pliku_pdf",
            ];
            mapRefsIntoInitialValues(iv, c, KNOWN_REFS, "KNOWN-refs");

            // d) osoba → first_name / last_name / email / phone_number
            const p = j?.person;
            if (p) {
              const { first_name, last_name } = firstLast(p.name);
              if (first_name) iv.first_name = first_name;
              if (last_name) iv.last_name = last_name;

              const email =
                Array.isArray(p.email) && p.email.length
                  ? p.email[0]?.value || p.email[0]
                  : "";
              const phone =
                Array.isArray(p.phone) && p.phone.length
                  ? p.phone[0]?.value || p.phone[0]
                  : "";
              if (email) iv.email = email;
              if (phone) iv.phone_number = phone;
            }


            prefill = iv;
          }
        }

        setSchema(jSchema);
        setInitialValues(prefill);
        setPdDebug(pdDbg);
      } finally {
        setLoading(false);
      }
    })();
  }, [sp]);

  // ====== HOOKI ZAWSZE WYWOŁYWANE ======
  const personSummary = useMemo(() => {
    const p = pdDebug?.person;
    if (!p) return null;
    const email =
      Array.isArray(p.email) && p.email.length
        ? p.email[0]?.value || p.email[0]
        : "";
    const phone =
      Array.isArray(p.phone) && p.phone.length
        ? p.phone[0]?.value || p.phone[0]
        : "";
    return { name: p.name, email, phone, id: p.id };
  }, [pdDebug]);

  // helper do ładnego wypisu wartości
  const renderVal = (v: any) => {
    if (v == null) return <Text as="span" color="gray.500">—</Text>;
    if (Array.isArray(v)) return <Code>{JSON.stringify(v)}</Code>;
    if (typeof v === "object")
      return <Code whiteSpace="pre-wrap">{JSON.stringify(v)}</Code>;
    const s = String(v);
    return <Text as="span">{s.length > 200 ? s.slice(0, 200) + "…" : s}</Text>;
  };

  return (
    <Box pt={{ sm: "125px", lg: "75px" }}>
      {/* LOADING */}
      {(!schema || loading) && (
        <Center minH="50vh" flexDir="column" gap={3}>
          <Spinner />
          <Text color="gray.600">Ładowanie formularza…</Text>
        </Center>
      )}

      {/* FORMULARZ */}
      {schema && !loading && (
        <>
          <HorizonStepperRenderer
            schema={schema}
            hidden={hidden}
            initialValues={initialValues}
            onSubmit={async ({ values, hidden }) => {


              // MINI FIX: zapis "Jaki był koszt za energię cieplną w ostatnich 2 miesiącach?"

              // --- KOSZT CIEPŁO (liczba) ---
              {
                const FORM_REF = "jaki_by_koszt_za_energie_cieplna_w_ostatnich_2_miesiacach";
                const PD_KEY = "jaki_by_koszt_za_energie_cieplna_w_ostatnich_2_mie"; // <= 57

                const raw = values[FORM_REF];
                if (raw !== undefined && raw !== "") {
                  const s = String(raw).replace(/\s/g, "").replace(",", ".");
                  const n = parseFloat(s);
                  values[PD_KEY] = Number.isFinite(n) ? n : raw;
                }
              }

              {
                const FORM_REF = "podaj_kwote_ostatniego_rachunku_za_prad_za_dwa_miesiace";
                const PD_KEY = "podaj_kwote_ostatniego_rachunku_za_prad_za_dwa_mie"; // <= 57 i z podkreślnikiem na końcu

                const raw = values[FORM_REF];
                if (raw !== undefined && raw !== "") {
                  const s = String(raw).replace(/\s/g, "").replace(",", ".");
                  const n = parseFloat(s);
                  values[PD_KEY] = Number.isFinite(n) ? n : raw;
                }
              }

              // --- PDF CIEPŁO (Tak/Nie) ---
              {
                const FORM_REF = "czy_posiadasz_ostatni_rachunek_za_energie_cieplna_w_postaci_pliku_pdf";
                const PD_KEY = "czy_posiadasz_ostatni_rachunek_za_energie_cieplna_"; // <= 57 i z podkreślnikiem na końcu

                const raw = values[FORM_REF];
                if (raw !== undefined && raw !== "") {
                  const s = String(raw).trim().toLowerCase();
                  const yn =
                    ["yes", "tak", "true", "1"].includes(s) ? "Yes" :
                      ["no", "nie", "false", "0"].includes(s) ? "No" :
                        raw; // zostaw jak przyszło
                  values[PD_KEY] = yn;
                }
              }

              const r = await fetch(apiPath(`/api/native-form/submit`), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ values, hidden }),
              });
              if (!r.ok) throw new Error(await r.text());
            }}
          />

          {/* Sekcja mapy pod formularzem */}
          <UserGeoSection />


          {/* Sekcja formularza */}
          <CreateForm />

        </>
      )}
    </Box>
  );
}
