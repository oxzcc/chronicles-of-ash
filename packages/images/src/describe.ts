import { hashStr, mulberry32, raceKeys, secureRng, type CharacterDraft, type Gender, type LocationType, type RaceKey, type Rng } from "@ash/engine";
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
  /** Одежда и предмет в руках вместо classEn — у каждого облика свои. */
  outfit?: string;
}

/** Игрок сам написал о фигуре — не спорим с ним. */
const BUILD_NOTE = /худ|строй|полн|пышн|форм|толст|спортив|атлет|мускул|миниатюр|хрупк|крепк|груз|жилист/i;
/** Игрок сам написал об одежде — все четыре облика одеты по его словам. */
const CLOTHES_NOTE = /плащ|пальто|костюм|шляп|кепк|платье|пиджак|жилет|куртк|шинел|мантии|мантия|ряс|доспех|кольчуг|броня|броне|камзол|сюртук|рубаш|блуз|юбк|брюк|шарф|перчат|очк|пенсне|монокл|капюшон|накидк/i;

/**
 * Позы четырёх обликов — разные, выбирает код: служебная модель сама ставит всех одинаково.
 * Нейтральные к предмету в руках: «the object» — то, что даёт наряд.
 */
const POSES = [
  "standing in three-quarter view with arms crossed",
  "turned half away, looking back over the shoulder",
  "seen from a low angle, chin raised, one hand on the hip",
  "leaning forward slightly, studying the object in hand",
  "hands clasped in front, head tilted to one side",
  "one hand raised to the collar, the other holding the object at the side",
  "holding the object up close to the face",
];
// Без «walking»: в шаге FLUX рисует человека в полный рост и мелко — портрет выпадает из кадра остальных.

/**
 * Цвет волос и приметы на лице тоже раздаёт код: сама модель из прогона в прогон рисует одну четвёрку
 * (рыжие кудри, седина, чёрные волосы, пепельный блонд) и всем ставит шрам или ожог.
 */
const HAIR = [
  "copper-red", "auburn", "chestnut-brown", "dark brown", "jet-black", "honey-blond",
  "platinum-blond", "ash-blond", "mousy light brown", "strawberry-blond",
];
/** Игрок сам написал о волосах или приметах — не спорим. */
const HAIR_NOTE = /рыж|блонд|светлов|темновол|тёмновол|черновол|чёрн|брюнет|шатен|сед|русы|русая|каштан|волос|лыс|кос[аыу]\b|косич|стриж|кудр|каре|пучок/i;
const MARK_NOTE = /шрам|ожог|родинк|веснуш|татуир|отметин|оспин|рубц|порез/i;
const AGE_NOTE = /\d+\s*(лет|год)|молод|юн[аыо]|стар|пожил|зрел|средн\S* лет|девушк|бабушк|дедушк|парень/i;

/**
 * Возраст тоже выбирает код: модель ставила полной героине всегда 40–50, стройной — 20–25.
 * Четыре разных отрезка; среди четырёх обязательно кто-то моложе 32 и кто-то старше 45;
 * облик с формами — не старше 45.
 */
const AGE_BANDS: [number, number][] = [[20, 25], [26, 31], [32, 38], [39, 45], [46, 53], [54, 65]];
const CURVY = /curvy|voluptuous|hourglass/i;
function pickAges(rng: Rng, builds?: readonly string[]): number[] {
  const ok = (b: number[]) =>
    b.some((x) => x <= 1) && b.some((x) => x >= 4) && b.every((x, i) => !(builds?.[i] && CURVY.test(builds[i]!)) || AGE_BANDS[x]![1] <= 45);
  let bands = [0, 2, 3, 5];
  for (let t = 0; t < 100; t++) {
    const b = shuffled([0, 1, 2, 3, 4, 5], rng).slice(0, 4);
    if (ok(b)) {
      bands = b;
      break;
    }
  }
  return bands.map((x) => {
    const [lo, hi] = AGE_BANDS[x]!;
    return lo + Math.floor(rng() * (hi - lo + 1));
  });
}

/** Первые n элементов в случайном порядке (без повторов). */
const shuffled = <T>(arr: readonly T[], rng: Rng): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

/** Запасные отличия, если служебная модель не ответила: четыре разных человека, а не один. */
const VARIETY = [
  { label: "Молодость, рыжие волосы, веснушки", prompt: "young, copper-red hair in a loose braid, freckles, bright curious eyes" },
  { label: "Старше, шрам, короткая стрижка", prompt: "in their forties, close-cropped greying hair, a pale scar across the eyebrow, tired stern eyes" },
  { label: "Тёмные волосы, татуировка, усмешка", prompt: "dark wavy hair, a thin ink tattoo along the cheekbone, sly half-smile" },
  { label: "Светлые волосы, суровый взгляд", prompt: "ash-blond hair tied back, sharp cheekbones, wind-burned skin, cold determined gaze" },
];

/** Основа облика героя; outfit — наряд конкретного варианта вместо classEn. */
export function baseHero(world: World, d: Pick<CharacterDraft, "race" | "cls" | "gender">, outfit?: string): string {
  const cls = outfit ?? world.art.classEn[d.cls] ?? "";
  // С LoRA — как в подписях датасета: «a woman private detective in a belted trench coat…».
  if (captionStyle(world)) return `${d.gender === "f" ? "a woman" : "a man"} ${cls}`.trim();
  return `${genderEn(d.gender)}, ${raceEn(world, d.race, d.gender)}, ${cls}`;
}

/**
 * Четыре заметно разных облика по выбору игрока: общая основа (раса, класс, пол, заметки игрока)
 * плюс разные возраст, волосы, черты лица и выражение (пишет служебная модель), а телосложение,
 * наряд и поза — из списков мира, по одному на облик (выбирает код, иначе все четверо одинаковые).
 * Подпись — только про лицо и возраст: фигуру в подпись не пишем.
 */
export async function heroVariants(
  router: ModelRouter,
  world: World,
  d: Pick<CharacterDraft, "race" | "cls" | "gender">,
  notes: string,
  signal?: AbortSignal,
  rng: Rng = secureRng,
): Promise<LookVariant[]> {
  const builds = BUILD_NOTE.test(notes) ? undefined : world.art.figures?.hero[d.gender];
  const outfitList = world.art.heroOutfitsEn?.[d.cls];
  const outfits = outfitList && outfitList.length >= 4 && !CLOTHES_NOTE.test(notes) ? shuffled(outfitList, rng).slice(0, 4) : undefined;
  const poses = shuffled(POSES, rng).slice(0, 4);
  const hair = HAIR_NOTE.test(notes) ? undefined : shuffled(HAIR, rng).slice(0, 4);
  const ages = AGE_NOTE.test(notes) ? undefined : pickAges(rng, builds);
  // Примета на лице — у одного-двух из четырёх, остальные с чистым лицом.
  const marks = MARK_NOTE.test(notes) ? undefined : (() => {
    const n = rng() < 0.5 ? 1 : 2;
    const order = shuffled([0, 1, 2, 3], rng);
    return [0, 1, 2, 3].map((i) => order.indexOf(i) < n);
  })();
  const specs = [0, 1, 2, 3]
    .map((i) => {
      const parts = [
        ages && `${ages[i]} years old`,
        hair && `${hair[i]} hair${ages && ages[i]! >= 50 ? " streaked with grey" : ""}`,
        marks && (marks[i] ? "one noticeable scar, burn or mark on the face" : "a clean face without scars, burns or marks"),
      ].filter(Boolean);
      return parts.length ? `${i + 1}) ${parts.join(", ")}` : "";
    })
    .filter(Boolean);
  const finish = (v: LookVariant[]) =>
    v.map((x, i) => ({
      // Подпись — без телосложения, даже если модель его всё же вписала.
      label: x.label.split(/,\s*/).filter((part) => !BUILD_NOTE.test(part)).join(", ") || x.label,
      prompt: [x.prompt, builds?.[i], poses[i]].filter(Boolean).join(", "),
      ...(outfits ? { outfit: outfits[i] } : {}),
    }));
  const fixed = [builds && "body build", outfits && "clothing", "pose"].filter(Boolean).join(", ");
  try {
    const raw = await ask(
      router,
      `You design 4 clearly DIFFERENT looks for a ${world.art.genreEn} player character. Base: ${baseHero(world, d, outfits ? "" : undefined)} (${world.rules.races[d.race]?.name ?? d.race}, ${world.rules.classes[d.cls]?.name ?? d.cls}).${notes ? ` Player's notes (Russian, must be respected in all 4): ${notes}` : ""}
Vary ${ages ? "" : "age, "}hair${hair ? " style (colour is set below)" : " colour and style"}, face shape${marks ? "" : ", scars or marks"}${outfits ? "" : ", a clothing detail"} and expression so that the 4 people are easy to tell apart.${specs.length ? `\nSet by the game, in this order: ${specs.join("; ")}.` : ""}
${fixed[0]!.toUpperCase()}${fixed.slice(1)} are set by the game — do not describe them.${builds ? ` Body builds, in this order: ${builds.map((b, i) => `${i + 1}) ${b}`).join("; ")}${ages ? "" : "; pick ages that suit them: a curvy, voluptuous or hourglass look is 20 to 45 years old"}.` : ""}
Gender is fixed: every look is ${d.gender === "f" ? "a woman (no beards)" : "a man"}. Start every prompt with "${d.gender === "f" ? "woman" : "man"}" and ${ages ? "the age set above" : "an age"}.
Return JSON only: [{"label":"3-6 слов по-русски: возраст, волосы и примета на лице, если она есть; без фигуры и одежды","prompt":"English fragment, 15-30 words, no style words"}] — exactly 4 items.`,
      signal,
    );
    const arr = extractJson(`{"v":${raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)}}`) as { v?: unknown[] } | null;
    const items = (arr?.v ?? [])
      .map((x: any) => ({ label: String(x?.label ?? "").trim().slice(0, 60), prompt: oneLine(String(x?.prompt ?? "")) }))
      .filter((x) => x.label && x.prompt && !CYR.test(x.prompt));
    if (items.length >= 4) return finish(items.slice(0, 4));
  } catch {}
  return finish(VARIETY);
}
