import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import type { RowDataPacket } from "mysql2";

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();

    const id = Number(body.id);
    const role = Number(body.role);
    const access = Number(body.access);

    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    await pool.query(
      "UPDATE panel_users SET role = ?, access = ? WHERE id = ?",
      [role, access, id]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/admin/users/update error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
