"use client";

import type { Campaign, Character, CheckResult, CombatEvent, CombatOutcome, CombatState } from "@ash/engine";

export interface TurnView {
  turnNo: number;
  kind: string;
  action: string;
  narration: string;
  speaker: string | null;
  line: string;
  rolls: CheckResult[];
  suggestions: string[];
  combatEvents: CombatEvent[];
}

export interface CampaignView {
  id: string;
  turnNo: number;
  character: Character;
  campaign: Campaign;
  turns: TurnView[];
  costUsd: number;
}

export type TurnStreamEvent =
  | { type: "narration"; text: string }
  | { type: "roll"; roll: CheckResult }
  | { type: "combat"; events: CombatEvent[]; combat: CombatState | null; outcome: CombatOutcome }
  | { type: "done"; turnNo: number; character: Character; campaign: Campaign; turns: TurnView[]; costUsd: number }
  | { type: "error"; message: string };

export async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
  return data as T;
}

/** POST с ответом по SSE: каждое событие отдаётся в onEvent по мере прихода. */
export async function streamTurn(url: string, body: unknown, onEvent: (e: TurnStreamEvent) => void): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    onEvent({ type: "error", message: data.error ?? `Ошибка ${res.status}` });
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
        onEvent({ ...JSON.parse(data), type } as TurnStreamEvent);
      } catch {}
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
