import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: any) {
  // bierzemy params z context, ale typujemy lokalnie
  const { dealId, file } = context.params as { dealId: string; file: string };

  const filePath = path.join(
    "/var/www/vhosts/onrevolt.com/httpdocs",
    "report-bills",
    dealId,
    file
  );

  try {
    const fileBuffer = await fs.readFile(filePath); // Buffer
    const data = new Uint8Array(fileBuffer);        // BodyInit

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${file}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (err) {
    console.error("[report-bills] file error", filePath, err);
    return new NextResponse("Not found", { status: 404 });
  }
}
