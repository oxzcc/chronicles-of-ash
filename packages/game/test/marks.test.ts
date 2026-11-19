import { describe, expect, it } from "vitest";
import { effect, layoutCase, createCharacter, mulberry32 } from "@ash/engine";
import { getWorld } from "@ash/worlds";
import { findQuote, previewMarks, proposedFromFinds, resolveMarks, tagLast } from "../src/index";

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
    expect(beats[0]).toEqual({ speaker: null, text: "Ты наклоняешь чашку: горький осадок на дне.", marks: [{ kind: "clue", quote: "горький осадок", label: "улика", ref: "c1" }] });
    expect(beats[1]!.marks).toEqual([{ kind: "address", quote: "записка доктора Хоу", label: "адрес", ref: "L5" }]);
    // Слова не нашлись — ярлык остаётся в той реплике, где мастер его поставил.
    expect(beats[2]!.marks).toEqual([{ kind: "sanity", quote: null, label: "рассудок −2" }]);
    expect(beats.some((b) => "refs" in b)).toBe(false);
  });
  it("находка без пометки — ярлыком в конце последней реплики рассказчика", () => {
    const beats = resolveMarks([{ speaker: null, text: "Ты обыскиваешь комнату." }, { speaker: "Мод", text: "Нашли что-нибудь?" }], [clue, effect.gold(5, "$5")]);
    expect(beats[0]!.marks).toEqual([{ kind: "clue", quote: null, label: "улика", ref: "c1" }]);
    expect(beats[1]!.marks).toBeUndefined();
    expect(tagLast([{ speaker: "Мод", text: "Ох." }], [effect.deduction("c9", "Кит — отравитель")])[0]!.marks).toEqual([{ kind: "deduction", quote: null, label: "вывод", ref: "c9" }]);
    expect(tagLast([{ speaker: null, text: "Ох." }], [effect.item("Ключ")])[0]!.marks).toBeUndefined();
  });
});

describe("подсветка на лету", () => {
  const A = getWorld("arkham");
  const w = layoutCase(A.rules, A.fallbackCase!, "s");
  const c = createCharacter(A.rules, { world: "arkham", name: "Клара", gender: "f", race: "human", cls: "detective", base: { ...A.rules.recommended.detective! }, skills: ["Внимательность", "Психология"], phobia: "Темнота" }, mulberry32(1));
  w.current = "L1"; // дом Вейлов: здесь лежат c1 и c4
  it("пока мастер пишет — только то, что движок примет: улика здесь и не найдена, адрес неизвестен", () => {
    const beats = previewMarks(c, w, [
      { speaker: null, text: "Горький осадок в чашке, пустой футляр.", refs: [{ ref: "c1", quote: "Горький осадок" }, { ref: "c2", quote: "в чашке" }, { ref: "c4", quote: "пустой футляр" }] },
      { speaker: null, text: "Записка: особняк доктора Хоу. Мутит.", refs: [{ ref: "L5", quote: "особняк доктора Хоу" }, { ref: "L1", quote: "Записка" }, { ref: "sanity", quote: "Мутит" }, { ref: "q1", quote: "Записка" }] },
    ]);
    expect(beats[0]!.marks!.map((m) => m.ref)).toEqual(["c1", "c4"]); // c2 лежит в морге
    expect(beats[1]!.marks).toEqual([
      { kind: "address", quote: "особняк доктора Хоу", label: "адрес", ref: "L5" },
      { kind: "sanity", quote: "Мутит", label: "рассудок" },
    ]); // L1 уже известен; цели заранее не подсвечиваются
    expect(beats.some((b) => "refs" in b)).toBe(false);
    // Пока реплика пишется, недописанные слова не подсвечиваются; в дописанной — ярлык в конце.
    const partial = { speaker: null, text: "Горький осадок в чашке.", refs: [{ ref: "c1", quote: "Го" }] };
    expect(previewMarks(c, w, [partial])[0]!.marks).toBeUndefined();
    expect(previewMarks(c, w, [partial, { speaker: "Мод", text: "Ох." }])[0]!.marks).toEqual([{ kind: "clue", quote: null, label: "улика", ref: "c1" }]);
  });
  it("помеченные улики и адреса идут в проверку движка вместе с clues и reveal", () => {
    expect(proposedFromFinds(w, [{ speaker: null, text: "…", refs: [{ ref: "c4", quote: "" }, { ref: "sanity", quote: "" }, { ref: "L5", quote: "" }, { ref: "c99", quote: "" }] }])).toEqual({ clues: ["c4"], reveal: ["L5"] });
  });
});

describe("метки о людях", () => {
  it("отношение и уличение — у последней реплики этого человека", () => {
    const beats = tagLast(
      [{ speaker: null, text: "Ты кладёшь осадок на стол." }, { speaker: "Кит Ларкин", text: "Это не моё!" }, { speaker: null, text: "Он бледнеет." }],
      [effect.caught("Кит Ларкин", "к тёте не заходил"), effect.attitude("Кит", -1, "насторожен"), effect.attitude("Хэтти", 1, "расположена")],
    );
    expect(beats[1]!.marks).toEqual([
      { kind: "caught", quote: null, label: "ложь раскрыта", ref: "Кит Ларкин" },
      { kind: "attitude", quote: null, label: "доверие −1", ref: "Кит" },
    ]);
    expect(beats[2]!.marks).toBeUndefined(); // Хэтти не говорила — метки нет
  });
});
