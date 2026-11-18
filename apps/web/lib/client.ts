"use client";

import type { Character, CheckResult, CombatEvent, CombatOutcome, CombatState, PublicCampaign } from "@ash/engine";
import type { Beat, Suggestion } from "@ash/llm";
import type { SceneView } from "@ash/game";

export type { SceneView };

export type { Beat, Suggestion };

export interface TurnView {
  turnNo: number;
  kind: string;
  action: string;
  narration: string;
  beats: Beat[];
  speaker: string | null;
  line: string;
  rolls: CheckResult[];
  suggestions: Suggestion[];
  combatEvents: CombatEvent[];
}

export interface CampaignView {
  id: string;
  turnNo: number;
  character: Character;
  /** Кампания без секретов дела — см. publicCampaign. */
  campaign: PublicCampaign;
  turns: TurnView[];
  costUsd: number;
  scene: SceneView;
}

export type TurnStreamEvent =
  | { type: "beats"; beats: Beat[] }
  /** Герой вошёл в локацию (ещё до рассказа): фон уже в очереди или готов. */
  | { type: "arrive"; location: string; imageId: string | null; image: SceneView["locations"][string] | null }
  | { type: "roll"; roll: CheckResult }
  | { type: "combat"; events: CombatEvent[]; combat: CombatState | null; outcome: CombatOutcome }
  | { type: "done"; turnNo: number; character: Character; campaign: PublicCampaign; turns: TurnView[]; costUsd: number; scene: SceneView }
  | { type: "error"; message: string };

export async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data as T;
}

/** Полоса загрузки при создании кампании — см. genProgress в @ash/game. */
export type CreateStreamEvent =
  | { type: "progress"; value: number; phase: "thinking" | "writing" | "retry"; label: string; etaSec: number | null }
  | { type: "done"; id: string; usedFallback: boolean; costUsd: number }
  | { type: "error"; message: string };

/** POST с ответом по SSE: каждое событие отдаётся в onEvent по мере прихода. */
export async function streamTurn(url: string, body: unknown, onEvent: (e: TurnStreamEvent) => void): Promise<void> {
  return streamSse<TurnStreamEvent>(url, body, onEvent);
}

export async function streamSse<E extends { type: string }>(url: string, body: unknown, onEvent: (e: E) => void): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    onEvent({ type: "error", message: data.error ?? `Ошибка ${res.status}` } as unknown as E);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const type = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!type || !data) continue;
      try {
        onEvent({ ...JSON.parse(data), type } as E);
      } catch {}
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
