import { describe, expect, it } from "vitest";
import { heroMood, heroMoodsAhead } from "../src";

const hero = (o: Partial<{ hp: number; hpMax: number; sanity: number; sanityMax: number }> = {}) => ({ hp: 12, hpMax: 12, sanity: 12, sanityMax: 12, ...o });

describe("лицо героя по состоянию", () => {
  it("целый и в своём уме — нейтральный", () => {
    expect(heroMood(hero(), { turn: 5 })).toBeNull();
  });
  it("ранен — на трети здоровья и ниже, но не без сознания", () => {
    expect(heroMood(hero({ hp: 5 }), { turn: 5 })).toBeNull();
    expect(heroMood(hero({ hp: 4 }), { turn: 5 })).toBe("wounded");
    expect(heroMood(hero({ hp: 0 }), { turn: 5 })).toBeNull();
  });
  it("на грани важнее ран", () => {
    expect(heroMood(hero({ hp: 2, sanity: 4 }), { turn: 5 })).toBe("edge");
  });
  it("срыв — в ход срыва и ещё один после, важнее всего", () => {
    expect(heroMood(hero({ sanity: 6 }), { turn: 8, brokeAt: 7 })).toBe("breakdown");
    expect(heroMood(hero({ sanity: 6 }), { turn: 9, brokeAt: 7 })).toBe("breakdown");
    expect(heroMood(hero({ sanity: 6 }), { turn: 10, brokeAt: 7 })).toBeNull();
  });
  it("без рассудка (фэнтези) — только раны", () => {
    expect(heroMood({ hp: 3, hpMax: 12 }, { turn: 1 })).toBe("wounded");
    expect(heroMoodsAhead({ hp: 12, hpMax: 12 })).toEqual([]);
  });
  it("про запас — на половине здоровья или рассудка", () => {
    expect(heroMoodsAhead(hero({ hp: 7 }))).toEqual([]);
    expect(heroMoodsAhead(hero({ hp: 6 }))).toEqual(["wounded"]);
    expect(heroMoodsAhead(hero({ sanity: 6 }))).toEqual(["edge", "breakdown"]);
  });
});
