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

/**
 * Zwraca cache całej tabeli pd_config_items + mapę pól config_* (pd_field_id -> name).
 * Dzięki temu w frontendzie budujesz mapę: config_bank -> { "15 kWh": {...} }
 */
export async function GET() {
  try {
    // 1) pobierz config_* dealFields (id + name)
    const dj: any = await pdGet("/dealFields");
    const dealFields = Array.isArray(dj?.data) ? dj.data : [];

    const configFields = dealFields
      .filter((f: any) => typeof f?.name === "string" && String(f.name).toLowerCase().startsWith("config_"))
      .map((f: any) => ({ pd_field_id: Number(f.id), name: String(f.name) }));

    const idToName = Object.fromEntries(configFields.map((x) => [String(x.pd_field_id), x.name]));

    // 2) pobierz wszystkie rekordy z SQL
    const conn = await db();
    try {
      const [rows] = await conn.execute<any[]>(
        `SELECT pd_field_id, pd_option_id, label, item_type, price1, price2, price3plus, percent, maxdot, par1, par2
         FROM pd_config_items`
      );
      return NextResponse.json({ ok: true, idToName, rows });
    } finally {
      await conn.end();
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
