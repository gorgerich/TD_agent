import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Защита агентской зоны. Всё под /agent/* кроме /agent/login требует сессии.
// Полную проверку роли против БД делает серверный код страницы через getAgentSession();
// middleware — только грубый gate по наличию cookie сессии (имя задаётся при подключении Auth.js).
const SESSION_COOKIE = "tihiydom_agent_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/agent/login") return NextResponse.next();

  const hasSession = req.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/agent/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/agent/:path*"],
};
