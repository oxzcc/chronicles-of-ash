import { afterEach, describe, expect, it, vi } from "vitest";
import type { CharacterDraft } from "@ash/engine";
import { getWorld } from "@ash/worlds";
import { draftKey, PregenStore, type GenProgress, type NewGameResult, type StartGame } from "../src/index";

const W = getWorld("arkham");
const draft: CharacterDraft = { world: "arkham", phobia: "Темнота", name: "Уолтер Грей", gender: "m", race: "human", cls: "detective", skills: ["Внимательность", "Психология"], base: { ...W.rules.recommended.detective! }, backstory: "Бывший полицейский." };
const p = (value: number): GenProgress => ({ value, phase: "thinking", label: "…", etaSec: 30 });

/** Генерация под управлением теста: прогресс и завершение — вручную. */
function controlled() {
  const runs: { signal: AbortSignal; onProgress: (p: GenProgress) => void; resolve: (r: NewGameResult) => void; reject: (e: unknown) => void; draft: CharacterDraft }[] = [];
  const start: StartGame = (o) =>
    new Promise<NewGameResult>((resolve, reject) => {
      runs.push({ ...o, resolve, reject });
      o.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  return { runs, start };
}
const result = { usedFallback: false } as NewGameResult;

afterEach(() => vi.useRealTimers());

describe("ранний старт дела", () => {
  it("ключ — то, что попадает в промпт: портрет и порядок навыков не важны, предыстория важна", () => {
    expect(draftKey(draft, "free")).toBe(draftKey({ ...draft, skills: ["Психология", "Внимательность"] }, "free"));
    expect(draftKey(draft, "free")).not.toBe(draftKey({ ...draft, backstory: "Другая." }, "free"));
    expect(draftKey(draft, "free")).not.toBe(draftKey(draft, "paid"));
  });
  it("старт забирает заготовку того же героя: прогресс с места и дальше", async () => {
    const { runs, start } = controlled();
    const s = new PregenStore(start);
    expect(s.begin("u", draft, "free")).toBe("started");
    expect(s.begin("u", { ...draft }, "free")).toBe("same");
    expect(runs).toHaveLength(1);
    runs[0]!.onProgress(p(0.4));
    const pending = s.take("u", draft, "free")!;
    expect(pending.progress?.value).toBe(0.4);
    const seen: number[] = [];
    pending.subscribe((x) => seen.push(x.value));
    runs[0]!.onProgress(p(0.7));
    runs[0]!.resolve(result);
    await expect(pending.result).resolves.toBe(result);
    expect(seen).toEqual([0.7]);
    expect(s.size).toBe(0);
  });
  it("герой изменился — старая заготовка отменяется, старт её не берёт", () => {
    const { runs, start } = controlled();
    const s = new PregenStore(start);
    s.begin("u", draft, "free");
    s.begin("u", { ...draft, backstory: "Новая." }, "free");
    expect(runs[0]!.signal.aborted).toBe(true);
    expect(runs).toHaveLength(2);
    expect(s.take("u", draft, "free")).toBeNull();
    expect(runs[1]!.signal.aborted).toBe(true);
    expect(s.size).toBe(0);
  });
  it("упавшая заготовка не выдаётся; следующая попытка начинает заново", async () => {
    const { runs, start } = controlled();
    const s = new PregenStore(start);
    s.begin("u", draft, "free");
    runs[0]!.reject(new Error("сеть"));
    await Promise.resolve();
    await Promise.resolve();
    expect(s.take("u", draft, "free")).toBeNull();
    expect(s.begin("u", draft, "free")).toBe("started");
  });
  it("невостребованная заготовка отменяется по таймеру; у разных игроков — свои", () => {
    vi.useFakeTimers();
    const { runs, start } = controlled();
    const s = new PregenStore(start, 1000);
    s.begin("a", draft, "free");
    s.begin("b", draft, "free");
    expect(s.size).toBe(2);
    vi.advanceTimersByTime(1001);
    expect(runs.every((r) => r.signal.aborted)).toBe(true);
    expect(s.size).toBe(0);
  });
});
