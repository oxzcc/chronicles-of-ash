import { skillCheck, type CheckResult, type Edge, type Rng } from "@ash/engine";
import type { World } from "@ash/worlds";
import { narratorSystemPrompt, narratorUserPrompt, promptVersion, rollCheckTool, ROLL_CHECK, type SceneContext } from "./prompts/gm";
import { parseGmResponse, partialBeats, partialSpeaker, type Beat, type GmResponse, type Speaker } from "./schema";
import { addUsage, emptyUsage, type ChatMessage, type LlmProvider, type Usage } from "./types";

export const MAX_CHECKS_PER_TURN = 2;

export interface NarratorTurnOptions {
  provider: LlmProvider;
  model: string;
  world: World;
  worldBible: string;
  scene: SceneContext;
  rng: Rng;
  signal?: AbortSignal;
  /** Реплики по мере генерации (последняя может быть недописана). */
  onBeats?: (beats: Beat[]) => void;
  /** Карточка NPC дописана — можно ставить портрет в очередь, не дожидаясь конца хода. */
  onSpeaker?: (speaker: Speaker) => void;
  /** false — модели не даётся roll_check (например, проверка уже брошена игрой). */
  allowChecks?: boolean;
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
    { role: "system", content: narratorSystemPrompt(o.world, o.worldBible), cache: true },
    { role: "user", content: narratorUserPrompt(o.world, o.scene) },
  ];
  const rules = o.world.rules;
  const tool = rollCheckTool(rules);
  const rolls: CheckResult[] = [];
  let usage = emptyUsage();
  let requests = 0;
  let model = o.model;
  let retried = false;
  let shown = "";
  let speakerSent = false;
  const onText = (_d: string, full: string) => {
    if (o.onSpeaker && !speakerSent) {
      const s = partialSpeaker(full, rules);
      if (s !== undefined) {
        speakerSent = true;
        if (s) o.onSpeaker(s);
      }
    }
    const beats = partialBeats(full);
    const key = JSON.stringify(beats);
    if (beats.length && key !== shown) {
      shown = key;
      o.onBeats?.(beats);
    }
  };

  for (let step = 0; step < MAX_CHECKS_PER_TURN + 2; step++) {
    const allowTools = o.allowChecks !== false && rolls.length < MAX_CHECKS_PER_TURN;
    const res = await o.provider.complete({
      model: o.model,
      messages,
      tools: allowTools ? [tool] : undefined,
      // Скрытые рассуждения считаются в выход: на тяжёлых сценах (ужас в подвале) 2000 не хватало и JSON обрывался.
      maxTokens: 3500,
      signal: o.signal,
      onText,
    });
    requests++;
    usage = addUsage(usage, res.usage);
    model = res.model;

    const calls = allowTools ? res.toolCalls.filter((c) => c.name === ROLL_CHECK) : [];
    if (calls.length) {
      messages.push({ role: "assistant", content: res.text, toolCalls: calls });
      for (const call of calls) {
        if (rolls.length >= MAX_CHECKS_PER_TURN) {
          messages.push({ role: "tool", toolCallId: call.id, content: "Лимит проверок за ход исчерпан. Опиши исход без броска." });
          continue;
        }
        const a = parseArgs(call.arguments);
        const edge = (["advantage", "disadvantage"].includes(String(a.edge)) ? a.edge : "none") as Edge;
        const roll = skillCheck(rules, o.scene.character, { skill: String(a.skill ?? "Внимательность"), dc: Number(a.dc), reason: String(a.reason ?? ""), edge }, o.rng);
        rolls.push(roll);
        await o.onRoll?.(roll);
        messages.push({ role: "tool", toolCallId: call.id, content: roll.summary });
      }
      continue;
    }

    const parsed = parseGmResponse(res.text, rules);
    if (parsed.ok) {
      return { response: parsed.value, rolls, usage, model, promptVersion: promptVersion(o.world), requests, degraded: false, rawText: res.text };
    }
    if (!retried) {
      retried = true;
      messages.push({ role: "assistant", content: res.text });
      messages.push({
        role: "user",
        content: `Ответ не принят (${parsed.error}). Повтори тот же ход строго одним JSON-объектом по схеме из правил, без текста вокруг, только по-русски.`,
      });
      continue;
    }
    return { response: parsed.fallback, rolls, usage, model, promptVersion: promptVersion(o.world), requests, degraded: true, rawText: res.text };
  }
  throw new Error("Narrator turn exceeded step limit");
}
