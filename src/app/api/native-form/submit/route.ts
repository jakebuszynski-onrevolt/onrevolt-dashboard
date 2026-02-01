import { NextRequest, NextResponse } from "next/server";

const DOMAIN = process.env.PIPEDRIVE_DOMAIN;
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : "");
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || "";

function pdHeaders() {
  return { "x-api-token": TOKEN, "Content-Type": "application/json" };
}
function snakeAscii(input: string, maxLen = 220) {
  let s = (input || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[^A-Za-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  s = s.toLowerCase();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

type DealField = {
  key: string;
  name: string;
  snake: string;
  field_type: string;
  options?: Array<{ id: number | string; label: string }>;
};
type FieldMaps = { snakeToField: Map<string, DealField> };

async function loadDealFieldMaps(): Promise<FieldMaps> {
  const snakeToField = new Map<string, DealField>();
  let start = 0;
  const limit = 500;
  for (;;) {
    const url = `${BASE}/dealFields?start=${start}&limit=${limit}`;
    const r = await fetch(url, { headers: pdHeaders(), cache: "no-store" });
    if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${await r.text()}`);
    const j = await r.json();
    const rows = j?.data ?? [];
    for (const f of rows) {
      const meta: DealField = {
        key: String(f?.key),
        name: String(f?.name || ""),
        snake: snakeAscii(f?.name || ""),
        field_type: String(f?.field_type || ""),
        options: Array.isArray(f?.options)
          ? f.options.map((o: any) => ({
              id: o?.id ?? o?.key ?? o?.value,
              label: o?.label ?? String(o?.name ?? ""),
            }))
          : undefined,
      };
      snakeToField.set(meta.snake, meta);
    }
    const more = j?.additional_data?.pagination?.more_items_in_collection;
    if (!more) break;
    start = j?.additional_data?.pagination?.next_start ?? start + limit;
  }
  return { snakeToField };
}

// === typy/konwersje ===
const TRUTHY_LABELS = ["tak", "yes"];
const FALSY_LABELS  = ["nie", "no"];

const asNumber = (v: any): number | null => {
  if (v === "" || v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const asDate = (v: any): string | null => {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
};
const asTime = (v: any): string | null => {
  const s = String(v || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hh = String(Math.min(23, Number(m[1]))).padStart(2, "0");
  const mm = String(Math.min(59, Number(m[2]))).padStart(2, "0");
  return `${hh}:${mm}`;
};

function normalizeChoiceInput(raw: any): string[] {
  if (Array.isArray(raw)) return raw.flatMap(normalizeChoiceInput);
  if (raw && typeof raw === "object" && "label" in raw) return [String((raw as any).label)];
  if (typeof raw === "boolean") return TRUTHY_LABELS; // true -> ["tak","yes"]; false ustawimy niżej
  const s = String(raw ?? "").trim();
  if (!s) return [];
  return [s];
}
function matchEnumId(field: DealField, raw: any): number | string | null {
  const opts = field.options || [];
  if (!opts.length) return null;

  const asNum = asNumber(raw);
  if (asNum != null && opts.some(o => Number(o.id) === asNum)) return asNum;
  const rawStr = String(raw ?? "");
  if (rawStr && opts.some(o => String(o.id) === rawStr)) return rawStr;

  const cand0 = normalizeChoiceInput(raw);
  const cand =
    typeof raw === "boolean" ? (raw ? TRUTHY_LABELS : FALSY_LABELS) : cand0;

  for (const c of cand) {
    const cLow = c.toLowerCase();
    const cSnake = snakeAscii(c);
    const found =
      opts.find(o => o.label.toLowerCase() === cLow) ||
      opts.find(o => snakeAscii(o.label) === cSnake) ||
      opts.find(o => snakeAscii(o.label).includes(cSnake));
    if (found) return found.id;
  }
  return null;
}
function matchSetIds(field: DealField, raw: any): Array<number | string> | null {
  const opts = field.options || [];
  if (!opts.length) return null;
  const isCsv = typeof raw === "string" && raw.includes(",");
  const base = isCsv ? raw.split(",").map(s => s.trim()).filter(Boolean) : raw;
  const parts0 = normalizeChoiceInput(base);
  const parts =
    typeof base === "boolean" ? (base ? TRUTHY_LABELS : FALSY_LABELS) : parts0;

  const out: Array<number | string> = [];
  for (const p of parts) {
    const asNum = asNumber(p);
    if (asNum != null && opts.some(o => Number(o.id) === asNum)) { out.push(asNum); continue; }
    if (opts.some(o => String(o.id) === String(p))) { out.push(String(p)); continue; }
    const pLow = String(p).toLowerCase();
    const pSnake = snakeAscii(String(p));
    const found =
      opts.find(o => o.label.toLowerCase() === pLow) ||
      opts.find(o => snakeAscii(o.label) === pSnake) ||
      opts.find(o => snakeAscii(o.label).includes(pSnake));
    if (found) out.push(found.id);
  }
  return out.length ? out : null;
}
function coerceByType(field: DealField, rawVal: any) {
  const t = field.field_type;
  if (t === "enum")  return matchEnumId(field, rawVal);
  if (t === "set")   return matchSetIds(field, rawVal);
  if (t === "date")  return asDate(rawVal);
  if (t === "time")  return asTime(rawVal);
  if (t === "double" || t === "monetary" || t === "int" || t === "numeric" || t === "float")
                     return asNumber(rawVal);
  if (t === "user" || t === "org" || t === "people") {
    const n = asNumber(rawVal);
    return n != null ? n : null;
  }
  return Array.isArray(rawVal) ? rawVal.join(", ") : String(rawVal);
}

// resolver: exact → raport_ + exact → heurystyka prosta
function resolveField(snakeToField: Map<string, DealField>, keyFromForm: string): DealField | null {
  const s = snakeAscii(keyFromForm);
  let f = snakeToField.get(s);
  if (f) return f;
  f = snakeToField.get(`raport_${s}`);
  if (f) return f;

  // prostsza heurystyka pod długie pola (rachunek/koszt + prad/elektryczna/cieplna)
  const all = Array.from(snakeToField.values());
  const tokens = s.split("_").filter(Boolean);

  const prefer = all.filter(x => {
    const xs = x.snake;
    const okR = xs.startsWith("raport_");
    const hasRach = tokens.includes("rachunek") ? xs.includes("rachunek") : true;
    const hasKoszt = tokens.includes("koszt") ? xs.includes("koszt") : true;
    const isPrad = tokens.some(t => ["prad","elektryczna","energie","elektrycznej"].includes(t)) ? (xs.includes("prad") || xs.includes("elektryczna")) : true;
    const isCieplo = tokens.includes("cieplna") ? xs.includes("cieplna") : true;
    return okR && hasRach && hasKoszt && isPrad && isCieplo;
  });

  if (prefer.length === 1) return prefer[0];
  if (prefer.length > 1) return prefer.sort((a,b) => b.snake.length - a.snake.length)[0];

  // fallback: zawiera/przedrostek
  const cand =
    all.filter(x => x.snake.startsWith(s) || s.startsWith(x.snake)) ||
    all.filter(x => x.snake.includes(s) || s.includes(x.snake));

  if (cand.length === 1) return cand[0];
  if (cand.length > 1) return cand.sort((a,b) => b.snake.length - a.snake.length)[0];
  return null;
}

export async function POST(req: NextRequest) {
  try {
    if (!TOKEN || !BASE) {
      return NextResponse.json({ error: "Missing Pipedrive config" }, { status: 500 });
    }

    const { values = {}, hidden = {} } = (await req.json()) || {};
    const dealId = hidden.deal_id || hidden.dealId || hidden.deal;
    const personId = hidden.person_id || hidden.personId || hidden.person;

    const v: Record<string, any> = { ...values };
    if (v.miasto == null) v.miasto = v.miasto_miejscowosc ?? v.miejscowosc ?? null;
    if (v.phone_number == null && v.phone != null) v.phone_number = v.phone;

    const { snakeToField } = await loadDealFieldMaps();

    const dealPayload: Record<string, any> = {};
    const dealApplied: string[] = [];
    const dealSkipped: Array<{ name: string; reason: string; value: any; field?: any }> = [];

    for (const [k, rawVal] of Object.entries(v)) {
      if (rawVal == null) continue;
      const rawStr = String(rawVal).trim();
      if (!rawStr) continue;

      const field = resolveField(snakeToField, k);
      if (!field) { dealSkipped.push({ name: k, reason: "no such deal field", value: rawVal }); continue; }

      const coerced = coerceByType(field, rawVal);
      if (coerced == null || (Array.isArray(coerced) && !coerced.length)) {
        dealSkipped.push({ name: k, reason: `value not applicable for ${field.field_type}`, value: rawVal, field });
        continue;
      }

      dealPayload[field.key] = coerced;
      dealApplied.push(`${k} → ${field.key} (${field.snake})`);
    }

    let dealRes: any = null;
    if (dealId && Object.keys(dealPayload).length > 0) {
      const r = await fetch(`${BASE}/deals/${dealId}`, {
        method: "PUT",
        headers: pdHeaders(),
        body: JSON.stringify(dealPayload),
      });
      const body = await r.text();
      if (!r.ok) {
        return NextResponse.json(
          { error: "Pipedrive update failed", status: r.status, body, debug: { dealPayload, dealApplied, dealSkipped } },
          { status: 502 }
        );
      }
      dealRes = JSON.parse(body);
    }

    // optional: person
    const pp: Record<string, any> = {};
    const s = (x: any) => (x == null ? "" : String(x).trim());
    const first = s(v.first_name), last = s(v.last_name), email = s(v.email), phone = s(v.phone_number);
    if (first) pp.first_name = first;
    if (last)  pp.last_name  = last;
    if (first || last) pp.name = `${first} ${last}`.trim();
    if (email) pp.email = [{ value: email, primary: true, label: "work" }];
    if (phone) pp.phone = [{ value: phone, primary: true, label: "work" }];

    let personRes: any = null;
    if (personId && Object.keys(pp).length) {
      const r = await fetch(`${BASE}/persons/${personId}`, {
        method: "PUT",
        headers: pdHeaders(),
        body: JSON.stringify(pp),
      });
      const body = await r.text();
      if (!r.ok) {
        return NextResponse.json({ error: "Pipedrive person update failed", status: r.status, body, debug: { personPayload: pp } }, { status: 502 });
      }
      personRes = JSON.parse(body);
    }

    return NextResponse.json({
      ok: true,
      updated: {
        deal: { id: dealId, fields: Object.keys(dealPayload) },
        person: { id: personId, fields: Object.keys(pp) },
      },
      dealResponse: dealRes,
      personResponse: personRes,
      debug: { dealApplied, dealSkipped },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
