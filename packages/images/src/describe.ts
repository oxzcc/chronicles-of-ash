import { hashStr, mulberry32, raceKeys, type CharacterDraft, type Gender, type LocationType, type RaceKey, type Rng } from "@ash/engine";
import { extractJson, type ModelRouter } from "@ash/llm";
import type { BuildOption, World } from "@ash/worlds";
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
 * Мир с LoRA описывает людей языком подписей своего датасета: «a young woman newspaper reporter, curvy build, …».
 * Пол — прямо в существительном (woman/man), иначе FLUX путает пол у «пожилого библиотекаря».
 */
const captionStyle = (world: World) => !!world.art.lora;
const GENDER_WORD = /\b(woman|women|man|men|girl|boy|lady|gentleman|widow|widower|mother|father|wife|husband|nun|priest|monk)\b/i;
/** Текст модели — в середину подписи: без точки в конце и без заглавной «A» в начале. */
const withGender = (raw: string, g: Gender) => {
  const text = raw.replace(/[.\s]+$/, "").replace(/^(An?|The)\b/, (w) => w.toLowerCase());
  return GENDER_WORD.test(text) ? text : `${g === "f" ? "a woman" : "a man"}, ${text}`;
};

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

const oneLine = (s: string) => s.replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 500);

export interface NpcCard {
  name: string;
  race: RaceKey;
  gender: Gender;
  role: string;
  /** Внешность по-русски — из ответа мастера. */
  look?: string;
  /** Зверь или чудовище (враг в бою): без расы и пола героев мира. */
  creature?: boolean;
}

/**
 * Что просим описать у человека — словами подписей датасета LoRA мира: телосложение прямо
 * («thin frail build», «stout sturdy build», «voluptuous hourglass figure»), поза рук, ракурс для властных
 * и выражение лица. Без этого модель пишет «friendly smile», и все портреты улыбаются одинаково.
 */
/** Начало описания в стиле подписей датасета: кто это — одним существительным с возрастом и полом. */
const CAPTION_START =
  "start with who they are as one noun phrase with age, gender and role (e.g. 'a middle-aged woman housekeeper', 'an elderly bald man priest', 'a young woman newspaper reporter'); then ";
const weighted = (opts: BuildOption[], rng: Rng) => {
  let r = rng() * opts.reduce((a, o) => a + o.weight, 0);
  for (const o of opts) if ((r -= o.weight) < 0) return o.en;
  return opts[opts.length - 1]!.en;
};

/**
 * Телосложение человека по правилам мира (world.art.figures). Выбирает код, а не служебная модель:
 * сама она скатывается в один вариант на всех. Seed — от имени: один NPC всегда одной фигуры.
 * Возраст и болезнь видит только модель, поэтому ей уходят три готовых варианта на выбор по состоянию.
 */
export function buildFor(world: World, who: { name: string; gender: Gender; role?: string }) {
  const fig = world.art.figures;
  if (!fig) return undefined;
  const rng = mulberry32(hashStr(`${world.id}:${who.name}:${who.gender}`));
  const young = weighted(fig.young[who.gender], rng);
  const elderly = weighted(fig.elderly[who.gender], rng);
  const forced = fig.roles?.find((r) => r.match.test(who.role ?? ""))?.[who.gender];
  return { young: forced ?? young, elderly, frail: fig.frail };
}

const buildRule = (b: NonNullable<ReturnType<typeof buildFor>>) =>
  `if sick, starving or drowned — '${b.frail}'; else if elderly — '${b.elderly}'; otherwise — '${b.young}'`;

const lookParts = (build?: string) => {
  const b = build
    ? `build in these exact words, chosen by the character's age and condition: ${build}`
    : "build in plain body-type words that fit the role (e.g. thin frail, wiry, stout sturdy, heavyset, muscular, curvy, voluptuous hourglass)";
  return `age; ${b}; face with one telling feature of this particular person (e.g. a scar, freckles, a beauty mark, crow's feet, a broken nose, heavy makeup; dark circles only for the sleepless or sick); hair; clothing from head to knees (no shoes or boots, nothing below the knees); one distinctive detail or object in hand; a pose that suits this person and what they hold (e.g. arms crossed, hands clasped, leaning on something, looking over the shoulder, hugging oneself, holding the object up; a hand on the hip only for confident or seductive people); add 'low angle' only for imposing, powerful or seductive people; an expression that follows from the role and the moment (haughty, sultry, stern, smug, grieving, terrified, sly, grim, vacant, coy) — not a generic 'wary' or 'neutral'; a smile only if the role calls for one`;
};

const npcBuild = (world: World, npc: NpcCard) => {
  const b = buildFor(world, npc);
  return b && buildRule(b);
};
/** Пол угадывает сама модель — правила для обоих. */
const guessBuild = (world: World, name: string) => {
  const f = buildFor(world, { name, gender: "f" });
  const m = buildFor(world, { name, gender: "m" });
  return f && m ? `if a woman: ${buildRule(f)}; if a man: ${buildRule(m)}` : undefined;
};

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
Return JSON only: {"race":"${raceKeys(world.rules).join("|")}","gender":"m|f","role":"кто это, 2–4 слова по-русски","look":"English image prompt fragment, 25-50 words: ${captionStyle(world) ? CAPTION_START : ""}${lookParts(guessBuild(world, o.name))}; no names, no style words"}`,
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
  const description =
    captionStyle(world) && look ? withGender(look, card.gender) : `${genderEn(card.gender)}, ${raceEn(world, card.race, card.gender)}, ${look || world.art.strangerEn}`;
  return { card, description };
}

export async function describeNpc(router: ModelRouter, world: World, npc: NpcCard, signal?: AbortSignal): Promise<string> {
  if (npc.creature) return describeCreature(router, world, npc, signal);
  const fallback = `${genderEn(npc.gender)}, ${raceEn(world, npc.race, npc.gender)}, ${npc.role ? world.art.localEn : "a traveller"}, weathered face, period clothing`;
  const caption = captionStyle(world);
  try {
    const text = oneLine(
      await ask(
        router,
        `Write an English image prompt fragment (25-55 words, no style words, no names) describing how this ${world.art.genreEn} character looks: ${caption ? CAPTION_START : ""}${lookParts(npcBuild(world, npc))}.\nCharacter: ${npc.name}, ${world.rules.races[npc.race]?.name ?? npc.race} (${raceEn(world, npc.race, npc.gender)}), ${npc.gender === "f" ? "female" : "male"}, role: ${npc.role}.${npc.look ? ` Appearance notes (Russian): ${npc.look}` : ""}\nAnswer with the fragment only.`,
        signal,
      ),
    );
    if (!text || CYR.test(text)) return fallback;
    return caption ? withGender(text, npc.gender) : `${genderEn(npc.gender)}, ${raceEn(world, npc.race, npc.gender)}, ${text}`;
  } catch {
    return fallback;
  }
}

/** Зверь или чудовище: облик целиком из описания мастера. */
async function describeCreature(router: ModelRouter, world: World, npc: NpcCard, signal?: AbortSignal): Promise<string> {
  const fallback = `a menacing creature, ${world.art.genreEn} monster, full figure`;
  try {
    const text = oneLine(
      await ask(
        router,
        `Write an English image prompt fragment (15-35 words, no style words, no names) describing how this ${world.art.genreEn} creature looks: size, shape, body, skin or fur, one distinctive detail, menace.\nCreature: ${npc.name}.${npc.look ? ` Appearance notes (Russian): ${npc.look}` : ""}\nAnswer with the fragment only.`,
        signal,
      ),
    );
    return text && !CYR.test(text) ? text : fallback;
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

/** Игрок сам написал о фигуре — не спорим с ним. */
const BUILD_NOTE = /худ|строй|полн|пышн|форм|толст|спортив|атлет|мускул|миниатюр|хрупк|крепк|груз|жилист/i;

/** Запасные отличия, если служебная модель не ответила: четыре разных человека, а не один. */
const VARIETY = [
  { label: "Молодость, рыжие волосы, веснушки", prompt: "young, copper-red hair in a loose braid, freckles, bright curious eyes" },
  { label: "Старше, шрам, короткая стрижка", prompt: "in their forties, close-cropped greying hair, a pale scar across the eyebrow, tired stern eyes" },
  { label: "Тёмные волосы, татуировка, усмешка", prompt: "dark wavy hair, a thin ink tattoo along the cheekbone, sly half-smile" },
  { label: "Светлые волосы, суровый взгляд", prompt: "ash-blond hair tied back, sharp cheekbones, wind-burned skin, cold determined gaze" },
];

export function baseHero(world: World, d: Pick<CharacterDraft, "race" | "cls" | "gender">): string {
  // С LoRA — как в подписях датасета: «a woman private detective in a belted trench coat…».
  if (captionStyle(world)) return `${d.gender === "f" ? "a woman" : "a man"} ${world.art.classEn[d.cls] ?? ""}`.trim();
  return `${genderEn(d.gender)}, ${raceEn(world, d.race, d.gender)}, ${world.art.classEn[d.cls] ?? ""}`;
}

/**
 * Четыре заметно разных облика по выбору игрока: общая основа (раса, класс, пол, заметки игрока)
 * плюс разные возраст, волосы, черты лица, детали одежды и выражение.
 */
export async function heroVariants(router: ModelRouter, world: World, d: Pick<CharacterDraft, "race" | "cls" | "gender">, notes: string, signal?: AbortSignal): Promise<LookVariant[]> {
  // Четыре облика — четыре разные фигуры мира (у героини: две с формами, две без), если игрок сам не задал фигуру.
  const builds = BUILD_NOTE.test(notes) ? undefined : world.art.figures?.hero[d.gender];
  const withBuild = (v: LookVariant[]) =>
    builds ? v.map((x, i) => (builds[i] ? { label: `${x.label}, ${builds[i]!.ru}`, prompt: `${x.prompt}, ${builds[i]!.en}` } : x)) : v;
  try {
    const raw = await ask(
      router,
      `You design 4 clearly DIFFERENT looks for a ${world.art.genreEn} player character. Base: ${baseHero(world, d)} (${world.rules.races[d.race]?.name ?? d.race}, ${world.rules.classes[d.cls]?.name ?? d.cls}).${notes ? ` Player's notes (Russian, must be respected in all 4): ${notes}` : ""}
Vary age, hair colour and style, face shape, scars or marks, a clothing detail and expression so that the 4 people are easy to tell apart.${builds ? `\nBody builds are fixed by the game, in this order: ${builds.map((b, i) => `${i + 1}) ${b.en}`).join("; ")}. Do not describe build or figure yourself, but pick ages that suit them: a curvy, voluptuous or hourglass look is 20 to 45 years old.` : ""}
Gender is fixed: every look is ${d.gender === "f" ? "a woman (no beards)" : "a man"}. Start every prompt with "${d.gender === "f" ? "woman" : "man"}" and an age.
Return JSON only: [{"label":"4-7 слов по-русски","prompt":"English fragment, 15-30 words, no style words"}] — exactly 4 items.`,
      signal,
    );
    const arr = extractJson(`{"v":${raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)}}`) as { v?: unknown[] } | null;
    const items = (arr?.v ?? [])
      .map((x: any) => ({ label: String(x?.label ?? "").trim().slice(0, 60), prompt: oneLine(String(x?.prompt ?? "")) }))
      .filter((x) => x.label && x.prompt && !CYR.test(x.prompt));
    if (items.length >= 4) return withBuild(items.slice(0, 4));
  } catch {}
  return withBuild(VARIETY);
}
