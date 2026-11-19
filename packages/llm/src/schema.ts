import { z } from "zod";
import { checkable, DC_MAX, DC_MIN, raceKeys, type Ruleset } from "@ash/engine";

/**
 * JSON-контракт ответа мастера (gm-2). Ответ — последовательность реплик (beats):
 * повествование (speaker = null) и прямая речь NPC. Это основа экрана новеллы:
 * каждая реплика — отдельный «кадр» с именем и, позже, портретом говорящего.
 *
 * Схема снисходительная: битые поля получают значения по умолчанию, а не валят ход.
 * Повтор хода — только если нет ни одной реплики или в тексте иероглифы.
 */
const str = (max: number) => z.string().transform((s) => s.trim().slice(0, max)).catch("");
const int = z.coerce.number().transform((n) => (Number.isFinite(n) ? Math.round(n) : 0)).catch(0);
const strList = (maxItems: number, maxLen: number) =>
  z.array(z.unknown()).transform((a) => a.map(String).map((s) => s.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems)).catch([]);
/** Список id: модель иногда пишет объекты ({"id":"c5","text":…}) вместо строк — берём id (или ref). */
const idList = (maxItems: number, maxLen: number) =>
  z
    .array(z.unknown())
    .transform((a) =>
      a
        .map((x) => (x && typeof x === "object" ? ((x as Record<string, unknown>).id ?? (x as Record<string, unknown>).ref ?? "") : x))
        .filter((x) => typeof x === "string" || typeof x === "number")
        .map((x) => String(x).trim().slice(0, maxLen))
        .filter(Boolean)
        .slice(0, maxItems),
    )
    .catch([]);

/** Раса NPC — только из рас мира; неизвестная становится первой (человеком). */
const buildSpeakerSchema = (r: Ruleset) => {
  const races = raceKeys(r);
  return z
    .object({
      name: str(40),
      race: z.enum(races as [string, ...string[]]).catch(races[0]!),
      gender: z.enum(["m", "f"]).catch("m"),
      role: str(60),
      look: str(200).optional(),
    })
    .nullable()
    .catch(null)
    .transform((s) => (s && s.name ? s : null));
};
const speakerSchemas = new Map<string, ReturnType<typeof buildSpeakerSchema>>();
function speakerSchema(r: Ruleset) {
  let s = speakerSchemas.get(r.id);
  if (!s) speakerSchemas.set(r.id, (s = buildSpeakerSchema(r)));
  return s;
}

/** Пометка мастера: в этой реплике случилась находка (ref — id улики или места, "sanity", "hp"), quote — её слова в тексте. */
export interface BeatRef {
  ref: string;
  quote: string;
}

/** Проверенная игрой пометка: что подсветить в тексте и какой ярлык поставить. quote null — только ярлык в конце реплики. */
export interface BeatMark {
  kind: string;
  quote: string | null;
  label: string;
  /** id улики, места или цели — по клику игрок попадает к ней в досье или справочник. */
  ref?: string;
}

export interface Beat {
  /** null — голос рассказчика; иначе имя говорящего NPC. */
  speaker: string | null;
  text: string;
  /** Сырые пометки мастера (finds) — до проверки игрой. Клиенту не уходят. */
  refs?: BeatRef[];
  /** Пометки после проверки: только то, что движок принял. */
  marks?: BeatMark[];
}

/** Убирает кавычки-ёлочки и тире, которыми модели иногда обрамляют реплику. */
const unquote = (s: string) => s.replace(/^[«"“—–\-\s]+|[»"”\s]+$/g, "").trim();

const refsSchema = z
  .array(z.unknown())
  .catch([])
  .transform((a): BeatRef[] =>
    a
      .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
      .map((x) => ({ ref: String(x.ref ?? "").trim().slice(0, 80), quote: String(x.quote ?? "").trim().replace(/^[«"“]+|[»"”]+$/g, "").slice(0, 200) }))
      .filter((x) => x.ref)
      .slice(0, 3),
  );

const BeatSchema = z
  .object({ speaker: z.string().nullable().catch(null).default(null), text: z.string().catch(""), finds: refsSchema.optional() })
  .transform((b): Beat => {
    const speaker = b.speaker && b.speaker.trim() && !/^(рассказчик|мастер|narrator)$/i.test(b.speaker.trim()) ? b.speaker.trim().slice(0, 40) : null;
    const beat: Beat = { speaker, text: (speaker ? unquote(b.text) : b.text.trim()).slice(0, 1500) };
    if (b.finds?.length) beat.refs = b.finds;
    return beat;
  });

export interface Suggestion {
  text: string;
  /** Проверка, если исход варианта неочевиден: навык и сложность видны игроку заранее. */
  check?: { skill: string; dc: number };
  /** Дело: вариант предъявляет найденную улику (её id). Игра оставляет его, только если улика найдена. */
  present?: string;
}

const suggestionSchema = (checks: string[]) => z.union([
  z.string().transform((text): Suggestion => ({ text })),
  z
    .object({ text: z.string(), skill: z.string().optional().catch(undefined), dc: z.coerce.number().optional().catch(undefined), present: z.string().optional().catch(undefined) })
    .transform((s): Suggestion => {
      const skill = s.skill && checks.includes(s.skill.trim()) ? s.skill.trim() : null;
      const dc = Number.isFinite(s.dc) ? Math.min(DC_MAX, Math.max(DC_MIN, Math.round(s.dc!))) : 13;
      const present = s.present?.trim().slice(0, 8);
      return { text: s.text, ...(skill ? { check: { skill, dc } } : {}), ...(present ? { present } : {}) };
    }),
]);

const EnemySchema = z.object({
  name: str(32),
  hp: int,
  ac: int,
  attack: int,
  damage: z.string().catch("1d6+1"),
  /** Для портрета врага: пол, облик; creature — зверь или чудовище, а не человек. */
  gender: z.enum(["m", "f"]).optional().catch(undefined),
  creature: z.boolean().optional().catch(undefined),
  look: str(200).optional(),
});

const rawResponseSchema = (r: Ruleset) => z.object({
  beats: z.array(z.unknown()).catch([]).default([]),
  /** Старый формат gm-1 — на случай, если модель его вспомнит. */
  narration: z.string().optional().catch(undefined),
  line: z.string().optional().catch(undefined),
  speaker: speakerSchema(r).default(null),
  changes: z
    .object({
      hp: int.default(0),
      /** Рассудок — в мирах, где он есть; движок проверит. */
      sanity: int.default(0),
      gold: int.default(0),
      addItems: strList(6, 40).default([]),
      removeItems: strList(6, 40).default([]),
    })
    .catch({ hp: 0, sanity: 0, gold: 0, addItems: [], removeItems: [] })
    .default({ hp: 0, sanity: 0, gold: 0, addItems: [], removeItems: [] }),
  combat: z
    .object({ enemies: z.array(EnemySchema).min(1) })
    .nullable()
    .catch(null)
    .default(null),
  questDone: idList(4, 8).default([]),
  questComplete: z.boolean().catch(false).default(false),
  /** Дело (Аркхэм): найденные улики и открытые адреса — id; проверяет движок. */
  clues: idList(4, 8).default([]),
  reveal: idList(4, 80).default([]),
  suggestions: z.array(z.unknown()).catch([]).default([]),
  /** Герой по ходу рассказа пришёл в другое место карты: название или id; проверяет движок. */
  move: z
    .string()
    .nullable()
    .catch(null)
    .default(null)
    .transform((m) => (m && m.trim() && !/^(null|нет|none)$/i.test(m.trim()) ? m.trim().slice(0, 80) : null)),
});

/** Схема ответа мастера для правил мира: расы NPC и навыки проверок — из мира. */
function buildGmResponseSchema(rules: Ruleset) {
  const SuggestionSchema = suggestionSchema(checkable(rules));
  return rawResponseSchema(rules).transform((r) => {
    let beats = r.beats.map((b) => BeatSchema.safeParse(b)).flatMap((x) => (x.success && x.data.text ? [x.data] : [])).slice(0, 12);
    if (!beats.length && r.narration?.trim()) {
      beats = r.narration.split(/\n\s*\n/).map((t) => ({ speaker: null, text: t.trim() })).filter((b) => b.text);
      if (r.line?.trim()) beats.push({ speaker: r.speaker?.name ?? "Голос", text: unquote(r.line) });
    }
    const suggestions = r.suggestions
      .map((s) => SuggestionSchema.safeParse(s))
      .flatMap((x) => (x.success && x.data.text.trim() ? [{ ...x.data, text: x.data.text.trim().slice(0, 100) }] : []))
      .slice(0, 4);
    return {
      beats,
      narration: beatsText(beats),
      speaker: r.speaker,
      changes: r.changes,
      combat: r.combat,
      questDone: r.questDone,
      questComplete: r.questComplete,
      clues: r.clues,
      reveal: r.reveal,
      move: r.move,
      suggestions,
    };
  });
}

const schemas = new Map<string, ReturnType<typeof buildGmResponseSchema>>();
export function gmResponseSchema(rules: Ruleset) {
  let s = schemas.get(rules.id);
  if (!s) schemas.set(rules.id, (s = buildGmResponseSchema(rules)));
  return s;
}

export type GmResponse = z.output<ReturnType<typeof buildGmResponseSchema>>;

/** Реплики одной строкой — для журнала, истории в промпте и стенограмм. */
export function beatsText(beats: Beat[]): string {
  return beats.map((b) => (b.speaker ? `${b.speaker}: «${b.text}»` : b.text)).join("\n\n");
}

/** Китайские и японские иероглифы — DeepSeek иногда вставляет их посреди русского текста. */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;
export const hasCjk = (s: string) => CJK.test(s);
export const stripCjk = (s: string) => s.replace(new RegExp(CJK.source, "g"), "");

/**
 * Разбор незаконченного JSON: закрывает открытые строки, массивы и объекты и пробует
 * JSON.parse, при неудаче отрезает хвост до последнего разделителя. Для стриминга реплик.
 */
export function parsePartialJson(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let t = text.slice(start);
  for (let attempt = 0; attempt < 12 && t.length > 1; attempt++) {
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    for (const ch of t) {
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
      else if (ch === "}" || ch === "]") stack.pop();
    }
    let fixed = t;
    if (inStr) fixed += esc ? '\\"' : '"';
    fixed = fixed.replace(/[,:]\s*$/, "").replace(/,\s*"[^"]*"\s*$/, "");
    try {
      return JSON.parse(fixed + stack.reverse().join(""));
    } catch {
      // Отрезаем незаконченный хвост (ключ без значения, половину escape-последовательности) и пробуем снова.
      const cut = Math.max(t.lastIndexOf(","), t.lastIndexOf("{"), t.lastIndexOf("["));
      if (cut <= 0) return null;
      t = t.slice(0, t[cut] === "," ? cut : cut + 1);
    }
  }
  return null;
}

/** Реплики из незаконченного ответа — то, что игрок видит, пока модель пишет. */
export function partialBeats(text: string): Beat[] {
  const raw = parsePartialJson(text) as { beats?: unknown[]; narration?: unknown } | null;
  if (!raw) return [];
  if (Array.isArray(raw.beats))
    return raw.beats
      .map((b) => BeatSchema.safeParse(b))
      // Пометки мастера (refs) остаются: игра проверит их и превратит в подсветку, прежде чем отдать клиенту.
      .flatMap((x) => (x.success && x.data.text ? [{ ...x.data, text: stripCjk(x.data.text) }] : []));
  if (typeof raw.narration === "string" && raw.narration.trim()) return [{ speaker: null, text: stripCjk(raw.narration) }];
  return [];
}

export type Speaker = NonNullable<z.output<ReturnType<typeof speakerSchema>>>;

/**
 * Карточка NPC из недописанного ответа — как только она дописана целиком
 * (после неё в JSON уже начались другие поля). Нужна, чтобы портрет начинал рисоваться
 * до конца хода. undefined — ещё рано; null — в ответе NPC нет.
 */
export function partialSpeaker(text: string, rules: Ruleset): Speaker | null | undefined {
  const raw = parsePartialJson(text) as Record<string, unknown> | null;
  if (!raw || !("speaker" in raw)) return undefined;
  const keys = Object.keys(raw);
  if (keys.indexOf("speaker") === keys.length - 1) return undefined;
  return speakerSchema(rules).parse(raw.speaker);
}

/** Первый годный JSON-объект в тексте (модели иногда пишут что-то до или после). */
export function extractJson(text: string): unknown | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const end = t.lastIndexOf("}");
  for (let i = t.indexOf("{"); i >= 0 && i < end; i = t.indexOf("{", i + 1)) {
    try {
      return JSON.parse(t.slice(i, end + 1));
    } catch {}
  }
  return null;
}

export type ParseResult = { ok: true; value: GmResponse } | { ok: false; error: string; fallback: GmResponse };

export function parseGmResponse(text: string, rules: Ruleset): ParseResult {
  const GmResponseSchema = gmResponseSchema(rules);
  const raw = extractJson(text);
  if (raw && typeof raw === "object") {
    const r = GmResponseSchema.safeParse(raw);
    if (r.success && r.data.beats.length) {
      if (hasCjk(r.data.narration)) {
        const clean = r.data.beats.map((b) => ({ ...b, text: stripCjk(b.text) }));
        return { ok: false, error: "в тексте китайские иероглифы", fallback: { ...r.data, beats: clean, narration: beatsText(clean) } };
      }
      return { ok: true, value: r.data };
    }
  }
  const beats = partialBeats(text);
  const plain = beats.length ? beats : [{ speaker: null, text: stripCjk(text.replace(/```[a-z]*|```/g, "").replace(/[{}]/g, "").trim()).slice(0, 2000) || "Мастер на мгновение умолкает…" }];
  return { ok: false, error: raw ? "JSON без реплик" : "ответ не является JSON", fallback: GmResponseSchema.parse({ beats: plain }) };
}
