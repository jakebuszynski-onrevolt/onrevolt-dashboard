import { NextRequest } from "next/server";

const DOMAIN = process.env.PIPEDRIVE_DOMAIN;
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : "");
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || "";

export async function GET(req: NextRequest) {
  try {
    if (!TOKEN) return new Response("Missing PIPEDRIVE_API_TOKEN", { status: 500 });
    if (!BASE)  return new Response("Missing PIPEDRIVE_BASE_URL or PIPEDRIVE_DOMAIN", { status: 500 });

    const url = new URL(req.url);
    const pid = url.searchParams.get("pipeline_id");
    const target = pid ? `${BASE}/stages?pipeline_id=${pid}` : `${BASE}/stages`;

    const r = await fetch(target, {
      headers: { "x-api-token": TOKEN },
      cache: "no-store",
    });
    if (!r.ok) return new Response(`Pipedrive /stages ${r.status}: ${await r.text()}`, { status: 502 });
    const j = await r.json();
    return Response.json(j?.data ?? []);
  } catch (e: any) {
    return new Response(`stages error: ${e?.message || e}`, { status: 500 });
  }
}
