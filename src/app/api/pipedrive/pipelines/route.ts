import { NextRequest } from "next/server";

const DOMAIN = process.env.PIPEDRIVE_DOMAIN;
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : "");
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || "";

export async function GET(_req: NextRequest) {
  try {
    if (!TOKEN) return new Response("Missing PIPEDRIVE_API_TOKEN", { status: 500 });
    if (!BASE)  return new Response("Missing PIPEDRIVE_BASE_URL or PIPEDRIVE_DOMAIN", { status: 500 });

    const r = await fetch(`${BASE}/pipelines`, {
      headers: { "x-api-token": TOKEN },
      cache: "no-store",
    });
    if (!r.ok) return new Response(`Pipedrive /pipelines ${r.status}: ${await r.text()}`, { status: 502 });
    const j = await r.json();
    return Response.json(j?.data ?? []);
  } catch (e: any) {
    return new Response(`pipelines error: ${e?.message || e}`, { status: 500 });
  }
}
