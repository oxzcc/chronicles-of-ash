import { describe, expect, it } from "vitest";
import { createCharacter, layoutCampaign, mulberry32, scriptedRng } from "@ash/engine";
import { getWorld } from "@ash/worlds";
import {
  FakeProvider, OpenRouterProvider, parseGmResponse, parsePartialJson, partialBeats, runNarratorTurn, toWireMessages,
  type CompletionRequest, type CompletionResult, type LlmProvider,
} from "../src/index";

const world = getWorld("fantasy");
const R = world.rules;
const character = () =>
  createCharacter(R, { name: "Мирена", gender: "f", race: "elf", cls: "rogue", base: { ...R.recommended.rogue! }, skills: ["Обман", "Внимательность"] }, mulberry32(1));
const campaign = () =>
  layoutCampaign(R, {
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
    const r = parseGmResponse('Вот ответ:\n```json\n{"beats":[{"speaker":null,"text":"Тьма."},{"speaker":"Бран","text":"«Кто здесь?»"},{"speaker":"Рассказчик","text":"Тишина."}],"speaker":{"name":"Бран","race":"goblin"},"changes":{"gold":"12"},"suggestions":[1,"Иду",{"text":"Лгу","skill":"Обман","dc":40},{"text":"Колдую","skill":"Некромантия","dc":12}]}\n```', R);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.beats).toEqual([{ speaker: null, text: "Тьма." }, { speaker: "Бран", text: "Кто здесь?" }, { speaker: null, text: "Тишина." }]);
    expect(r.value.narration).toBe("Тьма.\n\nБран: «Кто здесь?»\n\nТишина.");
    expect(r.value.speaker).toMatchObject({ name: "Бран", race: "human", gender: "m" });
    expect(r.value.changes.gold).toBe(12);
    expect(r.value.suggestions).toEqual([{ text: "Иду" }, { text: "Лгу", check: { skill: "Обман", dc: 25 } }, { text: "Колдую" }]);
    expect(r.value.combat).toBeNull();
  });
  it("старый формат narration + line превращается в реплики", () => {
    const r = parseGmResponse('{"narration":"Дверь скрипит.\\n\\nВходит стражник.","speaker":{"name":"Вейл"},"line":"Бумаги!"}', R);
    expect(r.ok && r.value.beats).toEqual([{ speaker: null, text: "Дверь скрипит." }, { speaker: null, text: "Входит стражник." }, { speaker: "Вейл", text: "Бумаги!" }]);
  });
  it("иероглифы — повод для повтора, в запасном тексте вычищены", () => {
    const r = parseGmResponse('{"beats":[{"speaker":null,"text":"Он смотрит 突然 на тебя."}]}', R);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/иероглиф/);
    expect(r.fallback.beats[0]!.text).toBe("Он смотрит  на тебя.");
  });
  it("битый JSON — запасные реплики", () => {
    const r = parseGmResponse('{"beats":[{"speaker":null,"text":"Дверь скрипит\\nи открывается', R);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallback.beats[0]!.text).toBe("Дверь скрипит\nи открывается");
  });
});

describe("стриминг реплик", () => {
  it("недописанный JSON разбирается на каждом шаге", () => {
    const full = '{"beats":[{"speaker":null,"text":"Ветер воет."},{"speaker":"Годрик","text":"Пей или уходи, \\"гость\\"."}],"changes":{"hp":0}}';
    const seen = new Set<string>();
    for (let n = 1; n <= full.length; n++) seen.add(JSON.stringify(partialBeats(full.slice(0, n))));
    const last = partialBeats(full);
    expect(last).toEqual([{ speaker: null, text: "Ветер воет." }, { speaker: "Годрик", text: 'Пей или уходи, "гость".' }]);
    expect(seen.size).toBeGreaterThan(20);
    expect(parsePartialJson('{"beats":[{"speaker":"Го')).toEqual({ beats: [{ speaker: "Го" }] });
  });
  it("иероглифы не показываются даже на лету", () => {
    expect(partialBeats('{"beats":[{"speaker":null,"text":"Шаги 突然 стихли')).toEqual([{ speaker: null, text: "Шаги  стихли" }]);
  });
});

describe("ход рассказчика", () => {
  it("roll_check бросает сервер и результат уходит модели", async () => {
    const p = new Scripted([
      { toolCalls: [{ id: "c1", name: "roll_check", arguments: '{"skill":"Обман","dc":13}' }] },
      { text: '{"beats":[{"speaker":null,"text":"Стражник верит тебе."}],"suggestions":["Иду дальше"]}' },
    ]);
    const rolls: number[] = [];
    const r = await runNarratorTurn({ world, provider: p, model: "m", worldBible: "", scene: scene(), rng: scriptedRng([15]), onRoll: (x) => void rolls.push(x.d20) });
    expect(rolls).toEqual([15]);
    expect(r.rolls[0]!.success).toBe(true); // 15 + ХАР 12(+1) + мастерство 2 = 18
    expect(r.requests).toBe(2);
    expect(r.usage.costUsd).toBeCloseTo(0.002);
    const toolMsg = p.calls[1]!.messages.at(-1)!;
    expect(toolMsg).toMatchObject({ role: "tool", toolCallId: "c1" });
    expect(r.response.narration).toBe("Стражник верит тебе.");
    expect(r.response.suggestions).toEqual([{ text: "Иду дальше" }]);
  });
  it("не больше двух проверок, третья отклоняется", async () => {
    const call = (id: string) => ({ toolCalls: [{ id, name: "roll_check", arguments: '{"skill":"Атлетика","dc":10}' }] });
    const p = new Scripted([call("1"), call("2"), { text: '{"beats":[{"speaker":null,"text":"Готово."}]}' }]);
    const r = await runNarratorTurn({ world, provider: p, model: "m", worldBible: "", scene: scene(), rng: mulberry32(1) });
    expect(r.rolls).toHaveLength(2);
    expect(p.calls[2]!.tools).toBeUndefined();
  });
  it("один повтор при битом JSON", async () => {
    const p = new Scripted([{ text: "просто текст" }, { text: '{"beats":[{"speaker":null,"text":"Теперь правильно."}]}' }]);
    const r = await runNarratorTurn({ world, provider: p, model: "m", worldBible: "", scene: scene(), rng: mulberry32(1) });
    expect(r.degraded).toBe(false);
    expect(r.requests).toBe(2);
  });
  it("после второго провала — деградация, но ход не падает", async () => {
    const p = new Scripted([{ text: "раз" }, { text: "два" }]);
    const r = await runNarratorTurn({ world, provider: p, model: "m", worldBible: "", scene: scene(), rng: mulberry32(1) });
    expect(r.degraded).toBe(true);
    expect(r.response.beats[0]!.text).toBe("два");
  });
  it("системный промпт кэшируемый, описание мира внутри", async () => {
    const p = new Scripted([{ text: '{"beats":[{"speaker":null,"text":"Ок."}]}' }]);
    await runNarratorTurn({ world, provider: p, model: "m", worldBible: "Мир Пепла.", scene: scene(), rng: mulberry32(1) });
    const sys = p.calls[0]!.messages[0]!;
    expect(sys).toMatchObject({ role: "system", cache: true });
    expect((sys as any).content).toContain("Мир Пепла.");
    expect(toWireMessages([sys])[0]).toMatchObject({ content: [{ cache_control: { type: "ephemeral" } }] });
  });
  it("фейковая модель проходит полный цикл со стримингом", async () => {
    const seen: number[] = [];
    const r = await runNarratorTurn({ world, provider: new FakeProvider(), model: "fake", worldBible: "", scene: scene(), rng: mulberry32(2), onBeats: (b) => seen.push(b.length) });
    expect(r.rolls).toHaveLength(1);
    expect(r.response.speaker?.name).toBe("Старый Ведун");
    expect(r.response.beats.at(-1)).toEqual({ speaker: "Старый Ведун", text: "Ты не первый, кто спрашивает. Те, кто спрашивал, не вернулись." });
    expect(seen.length).toBeGreaterThan(3);
    expect(Math.max(...seen)).toBe(3);
  });
  it("без allowChecks инструмент не даётся", async () => {
    const r = await runNarratorTurn({ world, provider: new FakeProvider(), model: "fake", worldBible: "", scene: scene(), rng: mulberry32(2), allowChecks: false });
    expect(r.rolls).toHaveLength(0);
    expect(r.requests).toBe(1);
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

describe("рассуждения модели", () => {
  it("усилие по умолчанию уходит в запрос, запрос может его переопределить", async () => {
    const bodies: any[] = [];
    const fetchImpl = (async (_u: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return new Response('data: {"choices":[{"delta":{"content":"ок"}}]}\n\ndata: [DONE]\n\n');
    }) as unknown as typeof fetch;
    const p = new OpenRouterProvider({ apiKey: "k", fetchImpl, reasoningEffort: "low" });
    await p.complete({ model: "m", messages: [] });
    await p.complete({ model: "m", messages: [], reasoningEffort: "high" });
    expect(bodies[0].reasoning).toEqual({ effort: "low" });
    expect(bodies[1].reasoning).toEqual({ effort: "high" });
    await new OpenRouterProvider({ apiKey: "k", fetchImpl }).complete({ model: "m", messages: [] });
    expect(bodies[2].reasoning).toBeUndefined();
  });
});

describe("промпты по мирам", () => {
  const arkham = getWorld("arkham");
  it("мастер Аркхэма: свои разделы, свои расы, своя версия; у фэнтези — без них", async () => {
    const { gmRules, promptVersion, questPrompt, rollCheckTool } = await import("../src/index");
    const a = gmRules(arkham);
    expect(a).toContain("РАССЛЕДОВАНИЕ:");
    expect(a).toContain('"race":"human"');
    expect(a).not.toMatch(/Baldur|тёмно-фэнтезийн|золот/);
    expect(gmRules(world)).not.toContain("РАССЛЕДОВАНИЕ:");
    expect(promptVersion(arkham)).toBe("gm-3+arkham-2");
    expect(promptVersion(world)).toBe("gm-3");
    expect(rollCheckTool(arkham.rules).parameters).toMatchObject({ properties: { skill: { enum: expect.arrayContaining(["Психология", "Оккультизм"]) } } });
    expect(JSON.stringify(rollCheckTool(arkham.rules))).not.toContain("Магия");
    const hero = createCharacter(arkham.rules, { world: "arkham", name: "Агнес", gender: "f", race: "human", cls: "journalist", base: { ...arkham.rules.recommended.journalist! }, skills: ["Обман", "Архивы"] }, mulberry32(1));
    const q = questPrompt(arkham, hero);
    expect(q).toContain("контора, гостиница, закусочная или полицейский участок");
    expect(q).toContain("деньги $");
  });
  it("разбор ответа: раса и навыки — из мира", () => {
    const r = parseGmResponse('{"beats":[{"speaker":null,"text":"Туман."}],"speaker":{"name":"Маллой","race":"dwarf"},"suggestions":[{"text":"Читаю","skill":"Оккультизм","dc":13},{"text":"Колдую","skill":"Магия","dc":13}]}', arkham.rules);
    expect(r.ok && r.value.speaker?.race).toBe("human");
    expect(r.ok && r.value.suggestions).toEqual([{ text: "Читаю", check: { skill: "Оккультизм", dc: 13 } }, { text: "Колдую" }]);
  });
  it("фейковая модель узнаёт мир Аркхэма", async () => {
    const hero = createCharacter(arkham.rules, { world: "arkham", name: "Уолтер", gender: "m", race: "human", cls: "detective", base: { ...arkham.rules.recommended.detective! }, skills: ["Внимательность", "Психология"] }, mulberry32(1));
    const camp = layoutCampaign(arkham.rules, arkham.fallbackQuest, "s");
    const r = await runNarratorTurn({ world: arkham, provider: new FakeProvider(), model: "fake", worldBible: "", scene: { character: hero, campaign: camp, history: [], action: "Осматриваюсь" }, rng: mulberry32(2) });
    expect(r.response.speaker?.name).toBe("Сержант Маллой");
    expect(r.promptVersion).toBe("gm-3+arkham-2");
  });
});

describe("дело в промптах", () => {
  const arkham = getWorld("arkham");
  it("мастер видит разгадку, улики с id и неизвестные места; в JSON — clues и reveal", async () => {
    const { gmRules, narratorUserPrompt, layoutCase } = { ...(await import("../src/index")), ...(await import("@ash/engine")) };
    expect(gmRules(arkham)).toContain("ДЕЛО:");
    expect(gmRules(arkham)).toContain('"clues":[],"reveal":[]');
    expect(gmRules(world)).not.toContain('"clues"');
    const hero = createCharacter(arkham.rules, { world: "arkham", name: "Уолтер", gender: "m", race: "human", cls: "detective", base: { ...arkham.rules.recommended.detective! }, skills: ["Внимательность", "Психология"] }, mulberry32(1));
    const w = layoutCase(arkham.rules, arkham.fallbackCase!, "s");
    const p = narratorUserPrompt(arkham, { character: hero, campaign: w, history: [], action: "Осматриваю" });
    expect(p).toContain("Разгадка: Корделию Вейл отравил");
    expect(p).toContain("[c1] Дом Вейлов на Сосновой улице (L1) — не найдена, ключевая");
    expect(p).toMatch(/Места, о которых герой ещё не знает: Бакалея Финнегана \(L4/);
    expect(p).toContain("Известные герою адреса:");
    expect(p).toContain("Визиты: 0 из 10.");
  });
  it("ответ мастера несёт улики и адреса", () => {
    const r = parseGmResponse('{"beats":[{"speaker":null,"text":"Чашка."}],"clues":["c1"],"reveal":["L4"]}', arkham.rules);
    expect(r.ok && [r.value.clues, r.value.reveal]).toEqual([["c1"], ["L4"]]);
  });
  it("вердикты и вывод — только из допустимых значений; запасная проверка по словам", async () => {
    const { parseVerdicts, parseDeduction, roughVerdict } = await import("../src/index");
    expect(parseVerdicts('{"a1":"right","a2":"maybe"}', ["a1", "a2", "a3"])).toEqual({ a1: "right", a2: "wrong", a3: "wrong" });
    expect(parseDeduction('{"match":"c9"}', ["c9"])).toBe("c9");
    expect(parseDeduction('{"match":"c1"}', ["c9"])).toBeNull();
    expect(roughVerdict("Племянник Кит Ларкин отравил её ради наследства", "Её племянник Кит Ларкин: отравил её наперстянкой ради наследства, чтобы закрыть долг бутлегерам.")).toBe("right");
    expect(roughVerdict("дворецкий", "Её племянник Кит Ларкин: отравил её наперстянкой ради наследства.")).toBe("wrong");
  });
});
