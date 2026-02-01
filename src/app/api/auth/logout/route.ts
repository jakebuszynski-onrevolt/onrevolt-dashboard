import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });

  // wyczyść oba ciasteczka ustawiane w sign-in
  res.cookies.set("panel_uid", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/panel",
    maxAge: 0,
  });
  res.cookies.set("panel_uname", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/panel",
    maxAge: 0,
  });

  return res;
}
