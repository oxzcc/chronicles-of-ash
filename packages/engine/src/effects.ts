/**
 * Что изменил ход — для игрока: плашки в сцене и в истории («Улика: …», «Рассудок −2»).
 * Строит их код по тому, что движок реально применил, а не по словам модели.
 */
export type EffectKind =
  /** Найдена улика (дело). ref — id улики. */
  | "clue"
  /** Сделан вывод реконструкцией (дело). ref — id вывода. */
  | "deduction"
  /** Узнан новый адрес (дело). ref — id места. */
  | "address"
  /** Выполнена цель квеста или дела. ref — id цели. */
  | "objective"
  /** Квест завершён целиком. */
  | "quest"
  | "hp"
  | "sanity"
  | "gold"
  /** Получен предмет. */
  | "item"
  /** Потерян предмет. */
  | "lost"
  /** Отношение NPC к герою сдвинулось. ref — имя. */
  | "attitude"
  /** Предъявленная улика уличила человека во лжи (дело). ref — имя. */
  | "caught";

export interface TurnEffect {
  kind: EffectKind;
  /** Готовый текст плашки: «−2», «Ржавый ключ», название улики. */
  text: string;
  /** Полный текст, когда в text — короткое название (улика). */
  detail?: string;
  /** Хорошо это для героя или плохо — цвет плашки. */
  good: boolean;
  ref?: string;
  /** Для чисел: на сколько изменилось. */
  delta?: number;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

export const effect = {
  /** title — короткое название улики («Осадок в чашке»); без него — весь текст. */
  clue: (id: string, text: string, title?: string): TurnEffect => (title ? { kind: "clue", text: title, detail: text, good: true, ref: id } : { kind: "clue", text, good: true, ref: id }),
  deduction: (id: string, text: string): TurnEffect => ({ kind: "deduction", text, good: true, ref: id }),
  address: (id: string, name: string): TurnEffect => ({ kind: "address", text: name, good: true, ref: id }),
  objective: (id: string, text: string): TurnEffect => ({ kind: "objective", text, good: true, ref: id }),
  quest: (): TurnEffect => ({ kind: "quest", text: "Квест выполнен", good: true }),
  hp: (delta: number): TurnEffect => ({ kind: "hp", text: signed(delta), good: delta > 0, delta }),
  sanity: (delta: number): TurnEffect => ({ kind: "sanity", text: signed(delta), good: delta > 0, delta }),
  /** amount — сумма словами мира без знака: «5 золота», «$7». */
  gold: (delta: number, amount: string): TurnEffect => ({ kind: "gold", text: `${delta > 0 ? "+" : "−"}${amount}`, good: delta > 0, delta }),
  item: (name: string): TurnEffect => ({ kind: "item", text: name, good: true }),
  lost: (name: string): TurnEffect => ({ kind: "lost", text: name, good: false }),
  /** word — отношение после сдвига: «насторожен», «доверяет». */
  attitude: (name: string, delta: number, word: string): TurnEffect => ({ kind: "attitude", text: `${name}: ${word}`, good: delta > 0, ref: name, delta }),
  /** lie — что человек утверждал. */
  caught: (name: string, lie: string): TurnEffect => ({ kind: "caught", text: name, detail: lie, good: true, ref: name }),
};

/** Порядок плашек: сначала находки дела, потом цели, потом состояние героя. */
const ORDER: EffectKind[] = ["caught", "deduction", "clue", "address", "objective", "quest", "attitude", "sanity", "hp", "gold", "item", "lost"];
export const sortEffects = (xs: TurnEffect[]) => [...xs].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
