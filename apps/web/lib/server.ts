import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cookies } from "next/headers";
import { createDb, type Db } from "@ash/db";
import { secureRng } from "@ash/engine";
import { ensureUser, GameError, newGame, PregenStore } from "@ash/game";
import { configFromEnv, createRouter, type ModelRouter, type Tier } from "@ash/llm";
import type { World } from "@ash/worlds";
import { isUid, UID_COOKIE, uidCookieOptions } from "./uid";

let router: ModelRouter | null = null;
export function getRouter(): ModelRouter {
  return (router ??= createRouter(configFromEnv()));
}

/**
 * Заготовки дел (ранний старт, пока игрок выбирает портрет). Живут в памяти процесса;
 * через globalThis — чтобы перезагрузка модулей в dev не плодила хранилища.
 */
const g = globalThis as { __ashPregen?: PregenStore };
export function getPregen(): PregenStore {
  return (g.__ashPregen ??= new PregenStore(({ draft, tier, signal, onProgress }) =>
    newGame({ router: getRouter(), tier, draft, rng: secureRng, seed: crypto.randomUUID(), signal, onProgress }),
  ));
}

let dbHandle: ReturnType<typeof createDb> | null = null;
export function getDbHandle() {
  return (dbHandle ??= createDb());
}
export const getDb = (): Db => getDbHandle().db;

const bibles = new Map<string, string>();
/** Описание мира из world.md в папке мира — неизменная часть промпта мастера. */
export function getWorldBible(world: World): string {
  const cached = bibles.get(world.id);
  if (cached !== undefined) return cached;
  let text = "";
  for (const dir of [process.cwd(), join(process.cwd(), "..", "..")]) {
    try {
      // Путь расписан по частям (как worldBiblePath), чтобы сборка Next знала папку и не тащила весь проект.
      text = readFileSync(join(dir, "packages", "worlds", "src", world.id, "world.md"), "utf8");
      break;
    } catch {}
  }
  bibles.set(world.id, text);
  return text;
}

/**
 * Временный игрок: случайный id в httpOnly-cookie (выдаёт proxy.ts). Заменится входом через почту и соцсети в фазе 4.
 * Вызывать только из Route Handlers — там cookie можно записать, если proxy почему-то её не выдал.
 */
export async function currentUser(): Promise<{ id: string; tier: Tier }> {
  const jar = await cookies();
  let id = jar.get(UID_COOKIE)?.value;
  if (!isUid(id)) {
    id = crypto.randomUUID();
    jar.set(UID_COOKIE, id, uidCookieOptions());
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
