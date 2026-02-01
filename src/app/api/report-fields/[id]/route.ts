import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

// PATCH /api/report-fields/[id]
export async function PATCH(req: Request, context: any) {
  const id = Number(context.params.id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const b = await req.json();
  const fields: string[] = [];
  const vals: any[] = [];
  const map: Record<string, string> = {
    project_id: "project_id", page_id: "page_id", type: "type", name: "name",
    source: "source", pipedrive_key: "pipedrive_key", expr: "expr",
    x_percent: "x_percent", y_percent: "y_percent", w_percent: "w_percent", h_percent: "h_percent",
    font_family: "font_family", font_size: "font_size", font_weight: "font_weight",
    color: "color", text_align: "text_align", z_index: "z_index", meta_json: "meta_json"
  };

for (const k in map) if (k in b) {
  fields.push(`${map[k]} = ?`);

  if (k === "meta_json") {
    const v = b[k];
    if (v == null) {
      vals.push(null);
    } else if (typeof v === "string") {
      // zakładamy, że to już poprawny JSON string
      vals.push(v);
    } else {
      // obiekt → serializujemy raz
      vals.push(JSON.stringify(v));
    }
  } else {
    vals.push(b[k]);
  }
}



  if (!fields.length) return NextResponse.json({ error: "No fields to update" }, { status: 400 });

  vals.push(id);
  await pool.query(`UPDATE report_fields SET ${fields.join(", ")} WHERE id = ?`, vals);
  return NextResponse.json({ ok: true });
}

// DELETE /api/report-fields/[id]
export async function DELETE(_req: Request, context: any) {
  const id = Number(context.params.id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await pool.query("DELETE FROM report_fields WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
}
