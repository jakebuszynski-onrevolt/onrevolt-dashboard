// /src/app/api/report-images/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { imageSize } from "image-size";

export const dynamic = "force-dynamic"; // dla bezpieczeństwa przy uploadach

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const projectId = formData.get("projectId");
    const pageIndex = formData.get("pageIndex");
    const file = formData.get("file") as File | null;

    if (!projectId || !pageIndex || !file) {
      return NextResponse.json(
        { error: "projectId, pageIndex, file required" },
        { status: 400 }
      );
    }

    const project = String(projectId);
    const index = Number(pageIndex);
    if (Number.isNaN(index)) {
      return NextResponse.json(
        { error: "pageIndex must be a number" },
        { status: 400 }
      );
    }

    // przygotuj ścieżki
    const publicDir = path.join(process.cwd(), "public", "report-images", project);
    await fs.mkdir(publicDir, { recursive: true });

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // wykryj SVG vs PNG
    const originalName = (file as any).name?.toString() ?? "";
    const lowerName = originalName.toLowerCase();
    const isSvg =
      file.type === "image/svg+xml" ||
      lowerName.endsWith(".svg");

    const ext = isSvg ? ".svg" : ".png";
    const targetPath = path.join(publicDir, `page-${index}${ext}`);

    // Zapis pliku
    await fs.writeFile(targetPath, buffer);

    // Wymiary (ostrożnie, bo dla SVG może rzucić)
    let natural_width = 0;
    let natural_height = 0;
    try {
      const dim = imageSize(buffer);
      natural_width = dim.width ?? 0;
      natural_height = dim.height ?? 0;
    } catch (err) {
      console.error("imageSize error for report image", err);
      // zostaw 0/0 – front i tak ma viewBox, a do samego druku nie jest to krytyczne
    }

    const image_url = `/report-images/${project}/page-${index}${ext}`;

    return NextResponse.json({
      image_url,
      natural_width,
      natural_height,
    });
  } catch (err: any) {
    console.error("report-images POST fatal error", err);
    return NextResponse.json(
      { error: "internal-error", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
