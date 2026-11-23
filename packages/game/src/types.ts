import type { AppliedChanges, Campaign, Character, CheckResult, CombatEvent, CombatMove, CombatOutcome, CombatState } from "@ash/engine";
import type { Beat, GmResponse, HistoryEntry, ModelRouter, Speaker, Suggestion, Tier, Usage } from "@ash/llm";
import type { Rng } from "@ash/engine";

export interface GameState {
  character: Character;
  campaign: Campaign;
}

export type TurnInput =
  | { kind: "start" }
  | { kind: "action"; text: string }
  /** Вариант из последнего ответа мастера по номеру — проверку и СЛ сервер берёт из сохранённого варианта. */
  | { kind: "choice"; index: number }
  | { kind: "travel"; to: string }
  | { kind: "rest" }
  | { kind: "combat"; move: CombatMove; target?: number }
  /** Дело: найти имя или место в справочнике — без модели. */
  | { kind: "lookup"; query: string }
  /** Дело: версия событий по найденным уликам. */
  | { kind: "reconstruct"; text: string }
  /** Дело: ответы на вопросы по id вопроса. */
  | { kind: "close"; answers: Record<string, string> }
  /** Дело: показать найденную улику собеседнику; text — что герой при этом говорит (из варианта). */
  | { kind: "present"; clue: string; text?: string };

export type TurnKind = TurnInput["kind"] | "knockout" | "breakdown";

/** Одна запись в журнале кампании = одна строка таблицы turns. */
export interface TurnRecord {
  kind: TurnKind;
  /** Что сделал игрок — словами, для журнала и для промпта. */
  action: string;
  /** Весь текст одной строкой (для промпта и поиска); реплики — в beats. */
  narration: string;
  beats: Beat[];
  speaker: string | null;
  line: string;
  suggestions: Suggestion[];
  response: GmResponse | null;
  applied: AppliedChanges | null;
  rolls: CheckResult[];
  combatEvents: CombatEvent[];
  model: string;
  promptVersion: string;
  usage: Usage;
  degraded: boolean;
  /** Сырой ответ модели — только когда JSON не разобрался, для разбора промптов. */
  raw?: string;
}

/** События для клиента по ходу хода (SSE). */
export type GameEvent =
  | { type: "beats"; beats: Beat[] }
  | { type: "roll"; roll: CheckResult }
  | { type: "combat"; events: CombatEvent[]; combat: CombatState | null; outcome: CombatOutcome };

export interface TurnDeps {
  router: ModelRouter;
  tier: Tier;
  worldBible: string;
  rng: Rng;
  signal?: AbortSignal;
  emit?: (e: GameEvent) => void;
  /** Рассказчик назвал NPC (ещё идёт ход) — для раннего старта портрета. */
  onSpeaker?: (speaker: Speaker) => void;
  /** У реплики NPC появилась эмоция (ещё идёт ход) — лицо начинает рисоваться раньше. Зовётся по разу на имя и эмоцию. */
  onEmotion?: (name: string, emotion: string) => void;
  /** Герой оказался в локации (начало, переход) — ещё до рассказа: фон начинает рисоваться сразу. */
  onArrive?: () => Promise<void>;
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
