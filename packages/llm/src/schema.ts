import { z } from "zod";
import { CHECKABLE, DC_MAX, DC_MIN, RACE_KEYS } from "@ash/engine";

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

const SpeakerSchema = z
  .object({
    name: str(40),
    race: z.enum(RACE_KEYS).catch("human"),
    gender: z.enum(["m", "f"]).catch("m"),
    role: str(60),
  })
  .nullable()
  .catch(null)
  .transform((s) => (s && s.name ? s : null));

export interface Beat {
  /** null — голос рассказчика; иначе имя говорящего NPC. */
  speaker: string | null;
  text: string;
}

/** Убирает кавычки-ёлочки и тире, которыми модели иногда обрамляют реплику. */
const unquote = (s: string) => s.replace(/^[«"“—–\-\s]+|[»"”\s]+$/g, "").trim();

const BeatSchema = z
  .object({ speaker: z.string().nullable().catch(null).default(null), text: z.string().catch("") })
  .transform((b): Beat => {
    const speaker = b.speaker && b.speaker.trim() && !/^(рассказчик|мастер|narrator)$/i.test(b.speaker.trim()) ? b.speaker.trim().slice(0, 40) : null;
    return { speaker, text: (speaker ? unquote(b.text) : b.text.trim()).slice(0, 1500) };
  });

export interface Suggestion {
  text: string;
  /** Проверка, если исход варианта неочевиден: навык и сложность видны игроку заранее. */
  check?: { skill: string; dc: number };
}

const SuggestionSchema = z.union([
  z.string().transform((text): Suggestion => ({ text })),
  z
    .object({ text: z.string(), skill: z.string().optional().catch(undefined), dc: z.coerce.number().optional().catch(undefined) })
    .transform((s): Suggestion => {
      const skill = s.skill && CHECKABLE.includes(s.skill.trim()) ? s.skill.trim() : null;
      const dc = Number.isFinite(s.dc) ? Math.min(DC_MAX, Math.max(DC_MIN, Math.round(s.dc!))) : 13;
      return skill ? { text: s.text, check: { skill, dc } } : { text: s.text };
    }),
]);

const EnemySchema = z.object({
  name: str(32),
  hp: int,
  ac: int,
  attack: int,
  damage: z.string().catch("1d6+1"),
});

const RawResponseSchema = z.object({
  beats: z.array(z.unknown()).catch([]).default([]),
  /** Старый формат gm-1 — на случай, если модель его вспомнит. */
  narration: z.string().optional().catch(undefined),
  line: z.string().optional().catch(undefined),
  speaker: SpeakerSchema.default(null),
  changes: z
    .object({
      hp: int.default(0),
      gold: int.default(0),
      addItems: strList(6, 40).default([]),
      removeItems: strList(6, 40).default([]),
    })
    .catch({ hp: 0, gold: 0, addItems: [], removeItems: [] })
    .default({ hp: 0, gold: 0, addItems: [], removeItems: [] }),
  combat: z
    .object({ enemies: z.array(EnemySchema).min(1) })
    .nullable()
    .catch(null)
    .default(null),
  questDone: strList(4, 8).default([]),
  questComplete: z.boolean().catch(false).default(false),
  suggestions: z.array(z.unknown()).catch([]).default([]),
});

export const GmResponseSchema = RawResponseSchema.transform((r) => {
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
    suggestions,
  };
});

export type GmResponse = z.output<typeof GmResponseSchema>;

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
      .flatMap((x) => (x.success && x.data.text ? [{ ...x.data, text: stripCjk(x.data.text) }] : []));
  if (typeof raw.narration === "string" && raw.narration.trim()) return [{ speaker: null, text: stripCjk(raw.narration) }];
  return [];
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

export function parseGmResponse(text: string): ParseResult {
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
