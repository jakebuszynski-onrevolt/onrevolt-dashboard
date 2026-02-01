import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export const AUTH_COOKIE = "wo_session";
const SECRET = process.env.AUTH_SECRET || "CHANGE_ME_IN_PROD";

export type SessionPayload = {
  id: number;
  firstname: string;
  lastname: string;
  email: string;
  role: number;
};

export function signSession(p: SessionPayload) {
  return jwt.sign(p, SECRET, { expiresIn: "7d" });
}

export function readSession(req: NextRequest): SessionPayload | null {
  const raw = req.cookies.get(AUTH_COOKIE)?.value;
  if (!raw) return null;
  try {
    return jwt.verify(raw, SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: NextResponse, token: string) {
  const path = process.env.NEXT_PUBLIC_BASE_PATH || "/";
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path,
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSessionCookie(res: NextResponse) {
  const path = process.env.NEXT_PUBLIC_BASE_PATH || "/";
  res.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path,
    maxAge: 0,
  });
}
