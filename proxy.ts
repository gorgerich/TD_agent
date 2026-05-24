import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/agent/login") return NextResponse.next();

  // Dev bypass: skip session check entirely
  if (process.env.NODE_ENV === "development") return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return redirect(req, "/agent/login");

  const session = await verifySession(token);
  if (!session) return redirect(req, "/agent/login");

  return NextResponse.next();
}

function redirect(req: NextRequest, to: string) {
  const url = req.nextUrl.clone();
  url.pathname = to;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/agent/:path*"],
};
