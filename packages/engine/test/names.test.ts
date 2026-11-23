import { describe, expect, it } from "vitest";
import { getWorld } from "@ash/worlds";
import { CASE_HUB_ID, findPlace, layoutCampaign, layoutCase, matchName, mulberry32, neighbors, sameName, storyMove } from "../src/index";

describe("имена: тот же ли человек", () => {
  it("короткое имя и падежи — тот же; лишнее слово — другой", () => {
    expect(sameName("Эзра", "Эзра Кроу")).toBe(true);
    expect(sameName("доктор Уэйкфилд", "доктор Сайлас Уэйкфилд")).toBe(true);
    expect(sameName("Тео Финнегана", "Тео Финнеган")).toBe(true);
    expect(sameName("Миссис Кроу", "Эзра Кроу")).toBe(false);
    expect(sameName("Старый Эзра", "Эзра Кроу")).toBe(false);
    expect(sameName("Человек в кепке", "Громила в кепке")).toBe(false);
    expect(sameName("Лорейн", "Лоренс Пайк")).toBe(false);
    expect(sameName("Марии Вейл", "Мария Вейл")).toBe(true);
    expect(sameName("Финнеганом", "Тео Финнеган")).toBe(true);
    // Должность без пола опускается, «миссис» — нет.
    expect(sameName("Доктор Хоу", "Арчибальд Хоу")).toBe(true);
    expect(sameName("Коронер Пайк", "доктор Лоренс Пайк")).toBe(true);
    expect(sameName("Миссис Хоу", "Арчибальд Хоу")).toBe(false);
    expect(sameName("Доктор", "доктор Лоренс Пайк")).toBe(true);
    expect(matchName("Доктор", ["доктор Сайлас Уэйкфилд", "доктор Лоренс Пайк"])).toBe(-1);
  });
  it("matchName: точное совпадение важнее, неоднозначное — новый человек", () => {
    const known = ["Эзра Кроу", "Джон Харроу", "Эдвард Харроу", "Харроу"];
    expect(matchName("эзра", known)).toBe(0);
    expect(matchName("Харроу", known)).toBe(3);
    expect(matchName("Харроу", known.slice(0, 3))).toBe(-1);
    expect(matchName("Человек в кепке", known)).toBe(-1);
  });
});

describe("переход по рассказу", () => {
  const F = getWorld("fantasy");
  const A = getWorld("arkham");
  it("место по id, полному названию и началу названия", () => {
    const w = layoutCase(A.rules, A.fallbackCase!, "s");
    const l = w.locations[4]!;
    expect(findPlace(w, l.id)).toBe(l);
    expect(findPlace(w, l.name.toUpperCase())).toBe(l);
    expect(findPlace(w, "нет такого места")).toBeUndefined();
  });
  it("квест: только к соседям; то же место — не переход", () => {
    const w = layoutCampaign(F.rules, F.fallbackQuest, "s");
    const start = w.current;
    expect(storyMove(F.rules, w, null, mulberry32(1))).toBeNull();
    expect(storyMove(F.rules, w, locName(w, start), mulberry32(1))).toBeNull();
    const far = w.locations.find((l) => l.id !== start && !neighbors(w, start).some((n) => n.id === l.id))!;
    expect(storyMove(F.rules, w, far.name, mulberry32(1))).toMatchObject({ error: expect.stringMatching(/нет прямой дороги/) });
    expect(w.current).toBe(start);
    const nb = neighbors(w, start)[0]!;
    expect(storyMove(F.rules, w, nb.name, mulberry32(1))).toMatchObject({ to: { id: nb.id } });
    expect(w.current).toBe(nb.id);
  });
  it("дело: по известному адресу и визит на счету; неизвестный адрес — нельзя; визиты кончились — нельзя", () => {
    const w = layoutCase(A.rules, A.fallbackCase!, "s");
    const unknown = w.locations.find((l) => !w.case!.known.includes(l.id))!;
    expect(storyMove(A.rules, w, unknown.id, mulberry32(1))).toMatchObject({ error: expect.stringMatching(/не знаешь/) });
    w.current = CASE_HUB_ID;
    const known = w.locations.find((l) => w.case!.known.includes(l.id) && l.id !== w.current)!;
    expect(storyMove(A.rules, w, known.name, mulberry32(1))).toMatchObject({ to: { id: known.id } });
    expect(w.case!.visits).toBe(1);
    w.case!.visits = w.case!.limit;
    const next = w.locations.find((l) => l.id !== w.current && w.case!.known.includes(l.id))!;
    expect(storyMove(A.rules, w, next.id, mulberry32(1))).toMatchObject({ error: expect.stringMatching(/Время вышло/) });
  });
});

const locName = (w: { locations: { id: string; name: string }[] }, id: string) => w.locations.find((l) => l.id === id)!.name;
