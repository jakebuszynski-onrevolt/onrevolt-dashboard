import { NextRequest } from "next/server";

const DOMAIN = process.env.PIPEDRIVE_DOMAIN;
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : "");
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || "";

function norm(s: string) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

async function getDealFieldKeyByName(): Promise<Record<string, string>> {
  const r = await fetch(`${BASE}/dealFields`, {
    headers: { "x-api-token": TOKEN },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`dealFields ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const map: Record<string, string> = {};
  for (const f of j?.data || []) map[norm(f.name)] = f.key;
  return map;
}

async function updatePerson(id: string | number, data: Record<string, any>) {
  const r = await fetch(`${BASE}/persons/${id}`, {
    method: "PATCH",
    headers: { "x-api-token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`PATCH person ${r.status}: ${await r.text()}`);
  return r.json();
}

async function updateDeal(id: string | number, data: Record<string, any>) {
  const r = await fetch(`${BASE}/deals/${id}`, {
    method: "PATCH",
    headers: { "x-api-token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`PATCH deal ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function POST(req: NextRequest) {
  try {
    if (!TOKEN || !BASE) return new Response("Pipedrive env missing", { status: 500 });

    const { values, hidden } = await req.json();
    const personId = hidden?.person_id || hidden?.user_id;
    const dealId = hidden?.deal_id;

    // scal: wartości z formularza mają priorytet nad hidden
    const merged: Record<string, any> = { ...(hidden || {}) };
    for (const [k, v] of Object.entries(values || {})) {
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (s !== "") merged[k] = s;
    }

    // rozdział: Person vs Deal
    const personUpdate: Record<string, any> = {};
    if (merged.first_name) personUpdate.first_name = merged.first_name;
    if (merged.last_name)  personUpdate.last_name  = merged.last_name;
    if (merged.email)      personUpdate.email      = merged.email;
    if (merged.phone || merged.phone_number) personUpdate.phone = merged.phone || merged.phone_number;

    const dealFieldMap = await getDealFieldKeyByName();
    const dealUpdate: Record<string, any> = {};
    for (const [k, v] of Object.entries(merged)) {
      if (["first_name","last_name","email","phone","phone_number","person_id","user_id","deal_id"].includes(k)) continue;
      const key = dealFieldMap[norm(k)];
      if (key) dealUpdate[key] = v;
    }

    const results: any = {};
    if (personId && Object.keys(personUpdate).length) {
      results.person = await updatePerson(personId, personUpdate);
    }
    if (dealId && Object.keys(dealUpdate).length) {
      results.deal = await updateDeal(dealId, dealUpdate);
    }

    return Response.json({ ok: true, updated: results });
  } catch (e: any) {
    return new Response(`native submit error: ${e?.message || e}`, { status: 500 });
  }
}
