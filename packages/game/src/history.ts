import type { HistoryEntry } from "@ash/llm";
import type { TurnRecord } from "./types";

/** Сколько последних записей журнала идёт в промпт (как в плане: ~14 событий). */
export const HISTORY_WINDOW = 14;

export type Recordish = Pick<TurnRecord, "kind" | "action" | "narration" | "speaker" | "line" | "rolls">;

/** Журнал ходов → события для промпта мастера. */
export function toHistory(records: Recordish[]): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const r of records) {
    if (r.kind === "action") out.push({ who: "player", text: r.action });
    else if (r.kind === "combat") {
      out.push({ who: "combat", text: r.narration });
      continue;
    } else if (r.kind !== "start") out.push({ who: "system", text: r.action });
    for (const roll of r.rolls ?? []) out.push({ who: "roll", text: roll.summary });
    out.push({ who: "gm", text: r.narration, speaker: r.speaker ?? undefined, line: r.line || undefined });
  }
  return out.slice(-HISTORY_WINDOW);
}
