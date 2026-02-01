import { NextResponse } from "next/server";
import { pool } from "@/lib/db"; // twoje połączenie do MariaDB
import type { ResultSetHeader } from "mysql2";

// GET /api/report-projects
export async function GET() {
  const [rows] = await pool.query("SELECT * FROM report_projects ORDER BY id");
  return NextResponse.json(rows);
}

// POST /api/report-projects
export async function POST(req: Request) {
  const { name, code } = await req.json();

const [result] = await pool.query<ResultSetHeader>(
  "INSERT INTO report_projects (name, code) VALUES (?, ?)",
  [name, code]
);

return NextResponse.json({ id: result.insertId, name, code });

}
