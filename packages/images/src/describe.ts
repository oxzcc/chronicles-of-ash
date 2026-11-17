import { raceKeys, type CharacterDraft, type Gender, type LocationType, type RaceKey } from "@ash/engine";
import { extractJson, type ModelRouter } from "@ash/llm";
import type { World } from "@ash/worlds";
import { isInterior, raceEn } from "./style";

/**
 * Служебная модель переводит русское описание в короткий английский промпт для FLUX.
 * Если ответа нет или он не по-английски — собираем промпт из данных сами.
 */
const CYR = /[а-яё]/i;
/**
 * Пол — первым и с повтором: иначе FLUX на «пожилом следопыте в капюшоне» рисует бородатого старика
 * даже для героини (найдено на первом живом прогоне).
 */
const genderEn = (g: Gender) => (g === "f" ? "a woman, female character" : "a man, male character");

/**
 * Без скрытых рассуждений: описание для картинки не стоит 5 секунд ожидания.
 * Лимит с запасом — если модель всё же «думает», ответ не обрежется до пустого.
 */
export const UTILITY_MAX_TOKENS = 3000;

async function ask(router: ModelRouter, prompt: string, signal?: AbortSignal): Promise<string> {
  const { provider, model } = router.route("utility");
  const r = await provider.complete({ model, maxTokens: UTILITY_MAX_TOKENS, reasoningEffort: "none", temperature: 0.9, signal, messages: [{ role: "user", content: prompt }] });
  return r.text.trim();
}

const oneLine = (s: string) => s.replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 400);

export interface NpcCard {
  name: string;
  race: RaceKey;
  gender: Gender;
  role: string;
  /** Внешность по-русски — из ответа мастера. */
  look?: string;
}

/**
 * NPC без карточки: мастер дал ему реплики, но расу, пол и внешность описал только для главного
 * собеседника. Догадываемся по имени, репликам и сцене (в русском пол обычно слышен: «рогатая», «пришла»).
 */
export async function guessNpc(
  router: ModelRouter,
  world: World,
  o: { name: string; lines: string[]; scene: string },
  signal?: AbortSignal,
): Promise<{ card: NpcCard; description: string }> {
  let card: NpcCard = { name: o.name, race: raceKeys(world.rules)[0]!, gender: "m", role: "" };
  let look = "";
  try {
    const raw = await ask(
      router,
      `A character in a Russian ${world.art.genreEn} story speaks, but nobody described them. Guess who they are from the name, their lines and the scene.
Name: ${o.name}
Their lines (Russian): ${o.lines.map((l) => `«${l}»`).join(" ").slice(0, 600)}
Scene (Russian): ${o.scene.slice(0, 600)}
Return JSON only: {"race":"${raceKeys(world.rules).join("|")}","gender":"m|f","role":"кто это, 2–4 слова по-русски","look":"English image prompt fragment, 15-30 words: age, build, face, hair, clothing, one distinctive detail, expression; no names, no style words"}`,
      signal,
    );
    const j = extractJson(raw) as Record<string, unknown> | null;
    if (j) {
      const race = String(j.race) as RaceKey;
      card = {
        name: o.name,
        race: race in world.rules.races ? race : raceKeys(world.rules)[0]!,
        gender: j.gender === "f" ? "f" : "m",
        role: String(j.role ?? "").trim().slice(0, 60),
      };
      const l = oneLine(String(j.look ?? ""));
      if (l && !CYR.test(l)) look = l;
    }
  } catch {}
  const description = `${genderEn(card.gender)}, ${raceEn(world, card.race, card.gender)}, ${look || world.art.strangerEn}`;
  return { card, description };
}

export async function describeNpc(router: ModelRouter, world: World, npc: NpcCard, signal?: AbortSignal): Promise<string> {
  const fallback = `${genderEn(npc.gender)}, ${raceEn(world, npc.race, npc.gender)}, ${npc.role ? world.art.localEn : "a traveller"}, weathered face, period clothing`;
  try {
    const text = oneLine(
      await ask(
        router,
        `Write an English image prompt fragment (15-35 words, no style words, no names) describing how this ${world.art.genreEn} character looks: age, build, face, hair, clothing, one distinctive detail, expression.\nCharacter: ${npc.name}, ${world.rules.races[npc.race]?.name ?? npc.race} (${raceEn(world, npc.race, npc.gender)}), ${npc.gender === "f" ? "female" : "male"}, role: ${npc.role}.${npc.look ? ` Appearance notes (Russian): ${npc.look}` : ""}\nAnswer with the fragment only.`,
        signal,
      ),
    );
    return text && !CYR.test(text) ? `${genderEn(npc.gender)}, ${raceEn(world, npc.race, npc.gender)}, ${text}` : fallback;
  } catch {
    return fallback;
  }
}

export async function describeLocation(router: ModelRouter, world: World, loc: { name: string; type: LocationType; desc: string }, signal?: AbortSignal): Promise<string> {
  const base = world.art.locationEn[loc.type] ?? world.art.locationEn[world.rules.defaultLocationType] ?? "";
  const fallback = base;
  try {
    const text = oneLine(
      await ask(
        router,
        `Write an English image prompt fragment (15-35 words, no style words, no people) describing this ${world.art.locationNounEn} as a wide establishing shot${isInterior(world, loc.type) ? ", seen from the INSIDE (interior view)" : ""}. ${world.art.eraRuleEn}\nPlace: ${loc.name} (${loc.type}). Description (Russian): ${loc.desc}\nAnswer with the fragment only.`,
        signal,
      ),
    );
    return text && !CYR.test(text) ? `${base}, ${text}` : fallback;
  } catch {
    return fallback;
  }
}

export interface LookVariant {
  /** Коротко по-русски — подпись под портретом. */
  label: string;
  /** Английский фрагмент промпта. */
  prompt: string;
}

/** Запасные отличия, если служебная модель не ответила: четыре разных человека, а не один. */
const VARIETY = [
  { label: "Молодость, рыжие волосы, веснушки", prompt: "young, copper-red hair in a loose braid, freckles, bright curious eyes" },
  { label: "Старше, шрам, короткая стрижка", prompt: "in their forties, close-cropped greying hair, a pale scar across the eyebrow, tired stern eyes" },
  { label: "Тёмные волосы, татуировка, усмешка", prompt: "dark wavy hair, a thin ink tattoo along the cheekbone, sly half-smile" },
  { label: "Светлые волосы, суровый взгляд", prompt: "ash-blond hair tied back, sharp cheekbones, wind-burned skin, cold determined gaze" },
];

export function baseHero(world: World, d: Pick<CharacterDraft, "race" | "cls" | "gender">): string {
  return `${genderEn(d.gender)}, ${raceEn(world, d.race, d.gender)}, ${world.art.classEn[d.cls] ?? ""}`;
}

/**
 * Четыре заметно разных облика по выбору игрока: общая основа (раса, класс, пол, заметки игрока)
 * плюс разные возраст, волосы, черты лица, детали одежды и выражение.
 */
export async function heroVariants(router: ModelRouter, world: World, d: Pick<CharacterDraft, "race" | "cls" | "gender">, notes: string, signal?: AbortSignal): Promise<LookVariant[]> {
  try {
    const raw = await ask(
      router,
      `You design 4 clearly DIFFERENT looks for a ${world.art.genreEn} player character. Base: ${baseHero(world, d)} (${world.rules.races[d.race]?.name ?? d.race}, ${world.rules.classes[d.cls]?.name ?? d.cls}).${notes ? ` Player's notes (Russian, must be respected in all 4): ${notes}` : ""}
Vary age, hair colour and style, face shape, scars or marks, a clothing detail and expression so that the 4 people are easy to tell apart.
Gender is fixed: every look is ${d.gender === "f" ? "a woman (no beards)" : "a man"}. Start every prompt with "${d.gender === "f" ? "woman" : "man"}" and an age.
Return JSON only: [{"label":"4-7 слов по-русски","prompt":"English fragment, 15-30 words, no style words"}] — exactly 4 items.`,
      signal,
    );
    const arr = extractJson(`{"v":${raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)}}`) as { v?: unknown[] } | null;
    const items = (arr?.v ?? [])
      .map((x: any) => ({ label: String(x?.label ?? "").trim().slice(0, 60), prompt: oneLine(String(x?.prompt ?? "")) }))
      .filter((x) => x.label && x.prompt && !CYR.test(x.prompt));
    if (items.length >= 4) return items.slice(0, 4);
  } catch {}
  return VARIETY;
}
