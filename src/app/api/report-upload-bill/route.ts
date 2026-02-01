import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const dealId = String(form.get("dealId") || "").trim();
    const kind = String(form.get("kind") || "electric").trim();

    if (!file) {
      return NextResponse.json(
        { error: "Brak pliku 'file' w żądaniu" },
        { status: 400 }
      );
    }

    if (!dealId) {
      return NextResponse.json(
        { error: "Brak 'dealId' w żądaniu" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // ⬇⬇⬇ TU NA SZTYWNO BIERZEMY DOCUMENTROOT DLA onrevolt.com
    const uploadRoot = path.join(
      "/var/www/vhosts/onrevolt.com/httpdocs",
      "report-bills"
    );
    const uploadDir = path.join(uploadRoot, dealId);
    await fs.mkdir(uploadDir, { recursive: true });

    const filename = `${kind}-${Date.now()}.pdf`;
    const filePath = path.join(uploadDir, filename);
    await fs.writeFile(filePath, buffer);

    // URL widoczny z przeglądarki
    const publicUrl = `/report-bills/${dealId}/${filename}`;

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    console.error("[report-upload-bill] error:", err);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
