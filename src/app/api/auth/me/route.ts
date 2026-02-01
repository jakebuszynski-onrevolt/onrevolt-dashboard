import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "../../../../lib/db";

export async function GET(req: NextRequest) {
  try {
    // czytamy ciasteczko ustawiane w sign-in
    const uidCookie =
      req.cookies.get("panel_uid")?.value ||
      req.cookies.get("uid")?.value || // fallback, jeśli kiedyś zmienisz
      null;

    if (!uidCookie) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const uid = Number(uidCookie);
    if (!Number.isFinite(uid)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, firstname, lastname, email, username, role, access FROM panel_users WHERE id = ? LIMIT 1",
      [uid]
    );

    const u = rows?.[0];
    if (!u) return NextResponse.json({ error: "not found" }, { status: 404 });

    const accessRaw = u.access;

    const role = Number(u.role);
    // domyślne mapowanie: jeśli access NULL,
    // to admin dostaje 2, zwykły user 1
    const access =
      accessRaw == null
        ? role === 1
          ? 2
          : 1
        : Number(accessRaw);

    return NextResponse.json({
      id: u.id,
      firstname: u.firstname,
      lastname: u.lastname,
      email: u.email,
      username: u.username,
      role,
      access,
    });
  } catch {
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
