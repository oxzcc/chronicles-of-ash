import type { TurnEffect } from "@ash/engine";
import type { Beat, BeatMark } from "@ash/llm";

/** Ярлык подсветки в тексте реплики. Что сюда не входит, в тексте не подсвечивается — только в сводке хода. */
const LABEL: Partial<Record<TurnEffect["kind"], (e: TurnEffect) => string>> = {
  clue: () => "улика",
  deduction: () => "вывод",
  address: () => "адрес",
  objective: () => "цель",
  sanity: (e) => `рассудок ${e.text}`,
  hp: (e) => `здоровье ${e.text}`,
};

/** Находки, которые видны в тексте всегда: без пометки мастера — ярлыком в конце реплики. */
const ALWAYS: TurnEffect["kind"][] = ["clue", "deduction", "address", "sanity"];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();

/** Слова пометки в тексте реплики — так, как они там написаны (регистр и ё не важны). null — не нашлись. */
export function findQuote(text: string, quote: string): string | null {
  const q = quote.trim().replace(/[.!?…,;:]+$/, "");
  if (q.length < 3) return null;
  const i = norm(text).indexOf(norm(q));
  return i >= 0 ? text.slice(i, i + q.length) : null;
}

/**
 * Пометки мастера (refs) → подсветка (marks), но только для того, что движок принял:
 * отклонённая улика не подсвечивается. Принятая находка без пометки получает ярлык
 * в конце последней реплики рассказчика — игрок видит её в тексте в любом случае.
 */
export function resolveMarks(beats: Beat[], effects: TurnEffect[]): Beat[] {
  const markable = effects.filter((e) => LABEL[e.kind]);
  const used = new Set<TurnEffect>();
  const match = (ref: string) =>
    markable.find((e) => !used.has(e) && (e.ref ? e.ref === ref || (e.kind === "address" && norm(e.text) === norm(ref)) : e.kind === norm(ref)));
  const out: Beat[] = beats.map((b) => {
    const { refs, marks: _old, ...rest } = b;
    const marks: BeatMark[] = [];
    for (const r of refs ?? []) {
      const e = match(r.ref);
      if (!e) continue;
      used.add(e);
      marks.push({ kind: e.kind, quote: findQuote(b.text, r.quote), label: LABEL[e.kind]!(e) });
    }
    return marks.length ? { ...rest, marks } : rest;
  });
  return tagLast(out, markable.filter((e) => !used.has(e)));
}

/** Ярлыки находок в конце последней реплики рассказчика (или последней вообще) — для того, что движок добавил сам. */
export function tagLast(beats: Beat[], effects: TurnEffect[]): Beat[] {
  const left = effects.filter((e) => LABEL[e.kind] && ALWAYS.includes(e.kind));
  if (!left.length || !beats.length) return beats;
  const out = [...beats];
  const narr = out.map((b) => b.speaker).lastIndexOf(null);
  const i = narr >= 0 ? narr : out.length - 1;
  const b = out[i]!;
  out[i] = { ...b, marks: [...(b.marks ?? []), ...left.map((e) => ({ kind: e.kind, quote: null, label: LABEL[e.kind]!(e) }))] };
  return out;
}
