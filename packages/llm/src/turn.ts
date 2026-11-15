import { skillCheck, type CheckResult, type Edge, type Rng } from "@ash/engine";
import { narratorSystemPrompt, narratorUserPrompt, rollCheckTool, PROMPT_VERSION, type SceneContext } from "./prompts/gm";
import { parseGmResponse, partialNarration, type GmResponse } from "./schema";
import { addUsage, emptyUsage, type ChatMessage, type LlmProvider, type Usage } from "./types";

export const MAX_CHECKS_PER_TURN = 2;

export interface NarratorTurnOptions {
  provider: LlmProvider;
  model: string;
  worldBible: string;
  scene: SceneContext;
  rng: Rng;
  signal?: AbortSignal;
  /** Повествование целиком по мере генерации. */
  onNarration?: (text: string) => void;
  /** Бросок сделан — клиент показывает анимацию до продолжения текста. */
  onRoll?: (roll: CheckResult) => void | Promise<void>;
}

export interface NarratorTurnResult {
  response: GmResponse;
  rolls: CheckResult[];
  usage: Usage;
  model: string;
  promptVersion: string;
  /** Сколько запросов к модели ушло (проверки и повтор увеличивают). */
  requests: number;
  /** JSON так и не разобрался — использовано повествование из сырого текста. */
  degraded: boolean;
  rawText: string;
}

function parseArgs(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * Один ход рассказчика: модель может вызвать roll_check (бросает сервер), затем
 * возвращает JSON. Если JSON не разобрался — один повтор с напоминанием о формате.
 */
export async function runNarratorTurn(o: NarratorTurnOptions): Promise<NarratorTurnResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: narratorSystemPrompt(o.worldBible), cache: true },
    { role: "user", content: narratorUserPrompt(o.scene) },
  ];
  const rolls: CheckResult[] = [];
  let usage = emptyUsage();
  let requests = 0;
  let model = o.model;
  let retried = false;
  let shown = "";
  const onText = (_d: string, full: string) => {
    const n = partialNarration(full);
    if (n && n !== shown) {
      shown = n;
      o.onNarration?.(n);
    }
  };

  for (let step = 0; step < MAX_CHECKS_PER_TURN + 2; step++) {
    const allowTools = rolls.length < MAX_CHECKS_PER_TURN;
    const res = await o.provider.complete({
      model: o.model,
      messages,
      tools: allowTools ? [rollCheckTool] : undefined,
      maxTokens: 2000,
      signal: o.signal,
      onText,
    });
    requests++;
    usage = addUsage(usage, res.usage);
    model = res.model;

    const calls = allowTools ? res.toolCalls.filter((c) => c.name === rollCheckTool.name) : [];
    if (calls.length) {
      messages.push({ role: "assistant", content: res.text, toolCalls: calls });
      for (const call of calls) {
        if (rolls.length >= MAX_CHECKS_PER_TURN) {
          messages.push({ role: "tool", toolCallId: call.id, content: "Лимит проверок за ход исчерпан. Опиши исход без броска." });
          continue;
        }
        const a = parseArgs(call.arguments);
        const edge = (["advantage", "disadvantage"].includes(String(a.edge)) ? a.edge : "none") as Edge;
        const roll = skillCheck(o.scene.character, { skill: String(a.skill ?? "Внимательность"), dc: Number(a.dc), reason: String(a.reason ?? ""), edge }, o.rng);
        rolls.push(roll);
        await o.onRoll?.(roll);
        messages.push({ role: "tool", toolCallId: call.id, content: roll.summary });
      }
      continue;
    }

    const parsed = parseGmResponse(res.text);
    if (parsed.ok) {
      return { response: parsed.value, rolls, usage, model, promptVersion: PROMPT_VERSION, requests, degraded: false, rawText: res.text };
    }
    if (!retried) {
      retried = true;
      messages.push({ role: "assistant", content: res.text });
      messages.push({ role: "user", content: `Ответ не разобран (${parsed.error}). Повтори тот же ход строго одним JSON-объектом по схеме из правил, без текста вокруг.` });
      continue;
    }
    return { response: parsed.fallback, rolls, usage, model, promptVersion: PROMPT_VERSION, requests, degraded: true, rawText: res.text };
  }
  throw new Error("Narrator turn exceeded step limit");
}
