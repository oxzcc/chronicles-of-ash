import type { AppliedChanges, Campaign, Character, CheckResult, CombatEvent, CombatMove, CombatOutcome, CombatState } from "@ash/engine";
import type { GmResponse, HistoryEntry, ModelRouter, Tier, Usage } from "@ash/llm";
import type { Rng } from "@ash/engine";

export interface GameState {
  character: Character;
  campaign: Campaign;
}

export type TurnInput =
  | { kind: "start" }
  | { kind: "action"; text: string }
  | { kind: "travel"; to: string }
  | { kind: "rest" }
  | { kind: "combat"; move: CombatMove; target?: number };

export type TurnKind = TurnInput["kind"] | "knockout";

/** Одна запись в журнале кампании = одна строка таблицы turns. */
export interface TurnRecord {
  kind: TurnKind;
  /** Что сделал игрок — словами, для журнала и для промпта. */
  action: string;
  narration: string;
  speaker: string | null;
  line: string;
  suggestions: string[];
  response: GmResponse | null;
  applied: AppliedChanges | null;
  rolls: CheckResult[];
  combatEvents: CombatEvent[];
  model: string;
  promptVersion: string;
  usage: Usage;
  degraded: boolean;
}

/** События для клиента по ходу хода (SSE). */
export type GameEvent =
  | { type: "narration"; text: string }
  | { type: "roll"; roll: CheckResult }
  | { type: "combat"; events: CombatEvent[]; combat: CombatState | null; outcome: CombatOutcome };

export interface TurnDeps {
  router: ModelRouter;
  tier: Tier;
  worldBible: string;
  rng: Rng;
  signal?: AbortSignal;
  emit?: (e: GameEvent) => void;
}

export interface TurnOutcome {
  state: GameState;
  records: TurnRecord[];
}

export class GameError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "GameError";
  }
}

export type { HistoryEntry };
