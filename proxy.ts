import { NextRequest, NextResponse } from "next/server";
import { evaluateReleaseWriteFreeze } from "@/lib/releaseWriteFreeze";

/*
  Лёгкий middleware: только заголовок noindex для B2B-раздела.
  Проверку сессии делаем в Node-рантайме (layout кабинета), а не здесь —
  Edge-рантайм ненадёжно отдаёт секрет APP_ENCRYPTION_KEY, из-за чего
  подпись сессии не сходилась и любой вход отбрасывало на /agent/login.
  Здесь также работает release write freeze: он проверяет только method/path
  и не читает session cookie или APP_ENCRYPTION_KEY.
*/
export function proxy(req: NextRequest) {
  const freeze = evaluateReleaseWriteFreeze({
    method: req.method,
    pathname: req.nextUrl.pathname,
  });
  if (freeze.blocked) {
    return NextResponse.json(
      { error: "Сервис временно доступен только для просмотра. Повторите действие после завершения обновления." },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "60",
          "X-Release-Write-Freeze": "active",
          "X-Robots-Tag": "noindex, nofollow",
        },
      },
    );
  }

  const res = NextResponse.next();
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (freeze.active) res.headers.set("X-Release-Write-Freeze", "active");
  return res;
}

export const config = {
  matcher: ["/api/:path*", "/agent/:path*", "/co/:path*"],
};
