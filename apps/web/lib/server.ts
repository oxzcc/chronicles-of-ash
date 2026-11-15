import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cookies } from "next/headers";
import { createDb, type Db } from "@ash/db";
import { ensureUser, GameError } from "@ash/game";
import { configFromEnv, createRouter, type ModelRouter, type Tier } from "@ash/llm";

let router: ModelRouter | null = null;
export function getRouter(): ModelRouter {
  return (router ??= createRouter(configFromEnv()));
}

let dbHandle: ReturnType<typeof createDb> | null = null;
export function getDbHandle() {
  return (dbHandle ??= createDb());
}
export const getDb = (): Db => getDbHandle().db;

let world: string | null = null;
/** Описание мира из docs/world.md — неизменная часть промпта мастера. */
export function getWorldBible(): string {
  if (world !== null) return world;
  for (const dir of [process.cwd(), join(process.cwd(), "..", "..")]) {
    try {
      world = readFileSync(join(dir, "docs", "world.md"), "utf8");
      return world;
    } catch {}
  }
  return (world = "");
}

const COOKIE = "ash_uid";

/**
 * Временный игрок: случайный id в httpOnly-cookie. Заменится входом через почту и соцсети в фазе 4.
 * Вызывать только из Route Handlers — там cookie можно записать.
 */
export async function currentUser(): Promise<{ id: string; tier: Tier }> {
  const jar = await cookies();
  let id = jar.get(COOKIE)?.value;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = crypto.randomUUID();
    jar.set(COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365, path: "/" });
  }
  return ensureUser(getDb(), id);
}

/** Ответ с ошибкой игры — текст показывается игроку как есть. */
export function errorResponse(e: unknown): Response {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Что-то пошло не так. Попробуй ещё раз." }, { status: 500 });
}

/** Ответ в формате Server-Sent Events. */
export function sseStream(run: (send: (event: string, data: unknown) => void) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        await run(send);
      } catch (e) {
        if (!(e instanceof GameError)) console.error(e);
        send("error", { message: e instanceof GameError ? e.message : "Мастер сбился с мысли. Попробуй ещё раз." });
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}

/** Один ход за раз на кампанию в этом процессе: второй запрос получает понятную ошибку, а не тратит токены. */
const busy = new Set<string>();
export async function withCampaignLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (busy.has(id)) throw new GameError("Мастер ещё пишет предыдущий ход.", 429);
  busy.add(id);
  try {
    return await fn();
  } finally {
    busy.delete(id);
  }
}
