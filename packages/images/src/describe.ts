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
 * Мир с LoRA описывает людей языком подписей своего датасета: «a young woman newspaper reporter, average build, …».
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
 * Что просим описать у человека — словами подписей датасета LoRA мира: естественное телосложение
 * («thin frail build», «average build», «solid full build»), осанка, одно действие рук и характерное
 * выражение лица. Без этого модель пишет «friendly smile», и все портреты улыбаются одинаково.
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

const lookParts = (build?: string, style?: { text?: string; age: boolean; face: boolean }) => {
  const b = build
    ? `build in these exact words, chosen by the character's age and condition: ${build}`
    : "natural build in plain body-type words that fit the person (e.g. average, thin frail, wiry lean, stout sturdy, heavyset stocky, broad solid, slim narrow-shouldered)";
  // Руки — одной фразой вместе с предметом: «предмет в руке» и «поза» по отдельности дают третью руку.
  // Возраст и примету на лице, если их выбрал код, задаёт style; иначе модель пишет сама — без примеров,
  // которые она копирует всем подряд («a small mole beside her mouth» у девяти из десяти).
  const age = style?.age ? "" : "age; ";
  const face = style?.face
    ? ""
    : "face with one telling feature of this particular person if the notes give one, otherwise a clean face (a scar is always faint, pale and healed — a fresh wound or blood only if the notes say they are hurt); ";
  return `${age}${b}; ${style?.text ? `${style.text}; ` : "hair; "}${face}no dark circles or streaks under the eyes; clothing from head to knees (no shoes or boots, nothing below the knees), only clothing and objects of the setting's era, nothing modern; practical period clothing with natural proportions, no sexualized pose or emphasis on breasts, waist, hips or muscles; one distinctive object and the pose that holds it, in ONE phrase that accounts for both hands (e.g. 'arms crossed, a ledger tucked under one arm', 'both hands wrapped around a teacup', 'a lantern raised in one hand, the other hand in a coat pocket'; a hand on the hip only for confident people) — do not mention hands or the object anywhere else; an expression that follows from the role and the moment (composed, assessing, quietly amused, stern, sceptical, grieving, terrified, sly, grim, vacant) — not a generic 'wary' or 'neutral'; a smile only if the role calls for one`;
};

/**
 * Причёска, цвет волос и что под верхней одеждой у NPC — выбирает код, seed от имени: один человек всегда
 * выглядит одинаково, а служебная модель не скатывается в «пучок» у всех. Открытый ворот не связан
 * с фигурой, возрастом или профессией. Слова игрока/мастера о волосах важнее — тогда волосы не задаём.
 */
export function npcStyle(world: World, who: { name: string; gender: Gender; role?: string; look?: string }) {
  const rng = mulberry32(hashStr(`${world.id}:${who.name}:${who.gender}:look`));
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(rng() * arr.length)]!;
  const styles = world.art.hairstylesEn?.[who.gender];
  const colour = pick(HAIR);
  const style = styles && pick(styles);
  const hair = HAIR_NOTE.test(who.look ?? "") ? undefined : `${colour} hair${style ? `, ${style}` : ""}`;
  // Возраст — доли по имени: сама модель делает молодыми почти всех. Роль важнее («бабушка», «студентка»).
  const age = AGE_NOTE.test(who.look ?? "") ? undefined : weightedPick(NPC_AGES, rng);
  const mark = MARK_NOTE.test(who.look ?? "") ? undefined : rng() < 0.45 ? pick(MARKS) : "a clean face without marks";
  const u = world.art.underlayersEn;
  const modest = u?.modestRoles?.test(who.role ?? "");
  let under: { open?: string; closed: string } | undefined;
  if (u && who.gender === "f") {
    const open = !modest && rng() < u.openShare;
    under = { closed: pick(u.closed), ...(open ? { open: pick(u.open) } : {}) };
  }
  return { hair, under, age, mark };
}

/** Возраст NPC по умолчанию — доли, а не «все молодые». */
const NPC_AGES: [string, number][] = [
  ["in their twenties", 0.3],
  ["in their thirties", 0.3],
  ["in their forties", 0.2],
  ["in their fifties", 0.12],
  ["elderly, in their sixties or older", 0.08],
];
function weightedPick(opts: [string, number][], rng: Rng) {
  let r = rng() * opts.reduce((a, o) => a + o[1], 0);
  for (const [v, w] of opts) if ((r -= w) < 0) return v;
  return opts[opts.length - 1]![0];
}

const styleRule = (s: ReturnType<typeof npcStyle>) =>
  [
    s.age && `age: ${s.age}, unless the role or the notes clearly need another age`,
    s.hair && `hair in these words: '${s.hair}' (if elderly — grey or white, same style)`,
    s.under &&
      (s.under.open
        ? `ONLY if they wear an open coat, jacket, cardigan or shawl, it is worn '${s.under.open}'; never put it under a dress or apron, skip it without outerwear`
        : `ONLY if they wear an open coat, jacket, cardigan or shawl, it is worn '${s.under.closed}'; never put it under a dress or apron, skip it without outerwear`),
    s.mark && `face: '${s.mark}'`,
  ]
    .filter(Boolean)
    .join("; ") || undefined;

const npcBuild = (world: World, npc: NpcCard) => {
  const b = buildFor(world, npc);
  return b && buildRule(b);
};
const npcLook = (world: World, npc: NpcCard) => {
  const s = npcStyle(world, npc);
  return lookParts(npcBuild(world, npc), { text: styleRule(s), age: !!s.age, face: !!s.mark });
};
/** Пол угадывает сама модель — правила для обоих. */
const guessBuild = (world: World, name: string) => {
  const f = buildFor(world, { name, gender: "f" });
  const m = buildFor(world, { name, gender: "m" });
  return f && m ? `if a woman: ${buildRule(f)}; if a man: ${buildRule(m)}` : undefined;
};
const guessLook = (world: World, name: string) => {
  const sf = npcStyle(world, { name, gender: "f" });
  const sm = npcStyle(world, { name, gender: "m" });
  const f = styleRule(sf);
  const m = styleRule(sm);
  return lookParts(guessBuild(world, name), { text: f && m ? `if a woman: ${f}; if a man: ${m}` : undefined, age: !!sf.age, face: !!sf.mark });
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
Return JSON only: {"race":"${raceKeys(world.rules).join("|")}","gender":"m|f","role":"кто это, 2–4 слова по-русски","look":"English image prompt fragment, 30-60 words: ${captionStyle(world) ? CAPTION_START : ""}${guessLook(world, o.name)}; no names, no style words"}`,
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
        `Write an English image prompt fragment (30-65 words, no style words, no names) describing how this ${world.art.genreEn} character looks: ${caption ? CAPTION_START : ""}${npcLook(world, npc)}.\nCharacter: ${npc.name}, ${world.rules.races[npc.race]?.name ?? npc.race} (${raceEn(world, npc.race, npc.gender)}), ${npc.gender === "f" ? "female" : "male"}, role: ${npc.role}.${npc.look ? ` Appearance notes (Russian): ${npc.look}` : ""}\nAnswer with the fragment only.`,
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

/**
 * Один визуально понятный момент из уже написанной развязки. Служебная модель не меняет исход:
 * она только выбирает действие героя, настроение и детали места для английского промпта FLUX.
 * Других людей опускаем: опорный портрет задаёт личность одного героя, а не всей группы.
 */
export async function describeMoment(
  router: ModelRouter,
  world: World,
  o: { story: string; place: { name: string; type: LocationType; desc: string }; tone: string },
  signal?: AbortSignal,
): Promise<string> {
  const base = world.art.locationEn[o.place.type] ?? world.art.locationEn[world.rules.defaultLocationType] ?? "";
  const fallback = `${base}, the investigator alone after the ending, full figure, ${o.tone}`;
  try {
    const text = oneLine(
      await ask(
        router,
        `Write an English image prompt fragment (35-65 words, no style words, no names) for one wide cinematic aftermath shot from this ${world.art.genreEn} story. Choose one visually telling instant from the ending. Show only the investigator, one full figure, doing one visible action in a specific environment; include two or three concrete setting details and the emotional aftermath. Omit every other person and creature. Do not invent a different outcome. ${world.art.eraRuleEn}\nPlace: ${o.place.name} (${o.place.type}), ${base}${isInterior(world, o.place.type) ? ", interior view" : ""}. Description (Russian): ${o.place.desc}\nRequired tone: ${o.tone}.\nEnding (Russian): ${o.story.slice(0, 6000)}\nAnswer with the fragment only.`,
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
 * Каждая поза — одно действие для обеих рук вместе с предметом («the object» — то, что даёт наряд):
 * «одна рука у воротника» + «предмет в руке» + привычка LoRA упирать руку в бедро давали третью руку.
 * Поза идёт сразу после наряда, рядом со своим предметом.
 */
const POSES = [
  "standing in three-quarter view with arms crossed over the chest, the object tucked under one arm",
  "turned slightly away and glancing back over the shoulder, the object held in both hands at the waist",
  "standing at ease with one shoulder slightly forward, the object held loosely in both hands at waist level",
  "leaning forward slightly, studying the object held in both hands",
  "head tilted to one side, the object held up near the face in both hands",
  "standing straight, one hand on the hip, the object raised to shoulder height in the other hand",
  "shoulders squared to the viewer, the object held low in front of the body with both hands",
];
// Без «walking»: в шаге FLUX рисует человека в полный рост и мелко — портрет выпадает из кадра остальных.

/**
 * Цвет волос и приметы на лице тоже раздаёт код: сама модель из прогона в прогон рисует одну четвёрку
 * (рыжие кудри, седина, чёрные волосы, пепельный блонд) и всем ставит шрам или ожог.
 * Рыжий — один из десяти (LoRA рисует copper, auburn и strawberry почти одинаково), светлых — три.
 */
const HAIR = [
  "copper-red", "chestnut-brown", "dark brown", "jet-black", "honey-blond",
  "platinum-blond", "ash-brown", "mousy light brown", "warm walnut-brown", "dark chocolate-brown",
];

/**
 * Приметы — мелкие и без шрамов: любой шрам, даже «faint pale healed», LoRA рисует свежей царапиной
 * (проверено на двух прогонах). Шрам будет, только если его попросил игрок или описал мастер.
 */
const MARKS = [
  "laugh lines around the eyes",
  "a small dark mole near the lips",
  "freckles across the nose and cheeks",
  "a beauty mark on the cheekbone",
  "faint old pockmarks on the cheeks",
  "a slightly crooked once-broken nose",
];

/** Выражения лица — по одному на облик: служебная модель всем пишет «stern». */
const EXPRESSIONS = [
  "a quietly knowing look", "a composed assessing look", "a cool determined look", "a restrained amused smile",
  "a stern frown", "a weary sorrowful look", "a sharp curious look", "a guarded sidelong glance", "a warm open smile",
  "a sceptical raised eyebrow",
];

/** Подставить слой под верхней одеждой; без слоя — просто убрать метку. */
export const fillUnder = (outfit: string, layer?: string) =>
  layer ? outfit.replace("{under}", layer) : outfit.replace(/\s*\{under\}/, "");

/**
 * Что под верхней одеждой у четырёх обликов героини: у облика с `{under}` — закрытый слой, и с вероятностью
 * как у NPC (1 − (1 − openShare)^n) не больше одного варианта со свободным воротом. Возраст и фигура
 * на этот выбор не влияют.
 */
function heroLayers(world: World, gender: Gender, outfits: string[], rng: Rng) {
  const u = world.art.underlayersEn;
  if (!u || gender !== "f") return undefined;
  const layers = outfits.map((o) => (o.includes("{under}") ? u.closed[Math.floor(rng() * u.closed.length)]! : undefined));
  const ok = outfits.map((o, i) => (o.includes("{under}") ? i : -1)).filter((i) => i >= 0);
  if (ok.length && rng() < 1 - (1 - u.openShare) ** ok.length) layers[ok[Math.floor(rng() * ok.length)]!] = u.open[Math.floor(rng() * u.open.length)]!;
  return layers;
}
/** Игрок сам написал о волосах или приметах — не спорим. */
const HAIR_NOTE = /рыж|блонд|светлов|темновол|тёмновол|черновол|чёрн|брюнет|шатен|сед|русы|русая|каштан|волос|лыс|кос[аыу]\b|косич|стриж|кудр|каре|пучок/i;
const MARK_NOTE = /шрам|ожог|родинк|веснуш|татуир|отметин|оспин|рубц|порез/i;
const AGE_NOTE = /\d+\s*(лет|год)|молод|юн[аыо]|стар|пожил|зрел|средн\S* лет|девушк|бабушк|дедушк|парень/i;

/**
 * Возраст тоже выбирает код: модель ставила полной героине всегда 40–50, стройной — 20–25.
 * Четыре разных отрезка; среди четырёх обязательно кто-то моложе 32 и кто-то старше 45.
 * Возраст не зависит от телосложения.
 */
const AGE_BANDS: [number, number][] = [[20, 25], [26, 31], [32, 38], [39, 45], [46, 53], [54, 65]];
function pickAges(rng: Rng): number[] {
  const ok = (b: number[]) => b.some((x) => x <= 1) && b.some((x) => x >= 4);
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
  // Телосложения перемешаны: порядок карточек не закрепляет один тип фигуры за первым вариантом.
  const heroBuilds = world.art.figures?.hero[d.gender];
  const builds = BUILD_NOTE.test(notes) || !heroBuilds ? undefined : shuffled(heroBuilds, rng);
  const outfitList = (d.gender === "f" ? world.art.heroOutfitsFemaleEn?.[d.cls] : undefined) ?? world.art.heroOutfitsEn?.[d.cls];
  const outfits = outfitList && outfitList.length >= 4 && !CLOTHES_NOTE.test(notes) ? shuffled(outfitList, rng).slice(0, 4) : undefined;
  const poses = shuffled(POSES, rng).slice(0, 4);
  const ownHair = HAIR_NOTE.test(notes);
  const hair = ownHair ? undefined : shuffled(HAIR, rng).slice(0, 4);
  const styleList = world.art.hairstylesEn?.[d.gender];
  const styles = ownHair || !styleList || styleList.length < 4 ? undefined : shuffled(styleList, rng).slice(0, 4);
  const ages = AGE_NOTE.test(notes) ? undefined : pickAges(rng);
  // Примета на лице — у одного-двух из четырёх, остальные с чистым лицом. Без шрамов (см. MARKS).
  const marks = MARK_NOTE.test(notes) ? undefined : (() => {
    const n = rng() < 0.5 ? 1 : 2;
    const order = shuffled([0, 1, 2, 3], rng);
    const picked = shuffled(MARKS, rng);
    return [0, 1, 2, 3].map((i) => (order.indexOf(i) < n ? picked[i]! : undefined));
  })();
  const faces = shuffled(EXPRESSIONS, rng).slice(0, 4);
  const layers = outfits && heroLayers(world, d.gender, outfits, rng);
  // Наряд + поза рядом: предмет из наряда и руки, которые его держат, — в одном месте промпта.
  const dressed = outfits?.map((o, i) => `${fillUnder(o, layers?.[i])}, ${poses[i]}`);
  const specs = [0, 1, 2, 3].map((i) => {
    const parts = [
      ages && `${ages[i]} years old`,
      hair && `${hair[i]} hair${ages && ages[i]! >= 50 ? " streaked with grey" : ""}${styles ? `, ${styles[i]}` : ""}`,
      marks && (marks[i] ?? "a clean face without scars, burns or marks"),
      `expression: ${faces[i]}`,
    ].filter(Boolean);
    return `${i + 1}) ${parts.join(", ")}`;
  });
  const finish = (v: LookVariant[]) =>
    v.map((x, i) => ({
      // Подпись — без телосложения, даже если модель его всё же вписала.
      label: x.label.split(/,\s*/).filter((part) => !BUILD_NOTE.test(part)).join(", ") || x.label,
      prompt: [x.prompt, ages && ages[i]! < 32 && "youthful face, smooth skin", builds?.[i], dressed ? undefined : poses[i]].filter(Boolean).join(", "),
      ...(dressed ? { outfit: dressed[i] } : {}),
    }));
  const fixed = [builds && "body build", outfits && "clothing", "pose and hands"].filter(Boolean).join(", ");
  try {
    const raw = await ask(
      router,
      `You design 4 clearly DIFFERENT looks for a ${world.art.genreEn} player character. Base: ${baseHero(world, d, outfits ? "" : undefined)} (${world.rules.races[d.race]?.name ?? d.race}, ${world.rules.classes[d.cls]?.name ?? d.cls}).${notes ? ` Player's notes (Russian, must be respected in all 4): ${notes}` : ""}
Vary ${ages ? "" : "age, "}${hair ? "" : "hair colour and style, "}face shape${marks ? "" : ", marks (old healed ones only, never fresh wounds)"}${outfits ? "" : ", a clothing detail"} so that the 4 people are easy to tell apart.
Set by the game, in this order — copy these words as they are: ${specs.join("; ")}.
${fixed[0]!.toUpperCase()}${fixed.slice(1)} are set by the game — do not describe them, do not mention hands or objects in hand.${builds ? ` Body builds, in this order: ${builds.map((b, i) => `${i + 1}) ${b}`).join("; ")}${ages ? "" : "; choose ages independently of body build"}.` : ""}
Gender is fixed: every look is ${d.gender === "f" ? "a woman (no beards)" : "a man"}. Start every prompt with "${d.gender === "f" ? "woman" : "man"}" and ${ages ? "the age set above" : "an age"}.
Return JSON only: [{"label":"3-6 слов по-русски: возраст, волосы и примета на лице, если она есть; без фигуры и одежды","prompt":"English fragment, 15-35 words, no style words"}] — exactly 4 items.`,
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
