import { afterAll, describe, expect, it } from "vitest";
import { mulberry32, neighbors, type CharacterDraft } from "@ash/engine";
import { getWorld } from "@ash/worlds";
import { createRouter, type CompletionRequest, type CompletionResult, type LlmProvider } from "@ash/llm";
import { createDb } from "@ash/db";
import {
  campaignTurns, ConflictError, createCampaign, ensureUser, GameError, loadCampaign, newGame, playTurn, saveTurn,
  type GameEvent, type TurnDeps,
} from "../src/index";

const draft: CharacterDraft = { name: "Альдрик", gender: "m", race: "human", cls: "fighter", base: { ...getWorld("fantasy").rules.recommended.fighter! }, skills: ["Внимательность", "Убеждение"] };
const fakeRouter = () => createRouter({ fake: true, models: { narratorPaid: "p", narratorFree: "f", utility: "u" } });

/** Провайдер с заготовленными ответами — для сценариев, которые фейковая модель не покрывает. */
class Scripted implements LlmProvider {
  name = "scripted";
  constructor(private readonly replies: object[]) {}
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const text = JSON.stringify({ beats: [{ speaker: null, text: "…" }], ...(this.replies.shift() ?? {}) });
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
const dpsFake = () => deps();

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
  it("неизвестный мир — понятная ошибка; герой помнит свой мир", async () => {
    await expect(newGame({ router: fakeRouter(), tier: "free", draft: { ...draft, world: "mars" }, rng: mulberry32(1), seed: "x" })).rejects.toBeInstanceOf(GameError);
    const g = await newGame({ router: fakeRouter(), tier: "free", draft: { ...draft, world: "fantasy" }, rng: mulberry32(1), seed: "x" });
    expect(g.character.world).toBe("fantasy");
  });
});

describe("мир Аркхэма", () => {
  const arkhamDraft: CharacterDraft = { world: "arkham", name: "Агнес", gender: "f", race: "human", cls: "journalist", base: { ...getWorld("arkham").rules.recommended.journalist! }, skills: ["Обман", "Архивы"] };
  it("дело от фейковой модели, ход и бой по правилам Аркхэма", async () => {
    const g = await newGame({ router: fakeRouter(), tier: "free", draft: arkhamDraft, rng: mulberry32(1), seed: "a" });
    expect(g.usedFallback).toBe(false);
    expect(g.character.world).toBe("arkham");
    expect(g.campaign.locations[0]!.type).toBe("office");
    const a = await playTurn(deps(), g, [], { kind: "start" });
    expect(a.records[0]!.promptVersion).toBe("gm-3+arkham-1");
    expect(g.campaign.npc?.name).toBe("Сержант Маллой");
    const b = await playTurn(deps(), g, a.records, { kind: "action", text: "Нападаю на громилу" });
    expect(g.campaign.combat?.enemies[0]!.name).toBe("Громила из Нижнего города");
    expect(b.records.some((r) => r.kind === "combat")).toBe(true);
  });
  it("фоны Аркхэма — в своей библиотеке, фэнтези — в старой", async () => {
    const { libraryTag } = await import("../src/visuals");
    expect(libraryTag(getWorld("fantasy"), "city")).toBe("bg:city");
    expect(libraryTag(getWorld("arkham"), "street")).toBe("bg:arkham:street");
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
    expect(events.some((e) => e.type === "beats")).toBe(true);
    expect(g.campaign.npc?.name).toBe("Старый Ведун");
    expect(g.campaign.turn).toBe(2);
  });
  it("вариант с проверкой: кубик бросает игра до рассказа, СЛ берётся из сохранённого варианта", async () => {
    const g = await freshGame();
    const events: GameEvent[] = [];
    const a = await playTurn(deps(), g, [], { kind: "start" });
    expect(a.records[0]!.suggestions[1]).toEqual({ text: "Убеждаю его рассказать правду", check: { skill: "Убеждение", dc: 13 } });
    const b = await playTurn(deps({ emit: (e) => events.push(e) }), g, a.records, { kind: "choice", index: 1 });
    expect(events[0]!.type).toBe("roll");
    expect(b.records[0]!.kind).toBe("choice");
    expect(b.records[0]!.action).toBe("Убеждаю его рассказать правду");
    expect(b.records[0]!.rolls).toHaveLength(1); // фейковая модель не просила второй бросок: инструмент отключён
    expect(b.records[0]!.rolls[0]!.dc).toBe(13);
    const plain = await playTurn(deps(), g, [...a.records, ...b.records], { kind: "choice", index: 0 });
    expect(plain.records[0]!.rolls).toHaveLength(1); // без проверки — мастер может бросить сам
    await expect(playTurn(deps(), g, a.records, { kind: "choice", index: 7 })).rejects.toThrow(/неактуален/);
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
    expect(again.recent[0]!.beats).toHaveLength(3);
    expect(again.recent[0]!.suggestions[2]!.check).toEqual({ skill: "Внимательность", dc: 12 });
    expect((await campaignTurns(db, id))[0]!.suggestions).toHaveLength(3);
    await expect(loadCampaign(db, crypto.randomUUID(), id)).rejects.toThrow(/не найдена/);
  });
});

describe.skipIf(!url)("картинки", async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { FakeImageProvider, LocalStorage } = await import("@ash/images");
  const v = await import("../src/visuals");
  const { db, pool } = url ? createDb(url) : ({} as ReturnType<typeof createDb>);
  afterAll(() => pool?.end());
  const deps = async () => ({ db, router: fakeRouter(), provider: new FakeImageProvider(), storage: new LocalStorage(await mkdtemp(join(tmpdir(), "ash-q-"))) });
  const drain = async (d: Awaited<ReturnType<typeof deps>>) => {
    let n = 0;
    while (await v.processOne(d)) n++;
    return n;
  };

  it("первый ход: портрет нового NPC и фон стартовой локации, оба готовы после очереди", async () => {
    const d = await deps();
    await drain(d); // очередь от прошлых тестов
    const uid = crypto.randomUUID();
    await ensureUser(db, uid);
    const g = await freshGame("vis");
    const id = await createCampaign(db, uid, g);
    const c = await loadCampaign(db, uid, id);
    const r = await playTurn(dpsFake(), c.state, c.recent, { kind: "start" });
    await v.prepareVisuals(db, id, r.state, r.records);
    await saveTurn(db, c, r.state, r.records);
    expect(r.state.campaign.locations[0]!.imageId).toBeTruthy();
    let scene = await v.sceneView(db, id, c.characterId, r.state.campaign);
    expect(scene.npcs["старый ведун"]!.status).toBe("queued");
    expect(await drain(d)).toBe(2);
    scene = await v.sceneView(db, id, c.characterId, r.state.campaign);
    expect(scene.npcs["старый ведун"]!.url).toMatch(/^\/api\/images\/npc\/.+\.webp$/);
    expect(scene.locations.L0!.status).toBe("ready");
    // тот же NPC в следующем ходу — портрет не перерисовывается
    const r2 = await playTurn(dpsFake(), r.state, r.records, { kind: "action", text: "Спрашиваю ещё" });
    await v.prepareVisuals(db, id, r2.state, r2.records);
    expect(await drain(d)).toBe(0);
  });

  it("второй говорящий без карточки тоже получает портрет", async () => {
    const d = await deps();
    await drain(d);
    const uid = crypto.randomUUID();
    await ensureUser(db, uid);
    const g = await freshGame("guess");
    const id = await createCampaign(db, uid, g);
    const c = await loadCampaign(db, uid, id);
    const r = await playTurn(dpsFake(), c.state, c.recent, { kind: "start" });
    r.records[0]!.beats.push({ speaker: "Серый плащ", text: "Выходи, рогатая." }, { speaker: c.state.character.name, text: "Не дождёшься." });
    await v.prepareVisuals(db, id, r.state, r.records);
    let scene = await v.sceneView(db, id, c.characterId, r.state.campaign);
    expect(scene.npcs["серый плащ"]!.status).toBe("queued");
    expect(scene.npcs[c.state.character.name.toLowerCase()]).toBeUndefined(); // герой — не NPC
    await drain(d);
    scene = await v.sceneView(db, id, c.characterId, r.state.campaign);
    expect(scene.npcs["серый плащ"]!.url).toMatch(/^\/api\/images\/npc\/.+\.webp$/);
  });

  it("обычные локации берут фон из общей библиотеки по типу", async () => {
    const d = await deps();
    const uid = crypto.randomUUID();
    await ensureUser(db, uid);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const g = await freshGame(`lib${i}`);
      const cid = await createCampaign(db, uid, g);
      const w = g.campaign;
      w.current = w.locations.find((l) => l.type === "road")!.id; // тракт — не ключевое место
      await v.prepareVisuals(db, cid, g, []);
      ids.push(w.locations.find((l) => l.id === w.current)!.imageId!);
    }
    await drain(d);
    expect(new Set(ids).size).toBeLessThanOrEqual(v.LIBRARY_PER_TYPE);
  });

  it("облик героя: 4 разных варианта, чужие картинки не видны и не прикрепляются", async () => {
    const d = await deps();
    const uid = crypto.randomUUID();
    const other = crypto.randomUUID();
    await ensureUser(db, uid);
    await ensureUser(db, other);
    const opts = await v.createHeroOptions(db, fakeRouter(), uid, { race: "elf", cls: "rogue", gender: "f" }, "");
    expect(new Set(opts.map((o) => o.label)).size).toBe(4);
    await drain(d);
    const st = await v.imageStatuses(db, uid, opts.map((o) => o.id));
    expect(st.every((s) => s.status === "ready")).toBe(true);
    expect(await v.imageStatuses(db, other, opts.map((o) => o.id))).toHaveLength(0);
    const g = await freshGame("hero");
    const cid = await createCampaign(db, other, g);
    const c = await loadCampaign(db, other, cid);
    await expect(v.attachHeroPortrait(db, other, c.characterId, opts[0]!.id)).rejects.toThrow(/недоступен/);
  });
});
