import { afterAll, describe, expect, it } from "vitest";
import { mulberry32, neighbors, sameName, type CharacterDraft } from "@ash/engine";
import { getWorld } from "@ash/worlds";
import { createRouter, type CompletionRequest, type CompletionResult, type LlmProvider } from "@ash/llm";
import { createDb, images, npcs } from "@ash/db";
import { eq } from "drizzle-orm";
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
const deps0 = deps;

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
  const arkhamDraft: CharacterDraft = { world: "arkham", phobia: "Мертвецы", name: "Агнес", gender: "f", race: "human", cls: "journalist", base: { ...getWorld("arkham").rules.recommended.journalist! }, skills: ["Обман", "Архивы"] };
  it("дело от фейковой модели, ход и бой по правилам Аркхэма", async () => {
    const g = await newGame({ router: fakeRouter(), tier: "free", draft: arkhamDraft, rng: mulberry32(1), seed: "a" });
    expect(g.usedFallback).toBe(false);
    expect(g.character.world).toBe("arkham");
    expect(g.campaign.locations[0]!.type).toBe("office");
    const a = await playTurn(deps(), g, [], { kind: "start" });
    expect(a.records[0]!.promptVersion).toBe("gm-7+arkham-6");
    expect(g.campaign.npc?.name).toBe("Сержант Маллой");
    const b = await playTurn(deps(), g, a.records, { kind: "action", text: "Нападаю на громилу" });
    expect(g.campaign.combat?.enemies[0]!.name).toBe("Громила из Нижнего города");
    expect(b.records.some((r) => r.kind === "combat")).toBe(true);
  });
  it("дело целиком: справочник, переход, улика, реконструкция, закрытие со счётом", async () => {
    const { publicCampaign } = await import("@ash/engine");
    const g = await newGame({ router: fakeRouter(), tier: "free", draft: arkhamDraft, rng: mulberry32(1), seed: "case" });
    const w = g.campaign;
    expect(w.case?.truth).toMatch(/Кит Ларкин/);
    expect(JSON.stringify(publicCampaign(w))).not.toMatch(/Кит Ларкин: отравил/);
    let recs = (await playTurn(deps(), g, [], { kind: "start" })).records;
    // Справочник без модели: имя из газеты открывает адрес.
    const look = await playTurn(deps(), g, recs, { kind: "lookup", query: "Финнеган" });
    expect(look.records[0]).toMatchObject({ kind: "lookup", model: "engine" });
    expect(look.records[0]!.narration).toMatch(/Бакалея Финнегана/);
    expect(w.case!.known).toContain("L4");
    expect(look.records[0]!.applied!.effects).toEqual([{ kind: "address", text: "Бакалея Финнегана", good: true, ref: "L4" }]);
    recs = [...recs, ...look.records];
    await expect(playTurn(deps(), g, recs, { kind: "travel", to: "L5" })).rejects.toThrow(/не знаешь/);
    // Мастер нашёл улику в доме Вейлов — движок принимает её только там.
    const scripted = scriptedRouter([{
      beats: [{ speaker: null, text: "В чашке — горький зеленоватый осадок.", finds: [{ ref: "c1", quote: "горький зеленоватый осадок" }, { ref: "c3", quote: "в чашке" }] }],
      clues: ["c1", "c3"], reveal: ["L5"],
      suggestions: [{ text: "Показываю осадок", present: "c1" }, { text: "Показываю футляр", present: "c4" }],
    }]);
    const t = await playTurn(deps({ router: scripted }), g, recs, { kind: "travel", to: "L1" });
    expect(w.case!.visits).toBe(1);
    expect(w.case!.clues.find((x) => x.id === "c1")!.found).toBe(true);
    expect(w.case!.clues.find((x) => x.id === "c3")!.found).toBe(false);
    expect(t.records[0]!.applied!.rejected.join()).toMatch(/c3 лежит не здесь/);
    expect(w.case!.known).toContain("L5");
    expect(t.records[0]!.applied!.effects.map((e) => [e.kind, e.ref])).toEqual([["clue", "c1"], ["address", "L5"]]);
    // Подсвечена только принятая улика; адрес без пометки — ярлыком в конце; предъявить можно только найденное.
    expect(t.records[0]!.beats[0]!.marks).toEqual([
      { kind: "clue", quote: "горький зеленоватый осадок", label: "улика", ref: "c1" },
      { kind: "address", quote: null, label: "адрес", ref: "L5" },
    ]);
    expect(t.records[0]!.response!.beats).toBe(t.records[0]!.beats);
    expect(t.records[0]!.suggestions).toEqual([{ text: "Показываю осадок", present: "c1" }, { text: "Показываю футляр" }]);
    expect(t.records[0]!.applied!.effects[0]!.text).toBe("Осадок в чайной чашке");
    // Реконструкция: без нужных улик — понятная ошибка; с ними — вывод от служебной модели.
    await expect(playTurn(deps(), g, recs, { kind: "reconstruct", text: "Кит отравил тётю ради денег" })).rejects.toThrow(/мало/);
    for (const id of ["c2", "c3"]) w.case!.clues.find((x) => x.id === id)!.found = true;
    const rc = await playTurn(deps(), g, recs, { kind: "reconstruct", text: "Кит подал отравленный чай, потому что ему нужны были деньги на долги" });
    expect(rc.records[0]!.kind).toBe("reconstruct");
    expect(w.case!.clues.find((x) => x.id === "c9")!.found).toBe(true);
    expect(rc.records[0]!.applied!.effects[0]).toMatchObject({ kind: "deduction", ref: "c9", good: true });
    // Закрытие: оценка (фейковая модель — по словам), счёт, разбор.
    const close = await playTurn(deps(), g, recs, { kind: "close", answers: { a1: "Племянник Кит Ларкин отравил её наперстянкой ради наследства", a2: "Не знаю" } });
    expect(close.records[0]!.kind).toBe("close");
    const res = w.case!.result!;
    expect(res.answers.map((a) => a.verdict)).toEqual(["right", "wrong", "wrong"]);
    expect(res).toMatchObject({ points: 20, mentor: 40, penalty: 0, score: 20 });
    expect(w.complete).toBe(true);
    await expect(playTurn(deps(), g, recs, { kind: "close", answers: { a1: "x" } })).rejects.toThrow(/закрыто/);
  });
  it("люди и предъявление: карточки говоривших, улика уличает лжеца, метка у его реплики", async () => {
    const g = await newGame({ router: fakeRouter(), tier: "free", draft: arkhamDraft, rng: mulberry32(1), seed: "present" });
    const w = g.campaign;
    const kit = { name: "Кит Ларкин", race: "human", gender: "m", role: "племянник покойной" };
    let r = await playTurn(deps({ router: scriptedRouter([{
      beats: [{ speaker: null, text: "Кит курит у стойки." }, { speaker: "Кит Ларкин", text: "К тёте я в тот вечер не заходил." }],
      speaker: kit, npcs: [{ name: "Кит", voice: "развязно, с усмешкой", attitude: -1, told: ["в тот вечер к тёте не заходил"] }, { name: "Финнеган", told: ["я ничего не видел"] }],
    }]) }), g, [], { kind: "action", text: "Спрашиваю Кита про тот вечер" });
    expect(w.memory).toEqual([expect.objectContaining({ name: "Кит Ларкин", role: "племянник покойной", voice: "развязно, с усмешкой", attitude: -1, told: ["в тот вечер к тёте не заходил"] })]);
    expect(r.records[0]!.applied!.rejected.join()).toMatch(/Финнеган не говорил/);
    expect(r.records[0]!.beats[1]!.marks).toEqual([{ kind: "attitude", quote: null, label: "доверие −1", ref: "Кит Ларкин" }]);
    // Показать можно только найденное и только собеседнику.
    await expect(playTurn(deps(), g, [], { kind: "present", clue: "c1" })).rejects.toThrow(/не найдена/);
    w.case!.clues.find((x) => x.id === "c1")!.found = true;
    r = await playTurn(deps({ router: scriptedRouter([{
      beats: [{ speaker: null, text: "Ты ставишь чашку перед ним." }, { speaker: "Кит Ларкин", text: "Ладно. Я принёс ей чай." }],
      speaker: kit, npcs: [{ name: "Кит Ларкин", attitude: -1, told: ["сам принёс тёте чай"] }],
    }]) }), g, [], { kind: "present", clue: "c1", text: "Показываю Киту осадок" });
    const rec = r.records[0]!;
    expect(rec).toMatchObject({ kind: "present", action: "Показываю Киту осадок" });
    expect(rec.applied!.effects[0]).toMatchObject({ kind: "caught", text: "Кит Ларкин" });
    expect(rec.beats[1]!.marks!.map((m) => m.kind)).toEqual(["attitude", "caught"]);
    expect(w.case!.people.find((p) => p.name === "Кит Ларкин")!.lie!.broken).toBe(true);
    expect(w.memory![0]!.told).toEqual(["в тот вечер к тёте не заходил", "сам принёс тёте чай"]);
    w.npc = null;
    await expect(playTurn(deps(), g, [], { kind: "present", clue: "c1" })).rejects.toThrow(/некому/);
  });
  it("рассудок: потеря в деле копится, на грани — два варианта, на нуле — срыв и потерянное время", async () => {
    const g = await newGame({ router: fakeRouter(), tier: "free", draft: arkhamDraft, rng: mulberry32(1), seed: "san" });
    const c = g.character;
    expect(c.sanity).toBe(c.sanityMax);
    const three = [{ text: "А" }, { text: "Б" }, { text: "В" }];
    let r = await playTurn(deps({ router: scriptedRouter([{ changes: { sanity: -3 }, suggestions: three }]) }), g, [], { kind: "action", text: "Читаю книгу" });
    expect(c.sanity).toBe(c.sanityMax! - 3);
    expect(g.campaign.case!.sanityLost).toBe(3);
    expect(r.records[0]!.suggestions).toHaveLength(3);
    c.sanity = 4;
    r = await playTurn(deps({ router: scriptedRouter([{ changes: { sanity: 0 }, suggestions: three }]) }), g, [], { kind: "action", text: "Смотрю в окно" });
    expect(r.records[0]!.suggestions).toHaveLength(2);
    const visits = g.campaign.case!.visits;
    r = await playTurn(deps({ router: scriptedRouter([{ changes: { sanity: -4 } }, { changes: { sanity: -2 } }]) }), g, [], { kind: "action", text: "Смотрю в круг" });
    expect(r.records.map((x) => x.kind)).toEqual(["action", "breakdown"]);
    expect(r.records[0]!.applied!.effects).toContainEqual({ kind: "sanity", text: "−4", good: false, delta: -4 });
    expect(r.records[1]!.applied!.effects).toContainEqual(expect.objectContaining({ kind: "sanity", good: true }));
    expect(c.sanity).toBe(Math.ceil(c.sanityMax! / 2)); // мастер в срыве рассудок не трогает
    expect(g.campaign.case!.visits).toBe(visits + 2);
    expect(g.campaign.case!.sanityLost).toBe(7);
  });
  it("фоны Аркхэма — в своей библиотеке, фэнтези — в общей; версия библиотеки в теге", async () => {
    const { libraryTag } = await import("../src/visuals");
    expect(libraryTag(getWorld("fantasy"), "city")).toBe("bg2:city");
    expect(libraryTag(getWorld("arkham"), "street")).toBe("bg2:arkham:street");
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
  it("переход по рассказу: мастер довёл до соседнего места — герой там, фон заказан; в чужое место — нет", async () => {
    const g = await freshGame();
    const start = g.campaign.current;
    const nb = neighbors(g.campaign, start)[0]!;
    const far = g.campaign.locations.find((l) => l.id !== start && !neighbors(g.campaign, start).some((n) => n.id === l.id))!;
    let arrived = 0;
    const bad = await playTurn(deps({ router: scriptedRouter([{ move: far.name }]), onArrive: async () => void arrived++ }), g, [], { kind: "action", text: "Иду туда" });
    expect(g.campaign.current).toBe(start);
    expect(arrived).toBe(0);
    expect(bad.records[0]!.applied!.rejected.join()).toMatch(/нет прямой дороги/);
    const ok = await playTurn(deps({ router: scriptedRouter([{ move: nb.name, speaker: { name: "Сторож", race: "human", gender: "m", role: "сторож" } }]), onArrive: async () => void arrived++ }), g, [], { kind: "action", text: "Иду к соседям" });
    expect(g.campaign.current).toBe(nb.id);
    expect(arrived).toBe(1);
    expect(ok.records[0]!.applied!.notes.join()).toMatch(/переход/);
    // Собеседник — уже из нового места.
    expect(g.campaign.npc?.name).toBe("Сторож");
    // Служебные ходы (путь по карте, отдых) не переносят героя по рассказу.
    const back = g.campaign.current;
    await playTurn(deps({ router: scriptedRouter([{ move: g.campaign.locations.find((l) => l.id === start)!.name }]) }), g, [], { kind: "rest" });
    expect(g.campaign.current).toBe(back);
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
    expect(r.records[1]!.applied!.effects).toContainEqual(expect.objectContaining({ kind: "gold", good: false }));
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
    // Плашки хода сохраняются и возвращаются при загрузке.
    const c2 = await loadCampaign(db, uid, id);
    const r2 = await playTurn(deps({ router: scriptedRouter([{ changes: { gold: 3, addItems: ["Ключ"] } }]) }), c2.state, c2.recent, { kind: "action", text: "Обыскиваю стол" });
    await saveTurn(db, c2, r2.state, r2.records);
    expect((await campaignTurns(db, id)).at(-1)!.effects.map((e) => e.kind)).toEqual(["gold", "item"]);
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
    // Сначала срочное — портрет собеседника и фон, где стоит герой; фоны соседних мест — про запас, потом.
    expect(await v.processOne(d)).toBe(true);
    expect(await v.processOne(d)).toBe(true);
    scene = await v.sceneView(db, id, c.characterId, r.state.campaign);
    expect(scene.npcs["старый ведун"]!.status).toBe("ready");
    expect(scene.locations.L0!.status).toBe("ready");
    await drain(d);
    scene = await v.sceneView(db, id, c.characterId, r.state.campaign);
    expect(scene.npcs["старый ведун"]!.url).toMatch(/^\/api\/images\/npc\/.+\.webp$/);
    expect(scene.locations.L0!.status).toBe("ready");
    // тот же NPC в следующем ходу — портрет не перерисовывается
    const r2 = await playTurn(dpsFake(), r.state, r.records, { kind: "action", text: "Спрашиваю ещё" });
    await v.prepareVisuals(db, id, r2.state, r2.records);
    expect(await drain(d)).toBe(0);
  });

  it("про запас: при создании дела — фоны известных адресов и портреты жителей; срочное и узнанное — вперёд", async () => {
    const d = await deps();
    await drain(d);
    const uid = crypto.randomUUID();
    await ensureUser(db, uid);
    const arkham = getWorld("arkham");
    const draftA: CharacterDraft = { world: "arkham", phobia: "Мертвецы", name: "Агнес", gender: "f", race: "human", cls: "journalist", base: { ...arkham.rules.recommended.journalist! }, skills: ["Обман", "Архивы"] };
    const g = await newGame({ router: fakeRouter(), tier: "free", draft: draftA, rng: mulberry32(1), seed: "pre" });
    const id = await createCampaign(db, uid, g);
    const w = g.campaign;
    expect(await v.prefetchVisuals(db, id, arkham, w)).toBe(true);
    // Фоны: старт и все известные адреса; неизвестные — нет.
    for (const l of w.locations) expect(!!l.imageId).toBe(w.case!.known.includes(l.id));
    const c = await loadCampaign(db, uid, id);
    let scene = await v.sceneView(db, id, c.characterId, w);
    // Свои — все, с общими портретами; жители известных адресов — в очереди, кроме тех, кто и есть свой
    // («Деннис Маллой» = «сержант Деннис Маллой»); жители неизвестных адресов — ещё нет.
    const cast = [arkham.cast!.mentor, ...arkham.cast!.allies];
    const atKnown = w.case!.people.filter((p) => w.case!.known.includes(p.at) && !cast.some((m) => sameName(m.name, p.name))).map((p) => p.name.toLowerCase());
    expect(Object.keys(scene.npcs).sort()).toEqual([...atKnown, ...cast.map((m) => m.name.toLowerCase())].sort());
    // Портреты своих — общие для мира: у второй кампании те же картинки, новых задач на них нет.
    const castImages = async (cid: string) =>
      new Map((await db.select({ name: npcs.name, img: npcs.portraitImageId }).from(npcs).where(eq(npcs.campaignId, cid))).filter((r) => cast.some((m) => m.name === r.name)).map((r) => [r.name, r.img]));
    const id2 = await createCampaign(db, uid, g);
    await v.prefetchVisuals(db, id2, arkham, structuredClone(w));
    const first = await castImages(id);
    expect(first.size).toBe(cast.length);
    expect(await castImages(id2)).toEqual(first);
    // Новый собеседник — срочно: его берут сразу после фона, где стоит герой, раньше всех заготовок.
    await v.ensureNpc(db, id, arkham, { name: "Человек в кепке", race: "human", gender: "m", role: "громила", look: "кепка, нож" });
    expect(await v.processOne(d)).toBe(true);
    expect(await v.processOne(d)).toBe(true);
    expect((await v.sceneView(db, id, c.characterId, w)).locations[w.current]!.status).toBe("ready");
    scene = await v.sceneView(db, id, c.characterId, w);
    expect(scene.npcs["человек в кепке"]!.status).toBe("ready");
    // Готов только он (портреты своих могли нарисоваться в прошлых прогонах — библиотека общая).
    expect(Object.entries(scene.npcs).filter(([k, n]) => n.status === "ready" && !cast.some((m) => m.name.toLowerCase() === k))).toHaveLength(1);
    // Мастер называет жителя коротко — новый портрет не рисуется, заготовка поднимается в начало.
    const lorraine = w.case!.people.find((p) => p.name === "Лорейн Вейл")!;
    expect(w.case!.known).toContain(lorraine.at);
    const before = Object.keys(scene.npcs).length;
    await v.ensureNpc(db, id, arkham, { name: "Лорейн", race: "human", gender: "f", role: "дочь", look: "другое лицо" });
    expect(await v.processOne(d)).toBe(true);
    scene = await v.sceneView(db, id, c.characterId, w);
    expect(Object.keys(scene.npcs)).toHaveLength(before);
    expect(scene.npcs["лорейн вейл"]!.status).toBe("ready");
  });

  it("враг в бою получает портрет; знакомый NPC в роли врага — свой прежний", async () => {
    const d = await deps();
    await drain(d);
    const uid = crypto.randomUUID();
    await ensureUser(db, uid);
    const g = await freshGame("foe");
    const id = await createCampaign(db, uid, g);
    const c = await loadCampaign(db, uid, id);
    const r = await playTurn(deps0({ router: scriptedRouter([{ speaker: { name: "Брам Кривой", race: "human", gender: "m", role: "разбойник", look: "шрам" } }]) }), c.state, c.recent, { kind: "start" });
    await v.prepareVisuals(db, id, r.state, r.records);
    const r2 = await playTurn(deps0({ router: scriptedRouter([{ combat: { enemies: [{ name: "Брам", hp: 8, ac: 11, attack: 2, damage: "1d4", look: "шрам" }, { name: "Волк", hp: 6, ac: 11, attack: 2, damage: "1d4", creature: true, look: "серый, худой" }] } }]) }), r.state, r.records, { kind: "action", text: "Бью Брама" });
    await v.prepareVisuals(db, id, r2.state, r2.records);
    const scene = await v.sceneView(db, id, c.characterId, r2.state.campaign);
    expect(Object.keys(scene.npcs).sort()).toEqual(["брам кривой", "волк"]);
    await drain(d);
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

  it("перерисовка мира: готовые картинки — снова в очередь на месте, под новым ключом; постоянные лица — по нынешнему описанию", async () => {
    const d = await deps();
    await drain(d);
    const uid = crypto.randomUUID();
    await ensureUser(db, uid);
    const arkham = getWorld("arkham");
    const draftA: CharacterDraft = { world: "arkham", phobia: "Мертвецы", name: "Агнес", gender: "f", race: "human", cls: "journalist", base: { ...arkham.rules.recommended.journalist! }, skills: ["Обман", "Архивы"] };
    const g = await newGame({ router: fakeRouter(), tier: "free", draft: draftA, rng: mulberry32(2), seed: "restyle" });
    const id = await createCampaign(db, uid, g);
    await v.prefetchVisuals(db, id, arkham, g.campaign);
    await drain(d);
    const bgId = g.campaign.locations.find((l) => l.imageId)!.imageId!;
    // Портрет Рут из старых данных мира: другой отпечаток описания, книга вместо блокнота.
    const ruth = arkham.cast!.allies.find((m) => m.id === "ashworth")!;
    const [old] = await db
      .insert(images)
      .values({ kind: "npc", job: { world: "arkham", type: "portrait", description: "woman with a book", seed: 1 }, tags: ["cast:arkham:ashworth:old"], prompt: "", model: "", status: "ready", url: "/api/images/npc/old.webp" })
      .returning({ id: images.id });
    const heroOpts = await v.createHeroOptions(db, fakeRouter(), uid, { world: "arkham", race: "human", cls: "journalist", gender: "f" }, "");
    await drain(d);

    expect((await v.restyleImages(db, "arkham", { dryRun: true })).background).toBeGreaterThan(0);
    const counts = await v.restyleImages(db, "arkham");
    expect(counts.npc).toBeGreaterThan(0);
    expect(counts.hero).toBeUndefined();
    const row = async (iid: string) => (await db.select().from(images).where(eq(images.id, iid)))[0]!;
    expect((await row(bgId)).status).toBe("queued");
    expect((await row(bgId)).tags).toContain(v.PREFETCH_TAG);
    expect((await row(heroOpts[0]!.id)).status).toBe("ready");
    const ruthRow = await row(old!.id);
    expect((ruthRow.job as { description: string }).description).toBe(ruth.portrait);
    expect(ruthRow.tags).toContain(v.castTag(arkham, ruth));
    await drain(d);
    const bg = await row(bgId);
    expect(bg.status).toBe("ready");
    expect(bg.url).toMatch(/^\/api\/images\/bg\/.+-r1\.webp$/);
    // Вторая перерисовка — следующий ключ.
    await v.restyleImages(db, "arkham");
    await drain(d);
    expect((await row(bgId)).url).toMatch(/-r2\.webp$/);
  }, 20_000); // дважды прогоняет всю очередь мира — дольше 5 с по умолчанию
  it("закрытие дела: герой в широкой иллюстрации, задача не дублируется и переживает загрузку", async () => {
    const d = await deps();
    await drain(d);
    const uid = crypto.randomUUID();
    await ensureUser(db, uid);
    const arkham = getWorld("arkham");
    const draftA: CharacterDraft = { world: "arkham", phobia: "Мертвецы", name: "Агнес", gender: "f", race: "human", cls: "journalist", base: { ...arkham.rules.recommended.journalist! }, skills: ["Обман", "Архивы"] };
    const g = await newGame({ router: fakeRouter(), tier: "free", draft: draftA, rng: mulberry32(6), seed: "moment" });
    const id = await createCampaign(db, uid, g);
    const c = await loadCampaign(db, uid, id);
    const opts = await v.createHeroOptions(db, fakeRouter(), uid, { world: "arkham", race: "human", cls: "journalist", gender: "f" }, "");
    await drain(d);
    await v.attachHeroPortrait(db, uid, c.characterId, opts[0]!.id);

    const out = await playTurn(dpsFake(), c.state, c.recent, { kind: "close", answers: { a1: "Кит Ларкин отравил тётю ради наследства" } });
    await v.prepareVisuals(db, id, out.state, out.records);
    const close = out.records.find((r) => r.kind === "close")!;
    const moment = close.moment!;
    expect(moment.type).toBe("case-close");
    expect(moment.imageId).toBeTruthy();
    let scene = await v.sceneView(db, id, c.characterId, out.state.campaign);
    expect(scene.moments[moment.imageId]!.status).toBe("queued");

    // Повторная подготовка того же хода возвращает ту же строку, а не новую генерацию.
    await v.prepareVisuals(db, id, out.state, out.records);
    expect(close.moment).toEqual(moment);
    await saveTurn(db, c, out.state, out.records);
    await drain(d);

    scene = await v.sceneView(db, id, c.characterId, out.state.campaign);
    expect(scene.moments[moment.imageId]).toMatchObject({ status: "ready", url: expect.stringMatching(/^\/api\/images\/moment\/.+\.webp$/) });
    const [img] = await db.select().from(images).where(eq(images.id, moment.imageId));
    expect(img!.job).toMatchObject({ type: "moment", moment: "case-close", base: opts[0]!.id });
    expect(img!.prompt).toContain("wide cinematic 16:9");
    expect(img!.prompt).toContain("a woman newspaper reporter");
    expect((await campaignTurns(db, id)).at(-1)!.moment).toEqual(moment);
  }, 20_000);

  it("эмоции: лицо рисуется правкой готового портрета; ждёт портрет; у жителей лимит, у своих — один раз на мир", async () => {
    const d = await deps();
    await drain(d);
    const uid = crypto.randomUUID();
    await ensureUser(db, uid);
    const arkham = getWorld("arkham");
    const draftA: CharacterDraft = { world: "arkham", phobia: "Мертвецы", name: "Агнес", gender: "f", race: "human", cls: "journalist", base: { ...arkham.rules.recommended.journalist! }, skills: ["Обман", "Архивы"] };
    const g = await newGame({ router: fakeRouter(), tier: "free", draft: draftA, rng: mulberry32(3), seed: "emo" });
    const id = await createCampaign(db, uid, g);
    const c = await loadCampaign(db, uid, id);
    // Новый NPC: портрет ещё в очереди — вариант встаёт за ним и ждёт, попытку не тратит.
    await v.ensureNpc(db, id, arkham, { name: "Кит Ларкин", race: "human", gender: "m", role: "слуга", look: "худой, бледный" });
    const fear = await v.ensureEmotion(db, id, arkham, "Кит", "fear");
    expect(fear).toBeTruthy();
    expect(await v.ensureEmotion(db, id, arkham, "Кит", "fear")).toBe(fear); // тот же вариант, не второй
    const [npc] = await db.select().from(npcs).where(eq(npcs.campaignId, id));
    await db.update(images).set({ status: "working" }).where(eq(images.id, npc!.portraitImageId!));
    expect(await v.processOne(d)).toBe(true); // берёт вариант: портрет «рисуется»
    const row = async (iid: string) => (await db.select().from(images).where(eq(images.id, iid)))[0]!;
    expect((await row(fear!)).status).toBe("queued");
    expect((await row(fear!)).attempts).toBe(0);
    await db.update(images).set({ status: "queued" }).where(eq(images.id, npc!.portraitImageId!));
    let scene = await v.sceneView(db, id, c.characterId, g.campaign);
    expect(scene.variantsPending).toBe(true);
    await drain(d);
    scene = await v.sceneView(db, id, c.characterId, g.campaign);
    expect(scene.npcs["кит ларкин"]!.emotions?.fear).toMatch(/^\/api\/images\/emo\/.+\.webp$/);
    expect(scene.variantsPending).toBeUndefined();
    const fearRow = await row(fear!);
    expect(fearRow.campaignId).toBe(id);
    const { lookFromPrompt } = await import("@ash/images");
    const look = lookFromPrompt(arkham, (await row(npc!.portraitImageId!)).prompt);
    expect(look.length).toBeGreaterThan(5);
    expect(fearRow.prompt).toContain(look); // облик — из промпта портрета
    // Лимит жителя — две разные эмоции; чужое слово — ничего.
    expect(await v.ensureEmotion(db, id, arkham, "Кит Ларкин", "anger")).toBeTruthy();
    expect(await v.ensureEmotion(db, id, arkham, "Кит Ларкин", "joy")).toBeNull();
    expect(await v.ensureEmotion(db, id, arkham, "Кит Ларкин", "ярость")).toBeNull();
    // Чудовищу эмоций нет; незнакомцу без портрета — тоже.
    await v.ensureNpc(db, id, arkham, { name: "Тварь из колодца", race: "human", gender: "m", role: "чудовище", look: "щупальца", creature: true });
    expect(await v.ensureEmotion(db, id, arkham, "Тварь из колодца", "anger")).toBeNull();
    expect(await v.ensureEmotion(db, id, arkham, "Никто", "fear")).toBeNull();
    // Свои: портрет общий на мир — и эмоция тоже: во второй кампании та же картинка.
    await v.prefetchVisuals(db, id, arkham, g.campaign);
    const id2 = await createCampaign(db, uid, g);
    await v.prefetchVisuals(db, id2, arkham, structuredClone(g.campaign));
    const hattie = await v.ensureEmotion(db, id, arkham, "Хэтти", "sorrow");
    expect(hattie).toBeTruthy();
    expect(await v.ensureEmotion(db, id2, arkham, "Хэтти Колдуэлл", "sorrow")).toBe(hattie);
    expect((await row(hattie!)).campaignId).toBeNull();
    for (const e of ["fear", "anger", "joy"]) expect(await v.ensureEmotion(db, id, arkham, "Хэтти", e)).toBeTruthy(); // у своих лимита нет
    await drain(d);
    // В фэнтези эмоций нет.
    expect(await v.ensureEmotion(db, id, getWorld("fantasy"), "Кит", "fear")).toBeNull();
  }, 20_000);

  it("эмоции после хода: реплики с эмоцией → варианты лица; лицо героя — по состоянию, про запас заранее", async () => {
    const d = await deps();
    await drain(d);
    const uid = crypto.randomUUID();
    await ensureUser(db, uid);
    const arkham = getWorld("arkham");
    const draftA: CharacterDraft = { world: "arkham", phobia: "Мертвецы", name: "Агнес", gender: "f", race: "human", cls: "journalist", base: { ...arkham.rules.recommended.journalist! }, skills: ["Обман", "Архивы"] };
    const g = await newGame({ router: fakeRouter(), tier: "free", draft: draftA, rng: mulberry32(4), seed: "emo2" });
    const id = await createCampaign(db, uid, g);
    const c = await loadCampaign(db, uid, id);
    const opts = await v.createHeroOptions(db, fakeRouter(), uid, { world: "arkham", race: "human", cls: "journalist", gender: "f" }, "");
    await drain(d);
    await v.attachHeroPortrait(db, uid, c.characterId, opts[0]!.id);
    const early: string[] = [];
    const reply = {
      speaker: { name: "Мэри Хоу", race: "human", gender: "f", role: "вдова", look: "чёрное платье" },
      beats: [
        { speaker: null, emotion: "страх", text: "Свеча гаснет." },
        { speaker: "Мэри Хоу", emotion: "Страх", text: "Кто здесь?!" },
        { speaker: "Мэри Хоу", emotion: "ярость", text: "Уходите." },
      ],
    };
    const r = await playTurn(deps0({ router: scriptedRouter([reply]), onEmotion: (n, e) => early.push(`${n}|${e}`) }), c.state, c.recent, { kind: "start" });
    expect(r.records[0]!.beats.map((b) => b.emotion)).toEqual([undefined, "fear", undefined]);
    expect(early).toEqual(["Мэри Хоу|fear"]);
    r.state.character.hp = Math.floor(r.state.character.hpMax / 3); // ранен
    await v.prepareVisuals(db, id, r.state, r.records);
    await drain(d);
    const scene = await v.sceneView(db, id, c.characterId, r.state.campaign);
    expect(Object.keys(scene.npcs["мэри хоу"]!.emotions ?? {})).toEqual(["fear"]);
    // Ранен сейчас; рассудок цел — «на грани» и «срыв» не рисуются.
    expect(Object.keys(scene.heroMoods ?? {})).toEqual(["wounded"]);
    // Рассудок на половине — «на грани» и «срыв» про запас.
    r.state.character.sanity = Math.floor(r.state.character.sanityMax! / 2);
    await v.prepareVisuals(db, id, r.state, []);
    await drain(d);
    expect(Object.keys((await v.sceneView(db, id, c.characterId, r.state.campaign)).heroMoods ?? {}).sort()).toEqual(["breakdown", "edge", "wounded"]);
    // Перерисовка мира с героями: варианты лица — снова в очередь вместе со своими портретами.
    const counts = await v.restyleImages(db, "arkham", { heroes: true, dryRun: true });
    expect(counts.emotion).toBeGreaterThanOrEqual(4);
  }, 20_000);
});
