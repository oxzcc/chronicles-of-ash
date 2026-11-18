import { NextResponse, type NextRequest } from "next/server";
import { isUid, UID_COOKIE, uidCookieOptions } from "./lib/uid";

/**
 * Выдаёт cookie игрока до того, как запрос дойдёт до страниц и ручек. Раньше её ставила первая ручка,
 * и если страница сразу слала два запроса (портреты и ранний старт дела), каждый заводил своего игрока —
 * заготовка дела доставалась «другому» и при старте не находилась.
 */
export function proxy(request: NextRequest) {
  if (isUid(request.cookies.get(UID_COOKIE)?.value)) return NextResponse.next();
  const id = crypto.randomUUID();
  // Тот же id — и в этот запрос (ручка увидит его сразу), и в ответ (браузер запомнит).
  request.cookies.set(UID_COOKIE, id);
  const res = NextResponse.next({ request: { headers: request.headers } });
  res.cookies.set(UID_COOKIE, id, uidCookieOptions());
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|images/|favicon.ico).*)"],
};
