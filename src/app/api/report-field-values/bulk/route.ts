import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

type IncomingChange = {
  dealId?: number | string;
  deal_id?: number | string;
  reportFieldId?: number | string;
  report_field_id?: number | string;
  pdKey?: string | null;
  kind?: string | null;
  displayValue?: any;
  pdValue?: any;
  fieldName?: string | null;
  source?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null as any);

    console.log("[report-field-values/bulk] raw body:", body);

    if (!body || !Array.isArray(body.items)) {
      return NextResponse.json(
        { error: "Body must be { items: [...] } and not empty" },
        { status: 400 }
      );
    }

    const rawItems = body.items as IncomingChange[];

    const valid = rawItems
      .map((it, idx) => {
        if (!it) return null;

        // obsługujemy i camelCase, i snake_case
        const dealIdNum = Number(
          it.dealId ?? it.deal_id
        );
        const reportFieldIdNum = Number(
          it.reportFieldId ?? it.report_field_id
        );

        if (!dealIdNum || !reportFieldIdNum) {
          console.warn(
            `[report-field-values/bulk] skip idx=${idx} – bad ids`,
            { dealId: it.dealId ?? it.deal_id, reportFieldId: it.reportFieldId ?? it.report_field_id }
          );
          return null;
        }

        const valueJson = {
          pdKey: it.pdKey ?? null,
          kind: it.kind ?? null,
          displayValue: it.displayValue ?? null,
          pdValue: it.pdValue ?? null,
          fieldName: it.fieldName ?? null,
          source: it.source ?? null,
        };

        return {
          dealId: dealIdNum,
          reportFieldId: reportFieldIdNum,
          valueJson,
        };
      })
      .filter(Boolean) as {
        dealId: number;
        reportFieldId: number;
        valueJson: any;
      }[];

    if (!valid.length) {
      return NextResponse.json(
        { error: "No valid items after parsing (missing dealId/reportFieldId)" },
        { status: 400 }
      );
    }

    const placeholders = valid.map(() => "(?,?,?)").join(",");
    const params: any[] = [];

    for (const v of valid) {
      params.push(v.dealId, v.reportFieldId, JSON.stringify(v.valueJson));
    }

    const sql = `
      INSERT INTO report_field_values (deal_id, report_field_id, value_json)
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        value_json = VALUES(value_json)
    `;

    console.log(
      "[report-field-values/bulk] SQL:",
      sql,
      "params length:",
      params.length
    );

    await pool.query(sql, params);

    return NextResponse.json({ ok: true, saved: valid.length });
  } catch (e: any) {
    console.error("[report-field-values/bulk] ERROR:", e);
    return NextResponse.json(
      { error: "Internal error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
