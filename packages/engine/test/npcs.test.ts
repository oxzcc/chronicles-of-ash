import { describe, expect, it } from "vitest";
import { applyNpcNotes, attitudeWord, findNpc, layoutCampaign, NPC_LIMITS, type Campaign } from "../src/index";
import { getWorld } from "@ash/worlds";

const R = getWorld("fantasy").rules;
const fresh = (): Campaign => layoutCampaign(R, getWorld("fantasy").fallbackQuest, "s");

describe("память о людях", () => {
  it("карточка у каждого, кто говорил; заметки о молчавших отклоняются", () => {
    const w = fresh();
    const r = applyNpcNotes(w, [{ name: "Годрик", role: "трактирщик" }], [{ name: "Годрик", voice: "басом, с присказками", told: ["в башне жгут огни"] }, { name: "Вейл", told: ["я всё видел"] }]);
    expect(w.memory).toHaveLength(1);
    expect(w.memory![0]).toMatchObject({ name: "Годрик", role: "трактирщик", voice: "басом, с присказками", attitude: 0, told: ["в башне жгут огни"], at: w.current });
    expect(r.rejected.join()).toMatch(/Вейл не говорил/);
  });
  it("отношение — на шаг за ход и в пределах −2…+2; манера речи — один раз", () => {
    const w = fresh();
    const s = [{ name: "Годрик" }];
    let r = applyNpcNotes(w, s, [{ name: "Годрик", voice: "басом", attitude: 3 }]);
    expect(findNpc(w, "Годрик")!.attitude).toBe(1);
    expect(r.effects).toEqual([{ kind: "attitude", text: "Годрик: расположен", good: true, ref: "Годрик", delta: 1 }]);
    expect(r.rejected.join()).toMatch(/урезано/);
    applyNpcNotes(w, s, [{ name: "Годрик", voice: "шёпотом", attitude: 1 }]);
    r = applyNpcNotes(w, s, [{ name: "Годрик", attitude: 1 }]);
    expect(findNpc(w, "Годрик")).toMatchObject({ attitude: 2, voice: "басом" });
    expect(r.effects).toEqual([]); // уже доверяет — сдвигать некуда
    expect(attitudeWord(-2)).toBe("враждебен");
  });
  it("показания: без повторов, не больше двух за ход, в памяти — последние шесть", () => {
    const w = fresh();
    const s = [{ name: "Мод Ларкин" }];
    applyNpcNotes(w, s, [{ name: "Мод", told: ["чай подавал Кит", "Чай подавал Кит", "хозяйка боялась сеансов", "лишнее"] }]);
    expect(findNpc(w, "Мод Ларкин")!.told).toEqual(["чай подавал Кит", "хозяйка боялась сеансов"]);
    for (let i = 0; i < 5; i++) applyNpcNotes(w, s, [{ name: "Мод Ларкин", told: [`факт ${i}`] }]);
    expect(findNpc(w, "Мод Ларкин")!.told).toHaveLength(NPC_LIMITS.told);
    expect(findNpc(w, "Мод Ларкин")!.told[0]).toBe("хозяйка боялась сеансов");
  });
  it("память не бесконечна: забываются давно не встречавшиеся", () => {
    const w = fresh();
    // Разные короткие имена: «Абв», «Абг»… (короткие слова сравниваются только целиком).
    const name = (i: number) => "Б" + "аеиоу"[i % 5] + "вгдклмн"[Math.floor(i / 5)];
    for (let i = 0; i < NPC_LIMITS.people + 3; i++) {
      w.turn = i;
      applyNpcNotes(w, [{ name: name(i) }], []);
    }
    expect(w.memory).toHaveLength(NPC_LIMITS.people);
    expect(findNpc(w, name(0))).toBeUndefined();
    expect(findNpc(w, name(NPC_LIMITS.people + 2))).toBeDefined();
  });
});
