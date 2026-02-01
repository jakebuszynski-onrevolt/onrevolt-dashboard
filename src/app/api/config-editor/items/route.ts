import { NextResponse } from "next/server";
import mysql from "mysql2/promise";

const PD_BASE = "https://api.pipedrive.com/v1";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Brak ENV: ${name}`);
  return v;
}

async function db() {
  return mysql.createConnection({
    host: mustEnv("DB_HOST"),
    user: mustEnv("DB_USER"),
    password: mustEnv("DB_PASSWORD"),
    database: mustEnv("DB_NAME"),
    charset: "utf8mb4",
  });
}

async function pdGet(path: string) {
  const token = mustEnv("PIPEDRIVE_API_TOKEN");
  const url = `${PD_BASE}${path}${path.includes("?") ? "&" : "?"}api_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok || j?.success === false) throw new Error(`Pipedrive GET ${path} failed: ${JSON.stringify(j)}`);
  return j;
}

async function pdPut(path: string, body: any) {
  const token = mustEnv("PIPEDRIVE_API_TOKEN");
  const url = `${PD_BASE}${path}${path.includes("?") ? "&" : "?"}api_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok || j?.success === false) throw new Error(`Pipedrive PUT ${path} failed: ${JSON.stringify(j)}`);
  return j;
}

type PdOption = { id: number; label: string };
type PdField = { id: number; name: string; options: PdOption[] };

async function getDealEnumFieldById(pd_field_id: number): Promise<PdField> {
  const j: any = await pdGet("/dealFields");
  const data: any[] = Array.isArray(j?.data) ? j.data : [];
  const f = data.find((x) => Number(x?.id) === pd_field_id);
  if (!f) throw new Error(`Nie znaleziono dealField id=${pd_field_id}`);
  if (!Array.isArray(f.options)) throw new Error(`Pole id=${pd_field_id} nie ma options (musi być enum/set).`);
  return {
    id: Number(f.id),
    name: String(f.name ?? ""),
    options: f.options.map((o: any) => ({ id: Number(o.id), label: String(o.label ?? "") })),
  };
}

async function updateDealFieldOptions(pd_field_id: number, options: Array<{ id?: number; label: string }>) {
  const safe = options.map((o) => (o.id ? { id: o.id, label: o.label } : { label: o.label }));
  await pdPut(`/dealFields/${pd_field_id}`, { options: safe });
}

async function ensureSqlRows(pd_field_id: number, options: PdOption[]) {
  const conn = await db();
  try {
    const [rows] = await conn.execute<any[]>(
      `SELECT pd_option_id FROM pd_config_items WHERE pd_field_id=?`,
      [pd_field_id]
    );
    const existing = new Set(rows.map((r) => Number(r.pd_option_id)));

    for (const o of options) {
      if (!existing.has(o.id)) {
        await conn.execute(
          `INSERT INTO pd_config_items (pd_field_id, pd_option_id, label, item_type)
           VALUES (?,?,?, 'towar')`,
          [pd_field_id, o.id, o.label]
        );
      } else {
        // sync label
        await conn.execute(
          `UPDATE pd_config_items SET label=? WHERE pd_field_id=? AND pd_option_id=?`,
          [o.label, pd_field_id, o.id]
        );
      }
    }
  } finally {
    await conn.end();
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const pd_field_id = Number(searchParams.get("pd_field_id"));
    if (!Number.isFinite(pd_field_id)) {
      return NextResponse.json({ ok: false, error: "pd_field_id wymagane (number)" }, { status: 400 });
    }

    const pdField = await getDealEnumFieldById(pd_field_id);
    await ensureSqlRows(pd_field_id, pdField.options);

    const conn = await db();
    try {
      const [metaRows] = await conn.execute<any[]>(
        `SELECT pd_option_id, label, item_type, price1, price2, price3plus, percent, maxdot, par1, par2
         FROM pd_config_items
         WHERE pd_field_id=?
         ORDER BY label ASC`,
        [pd_field_id]
      );

      const metaById = new Map<number, any>();
      for (const r of metaRows) metaById.set(Number(r.pd_option_id), r);

const items = pdField.options.map((o) => {
  const m = metaById.get(o.id);
  return {
    pd_option_id: o.id,
    label: o.label,
    item_type: m?.item_type ?? "towar",
    price1: m?.price1 ?? null,
    price2: m?.price2 ?? null,
    price3plus: m?.price3plus ?? null,
    percent: m?.percent ?? null,
    maxdot: m?.maxdot ?? null,
    // par1/par2 jeśli już dodałeś:
    par1: m?.par1 ?? null,
    par2: m?.par2 ?? null,
  };
});

      return NextResponse.json({ ok: true, field: { id: pdField.id, name: pdField.name }, items });
    } finally {
      await conn.end();
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

type Action =
  | { action: "add"; pd_field_id: number; label: string }
  | { action: "delete"; pd_field_id: number; pd_option_id: number }
  | { action: "rename"; pd_field_id: number; pd_option_id: number; label: string }
  | {
      action: "update_meta";
      pd_field_id: number;
      pd_option_id: number;
      item_type?: string;
      price1?: number | null;
      price2?: number | null;
      price3plus?: number | null;
      percent?: number | null;
      maxdot?: number | null;
      par1?: string | null;
      par2?: string | null;
    };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Action;

    const pd_field_id = Number((body as any).pd_field_id);
    if (!Number.isFinite(pd_field_id)) {
      return NextResponse.json({ ok: false, error: "pd_field_id wymagane (number)" }, { status: 400 });
    }

    const pdField = await getDealEnumFieldById(pd_field_id);

    // ADD
    if (body.action === "add") {
      const label = (body.label || "").trim();
      if (!label) return NextResponse.json({ ok: false, error: "Brak label" }, { status: 400 });

      const current = pdField.options.map((o) => ({ id: o.id, label: o.label }));
      await updateDealFieldOptions(pd_field_id, [...current, { label }]);

      const pdField2 = await getDealEnumFieldById(pd_field_id);
      const added = pdField2.options.find((o) => o.label === label) || pdField2.options[pdField2.options.length - 1];
      if (!added) throw new Error("Nie udało się odnaleźć dodanej opcji w PD.");

      const conn = await db();
      try {
        await conn.execute(
          `INSERT INTO pd_config_items (pd_field_id, pd_option_id, label, item_type)
           VALUES (?,?,?, 'towar')
           ON DUPLICATE KEY UPDATE label=VALUES(label)`,
          [pd_field_id, added.id, added.label]
        );
      } finally {
        await conn.end();
      }

      return NextResponse.json({ ok: true, added });
    }

    // DELETE
    if (body.action === "delete") {
      const id = Number(body.pd_option_id);
      if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "pd_option_id niepoprawne" }, { status: 400 });

      const next = pdField.options.filter((o) => o.id !== id).map((o) => ({ id: o.id, label: o.label }));
      await updateDealFieldOptions(pd_field_id, next);

      const conn = await db();
      try {
        await conn.execute(`DELETE FROM pd_config_items WHERE pd_field_id=? AND pd_option_id=?`, [pd_field_id, id]);
      } finally {
        await conn.end();
      }

      return NextResponse.json({ ok: true });
    }

    // RENAME
    if (body.action === "rename") {
      const id = Number(body.pd_option_id);
      const label = (body.label || "").trim();
      if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "pd_option_id niepoprawne" }, { status: 400 });
      if (!label) return NextResponse.json({ ok: false, error: "Brak label" }, { status: 400 });

      const next = pdField.options.map((o) => (o.id === id ? { id: o.id, label } : { id: o.id, label: o.label }));
      await updateDealFieldOptions(pd_field_id, next);

      const conn = await db();
      try {
        await conn.execute(
          `UPDATE pd_config_items SET label=? WHERE pd_field_id=? AND pd_option_id=?`,
          [label, pd_field_id, id]
        );
      } finally {
        await conn.end();
      }

      return NextResponse.json({ ok: true });
    }

    // UPDATE_META (SQL only)
    if (body.action === "update_meta") {
      const id = Number(body.pd_option_id);
      if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "pd_option_id niepoprawne" }, { status: 400 });

      const item_type = (body.item_type ?? "").trim() || null;

      const conn = await db();
      try {
        await conn.execute(
          `UPDATE pd_config_items
           SET item_type = COALESCE(?, item_type),
               price1 = ?,
               price2 = ?,
               price3plus = ?,
               percent = ?,
               maxdot = ?,
               par1 = ?,
               par2 = ?
           WHERE pd_field_id=? AND pd_option_id=?`,
          [
            item_type,
            body.price1 ?? null,
            body.price2 ?? null,
            body.price3plus ?? null,
            body.percent ?? null,
            body.maxdot ?? null,
            body.par1 ?? null,
            body.par2 ?? null,
            pd_field_id,
            id,
          ]
        );
      } finally {
        await conn.end();
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Nieznana akcja" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
