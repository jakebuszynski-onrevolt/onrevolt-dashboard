import { NextRequest } from "next/server";
import {
  getTypeformForm,
  simplifyTypeformFieldsFull,
  type TypeformField,
} from "../../../../clients/typeform";

// --- Pipedrive config przez API KEY ---
const DOMAIN = process.env.PIPEDRIVE_DOMAIN; // np. "mycompany"
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : "");
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || "";

// --- Pipedrive helpers ---
async function listDealFields() {
  let start = 0;
  const limit = 500;
  const out: any[] = [];
  for (;;) {
    const url = `${BASE}/dealFields?start=${start}&limit=${limit}`;
    const r = await fetch(url, {
      headers: { "x-api-token": TOKEN },
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${await r.text()}`);
    const j = await r.json();
    out.push(...(j?.data ?? []));
    const more = j?.additional_data?.pagination?.more_items_in_collection;
    if (!more) break;
    start = j?.additional_data?.pagination?.next_start ?? start + limit;
  }
  return out.map((f: any) => ({
    id: f.id,
    key: f.key,                // tym kluczem ustawiasz wartości w Deal
    name: f.name,
    field_type: f.field_type,  // varchar, double, enum, set, date, phone...
    options: (f.options ?? []).map((o: any) => o.label),
  }));
}

// --- mapowanie Typeform → Pipedrive ---
type PdType =
  | "varchar" | "text" | "double" | "enum" | "set"
  | "phone" | "date";

function mapTfToPdType(tfType: TypeformField, multi?: boolean): PdType | undefined {
  switch (tfType) {
    case "short_text":
    case "email":
      return "varchar";
    case "long_text":
    case "file_upload": // zapisujemy URL/ID pliku jako tekst
      return "text";
    case "number":
    case "opinion_scale":
    case "rating":
      return "double";
    case "date":
      return "date";
    case "dropdown":
      return "enum";
    case "multiple_choice":
      return multi ? "set" : "enum";
    case "yes_no":
      return "enum";
    case "phone_number":
      return "phone";
    // layoutowe lub kontenery pomijamy (dzieci już są spłaszczone):
    case "contact_info":
    case "group":
    case "inline_group":
    case "legal": // same „zgody” zwykle osobno modelujemy, ale nie mapujemy automatycznie
      return undefined;
    default:
      return undefined;
  }
}

function suggestedOptions(tf: {
  type: TypeformField;
  options?: string[];
}): string[] | undefined {
  if (tf.type === "yes_no") return ["Yes", "No"];
  return tf.options;
}

// Czytelna, ale stabilna nazwa w PD (możesz dodać ref, jeśli chcesz 100% unikalności)
function suggestedPdName(title: string, ref: string) {
  return title?.trim() || ref;
  // np. bardziej unikalnie:
  // return `${(title || ref).trim()} (TF:${ref.slice(0,8)})`;
}

// normalizacja nazw do porównań (bez polskich znaków, case-insensitive)
function normalizeName(s: string) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export async function GET(req: NextRequest) {
  try {
    if (!TOKEN) return new Response("Missing PIPEDRIVE_API_TOKEN", { status: 500 });
    if (!BASE)  return new Response("Missing PIPEDRIVE_BASE_URL or PIPEDRIVE_DOMAIN", { status: 500 });

    const url = new URL(req.url);
    const formId =
      url.searchParams.get("form_id") ||
      process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID ||
      "";
    if (!formId) {
      return new Response("Missing form_id (query) or NEXT_PUBLIC_TYPEFORM_FORM_ID", { status: 400 });
    }

    // 1) Typeform – pełne spłaszczenie (w tym contact_info → first/last/email/phone)
    const form = await getTypeformForm(formId);
    const tfFlat = simplifyTypeformFieldsFull(form);

    // mapujemy tylko pola, które mają sens w PD
    const tfMappable = tfFlat
      .map(tf => {
        const pdType = mapTfToPdType(tf.type, tf.multi);
        if (!pdType) return null;
        return {
          ref: tf.ref,
          title: tf.title,
          tf_type: tf.type,
          pd_type: pdType,
          options: suggestedOptions(tf),
          suggested_name: suggestedPdName(tf.title, tf.ref),
        };
      })
      .filter(Boolean) as Array<{
        ref: string;
        title: string;
        tf_type: string;
        pd_type: PdType;
        options?: string[];
        suggested_name: string;
      }>;

    // 2) Pipedrive – deal fields
    const pdFields = await listDealFields();

    // 3) porównanie po nazwie (z normalizacją)
    const pdByNormName = new Map(
      pdFields.map(f => [normalizeName(f.name), f])
    );

    const missing = tfMappable
      .map(tf => {
        const match = pdByNormName.get(normalizeName(tf.suggested_name));
        if (match) {
          return {
            tf_ref: tf.ref,
            tf_title: tf.title,
            tf_type: tf.tf_type,
            pd_suggested: { name: tf.suggested_name, field_type: tf.pd_type, options: tf.options },
            exists_in_pipedrive: true,
            existing_pd: match,
          };
        }
        return {
          tf_ref: tf.ref,
          tf_title: tf.title,
          tf_type: tf.tf_type,
          pd_suggested: { name: tf.suggested_name, field_type: tf.pd_type, options: tf.options },
          exists_in_pipedrive: false,
        };
      })
      .filter(row => !row.exists_in_pipedrive);

    return Response.json({
      form: { id: form.id, title: form.title },
      typeform_fields: tfMappable,   // spłaszczone + zmapowane
      pipedrive_fields: pdFields,    // uproszczone PD
      missing_on_pipedrive: missing, // tylko brakujące
    });
  } catch (e: any) {
    return new Response(`compare-typeform error: ${e?.message || e}`, { status: 500 });
  }
}
