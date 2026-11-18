/** Временный игрок (до входа через почту в фазе 4): случайный id в httpOnly-cookie. Общее для proxy и сервера. */
export const UID_COOKIE = "ash_uid";
export const isUid = (v: string | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);
export const uidCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365,
  path: "/",
});
