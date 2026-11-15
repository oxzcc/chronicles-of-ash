import { z } from "zod";
import { RACE_KEYS } from "@ash/engine";

/**
 * JSON-контракт ответа мастера. Схема снисходительная: битые поля получают значения
 * по умолчанию, а не валят весь ход. Пустое повествование — единственная причина повтора.
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

const EnemySchema = z.object({
  name: str(32),
  hp: int,
  ac: int,
  attack: int,
  damage: z.string().catch("1d6+1"),
});

export const GmResponseSchema = z.object({
  narration: str(4000),
  speaker: SpeakerSchema.default(null),
  line: str(600).default(""),
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
  suggestions: strList(4, 80).default([]),
});

export type GmResponse = z.infer<typeof GmResponseSchema>;

/** Достаёт поле narration из незаконченного JSON — для стриминга текста игроку. */
export function partialNarration(t: string): string {
  const m = /"narration"\s*:\s*"/.exec(t);
  if (!m) return "";
  let i = m.index + m[0].length;
  let out = "";
  while (i < t.length) {
    const c = t[i]!;
    if (c === "\\") {
      const n = t[i + 1];
      if (n === undefined) break;
      if (n === "n") out += "\n";
      else if (n === "t") out += " ";
      else if (n === "u") {
        const hex = t.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      } else out += n;
      i += 2;
      continue;
    }
    if (c === '"') break;
    out += c;
    i++;
  }
  return out;
}

/** Последний JSON-объект с narration в тексте (модели иногда пишут что-то до или после). */
export function extractJson(text: string): unknown | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const starts = [...t.matchAll(/\{\s*"narration"/g)].map((m) => m.index!);
  const start = starts.length ? starts[starts.length - 1]! : t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type ParseResult = { ok: true; value: GmResponse } | { ok: false; error: string; fallback: GmResponse };

export function parseGmResponse(text: string): ParseResult {
  const raw = extractJson(text);
  if (raw && typeof raw === "object") {
    const r = GmResponseSchema.safeParse(raw);
    if (r.success && r.data.narration) return { ok: true, value: r.data };
  }
  const narration = partialNarration(text) || text.replace(/```[a-z]*|```/g, "").replace(/[{}]/g, "").trim();
  return {
    ok: false,
    error: raw ? "JSON без повествования" : "ответ не является JSON",
    fallback: GmResponseSchema.parse({ narration: narration.slice(0, 4000) || "Мастер на мгновение умолкает…" }),
  };
}
