import type { Beat } from "@ash/llm";
import type { World } from "@ash/worlds";

/** Эмоция от мастера («страх», «fear») → id из списка мира; чужое слово — без эмоции. */
export function emotionId(world: World, raw: string | undefined): string | undefined {
  const e = world.art.emotions;
  if (!e || !raw) return undefined;
  const k = raw.trim().toLowerCase().replace(/ё/g, "е");
  if (k in e.npc) return k;
  return Object.entries(e.npc).find(([, v]) => v.ru.replace(/ё/g, "е") === k)?.[0];
}

/**
 * Эмоции реплик по списку мира: у NPC — id или ничего, у рассказчика — ничего.
 * В мире без эмоций поле убирается целиком: клиенту нечего с ним делать.
 */
export function normalizeEmotions(world: World, beats: Beat[]): Beat[] {
  return beats.map((b) => {
    if (b.emotion === undefined) return b;
    const id = b.speaker ? emotionId(world, b.emotion) : undefined;
    if (id === b.emotion) return b;
    const { emotion: _drop, ...rest } = b;
    return id ? { ...rest, emotion: id } : rest;
  });
}
