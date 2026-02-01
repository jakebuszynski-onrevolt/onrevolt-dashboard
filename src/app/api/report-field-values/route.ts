// app/api/report-field-values/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db"; // <-- używamy wspólnego poola, tak jak w innych API

// GET /api/report-field-values?dealId=123[&fieldId=45]
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dealId = searchParams.get("dealId");
    const fieldId = searchParams.get("fieldId");

    if (!dealId) {
      return NextResponse.json(
        { error: "Missing dealId" },
        { status: 400 }
      );
    }

    // tryb 1: pojedyncze pole (dla debugowania / ewentualnych użyć)
    if (fieldId) {
      const [rows] = await pool.query(
        "SELECT value_json FROM report_field_values WHERE deal_id = ? AND report_field_id = ?",
        [dealId, fieldId]
      );

      const arr = rows as any[];
      const row = arr[0] ?? null;

      return NextResponse.json({
        value_json: row?.value_json ?? null,
      });
    }

    // tryb 2: wszystkie pola dla danego dealId (to będziemy używać przy odczycie formularza)
    const [rows] = await pool.query(
      "SELECT deal_id, report_field_id, value_json FROM report_field_values WHERE deal_id = ?",
      [dealId]
    );

    return NextResponse.json({ items: rows });
  } catch (e: any) {
    console.error("[report-field-values] GET error:", e);
    return NextResponse.json(
      { error: "Internal error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

// POST /api/report-field-values
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { deal_id, report_field_id, value_json } = body || {};

    if (!deal_id || !report_field_id) {
      return NextResponse.json(
        { error: "Missing deal_id or report_field_id" },
        { status: 400 }
      );
    }

    const valueStr =
      typeof value_json === "string"
        ? value_json
        : JSON.stringify(value_json ?? {});

    await pool.query(
      `INSERT INTO report_field_values (deal_id, report_field_id, value_json)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)`,
      [deal_id, report_field_id, valueStr]
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[report-field-values] POST error:", e);
    return NextResponse.json(
      { error: "Internal error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
