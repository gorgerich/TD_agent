import { NextResponse } from "next/server";

/*
  Лёгкий middleware: только заголовок noindex для B2B-раздела.
  Проверку сессии делаем в Node-рантайме (layout кабинета), а не здесь —
  Edge-рантайм ненадёжно отдаёт секрет APP_ENCRYPTION_KEY, из-за чего
  подпись сессии не сходилась и любой вход отбрасывало на /agent/login.
  Запрос не используется — параметр опущен намеренно.
*/
export function proxy() {
  const res = NextResponse.next();
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export const config = {
  matcher: ["/agent/:path*", "/co/:path*"],
};
