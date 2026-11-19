import { isUnhinged, type Character } from "./character";
import type { Campaign } from "./world";

/**
 * Состояние героя на его портрете — из чисел движка, а не со слов мастера: игрок пишет за героя сам,
 * и «спокойно отвечаю» не должно получить испуганное лицо.
 * - breakdown — срыв: в ход срыва и ещё один ход после;
 * - edge — рассудок на трети и меньше («на грани»);
 * - wounded — здоровье на трети и меньше.
 * Рассудок важнее ран: в Аркхэме лицо, которое сдаёт, — главный сигнал игроку.
 */
export type HeroMood = "wounded" | "edge" | "breakdown";
export const HERO_MOODS: HeroMood[] = ["wounded", "edge", "breakdown"];

/** Сколько ходов после срыва лицо остаётся «сорванным» (ход срыва — 1). */
export const BREAKDOWN_TURNS = 2;

export function heroMood(c: Pick<Character, "hp" | "hpMax" | "sanity" | "sanityMax">, w: Pick<Campaign, "turn" | "brokeAt">): HeroMood | null {
  if (w.brokeAt !== undefined && w.turn - w.brokeAt <= BREAKDOWN_TURNS) return "breakdown";
  if (isUnhinged(c)) return "edge";
  if (c.hpMax > 0 && c.hp > 0 && c.hp * 3 <= c.hpMax) return "wounded";
  return null;
}

/**
 * Какие состояния нарисовать заранее (про запас), пока герой к ним только подходит: здоровье или рассудок
 * на половине и ниже. Так лицо успевает нарисоваться до того, как понадобится, а у героя, которому
 * везёт, лишних картинок нет.
 */
export function heroMoodsAhead(c: Pick<Character, "hp" | "hpMax" | "sanity" | "sanityMax">): HeroMood[] {
  const out: HeroMood[] = [];
  if (c.hpMax > 0 && c.hp * 2 <= c.hpMax) out.push("wounded");
  if (c.sanity !== undefined && c.sanityMax && c.sanity * 2 <= c.sanityMax) out.push("edge", "breakdown");
  return out;
}
