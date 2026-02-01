import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DOMAIN = process.env.PIPEDRIVE_DOMAIN;
const BASE =
  process.env.PIPEDRIVE_BASE_URL ?? (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : "");
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || "";

async function fetchJson(url: string) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

function snake(input: string) {
  return (input || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export async function GET() {
  try {
    if (!TOKEN) return NextResponse.json({ error: "Missing PIPEDRIVE_API_TOKEN" }, { status: 500 });
    if (!BASE)  return NextResponse.json({ error: "Missing PIPEDRIVE_BASE_URL or PIPEDRIVE_DOMAIN" }, { status: 500 });

    // Persons fields
    const url = `${BASE}/personFields?api_token=${TOKEN}`;
    const j = await fetchJson(url);

    const fields = (j?.data ?? []).map((f: any) => ({
      id: f?.id,
      key: f?.key,          // <-- TEGO szukamy do .env
      name: f?.name,
      name_snake: snake(f?.name || ""),
      field_type: f?.field_type,
    }));

    // Pokaż sugestie dla lat/lon
    const suggestions = {
      lat_like: fields.filter((f: any) =>
        /lat|latitude|address_lat/i.test(f.key) || /lat|latitude/.test(f.name_snake)
      ),
      lon_like: fields.filter((f: any) =>
        /lon|long|lng|address_lon|address_long/i.test(f.key) || /(lon|long|lng)/.test(f.name_snake)
      ),
    };

    return NextResponse.json({ fields, suggestions });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
