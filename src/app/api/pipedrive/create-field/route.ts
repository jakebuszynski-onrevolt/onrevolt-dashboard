// POST /api/pipedrive/create-field
// Body: { entity?: "deal"|"person", name: string, field_type: "varchar"|"text"|"double"|"enum"|"set"|"phone"|"date", options?: string[] }

import { NextRequest } from "next/server";

type Entity = "deal" | "person";

const DOMAIN = process.env.PIPEDRIVE_DOMAIN; // np. "mycompany"
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : "");
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || "";

function ep(entity: Entity) {
  return entity === "person" ? "personFields" : "dealFields";
}

export async function POST(req: NextRequest) {
  try {
    if (!TOKEN) return new Response("Missing PIPEDRIVE_API_TOKEN", { status: 500 });
    if (!BASE)  return new Response("Missing PIPEDRIVE_BASE_URL or PIPEDRIVE_DOMAIN", { status: 500 });

    const { entity = "deal", name, field_type, options } = await req.json();

    if (!name || !field_type) {
      return new Response("Missing 'name' or 'field_type'", { status: 400 });
    }

    const body: any = { name, field_type };
    if ((field_type === "enum" || field_type === "set") && Array.isArray(options)) {
      body.options = options.map((label: string) => ({ label }));
    }

    const url = `${BASE}/${ep(entity as Entity)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-token": TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return new Response(`Pipedrive error: ${res.status} ${text}`, { status: 502 });
    }

    const json = await res.json();
    return Response.json({
      created: true,
      entity,
      id: json?.data?.id,
      key: json?.data?.key,
      field: json?.data,
    });
  } catch (e: any) {
    return new Response(`create-field error: ${e?.message || e}`, { status: 500 });
  }
}
