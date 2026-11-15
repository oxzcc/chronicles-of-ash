import { describe, expect, it } from "vitest";
import { createCharacter, layoutCampaign, mulberry32, RECOMMENDED_STATS, scriptedRng } from "@ash/engine";
import {
  FakeProvider, OpenRouterProvider, parseGmResponse, partialNarration, runNarratorTurn, toWireMessages,
  type CompletionRequest, type CompletionResult, type LlmProvider,
} from "../src/index";

const character = () =>
  createCharacter({ name: "Мирена", gender: "f", race: "elf", cls: "rogue", base: { ...RECOMMENDED_STATS.rogue }, skills: ["Обман", "Внимательность"] }, mulberry32(1));
const campaign = () =>
  layoutCampaign({
    questTitle: "Пепел", hook: "Пропадают люди.", objectives: ["А", "Б", "В"],
    locations: ["tavern", "village", "road", "forest", "cave", "ruins"].map((type, i) => ({ name: `Место ${i}`, type, desc: "…" })),
    target: 5,
  }, "s");
const scene = (action = "Осматриваю площадь") => ({ character: character(), campaign: campaign(), history: [], action });

class Scripted implements LlmProvider {
  name = "scripted";
  calls: CompletionRequest[] = [];
  constructor(private readonly replies: Partial<CompletionResult>[]) {}
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(structuredClone({ ...req, onText: undefined, signal: undefined }));
    const r = this.replies.shift() ?? {};
    if (r.text) req.onText?.(r.text, r.text);
    return { text: "", toolCalls: [], usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0, costUsd: 0.001 }, model: "m", finishReason: "stop", ...r };
  }
}

describe("разбор ответа мастера", () => {
  it("достаёт JSON из мусора и чинит поля", () => {
    const r = parseGmResponse('Вот ответ:\n```json\n{"narration":"Тьма.","speaker":{"name":"Бран","race":"goblin"},"changes":{"gold":"12"},"suggestions":[1,"Иду"]}\n```');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.speaker).toMatchObject({ name: "Бран", race: "human", gender: "m" });
    expect(r.value.changes.gold).toBe(12);
    expect(r.value.suggestions).toEqual(["1", "Иду"]);
    expect(r.value.combat).toBeNull();
  });
  it("битый JSON — запасное повествование", () => {
    const r = parseGmResponse('{"narration":"Дверь скрипит\\nи открывается');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallback.narration).toBe("Дверь скрипит\nи открывается");
  });
  it("частичный текст для стриминга", () => {
    expect(partialNarration('{"narration":"При\\"вет')).toBe('При"вет');
  });
});

describe("ход рассказчика", () => {
  it("roll_check бросает сервер и результат уходит модели", async () => {
    const p = new Scripted([
      { toolCalls: [{ id: "c1", name: "roll_check", arguments: '{"skill":"Обман","dc":13}' }] },
      { text: '{"narration":"Стражник верит тебе.","suggestions":["Иду дальше"]}' },
    ]);
    const rolls: number[] = [];
    const r = await runNarratorTurn({ provider: p, model: "m", worldBible: "", scene: scene(), rng: scriptedRng([15]), onRoll: (x) => void rolls.push(x.d20) });
    expect(rolls).toEqual([15]);
    expect(r.rolls[0]!.success).toBe(true); // 15 + ХАР 12(+1) + мастерство 2 = 18
    expect(r.requests).toBe(2);
    expect(r.usage.costUsd).toBeCloseTo(0.002);
    const toolMsg = p.calls[1]!.messages.at(-1)!;
    expect(toolMsg).toMatchObject({ role: "tool", toolCallId: "c1" });
    expect(r.response.narration).toBe("Стражник верит тебе.");
  });
  it("не больше двух проверок, третья отклоняется", async () => {
    const call = (id: string) => ({ toolCalls: [{ id, name: "roll_check", arguments: '{"skill":"Атлетика","dc":10}' }] });
    const p = new Scripted([call("1"), call("2"), { text: '{"narration":"Готово."}' }]);
    const r = await runNarratorTurn({ provider: p, model: "m", worldBible: "", scene: scene(), rng: mulberry32(1) });
    expect(r.rolls).toHaveLength(2);
    expect(p.calls[2]!.tools).toBeUndefined();
  });
  it("один повтор при битом JSON", async () => {
    const p = new Scripted([{ text: "просто текст" }, { text: '{"narration":"Теперь правильно."}' }]);
    const r = await runNarratorTurn({ provider: p, model: "m", worldBible: "", scene: scene(), rng: mulberry32(1) });
    expect(r.degraded).toBe(false);
    expect(r.requests).toBe(2);
  });
  it("после второго провала — деградация, но ход не падает", async () => {
    const p = new Scripted([{ text: "раз" }, { text: "два" }]);
    const r = await runNarratorTurn({ provider: p, model: "m", worldBible: "", scene: scene(), rng: mulberry32(1) });
    expect(r.degraded).toBe(true);
    expect(r.response.narration).toBe("два");
  });
  it("системный промпт кэшируемый, описание мира внутри", async () => {
    const p = new Scripted([{ text: '{"narration":"Ок."}' }]);
    await runNarratorTurn({ provider: p, model: "m", worldBible: "Мир Пепла.", scene: scene(), rng: mulberry32(1) });
    const sys = p.calls[0]!.messages[0]!;
    expect(sys).toMatchObject({ role: "system", cache: true });
    expect((sys as any).content).toContain("Мир Пепла.");
    expect(toWireMessages([sys])[0]).toMatchObject({ content: [{ cache_control: { type: "ephemeral" } }] });
  });
  it("фейковая модель проходит полный цикл со стримингом", async () => {
    const seen: string[] = [];
    const r = await runNarratorTurn({ provider: new FakeProvider(), model: "fake", worldBible: "", scene: scene(), rng: mulberry32(2), onNarration: (t) => seen.push(t) });
    expect(r.rolls).toHaveLength(1);
    expect(r.response.speaker?.name).toBe("Старый Ведун");
    expect(seen.length).toBeGreaterThan(1);
  });
});

describe("OpenRouter", () => {
  it("разбирает поток SSE с текстом, вызовом инструмента и стоимостью", async () => {
    const lines = [
      { model: "x/y", choices: [{ delta: { content: '{"narr' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "roll_check", arguments: '{"skill":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Магия","dc":13}' } }] }, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 900 }, cost: 0.0042 } },
    ];
    const body = ": OPENROUTER PROCESSING\n\n" + lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join("") + "data: [DONE]\n\n";
    const fetchImpl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const r = await new OpenRouterProvider({ apiKey: "k", fetchImpl }).complete({ model: "x/y", messages: [{ role: "user", content: "hi" }] });
    expect(r.toolCalls).toEqual([{ id: "t1", name: "roll_check", arguments: '{"skill":"Магия","dc":13}' }]);
    expect(r.usage).toEqual({ inputTokens: 1000, outputTokens: 40, cachedTokens: 900, costUsd: 0.0042 });
    expect(r.text).toBe('{"narr');
  });
  it("ошибка HTTP — LlmError с признаком повтора", async () => {
    const fetchImpl = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    await expect(new OpenRouterProvider({ apiKey: "k", fetchImpl, retries: 0 }).complete({ model: "m", messages: [] })).rejects.toMatchObject({ status: 429, retryable: true });
  });
  it("повторяет после сбоя сети, но не после 400", async () => {
    let n = 0;
    const flaky = (async () => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return new Response('data: {"choices":[{"delta":{"content":"ок"}}]}\n\ndata: [DONE]\n\n');
    }) as unknown as typeof fetch;
    expect((await new OpenRouterProvider({ apiKey: "k", fetchImpl: flaky }).complete({ model: "m", messages: [] })).text).toBe("ок");
    let m = 0;
    const bad = (async () => (m++, new Response("bad", { status: 400 }))) as unknown as typeof fetch;
    await expect(new OpenRouterProvider({ apiKey: "k", fetchImpl: bad }).complete({ model: "m", messages: [] })).rejects.toMatchObject({ status: 400 });
    expect(m).toBe(1);
  });
  it("ответ ассистента с вызовом инструмента — content строка, не null", () => {
    const w = toWireMessages([{ role: "assistant", content: "", toolCalls: [{ id: "1", name: "roll_check", arguments: "{}" }] }]);
    expect(w[0]).toMatchObject({ content: "" });
  });
});
