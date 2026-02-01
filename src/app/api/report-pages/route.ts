// /src/app/api/report-pages/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const [rows] = await pool.query(
    "SELECT * FROM report_project_pages WHERE project_id = ? ORDER BY page_index",
    [projectId]
  );
  return NextResponse.json(rows);
}

// DEBUG POST
export async function POST(req: Request) {
  try {
    // 1) Złap surowe body
    const raw = await req.text();
    console.log("=== [POST /api/report-pages] RAW BODY ===");
    console.log(raw);

    let body: any = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("!!! JSON.parse error in /api/report-pages:", e);
      return NextResponse.json(
        { error: "invalid-json", detail: String((e as any)?.message ?? e) },
        { status: 400 }
      );
    }

    console.log("=== [POST /api/report-pages] PARSED BODY ===");
    console.log(body);

    let { project_id, page_index, image_url, natural_width, natural_height } = body || {};

    console.log("TYPES:", {
      project_id: typeof project_id,
      page_index: typeof page_index,
      image_url: typeof image_url,
      natural_width: typeof natural_width,
      natural_height: typeof natural_height,
    });

    // dopuszczamy project_id jako string
    if (typeof project_id === "string") {
      project_id = Number(project_id);
    }

    if (
      project_id == null ||
      Number.isNaN(project_id) ||
      typeof page_index !== "number" ||
      typeof image_url !== "string" ||
      typeof natural_width !== "number" ||
      typeof natural_height !== "number"
    ) {
      console.error("!!! [POST /api/report-pages] Missing or invalid fields", {
        project_id,
        page_index,
        image_url,
        natural_width,
        natural_height,
      });
      return NextResponse.json(
        { error: "missing-or-invalid-fields" },
        { status: 400 }
      );
    }

    console.log("=== [POST /api/report-pages] Doing INSERT ===");
    console.log({
      project_id,
      page_index,
      image_url,
      natural_width,
      natural_height,
    });

    const [result]: any = await pool.query(
      `INSERT INTO report_project_pages
       (project_id, page_index, image_url, natural_width, natural_height)
       VALUES (?, ?, ?, ?, ?)`,
      [project_id, page_index, image_url, natural_width, natural_height]
    );

    console.log("=== [POST /api/report-pages] INSERT RESULT ===");
    console.log(result);

    return NextResponse.json(
      {
        id: result.insertId,
        project_id,
        page_index,
        image_url,
        natural_width,
        natural_height,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error("!!! [POST /api/report-pages] FATAL ERROR ===");
    console.error(err);
    return NextResponse.json(
      { error: "internal-error", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
