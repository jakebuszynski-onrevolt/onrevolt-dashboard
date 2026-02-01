import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import type { ResultSetHeader } from "mysql2";

// GET /api/report-fields?projectId=1
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const [rows] = await pool.query(
    "SELECT * FROM report_fields WHERE project_id = ? ORDER BY z_index, id",
    [projectId]
  );
  return NextResponse.json(rows);
}

// POST /api/report-fields
export async function POST(req: Request) {
  const b = await req.json();
  const required = ["project_id","page_id","type","name","source","x_percent","y_percent","w_percent","h_percent"];
  for (const k of required) if (b[k] === undefined) {
    return NextResponse.json({ error: `Missing ${k}` }, { status: 400 });
  }

  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO report_fields
    (project_id,page_id,type,name,source,pipedrive_key,expr,
     x_percent,y_percent,w_percent,h_percent,
     font_family,font_size,font_weight,color,text_align,z_index,meta_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      b.project_id, b.page_id, b.type, b.name, b.source, b.pipedrive_key ?? null, b.expr ?? null,
      b.x_percent, b.y_percent, b.w_percent, b.h_percent,
      b.font_family ?? "Inter", b.font_size ?? 14, b.font_weight ?? "400",
      b.color ?? "#0F172A", b.text_align ?? "left", b.z_index ?? 0,
      b.meta_json ? JSON.stringify(b.meta_json) : null
    ]
  );

  return NextResponse.json({ id: (res as any).insertId });
}
