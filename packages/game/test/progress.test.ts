import { describe, expect, it } from "vitest";
import { mulberry32, type CharacterDraft } from "@ash/engine";
import { getWorld } from "@ash/worlds";
import type { CompletionRequest, CompletionResult, LlmProvider } from "@ash/llm";
import { genProgress, newGame, progressTracker, startedStages, type GenProgress } from "../src/index";

const snap = (over: Partial<Parameters<typeof genProgress>[0]> = {}) =>
  genProgress({ kind: "case", elapsedMs: 0, reasoningChars: 0, text: "", attempt: 0, thinkingLabel: "Доктор Уэйкфилд ищет папку…", ...over });

describe("полоса загрузки: оценка", () => {
  it("рассуждения: по объёму, до 85%, с примерным временем", () => {
    const a = snap({ reasoningChars: 5000, elapsedMs: 12000 });
    const b = snap({ reasoningChars: 20000, elapsedMs: 48000 });
    expect(a.phase).toBe("thinking");
    expect(a.label).toBe("Доктор Уэйкфилд ищет папку…");
    expect(a.value).toBeGreaterThan(0.25);
    expect(b.value).toBeGreaterThan(a.value);
    expect(snap({ reasoningChars: 80000 }).value).toBeLessThan(0.85);
    // Четверть рассуждений за 12 с: осталось около 36 с + 13 с на запись (дело с мотивами жителей и поворотом длиннее).
    expect(a.etaSec).toBe(50);
    // Рассуждений столько, сколько обычно: осталось дописать хвост и сам JSON.
    expect(b.etaSec).toBe(20);
    expect(snap({ reasoningChars: 40000, elapsedMs: 50000 }).etaSec).toBeGreaterThan(0);
  });
  it("без рассуждений от провайдера — по времени", () => {
    expect(snap({ elapsedMs: 24000 }).value).toBeCloseTo(snap({ reasoningChars: 10000 }).value, 5);
  });
  it("запись: разделы JSON по порядку; тип места «newspaper» за газету не считается", () => {
    const t = '{"questTitle":"x","objectives":["a"],"locations":[{"name":"Редакция","type":"newspaper"}],"people":[';
    expect(startedStages("case", t)).toEqual(["objectives", "locations", "people"]);
    const p = snap({ text: t });
    expect(p.phase).toBe("writing");
    expect(p.label).toBe("Жители");
    expect(p.value).toBeGreaterThanOrEqual(0.85);
    expect(p.value).toBeLessThan(1);
    expect(snap({ text: t + '{"name":"x"}],"clues":[],"deductions":[],"questions":[],"newspaper":{' }).label).toBe("Утренняя газета");
  });
  it("вторая попытка — с подписью", () => {
    expect(snap({ attempt: 1, reasoningChars: 100 })).toMatchObject({ phase: "retry", label: expect.stringMatching(/ещё раз/) });
  });
});

describe("полоса загрузки: трекер", () => {
  it("не чаще интервала, не назад в пределах попытки, с нуля на новой попытке", () => {
    let t = 0;
    const seen: GenProgress[] = [];
    const tr = progressTracker({ kind: "quest", thinkingLabel: "…", onProgress: (p) => seen.push(p), now: () => t, intervalMs: 250 });
    tr.start();
    t = 100;
    tr.reasoning(1000); // слишком рано — пропущено
    t = 300;
    tr.reasoning(2000);
    t = 600;
    tr.text('{"objectives":['); // запись идёт — значение выше
    t = 900;
    tr.reasoning(2100); // поздний кусок рассуждений не тянет полосу назад
    expect(seen.map((p) => p.value)).toEqual([...seen.map((p) => p.value)].sort((a, b) => a - b));
    expect(seen).toHaveLength(4);
    t = 950;
    tr.retry();
    expect(seen.at(-1)).toMatchObject({ phase: "retry", value: 0 });
  });
});

describe("новая игра с полосой загрузки", () => {
  it("прогресс приходит из потока рассуждений и текста, вторая попытка видна", async () => {
    const W = getWorld("arkham");
    const caseJson = JSON.stringify(W.fallbackCase);
    let call = 0;
    const provider: LlmProvider = {
      name: "p",
      async complete(req: CompletionRequest): Promise<CompletionResult> {
        call++;
        req.onReasoning?.(6000);
        req.onReasoning?.(18000);
        const text = call === 1 ? "не JSON" : caseJson;
        req.onText?.(text, text);
        return { text, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, costUsd: 0 }, model: "m", finishReason: "stop" };
      },
    };
    const router = { isFake: false, route: () => ({ provider, model: "m" }), direct: () => ({ provider, model: "m" }) } as any;
    const d: CharacterDraft = { world: "arkham", phobia: W.rules.sanity!.phobias[0]!, name: "Уолтер Грей", gender: "m", race: "human", cls: "detective", skills: ["Внимательность", "Психология"], base: { ...W.rules.recommended.detective! } };
    const seen: GenProgress[] = [];
    const g = await newGame({ router, tier: "free", draft: d, rng: mulberry32(1), seed: "p", onProgress: (p) => seen.push(p) });
    expect(g.usedFallback).toBe(false);
    expect(seen[0]).toMatchObject({ phase: "thinking", label: W.ui.starting });
    expect(seen.some((p) => p.phase === "retry")).toBe(true);
  });
});

describe("свои в деле", () => {
  const W = getWorld("arkham");
  const d: CharacterDraft = { world: "arkham", phobia: W.rules.sanity!.phobias[0]!, name: "Уолтер Грей", gender: "m", race: "human", cls: "detective", skills: ["Внимательность", "Психология"], base: { ...W.rules.recommended.detective! } };
  const run = async (roll: number) => {
    const prompts: string[] = [];
    const provider: LlmProvider = {
      name: "p",
      async complete(req: CompletionRequest): Promise<CompletionResult> {
        prompts.push(String(req.messages[0]!.content));
        const text = JSON.stringify(W.fallbackCase);
        return { text, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, costUsd: 0 }, model: "m", finishReason: "stop" };
      },
    };
    const router = { isFake: false, route: () => ({ provider, model: "m" }), direct: () => ({ provider, model: "m" }) } as any;
    // Первые броски уходят на героя (золото), последний — на «своих».
    const g = await newGame({ router, tier: "free", draft: d, rng: () => roll, seed: "c" });
    return { g, prompt: prompts[0]! };
  };
  it("редкий бросок решает код: ниже шанса — один из своих замешан", async () => {
    const yes = await run(W.cast!.insiderChance / 2);
    expect(yes.g.insider).toBe(true);
    expect(yes.prompt).toMatch(/Поворот этого дела: один из своих/);
    expect(yes.prompt).toMatch(/Хэтти Колдуэлл/);
    const no = await run(0.5);
    expect(no.g.insider).toBe(false);
    expect(no.prompt).toMatch(/Свои вне подозрений/);
  });
  it("шанс редкий, у фэнтези своих нет", () => {
    expect(W.cast!.insiderChance).toBeGreaterThan(0);
    expect(W.cast!.insiderChance).toBeLessThanOrEqual(0.2);
    expect(getWorld("fantasy").cast).toBeUndefined();
  });
});
