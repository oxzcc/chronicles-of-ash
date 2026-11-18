import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkable, classKeys, layoutCampaign, locationTypeKeys, pointsSpent, POINT_BUY_BUDGET, raceKeys, skillNames, startLocationTypes, STAT_KEYS,
} from "@ash/engine";
import { DEFAULT_WORLD, getWorld, isWorldId, worldBiblePath, worldOf, WORLDS } from "../src/index";

const root = join(import.meta.dirname, "..", "..", "..");

describe("реестр миров", () => {
  it("id уникальны, мир по умолчанию есть", () => {
    expect(new Set(WORLDS.map((w) => w.id)).size).toBe(WORLDS.length);
    expect(isWorldId(DEFAULT_WORLD)).toBe(true);
    expect(() => getWorld("nope")).toThrow();
  });
  it("лист без мира — мир по умолчанию", () => {
    expect(worldOf({}).id).toBe(DEFAULT_WORLD);
    expect(worldOf({ world: "fantasy" }).id).toBe("fantasy");
  });
});

/** Данные мира пишутся руками — эти проверки ловят опечатки до того, как их найдёт игрок. */
describe.each(WORLDS.map((w) => [w.id, w] as const))("мир %s", (_id, w) => {
  const R = w.rules;
  it("id правил совпадает с id мира", () => expect(R.id).toBe(w.id));
  it("у каждого класса есть рекомендуемые характеристики в пределах 27 очков", () => {
    for (const k of classKeys(R)) {
      const s = R.recommended[k];
      expect(s, k).toBeDefined();
      for (const st of STAT_KEYS) expect(s![st]).toBeGreaterThanOrEqual(8), expect(s![st]).toBeLessThanOrEqual(15);
      expect(pointsSpent(s!)).toBeLessThanOrEqual(POINT_BUY_BUDGET);
    }
  });
  it("навыки классов, бегства и примера варианта существуют", () => {
    for (const k of classKeys(R)) for (const s of R.classes[k]!.skills) expect(skillNames(R), `${k}: ${s}`).toContain(s);
    expect(skillNames(R)).toContain(R.fleeSkill);
    expect(checkable(R)).toContain(w.gm.suggestionExample.skill);
    // Класс даёт навыки, игрок выбирает ещё 2 — значит, свободных навыков должно хватать.
    for (const k of classKeys(R)) expect(skillNames(R).length - R.classes[k]!.skills.length).toBeGreaterThanOrEqual(2);
  });
  it("имена есть для каждой расы и пола", () => {
    for (const r of raceKeys(R)) {
      expect(R.names[r]?.m.length, r).toBeGreaterThan(0);
      expect(R.names[r]?.f.length, r).toBeGreaterThan(0);
    }
  });
  it("типы мест согласованы", () => {
    const types = locationTypeKeys(R);
    expect(types).toContain(R.defaultLocationType);
    expect(startLocationTypes(R)).toContain(R.defaultStartType);
    for (const t of types) expect(w.art.locationEn[t], t).toBeTruthy();
    for (const t of w.art.interiorTypes) expect(types).toContain(t);
    for (const k of classKeys(R)) expect(w.art.classEn[k], k).toBeTruthy();
  });
  it("LoRA стиля: триггер одним словом-сочетанием, префикс без описания техники", () => {
    if (!w.art.lora) return;
    expect(w.art.lora.trigger).toMatch(/^[a-z0-9]+( [a-z0-9]+)?$/);
    expect(w.art.lora.stylePrefix).toMatch(/no text/);
  });
  it("запасной квест раскладывается без исправлений", () => {
    const camp = layoutCampaign(R, w.fallbackQuest, "t");
    const raw = w.fallbackQuest.locations as { type: string }[];
    expect(camp.locations.map((l) => l.type)).toEqual(raw.map((l) => l.type));
  });
  it("описание мира лежит на месте", () => {
    expect(existsSync(join(root, worldBiblePath(w.id)))).toBe(true);
  });
});

describe("постоянные лица мира", () => {
  it("у Аркхэма: уникальные id и имена, внешность по-русски, описание портрета по-английски с полом", async () => {
    const { getWorld } = await import("../src/index");
    const cast = getWorld("arkham").cast!;
    const all = [cast.mentor, ...cast.allies];
    expect(all).toHaveLength(7);
    expect(new Set(all.map((m) => m.id)).size).toBe(all.length);
    expect(new Set(all.map((m) => m.name)).size).toBe(all.length);
    for (const m of all) {
      expect(m.id, m.name).toMatch(/^[a-z]+$/);
      expect(m.look, m.name).toMatch(/[а-я]/);
      expect(m.portrait, m.name).not.toMatch(/[а-яё]/i);
      // Пол — прямо в существительном, как в подписях датасета LoRA («a woman newspaper reporter»).
      expect(m.portrait, m.name).toMatch(m.gender === "f" ? /^an? [^,]*\bwoman\b/ : /^an? [^,]*\bman\b/);
      expect(m.label, m.name).toContain(m.name.split(" ").at(-1)!);
    }
    expect(getWorld("fantasy").cast).toBeUndefined();
  });
});


describe("телосложение мира", () => {
  it("у Аркхэма: веса положительные, слова по-английски, у героя — четыре разные фигуры", async () => {
    const { getWorld } = await import("../src/index");
    const fig = getWorld("arkham").art.figures!;
    for (const opts of [fig.young.f, fig.young.m, fig.elderly.f, fig.elderly.m])
      for (const o of opts) {
        expect(o.weight, o.en).toBeGreaterThan(0);
        expect(o.en).not.toMatch(/[а-яё]/i);
      }
    for (const g of ["f", "m"] as const) {
      expect(fig.hero[g]).toHaveLength(4);
      expect(new Set(fig.hero[g]).size).toBe(4);
      for (const h of fig.hero[g]) expect(h).not.toMatch(/[а-яё]/i);
    }
    // Одна героиня — с талией и изгибами, одна — полная целиком, две — без форм.
    expect(fig.hero.f.filter((h) => /bust/.test(h))).toHaveLength(1);
    expect(fig.hero.f.filter((h) => /plump/.test(h))).toHaveLength(1);
  });
});

describe("наряды героя", () => {
  it("у каждого класса — четыре разных наряда по-английски, первый совпадает с classEn", async () => {
    const { WORLDS } = await import("../src/index");
    for (const w of WORLDS) {
      const outfits = w.art.heroOutfitsEn;
      if (!outfits) continue;
      for (const [cls, en] of Object.entries(w.art.classEn)) {
        const list = outfits[cls];
        expect(list, `${w.id}/${cls}`).toHaveLength(4);
        expect(new Set(list).size).toBe(4);
        expect(list![0]).toBe(en);
        for (const o of list!) expect(o).not.toMatch(/[а-яё]/i);
      }
    }
  });
});
