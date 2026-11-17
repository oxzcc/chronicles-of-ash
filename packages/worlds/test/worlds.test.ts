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
  it("запасной квест раскладывается без исправлений", () => {
    const camp = layoutCampaign(R, w.fallbackQuest, "t");
    const raw = w.fallbackQuest.locations as { type: string }[];
    expect(camp.locations.map((l) => l.type)).toEqual(raw.map((l) => l.type));
  });
  it("описание мира лежит на месте", () => {
    expect(existsSync(join(root, worldBiblePath(w.id)))).toBe(true);
  });
});
