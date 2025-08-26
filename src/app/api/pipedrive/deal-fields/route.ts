import { NextRequest } from "next/server";

const DOMAIN = process.env.PIPEDRIVE_DOMAIN; // np. "mycompany"
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : "");
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || "";

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
  return out;
}

export async function GET(_req: NextRequest) {
  try {
    if (!TOKEN) return new Response("Missing PIPEDRIVE_API_TOKEN", { status: 500 });
    if (!BASE)  return new Response("Missing PIPEDRIVE_BASE_URL or PIPEDRIVE_DOMAIN", { status: 500 });

    const fields = await listDealFields();

    // uproszczony widok do porównań
    const simplified = fields.map((f: any) => ({
      id: f.id,
      key: f.key,               // tym kluczem ustawiasz wartości w Deal
      name: f.name,
      field_type: f.field_type, // np. varchar, enum, set, double, date...
      options: (f.options ?? []).map((o: any) => o.label), // dla enum/set
      add_visible_flag: f.add_visible_flag,
      edit_flag: f.edit_flag,
    }));

    return Response.json({
      count: simplified.length,
      fields: simplified,
    });
  } catch (e: any) {
    return new Response(`deal-fields error: ${e?.message || e}`, { status: 500 });
  }
}
