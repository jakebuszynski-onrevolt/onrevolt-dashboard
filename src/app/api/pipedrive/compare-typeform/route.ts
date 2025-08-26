import { NextRequest } from "next/server";
import {
  getTypeformForm,
  simplifyTypeformFieldsFull,
  type TypeformField,
  type SimplifiedTFField,
} from "../../../../clients/typeform";

// ---- CONFIG PIPEDRIVE (API KEY) ----
const DOMAIN = process.env.PIPEDRIVE_DOMAIN; // np. "mycompany"
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : "");
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || "";

type Entity = "deal" | "person";

// ---- PIPEDRIVE HELPERS ----
function ep(entity: Entity) {
  return entity === "person" ? "personFields" : "dealFields";
}

async function listFields(entity: Entity) {
  let start = 0;
  const limit = 500;
  const out: any[] = [];
  for (;;) {
    const url = `${BASE}/${ep(entity)}?start=${start}&limit=${limit}`;
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
    key: f.key,
    name: f.name,
    field_type: f.field_type,       // np. varchar, text, double, enum, set, phone, date...
    options: (f.options ?? []).map((o: any) => o.label),
  }));
}

// ---- SANITIZER / NORMALIZER ----
/** snake_case ASCII: usuwa diakrytyki, zamienia nie-alfanum. na _, scala, tnie, wymusza lowercase */
function sanitizeToSnakeCase(input: string, refForFallback?: string, maxLen = 50): string {
  let s = (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");      // strip diacritics
  s = s.replace(/[^A-Za-z0-9]+/g, "_");     // wszystko poza [A-Za-z0-9] -> _
  s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, ""); // scala i trymuje _
  s = s.toLowerCase();
  if (!s || /^\d/.test(s)) s = `f_${s}`;    // nie zaczynaj od cyfry
  if (s.length > maxLen) s = s.slice(0, maxLen);
  if (!s) s = `field_${(refForFallback || "").slice(0, 8).toLowerCase()}`;
  return s;
}
/** normalizacja nazw PD do porównań – ta sama reguła co dla sugerowanych */
function normalizeForCompare(name: string) {
  return sanitizeToSnakeCase(name || "", "", 200);
}

// ---- MAPOWANIE TF -> PD ----
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
    // kontenery/layouty pomijamy (dzieci już są spłaszczone przez simplifyTypeformFieldsFull)
    case "contact_info":
    case "group":
    case "inline_group":
    case "legal":
      return undefined;
    default:
      return undefined;
  }
}

/** pola "personowe" — nie porównuj ich do Deal */
function isPersonish(tf: SimplifiedTFField) {
  const t = tf.type;
  const ref = tf.ref || "";
  const title = (tf.title || "").toLowerCase();
  if (t === "email" || t === "phone_number") return true;
  if (/__(first_name|last_name|email|phone)$/.test(ref)) return true;
  if (/\b(first\s*name|last\s*name)\b/i.test(title)) return true;
  if (title === "user_id" || /user[_\s]?id/.test(ref)) return true; // hidden identyfikacyjne
  return false;
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
    const entity = (url.searchParams.get("entity") as Entity) || "deal"; // "deal" | "person"

    if (!formId) {
      return new Response("Missing form_id (query) or NEXT_PUBLIC_TYPEFORM_FORM_ID", { status: 400 });
    }

    // 1) Typeform – spłaszczone pola (w tym contact_info rozbite)
    const form = await getTypeformForm(formId);
    const tfFlat = simplifyTypeformFieldsFull(form);

    // 2) Filtr pod encję
    const tfForEntity = tfFlat.filter(tf => {
      if (entity === "deal" && isPersonish(tf)) return false;
      if (entity === "person" && !isPersonish(tf)) return false;
      return true;
    });

    // 3) Mapowanie + SUGEROWANA NAZWA (snake_case)
    const seenNames = new Set<string>();
    const tfMappable = tfForEntity
      .map(tf => {
        const pdType = mapTfToPdType(tf.type, tf.multi);
        if (!pdType) return null;

        let suggested = sanitizeToSnakeCase(tf.title, tf.ref);
        // rozwiąż ewentualną kolizję w ramach jednej listy
        if (seenNames.has(suggested)) {
          suggested = `${suggested}_${(tf.ref || "").slice(0, 6).toLowerCase()}`;
        }
        seenNames.add(suggested);

        return {
          ref: tf.ref,
          title: tf.title,
          tf_type: tf.type,
          pd_type: pdType,
          options: tf.type === "yes_no" ? ["Yes", "No"] : (tf as any).options,
          suggested_name: suggested,
        };
      })
      .filter(Boolean) as Array<{
        ref: string;
        title: string;
        tf_type: TypeformField;
        pd_type: PdType;
        options?: string[];
        suggested_name: string;
      }>;

    // 4) Pipedrive – pola dla encji
    const pdFields = await listFields(entity);

    // 5) Porównanie po **znormalizowanej** nazwie
    const pdByNormName = new Map(
      pdFields.map(f => [normalizeForCompare(f.name), f])
    );

    const missing = tfMappable
      .map(tf => {
        const match = pdByNormName.get(normalizeForCompare(tf.suggested_name));
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
      entity,                          // "deal" (domyślnie) albo "person"
      typeform_fields: tfMappable,     // spłaszczone i zmapowane
      pipedrive_fields: pdFields,      // pola PD dla encji
      missing_on_pipedrive: missing,   // brakujące wg snake_case
      naming_convention: "snake_case ascii (no diacritics), lowercase, non-alnum -> _, collapse _, prefix f_ if starts with digit",
    });
  } catch (e: any) {
    return new Response(`compare-typeform error: ${e?.message || e}`, { status: 500 });
  }
}
