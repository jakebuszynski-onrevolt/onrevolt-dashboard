import { NextRequest, NextResponse } from "next/server";

const DOMAIN = process.env.PIPEDRIVE_DOMAIN;
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : "");
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || "";

export async function POST(req: NextRequest, { params }: any) {
  const dealId = params.id as string;
  try {
    if (!TOKEN) {
      return NextResponse.json(
        { error: "Missing PIPEDRIVE_API_TOKEN" },
        { status: 500 }
      );
    }
    if (!BASE) {
      return NextResponse.json(
        { error: "Missing PIPEDRIVE_BASE_URL or PIPEDRIVE_DOMAIN" },
        { status: 500 }
      );
    }

    const dealId = params.id;
    const body = await req.json();
    const updates = body?.updates || {};

    if (!dealId || !Object.keys(updates).length) {
      return NextResponse.json(
        { error: "Missing dealId or updates" },
        { status: 400 }
      );
    }

    const url = `${BASE}/deals/${encodeURIComponent(
      dealId
    )}?api_token=${TOKEN}`;

    const r = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    const txt = await r.text();
    if (!r.ok) {
      return NextResponse.json(
        { error: `Pipedrive error ${r.status}`, details: txt },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "unknown error" },
      { status: 500 }
    );
  }
}
