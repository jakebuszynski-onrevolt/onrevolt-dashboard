// app/api/admin/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { pool } from "../../../../lib/db";

export async function GET(req: NextRequest) {
  try {
    const uidCookie =
      req.cookies.get("panel_uid")?.value ||
      req.cookies.get("uid")?.value ||
      null;

    if (!uidCookie) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const uid = Number(uidCookie);
    if (!Number.isFinite(uid)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // WAŻNE: pobieramy też username i access
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, firstname, lastname, email, username, role, access FROM panel_users ORDER BY lastname, firstname"
    );

    const users = rows.map((u) => {
      const role = Number(u.role);
      const accessRaw = u.access;

      // domyślne: jeśli access jest NULL, wyliczamy z roli
      const access =
        accessRaw == null
          ? role === 1
            ? 2 // admin -> wszystkie
            : 1 // user -> tylko swoje
          : Number(accessRaw);

      return {
        id: u.id as number,
        firstname: u.firstname as string,
        lastname: u.lastname as string,
        email: u.email as string,
        username: u.username as string,
        role,
        access,
      };
    });

    return NextResponse.json(users);
  } catch (err) {
    console.error("[GET /api/admin/users] error:", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
