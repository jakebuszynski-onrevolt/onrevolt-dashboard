import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

// PATCH /api/report-pages/[id]
export async function PATCH(req: Request, context: any) {
  const id = Number(context.params.id);
  const body = await req.json();

  const { image_url, natural_width, natural_height, page_index } = body || {};
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const fields: string[] = [];
  const values: any[] = [];

  if (typeof image_url === "string") { fields.push("image_url = ?"); values.push(image_url); }
  if (typeof natural_width === "number") { fields.push("natural_width = ?"); values.push(natural_width); }
  if (typeof natural_height === "number") { fields.push("natural_height = ?"); values.push(natural_height); }
  if (typeof page_index === "number") { fields.push("page_index = ?"); values.push(page_index); }

  if (!fields.length)
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });

  values.push(id);
  await pool.query(`UPDATE report_project_pages SET ${fields.join(", ")} WHERE id = ?`, values);

  return NextResponse.json({ ok: true });
}

// DELETE /api/report-pages/[id]
export async function DELETE(req: Request, context: any) {
  const id = Number(context.params.id);
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await pool.query("DELETE FROM report_project_pages WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
}
