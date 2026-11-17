import { describe, expect, it } from "vitest";
import {
  applyChanges, createCharacter, layoutCampaign, mulberry32, neighbors, normalizeEnemies, playerMove, pointsSpent,
  rollExpr, scriptedRng, skillCheck, startCombat, travel, validateDraft, knockOut, isDiceExpr, sheetText, isUnhinged, breakDown,
  type CharacterDraft, type QuestSeed,
} from "../src/index";
// Движок проверяется на правилах настоящего мира: так тесты ловят и ошибки в данных мира.
import { getWorld } from "@ash/worlds";

const R = getWorld("fantasy").rules;

const draft = (over: Partial<CharacterDraft> = {}): CharacterDraft => ({
  name: "Альдрик", gender: "m", race: "human", cls: "fighter",
  base: { ...R.recommended.fighter! }, skills: ["Внимательность", "Запугивание"], ...over,
});

const quest: QuestSeed = {
  questTitle: "Пепел над Чернолесьем",
  hook: "В деревне пропадают люди.",
  objectives: ["Расспросить жителей", "Найти источник дыма", "Остановить похитителя"],
  locations: [
    { name: "Таверна", type: "tavern", desc: "" }, { name: "Брод", type: "village", desc: "" },
    { name: "Тракт", type: "road", desc: "" }, { name: "Лагерь", type: "camp", desc: "" },
    { name: "Чернолесье", type: "forest", desc: "" }, { name: "Топи", type: "swamp", desc: "" },
    { name: "Башня", type: "ruins", desc: "" }, { name: "Пещера", type: "cave", desc: "" },
  ],
  target: 7,
};

describe("кубики", () => {
  it("формулы", () => {
    expect(isDiceExpr("1d8+3")).toBe(true);
    expect(isDiceExpr("100d6")).toBe(false);
    expect(isDiceExpr("rm -rf")).toBe(false);
    const r = rollExpr("2d6+1", mulberry32(1));
    expect(r.rolls).toHaveLength(2);
    expect(r.total).toBe(r.rolls[0]! + r.rolls[1]! + 1);
    expect(rollExpr("1d6", mulberry32(1), true).rolls).toHaveLength(2);
  });
});

describe("персонаж", () => {
  it("рекомендуемые характеристики укладываются в 27 очков", () => {
    for (const s of Object.values(R.recommended)) expect(pointsSpent(s)).toBeLessThanOrEqual(27);
  });
  it("создаётся с бонусами расы, HP и КД", () => {
    const c = createCharacter(R, draft(), mulberry32(1));
    expect(c.stats.str).toBe(16);
    expect(c.hpMax).toBe(10 + 2); // d10 + ТЕЛ 15 (+2)
    expect(c.ac).toBe(16); // тяжёлый доспех без ЛОВ
    expect(c.skills).toEqual(["Атлетика", "Внимательность", "Запугивание"]);
    expect(c.gold).toBeGreaterThanOrEqual(11);
    expect(c.world).toBe("fantasy");
  });
  it("ловит нарушения", () => {
    expect(validateDraft(R, draft({ name: " " }))).toContain("Дай герою имя.");
    expect(validateDraft(R, draft({ base: { str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 } })).join()).toMatch(/27/);
    expect(validateDraft(R, draft({ skills: ["Атлетика", "Обман"] })).join()).toMatch(/уже даёт класс/);
    expect(validateDraft(R, draft({ skills: ["Обман"] })).join()).toMatch(/ровно 2/);
  });
});

describe("проверки", () => {
  const c = createCharacter(R, draft(), mulberry32(1));
  it("20 — успех даже против СЛ 25, 1 — провал", () => {
    expect(skillCheck(R, c, { skill: "Магия", dc: 25 }, scriptedRng([20])).crit).toBe("success");
    const fail = skillCheck(R, c, { skill: "Атлетика", dc: 5 }, scriptedRng([1]));
    expect(fail.success).toBe(false);
  });
  it("владение навыком добавляет мастерство", () => {
    expect(skillCheck(R, c, { skill: "Атлетика", dc: 10 }, scriptedRng([10])).modifier).toBe(3 + 2);
    expect(skillCheck(R, c, { skill: "Магия", dc: 10 }, scriptedRng([10])).modifier).toBe(-1);
    expect(skillCheck(R, c, { skill: "Сила", dc: 10 }, scriptedRng([10])).modifier).toBe(3);
  });
  it("преимущество и помеха", () => {
    expect(skillCheck(R, c, { skill: "Атлетика", dc: 10, edge: "advantage" }, scriptedRng([3, 17])).d20).toBe(17);
    expect(skillCheck(R, c, { skill: "Атлетика", dc: 10, edge: "disadvantage" }, scriptedRng([3, 17])).d20).toBe(3);
  });
  it("СЛ ограничивается", () => {
    expect(skillCheck(R, c, { skill: "Атлетика", dc: 99 }, scriptedRng([10])).dc).toBe(25);
  });
});

describe("изменения с ограничениями", () => {
  it("режет золото, лишние предметы и несуществующие цели", () => {
    const c = createCharacter(R, draft(), mulberry32(1));
    const w = layoutCampaign(R, quest, "seed");
    const gold = c.gold;
    const r = applyChanges(R, c, w, { gold: 10000, addItems: ["А", "Б", "В", "Г"], questDone: ["q1", "q9"], hp: -999 });
    expect(c.gold).toBe(gold + 25);
    expect(r.added).toEqual(["А", "Б", "В"]);
    expect(r.questDone).toEqual(["q1"]);
    expect(c.hp).toBe(0);
    expect(r.rejected.length).toBe(3);
    expect(r.notes).toContain("+25 золота");
  });
  it("квест нельзя завершить, пока открыто больше одной цели", () => {
    const c = createCharacter(R, draft(), mulberry32(1));
    const w = layoutCampaign(R, quest, "seed");
    expect(applyChanges(R, c, w, { questComplete: true }).questComplete).toBe(false);
    const ok = applyChanges(R, c, w, { questDone: ["q1", "q2"], questComplete: true });
    expect(ok.questComplete).toBe(true);
    expect(w.objectives.every((o) => o.done)).toBe(true);
  });
  it("удаляет только то, что есть", () => {
    const c = createCharacter(R, draft(), mulberry32(1));
    const w = layoutCampaign(R, quest, "seed");
    const r = applyChanges(R, c, w, { removeItems: ["щит", "Корона"] });
    expect(r.removed).toEqual(["Щит"]);
    expect(r.rejected).toHaveLength(1);
  });
  it("поражение: 1 HP и половина золота", () => {
    const c = createCharacter(R, draft(), mulberry32(1));
    c.gold = 21;
    expect(knockOut(c).goldLost).toBe(10);
    expect(c.hp).toBe(1);
  });
});

describe("карта", () => {
  it("связная, старт и финал не соседи, раскладка детерминирована", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const w = layoutCampaign(R, quest, seed);
      const seen = new Set(["L0"]);
      const stack = ["L0"];
      while (stack.length) for (const n of neighbors(w, stack.pop()!)) if (!seen.has(n.id)) (seen.add(n.id), stack.push(n.id));
      expect(seen.size).toBe(8);
      expect(neighbors(w, "L0").some((l) => l.id === w.target)).toBe(false);
    }
    expect(layoutCampaign(R, quest, "x")).toEqual(layoutCampaign(R, quest, "x"));
  });
  it("переход только к соседям", () => {
    const w = layoutCampaign(R, quest, "seed");
    expect(() => travel(R, w, w.target, mulberry32(1))).toThrow();
    const n = neighbors(w, "L0")[0]!;
    const r = travel(R, w, n.id, mulberry32(1));
    expect(w.current).toBe(n.id);
    expect(typeof r.encounter).toBe("boolean");
  });
  it("отклоняет слишком маленький мир и чинит типы", () => {
    expect(() => layoutCampaign(R, { locations: [{}, {}] }, "s")).toThrow();
    const w = layoutCampaign(R, { ...quest, locations: (quest.locations as any[]).map((l) => ({ ...l, type: "spaceship" })) }, "s");
    expect(w.locations[0]!.type).toBe("village");
    expect(w.locations[1]!.type).toBe("road");
  });
});

describe("бой", () => {
  it("враги ограничены уровнем героя", () => {
    const [e] = normalizeEnemies([{ name: "Дракон", hp: 500, ac: 30, attack: 15, damage: "10d12+10" }], 1);
    expect(e).toMatchObject({ hp: 22, ac: 15, attack: 5, damage: "1d6+1" });
    expect(normalizeEnemies(Array(6).fill({ name: "Крыса" }), 1)).toHaveLength(3);
  });
  it("бой доходит до конца", () => {
    const rng = mulberry32(42);
    const c = createCharacter(R, draft(), rng);
    const start = startCombat(c, [{ name: "Гоблин", hp: 7, ac: 12, attack: 3, damage: "1d6" }], rng);
    let outcome = start.outcome;
    for (let i = 0; i < 50 && outcome === "ongoing"; i++) outcome = playerMove(R, start.state, c, "attack", rng).outcome;
    expect(["victory", "defeat"]).toContain(outcome);
  });
  it("нельзя пить зелье, которого нет", () => {
    const rng = mulberry32(3);
    const c = createCharacter(R, draft(), rng);
    c.items = [];
    const { state } = startCombat(c, [{ name: "Волк", hp: 11 }], scriptedRng([20, 1]));
    expect(() => playerMove(R, state, c, "potion", rng)).toThrow();
  });
});

describe("мир Аркхэма", () => {
  const A = getWorld("arkham").rules;
  const sleuth = (over: Partial<CharacterDraft> = {}): CharacterDraft => ({
    world: "arkham", name: "Уолтер", gender: "m", race: "human", cls: "detective",
    base: { ...A.recommended.detective! }, skills: ["Внимательность", "Психология"], phobia: "Темнота", ...over,
  });
  it("сыщик: без доспеха, доллары, аптечка, навыки своего мира", () => {
    const c = createCharacter(A, sleuth(), mulberry32(1));
    expect(c.world).toBe("arkham");
    expect(c.ac).toBe(12 + 2); // пальто + ЛОВ 16 (+3, но не больше +2)
    expect(c.items).toContain("Аптечка");
    expect(validateDraft(A, sleuth({ skills: ["Магия", "Психология"] })).join()).toMatch(/Неизвестный навык: Магия/);
    expect(validateDraft(A, sleuth({ race: "elf" }))).toContain("Неизвестная раса.");
    const w = layoutCampaign(A, getWorld("arkham").fallbackQuest, "s");
    expect(applyChanges(A, c, w, { gold: 7 }).notes).toContain("+$7");
    expect(applyChanges(A, c, w, { gold: -3 }).notes).toContain("-$3");
  });
  it("выстрел пишется своими словами, аптечка лечит", () => {
    const rng = mulberry32(11);
    const c = createCharacter(A, sleuth(), rng);
    const { state } = startCombat(c, [{ name: "Громила", hp: 20, ac: 5 }], scriptedRng([20, 1]));
    const step = playerMove(A, state, c, "attack", scriptedRng([15, 4, 1]));
    expect(step.events[0]!.text).toMatch(/Пуля попадает в «Громила»/);
    c.hp = 1;
    const heal = playerMove(A, state, c, "potion", scriptedRng([3, 3, 1]));
    expect(heal.events[0]!.text).toMatch(/перевязываешь раны/);
    c.items = c.items.filter((x) => !/аптечк/i.test(x));
    expect(() => playerMove(A, state, c, "potion", rng)).toThrow(/Аптечек не осталось/);
  });
  it("неизвестный тип места — улица, старт — контора", () => {
    const w = layoutCampaign(A, { ...getWorld("arkham").fallbackQuest, locations: (getWorld("arkham").fallbackQuest.locations as any[]).map((l) => ({ ...l, type: "tavern" })) }, "s");
    expect(w.locations[0]!.type).toBe("office");
    expect(w.locations[1]!.type).toBe("street");
  });
});

describe("рассудок", () => {
  const A = getWorld("arkham").rules;
  const draft = (over: Partial<CharacterDraft> = {}): CharacterDraft => ({
    world: "arkham", name: "Эдит", gender: "f", race: "human", cls: "professor",
    base: { ...A.recommended.professor! }, skills: ["Оккультизм", "Психология"], phobia: "Глубокая вода", ...over,
  });
  it("герой Аркхэма: рассудок от Мудрости, фобия обязательна и из списка", () => {
    const c = createCharacter(A, draft(), mulberry32(1));
    expect(c).toMatchObject({ sanity: 14, sanityMax: 14, phobia: "Глубокая вода" }); // МДР 15 (+2): 10 + 4
    expect(validateDraft(A, draft({ phobia: undefined }))).toContain("Выбери фобию героя.");
    expect(validateDraft(A, draft({ phobia: "Пауки-великаны" }))).toContain("Выбери фобию героя.");
    expect(sheetText(A, c)).toContain("Рассудок 14/14. Фобия: Глубокая вода.");
    expect(createCharacter(R, { ...draft(), world: "fantasy", race: "human", cls: "wizard", base: { ...R.recommended.wizard! }, skills: ["История", "Природа"] }, mulberry32(1)).sanity).toBeUndefined();
  });
  it("потеря за ход — не больше 4, прибавка — не больше 1; в фэнтези рассудка нет", () => {
    const c = createCharacter(A, draft(), mulberry32(1));
    const w = layoutCampaign(A, getWorld("arkham").fallbackQuest, "s");
    const r = applyChanges(A, c, w, { sanity: -9 });
    expect(r.sanity).toBe(-4);
    expect(r.notes).toContain("-4 рассудка");
    expect(applyChanges(A, c, w, { sanity: 5 }).sanity).toBe(1);
    const f = createCharacter(R, { name: "Бран", gender: "m", race: "human", cls: "fighter", base: { ...R.recommended.fighter! }, skills: ["Внимательность", "Запугивание"] }, mulberry32(1));
    expect(applyChanges(R, f, layoutCampaign(R, quest, "s"), { sanity: -2 }).rejected.join()).toMatch(/нет рассудка/);
  });
  it("на грани — треть и меньше; срыв возвращает половину", () => {
    const c = createCharacter(A, draft(), mulberry32(1));
    c.sanity = 5;
    expect(isUnhinged(c)).toBe(false);
    c.sanity = 4;
    expect(isUnhinged(c)).toBe(true);
    c.sanity = 0;
    expect(breakDown(c).restored).toBe(7);
    expect(c.sanity).toBe(7);
  });
});
