import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DOMAIN = process.env.PIPEDRIVE_DOMAIN; // np. "mycompany"
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : "");
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || "";

// ========================= ALIASY =========================
// klasyczne zachowanie: ucina trailing "_" (tak było dotychczas)
function snakeAliasTrim(input: string, maxLen = 120) {
  let s = (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") // ucina i z przodu i z tyłu
    .toLowerCase();
  if (/^\d/.test(s)) s = `f_${s}`;
  if (!s) s = "field";
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

// nowy wariant: NIE ucina trailing "_" (tylko leading)
function snakeAliasKeepTail(input: string, maxLen = 120) {
  let s = (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+/, "") // tylko leading
    .toLowerCase();
  if (/^\d/.test(s)) s = `f_${s}`;
  if (!s) s = "field";
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

// ========================= UTILS =========================
async function fetchJson(url: string) {
  const r = await fetch(url, {
    headers: { "x-api-token": TOKEN },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${await r.text()}`);
  return r.json();
}

// pobierz wszystkie definicje pól deala (z paginacją)
async function listDealFields(): Promise<any[]> {
  const out: any[] = [];
  let start = 0;
  const limit = 500;
  for (;;) {
    const j = await fetchJson(`${BASE}/dealFields?start=${start}&limit=${limit}`);
    out.push(...(j?.data ?? []));
    const more = j?.additional_data?.pagination?.more_items_in_collection;
    if (!more) break;
    start = j?.additional_data?.pagination?.next_start ?? start + limit;
  }
  return out;
}

export async function GET(_req: Request, ctx: any) {
  try {
    if (!TOKEN)
      return NextResponse.json(
        { error: "Missing PIPEDRIVE_API_TOKEN" },
        { status: 500 }
      );
    if (!BASE)
      return NextResponse.json(
        { error: "Missing PIPEDRIVE_BASE_URL or PIPEDRIVE_DOMAIN" },
        { status: 500 }
      );

    const id: string | undefined = ctx?.params?.id;
    if (!id) return NextResponse.json({ error: "Missing deal id" }, { status: 400 });

    // 1) Deal
    const deal = (await fetchJson(`${BASE}/deals/${id}`))?.data;

    // 2) Person (dla contact_info)
    let person: any = null;
    const personId =
      deal?.person_id?.value ??
      deal?.person_id?.id ??
      (typeof deal?.person_id === "number" ? deal.person_id : null);
    if (personId) {
      person = (await fetchJson(`${BASE}/persons/${personId}`))?.data;
    }

    // 3) Definicje pól (mapowanie enum/set -> label)
    const fields = await listDealFields();

    const optionLabelMap = new Map<string, Map<string | number, string>>();
    for (const f of fields) {
      if (!f?.key) continue;
      if (Array.isArray(f.options) && f.options.length) {
        const m = new Map<string | number, string>();
        for (const opt of f.options) {
          const optId =
            opt?.id ??
            opt?.id_option ??
            opt?.id_value ??
            opt?.value ??
            opt?.key;
          const label = opt?.label ?? String(optId);
          if (optId != null) m.set(optId, label);
        }
        optionLabelMap.set(f.key, m);
      }
    }

    // 4) custom_by_name z prefiksem "raport_"
    const custom_by_name: Record<string, any> = {};
    const fields_debug: Array<{
      key: string;
      name: string;
      field_type: string;
      alias_full: string;      // trim
      alias_short: string;     // trim bez prefiksu raport_
      alias_full_keep?: string;// keep-tail (jeśli różny)
      alias_short_keep?: string;// keep-tail bez prefiksu
      has_value: boolean;
      raw_value: any;
      mapped_value: any;
    }> = [];

    const alias_max_len = 57; // informacyjnie

    // Pomocniczo zbierz listę kluczy z deal-a, które mają wartości
    const deal_keys_with_values = Object.keys(deal || {}).filter(
      (k) => deal?.[k] != null && deal?.[k] !== ""
    );

    for (const f of fields) {
      const key = f?.key;
      if (!key) continue;
      const raw = deal?.[key];

      // zmapuj wartość jeśli enum/set itp.
      let mapped_value: any = raw;
      const ft = f.field_type;
      if ((ft === "enum" || ft === "varchar_options") && optionLabelMap.has(key)) {
        const labels = optionLabelMap.get(key)!;
        mapped_value =
          labels.get(raw) ??
          labels.get(String(raw)) ??
          labels.get(Number(raw)) ??
          raw;
      } else if (ft === "set" && optionLabelMap.has(key)) {
        const labels = optionLabelMap.get(key)!;
        const arr =
          Array.isArray(raw)
            ? raw
            : typeof raw === "string" && raw.includes(",")
            ? raw.split(",").map((s) => s.trim()).filter(Boolean)
            : raw != null
            ? [raw]
            : [];
        mapped_value = arr.map(
          (v) =>
            labels.get(v) ??
            labels.get(String(v)) ??
            labels.get(Number(v)) ??
            String(v)
        );
      }

// helper: dołóż prefiks tylko jeśli go nie ma
const withRaport = (s: string) => (s.startsWith("raport_") ? s : `raport_${s}`);

const aliasTrimShort = snakeAliasTrim(f.name || key, alias_max_len);
const aliasKeepShort = snakeAliasKeepTail(f.name || key, alias_max_len);

// uwaga: NIE doklejaj drugi raz "raport_" jeśli nazwa już go zawierała
const aliasTrimFull = withRaport(aliasTrimShort);
const aliasKeepFull = withRaport(aliasKeepShort);

// zapisuj obie wersje (trim + keep-tail), ale tylko jeśli jest wartość
if (raw != null && raw !== "") {
  custom_by_name[aliasTrimFull] = mapped_value;
  if (aliasKeepFull !== aliasTrimFull) {
    custom_by_name[aliasKeepFull] = mapped_value;
  }
}


      fields_debug.push({
        key,
        name: f?.name,
        field_type: ft,
        alias_full: aliasTrimFull,
        alias_short: aliasTrimShort,
        alias_full_keep: aliasKeepFull !== aliasTrimFull ? aliasKeepFull : undefined,
        alias_short_keep: aliasKeepShort !== aliasTrimShort ? aliasKeepShort : undefined,
        has_value: raw != null && raw !== "",
        raw_value: raw,
        mapped_value,
      });
    }

    return NextResponse.json({
      id: deal?.id,
      title: deal?.title,
      person,
      custom_by_name,
      debug: {
        alias_max_len,
        deal_keys_with_values,
        fields_debug,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
