// clients/pipedrive/fields.ts
export type Entity = "deal";
export type FieldType =
  | "varchar" | "text" | "double" | "enum" | "set"
  | "phone" | "date" | "monetary";

const DOMAIN = process.env.PIPEDRIVE_DOMAIN;
const BASE = process.env.PIPEDRIVE_BASE_URL ?? `https://${DOMAIN}.pipedrive.com/api/v1`;
const TOKEN = process.env.PIPEDRIVE_API_TOKEN!;

function ep(entity: Entity) {
  if (entity === "deal") return "dealFields";
  throw new Error("Unsupported entity");
}

export async function listFields(entity: Entity) {
  let start = 0, out: any[] = [];
  for (;;) {
    const r = await fetch(`${BASE}/${ep(entity)}?start=${start}&limit=500`, {
      headers: { "x-api-token": TOKEN },
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`GET ${ep(entity)} failed: ${r.status}`);
    const json = await r.json();
    out.push(...(json?.data ?? []));
    const more = json?.additional_data?.pagination?.more_items_in_collection;
    if (!more) break;
    start = json?.additional_data?.pagination?.next_start ?? start + 500;
  }
  return out;
}

export async function findFieldByName(entity: Entity, name: string, fieldType?: FieldType) {
  const all = await listFields(entity);
  const byName = all.filter((f: any) => f.name === name);
  return fieldType ? byName.find((f: any) => f.field_type === fieldType) : byName[0];
}

export async function ensureField(params: {
  entity: Entity;
  name: string;
  field_type: FieldType;
  options?: string[]; // dla enum/set
}) {
  const { entity, name, field_type, options } = params;
  const existing = await findFieldByName(entity, name, field_type);
  if (existing) return { created: false, id: existing.id, key: existing.key, field: existing };

  const body: any = { name, field_type };
  if (field_type === "enum" || field_type === "set") {
    body.options = (options ?? []).map((label) => ({ label }));
  }

  const res = await fetch(`${BASE}/${ep(entity)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-token": TOKEN },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${ep(entity)} failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { created: true, id: json.data.id, key: json.data.key, field: json.data };
}
