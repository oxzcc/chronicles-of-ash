import { afterAll, describe, expect, it } from "vitest";
import { mulberry32, neighbors, RECOMMENDED_STATS, type CharacterDraft } from "@ash/engine";
import { createRouter, type CompletionRequest, type CompletionResult, type LlmProvider } from "@ash/llm";
import { createDb } from "@ash/db";
import {
  campaignTurns, ConflictError, createCampaign, ensureUser, GameError, loadCampaign, newGame, playTurn, saveTurn,
  type GameEvent, type TurnDeps,
} from "../src/index";

const draft: CharacterDraft = { name: "Альдрик", gender: "m", race: "human", cls: "fighter", base: { ...RECOMMENDED_STATS.fighter }, skills: ["Внимательность", "Убеждение"] };
const fakeRouter = () => createRouter({ fake: true, models: { narratorPaid: "p", narratorFree: "f", utility: "u" } });

/** Провайдер с заготовленными ответами — для сценариев, которые фейковая модель не покрывает. */
class Scripted implements LlmProvider {
  name = "scripted";
  constructor(private readonly replies: object[]) {}
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const text = JSON.stringify({ narration: "…", ...(this.replies.shift() ?? {}) });
    req.onText?.(text, text);
    return { text, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, costUsd: 0.001 }, model: "s", finishReason: "stop" };
  }
}
const scriptedRouter = (replies: object[]) => {
  const p = new Scripted(replies);
  return { isFake: true, route: () => ({ provider: p, model: "s" }), direct: () => ({ provider: p, model: "s" }) } as any;
};

async function freshGame(seed = "t") {
  return newGame({ router: fakeRouter(), tier: "free", draft, rng: mulberry32(1), seed });
}
const deps = (over: Partial<TurnDeps> = {}): TurnDeps => ({ router: fakeRouter(), tier: "free", worldBible: "", rng: mulberry32(5), ...over });

describe("новая игра", () => {
  it("герой и квест от фейковой модели", async () => {
    const g = await freshGame();
    expect(g.usedFallback).toBe(false);
    expect(g.campaign.locations).toHaveLength(6);
    expect(g.character.hp).toBe(g.character.hpMax);
  });
  it("битый ответ модели — запасной квест", async () => {
    const g = await newGame({ router: scriptedRouter([{}, {}]), tier: "free", draft, rng: mulberry32(1), seed: "x" });
    expect(g.usedFallback).toBe(true);
    expect(g.campaign.questTitle).toBe("Пепел над Чернолесьем");
  });
  it("неверный черновик — понятная ошибка", async () => {
    await expect(newGame({ router: fakeRouter(), tier: "free", draft: { ...draft, name: "" }, rng: mulberry32(1), seed: "x" })).rejects.toBeInstanceOf(GameError);
  });
});

describe("ход", () => {
  it("начало, затем действие: события, броски, журнал", async () => {
    const g = await freshGame();
    const events: GameEvent[] = [];
    const a = await playTurn(deps({ emit: (e) => events.push(e) }), g, [], { kind: "start" });
    expect(a.records[0]!.kind).toBe("start");
    await expect(playTurn(deps(), g, a.records, { kind: "start" })).rejects.toThrow(/уже началось/);
    const b = await playTurn(deps({ emit: (e) => events.push(e) }), g, a.records, { kind: "action", text: "Расспрашиваю старика" });
    expect(b.records[0]!.rolls).toHaveLength(1);
    expect(events.some((e) => e.type === "roll")).toBe(true);
    expect(events.some((e) => e.type === "narration")).toBe(true);
    expect(g.campaign.npc?.name).toBe("Старый Ведун");
    expect(g.campaign.turn).toBe(2);
  });
  it("пустое действие отклоняется", async () => {
    const g = await freshGame();
    await expect(playTurn(deps(), g, [], { kind: "action", text: "   " })).rejects.toBeInstanceOf(GameError);
  });
  it("перемещение только к соседям", async () => {
    const g = await freshGame();
    await expect(playTurn(deps(), g, [], { kind: "travel", to: g.campaign.target })).rejects.toThrow(/нет прямой дороги/);
    const to = neighbors(g.campaign, g.campaign.current)[0]!.id;
    const r = await playTurn(deps(), g, [], { kind: "travel", to });
    expect(g.campaign.current).toBe(to);
    expect(r.records[0]!.action).toMatch(/^Путь в/);
  });
  it("бой: объявлен мастером, идёт по ходам движка, итог рассказывает мастер", async () => {
    const g = await freshGame();
    const r = await playTurn(deps(), g, [], { kind: "action", text: "Нападаю на культиста" });
    expect(r.records.map((x) => x.kind)).toContain("combat");
    let guard = 0;
    while (g.campaign.combat && guard++ < 40) {
      const step = await playTurn(deps({ rng: mulberry32(guard) }), g, [], { kind: "combat", move: "attack" });
      expect(step.records[0]!.model).toBe("engine");
    }
    expect(g.campaign.combat).toBeNull();
    await expect(playTurn(deps(), g, [], { kind: "combat", move: "attack" })).rejects.toThrow(/нет боя/);
  });
  it("во время боя нельзя действовать словами, отдыхать и уходить", async () => {
    const g = await freshGame();
    await playTurn(deps({ rng: mulberry32(99) }), g, [], { kind: "action", text: "Атакую культиста" });
    if (!g.campaign.combat) return; // враги могли победить сразу на инициативе
    await expect(playTurn(deps(), g, [], { kind: "action", text: "Болтаю" })).rejects.toThrow(/Идёт бой/);
    await expect(playTurn(deps(), g, [], { kind: "rest" })).rejects.toThrow();
  });
  it("здоровье до нуля вне боя — герой без сознания, но жив", async () => {
    const g = await freshGame();
    const r = await playTurn(deps({ router: scriptedRouter([{ changes: { hp: -99 } }, { changes: { hp: 50 } }]) }), g, [], { kind: "action", text: "Прыгаю со скалы" });
    expect(r.records.map((x) => x.kind)).toEqual(["action", "knockout"]);
    expect(g.character.hp).toBe(1); // мастер не может «вылечить» в сцене поражения
  });
  it("удачный отдых возвращает умение", async () => {
    const g = await freshGame();
    g.character.hp = 3;
    g.character.abilityUses = 0;
    await playTurn(deps({ router: scriptedRouter([{ changes: { hp: 99 } }]) }), g, [], { kind: "rest" });
    expect(g.character.hp).toBe(g.character.hpMax);
    expect(g.character.abilityUses).toBe(1);
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("база", () => {
  const { db, pool } = url ? createDb(url) : ({} as ReturnType<typeof createDb>);
  afterAll(() => pool?.end());
  it("создание, ход, загрузка и защита от двойного хода", async () => {
    const uid = crypto.randomUUID();
    await ensureUser(db, uid);
    const g = await freshGame("db");
    const id = await createCampaign(db, uid, g);
    const c = await loadCampaign(db, uid, id);
    const r = await playTurn(deps(), c.state, c.recent, { kind: "start" });
    expect(await saveTurn(db, c, r.state, r.records)).toBe(1);
    await expect(saveTurn(db, c, r.state, r.records)).rejects.toBeInstanceOf(ConflictError);
    const again = await loadCampaign(db, uid, id);
    expect(again.turnNo).toBe(1);
    expect(again.recent[0]!.narration).toContain("пепел");
    expect((await campaignTurns(db, id))[0]!.suggestions).toHaveLength(3);
    await expect(loadCampaign(db, crypto.randomUUID(), id)).rejects.toThrow(/не найдена/);
  });
});
