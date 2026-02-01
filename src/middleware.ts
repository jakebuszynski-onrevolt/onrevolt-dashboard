// src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  // jeśli chcesz – możesz zostawić test:
  if (req.nextUrl.pathname.endsWith("/_mw-check")) {
    return new NextResponse("MIDDLEWARE ACTIVE", { status: 418 });
  }

  // ochrona: wymagaj ciasteczka panel_uid
  const authed = Boolean(req.cookies.get("panel_uid")?.value);
  if (!authed) {
    const u = req.nextUrl.clone();
    // jest
	u.pathname = "/auth/sign-in";  // bez basePath
    u.search = "";
    return NextResponse.redirect(u);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"], // <— bez /panel
};
