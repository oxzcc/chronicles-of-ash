import { describe, expect, it } from "vitest";
import { effect } from "@ash/engine";
import { findQuote, resolveMarks, tagLast } from "../src/index";

const clue = effect.clue("c1", "На дне чашки — горький осадок.", "Осадок в чашке");
const addr = effect.address("L5", "Особняк доктора Хоу");
const mind = effect.sanity(-2);

describe("подсветка находок в репликах", () => {
  it("слова ищутся без учёта регистра и ё, берутся как в тексте", () => {
    expect(findQuote("На дне — Горький осадок.", "горький осадок.")).toBe("Горький осадок");
    expect(findQuote("Зелёный свет", "зеленый")).toBe("Зелёный");
    expect(findQuote("Тихо.", "шорох")).toBeNull();
    expect(findQuote("Тихо.", "ти")).toBeNull();
  });
  it("подсвечивается только принятое движком; адрес — и по названию", () => {
    const beats = resolveMarks(
      [
        { speaker: null, text: "Ты наклоняешь чашку: горький осадок на дне.", refs: [{ ref: "c1", quote: "горький осадок" }, { ref: "c3", quote: "на дне" }] },
        { speaker: "Мод", text: "Это записка доктора Хоу.", refs: [{ ref: "Особняк доктора Хоу", quote: "записка доктора Хоу" }] },
        { speaker: null, text: "Наверху хлопает дверь.", refs: [{ ref: "sanity", quote: "дверь стонет" }] },
      ],
      [clue, addr, mind],
    );
    expect(beats[0]).toEqual({ speaker: null, text: "Ты наклоняешь чашку: горький осадок на дне.", marks: [{ kind: "clue", quote: "горький осадок", label: "улика" }] });
    expect(beats[1]!.marks).toEqual([{ kind: "address", quote: "записка доктора Хоу", label: "адрес" }]);
    // Слова не нашлись — ярлык остаётся в той реплике, где мастер его поставил.
    expect(beats[2]!.marks).toEqual([{ kind: "sanity", quote: null, label: "рассудок −2" }]);
    expect(beats.some((b) => "refs" in b)).toBe(false);
  });
  it("находка без пометки — ярлыком в конце последней реплики рассказчика", () => {
    const beats = resolveMarks([{ speaker: null, text: "Ты обыскиваешь комнату." }, { speaker: "Мод", text: "Нашли что-нибудь?" }], [clue, effect.gold(5, "$5")]);
    expect(beats[0]!.marks).toEqual([{ kind: "clue", quote: null, label: "улика" }]);
    expect(beats[1]!.marks).toBeUndefined();
    expect(tagLast([{ speaker: "Мод", text: "Ох." }], [effect.deduction("c9", "Кит — отравитель")])[0]!.marks).toEqual([{ kind: "deduction", quote: null, label: "вывод" }]);
    expect(tagLast([{ speaker: null, text: "Ох." }], [effect.item("Ключ")])[0]!.marks).toBeUndefined();
  });
});
