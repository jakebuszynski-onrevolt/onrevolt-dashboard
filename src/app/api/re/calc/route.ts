// src/app/api/re/calc/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);

  // wszystko co przyjdzie do /api/re/calc?... puszczamy dalej 1:1
  const qs = url.searchParams.toString();

  const target = `https://windyone.pl/re/GetRe.php?${qs}`;

  try {
    const r = await fetch(target, {
      method: "GET",
      // jeśli GetRe.php jest dynamiczne – unikamy cache
      cache: "no-store",
      headers: {
        "Accept": "application/json",
      },
    });

    const text = await r.text();

    // jeżeli GetRe.php czasem zwraca HTML/tekst – lepiej złapać błąd JSON
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ok: false, error: "GetRe.php did not return JSON", raw: text?.slice(0, 300) },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
