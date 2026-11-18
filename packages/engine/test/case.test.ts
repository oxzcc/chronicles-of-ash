import { describe, expect, it } from "vitest";
import { getWorld } from "@ash/worlds";
import {
  applyCaseChanges, closeCase, deductionCandidates, effect, layoutCase, lookup, markDeduction, mulberry32, publicCampaign, travelCase, type CaseSeed,
} from "../src/index";

const W = getWorld("arkham");
const R = W.rules;
const seed = W.fallbackCase!;
const fresh = () => layoutCase(R, seed, "s");

describe("дело: раскладка", () => {
  it("улики, выводы, вопросы, известные места и путь наставника", () => {
    const w = fresh();
    const c = w.case!;
    expect(c.clues.filter((x) => !x.requires)).toHaveLength(8);
    expect(c.clues.filter((x) => x.requires).map((x) => x.requires)).toEqual([["c1", "c2", "c3"], ["c4", "c6"]]);
    expect(c.questions.map((q) => q.points)).toEqual([20, 10, 10]);
    // Старт, общественные (участок, морг, библиотека) и дом Вейлов из завязки; бар, особняк Хоу и подвал — нет.
    expect(c.known.sort()).toEqual(["L0", "L1", "L2", "L3", "L6"]);
    expect(c.par).toBe(4); // Дом Вейлов, морг, бар, особняк Хоу
    expect(c.limit).toBe(10);
    expect(w.target).toBe("");
  });
  it("жители: пол и внешность — для портретов заранее; битые поля отбрасываются", () => {
    const people = [
      { name: "Эзра Кроу", role: "могильщик", gender: "m", look: "старик с лопатой", at: 1 },
      { name: "Мод", role: "вдова", gender: "?", look: 42, at: 1 },
    ];
    const c = layoutCase(R, { ...seed, people } as CaseSeed, "s").case!;
    expect(c.people[0]).toMatchObject({ name: "Эзра Кроу", gender: "m", look: "старик с лопатой" });
    expect(c.people[1]!.gender).toBeUndefined();
    expect(c.people[1]!.look).toBeUndefined();
  });
  it("битое дело не собирается, битые улики отбрасываются", () => {
    expect(() => layoutCase(R, { ...seed, truth: "" }, "s")).toThrow();
    expect(() => layoutCase(R, { ...seed, questions: [] }, "s")).toThrow();
    const w = layoutCase(R, { ...seed, clues: [...(seed.clues as any[]), { text: "мимо", at: 99 }, { at: 1 }] } as CaseSeed, "s");
    expect(w.case!.clues.filter((x) => !x.requires)).toHaveLength(8);
  });
  it("без ключевых улик ключевыми становятся первые три", () => {
    const w = layoutCase(R, { ...seed, clues: (seed.clues as any[]).map((x) => ({ ...x, key: false })) }, "s");
    expect(w.case!.clues.filter((x) => x.key).map((x) => x.id)).toEqual(["c1", "c2", "c3"]);
  });
});

describe("дело: ходы", () => {
  it("переход — только по известным адресам, каждый визит на счету, время кончается", () => {
    const w = fresh();
    expect(() => travelCase(R, w, "L4", mulberry32(1))).toThrow(/не знаешь/);
    expect(() => travelCase(R, w, "L0", mulberry32(1))).toThrow(/и так здесь/);
    travelCase(R, w, "L1", mulberry32(1));
    expect(w.case!.visits).toBe(1);
    w.case!.visits = w.case!.limit - 1;
    expect(travelCase(R, w, "L2", mulberry32(1)).timeUp).toBe(true);
    expect(() => travelCase(R, w, "L3", mulberry32(1))).toThrow(/Время вышло/);
  });
  it("улика находится только там, где лежит, не больше двух за ход; вывод так не находится", () => {
    const w = fresh();
    w.current = "L1";
    const r = applyCaseChanges(w, { clues: ["c1", "c2", "c4", "c9", "c99"], reveal: ["L5", "L77"] });
    expect(r.clues).toEqual(["c1", "c4"]);
    expect(r.rejected.join()).toMatch(/c2 лежит не здесь/);
    expect(r.rejected.join()).toMatch(/c9 — вывод/);
    expect(r.rejected.join()).toMatch(/неизвестная улика c99/);
    expect(r.revealed).toEqual(["L5"]);
    expect(r.rejected.join()).toMatch(/нет места L77/);
    // Плашки — только принятое: две улики этого места и новый адрес.
    expect(r.effects.map((e) => [e.kind, e.ref])).toEqual([["clue", "c1"], ["clue", "c4"], ["address", "L5"]]);
    // Плашка — короткое название улики, полный текст — в detail.
    expect(r.effects[0]).toMatchObject({ text: "Осадок в чайной чашке", detail: w.case!.clues.find((x) => x.id === "c1")!.text });
    expect(publicCampaign(w).case!.clues.find((x) => x.id === "c1")!.title).toBe("Осадок в чайной чашке");
    // Без названия (старые дела) — весь текст.
    expect(effect.clue("c2", "Текст улики")).toEqual({ kind: "clue", text: "Текст улики", good: true, ref: "c2" });
  });
  it("reveal по названию: мастер написал «Бакалея» вместо L4 — место открывается, если подходит ровно одно", () => {
    const w = fresh();
    const r = applyCaseChanges(w, { reveal: ["Бакалея ", "особняк доктора Хоу", "Ки", "Ратуша"] });
    expect(r.revealed).toEqual(["L4", "L5"]);
    expect(r.rejected).toEqual(["reveal: нет места Ки", "reveal: нет места Ратуша"]);
  });
  it("справочник: по фамилии, имени или названию; открывает адрес", () => {
    const w = fresh();
    expect(lookup(w, "Финнеган")).toMatchObject({ person: { name: "Тео Финнеган" }, place: "L4", revealed: true });
    expect(lookup(w, "финнеган")!.revealed).toBe(false);
    expect(lookup(w, "доктор Хоу")?.place).toBe("L5");
    expect(lookup(w, "Подвал под старой мельницей")?.place).toBe("L7");
    expect(lookup(w, "Ктулху")).toBeNull();
    expect(lookup(w, "Ки")).toBeNull();
    // Общими словами место не угадать — только по названию или имени владельца.
    expect(lookup(w, "подвал")).toBeNull();
    expect(lookup(w, "особняк")).toBeNull();
    expect(lookup(w, "Бакалея Финнегана")?.place).toBe("L4");
    expect(lookup(w, "Ларкина")?.person?.name).toBe("Кит Ларкин");
  });
  it("вывод доступен, когда найдены все его улики", () => {
    const w = fresh();
    expect(deductionCandidates(w)).toHaveLength(0);
    for (const id of ["c1", "c2", "c3"]) w.case!.clues.find((x) => x.id === id)!.found = true;
    expect(deductionCandidates(w).map((d) => d.id)).toEqual(["c9"]);
    markDeduction(w, "c9");
    expect(deductionCandidates(w)).toHaveLength(0);
    expect(() => markDeduction(w, "c10")).toThrow();
  });
  it("потерянный рассудок стоит очков", () => {
    const w = fresh();
    w.case!.sanityLost = 3;
    expect(closeCase(w, [{ id: "a1", answer: "Кит", verdict: "right" }])).toMatchObject({ points: 20, sanityPenalty: 6, score: 14 });
  });
  it("счёт: очки за ответы, штраф за лишние визиты, наставник — максимум", () => {
    const w = fresh();
    w.case!.visits = 6; // путь наставника — 4
    const r = closeCase(w, [{ id: "a1", answer: "Кит", verdict: "right" }, { id: "a2", answer: "?", verdict: "partial" }]);
    expect(r).toMatchObject({ points: 25, max: 40, penalty: 6, sanityPenalty: 0, score: 19, mentor: 40, timeUp: false });
    expect(r.answers[2]).toMatchObject({ id: "a3", verdict: "wrong" });
    expect(w.complete).toBe(true);
    expect(() => closeCase(w, [])).toThrow(/закрыто/);
  });
});

describe("дело: что видит клиент", () => {
  it("без разгадки, ответов, ненайденных улик и неизвестных мест", () => {
    const w = fresh();
    w.case!.clues[0]!.found = true;
    const pub = publicCampaign(w);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("наперстянкой ради наследства"); // разгадка и ответы
    expect(json).not.toContain("Особняк доктора Хоу"); // неизвестное место
    expect(json).not.toContain("пустой футляр"); // ненайденная улика
    expect(json).toContain("горький зеленоватый осадок"); // найденная
    expect(pub.case!.questions[0]).toEqual({ id: "a1", text: "Кто виновен в смерти миссис Вейл и зачем?", points: 20 });
    expect(pub.case!.people.map((p) => p.name)).not.toContain("Арчибальд Хоу");
    expect(pub.locations.map((l) => l.id).sort()).toEqual(["L0", "L1", "L2", "L3", "L6"]);
  });
  it("после закрытия — разбор целиком", () => {
    const w = fresh();
    closeCase(w, [{ id: "a1", answer: "Кит", verdict: "right" }]);
    const pub = publicCampaign(w);
    expect(pub.case!.reveal?.truth).toMatch(/Кит Ларкин/);
    expect(pub.case!.reveal?.answers.a2).toMatch(/Хоу/);
  });
  it("у фэнтези кампания не меняется", async () => {
    const { layoutCampaign } = await import("../src/index");
    const f = getWorld("fantasy");
    const w = layoutCampaign(f.rules, f.fallbackQuest, "s");
    expect(publicCampaign(w)).toBe(w);
  });
});
