import { NextResponse } from "next/server";

const PD_BASE = "https://api.pipedrive.com/v1";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Brak ENV: ${name}`);
  return v;
}

async function pdGet(path: string) {
  const token = mustEnv("PIPEDRIVE_API_TOKEN");
  const url = `${PD_BASE}${path}${path.includes("?") ? "&" : "?"}api_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok || j?.success === false) {
    throw new Error(`Pipedrive GET ${path} failed: ${JSON.stringify(j)}`);
  }
  return j;
}

export async function GET() {
  try {
    const j: any = await pdGet("/dealFields");
    const data = Array.isArray(j?.data) ? j.data : [];

    const fields = data
      .filter((f: any) => typeof f?.name === "string" && f.name.toLowerCase().startsWith("config_"))
      .map((f: any) => ({
        id: Number(f.id),
        name: String(f.name),
        field_type: String(f.field_type ?? ""),
        options_count: Array.isArray(f.options) ? f.options.length : 0,
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name, "pl"));

    return NextResponse.json({ ok: true, fields });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
