import { describe, expect, it } from "vitest";
import { getWorld } from "@ash/worlds";
import { buildScene } from "./scene";
import { FANTASY_SCENES } from "./scenes";
import { ARKHAM_SCENES } from "./scenes-arkham";

/** Сцены арены пишутся руками: герои, навыки и места должны существовать в своём мире. */
describe.each([FANTASY_SCENES, ARKHAM_SCENES].map((s) => [s.world, s] as const))("сцены арены: %s", (_w, set) => {
  it("собираются без ошибок и без подмены типов мест", () => {
    const R = getWorld(set.world).rules;
    expect(new Set(set.scenes.map((s) => s.id)).size).toBe(set.scenes.length);
    for (const s of set.scenes) {
      const b = buildScene(set, s);
      expect(b.character.world).toBe(set.world);
      expect(b.campaign.locations[s.at], s.id).toBeDefined();
      if (s.npc) expect(Object.keys(R.races), s.id).toContain(s.npc.race);
    }
    const raw = set.quest.locations as { type: string }[];
    expect(buildScene(set, set.scenes[0]!).campaign.locations.map((l) => l.type)).toEqual(raw.map((l) => l.type));
  });
});
