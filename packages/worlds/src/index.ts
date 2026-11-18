import { fantasy } from "./fantasy";
import type { World } from "./types";

export * from "./types";

/** Все миры игры. Порядок — порядок на экране выбора. */
export const WORLDS: World[] = [fantasy];

/** Мир кампаний, созданных до появления миров. */
export const DEFAULT_WORLD = "fantasy";

export const isWorldId = (id: unknown): id is string => typeof id === "string" && WORLDS.some((w) => w.id === id);

/** Мир по id; неизвестный id — ошибка (данные из базы или от клиента не совпали с кодом). */
export function getWorld(id: string = DEFAULT_WORLD): World {
  const w = WORLDS.find((x) => x.id === id);
  if (!w) throw new Error(`Unknown world: ${id}`);
  return w;
}

/** Мир героя или черновика: в листах до миров поля нет — это фэнтези. */
export const worldOf = (x: { world?: string | null }): World => getWorld(x.world || DEFAULT_WORLD);

/** Путь к описанию мира от корня репозитория. Читает его сервер: в браузере файлов нет. */
export const worldBiblePath = (id: string) => `packages/worlds/src/${id}/world.md`;
