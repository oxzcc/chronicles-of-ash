import { CASE_LIMITS, findPlace, sameName, type Campaign, type Character, type TurnEffect } from "@ash/engine";
import type { Beat, BeatMark } from "@ash/llm";

/** Ярлык подсветки в тексте реплики. Что сюда не входит, в тексте не подсвечивается — только в сводке хода. */
const LABEL: Partial<Record<TurnEffect["kind"], (e: TurnEffect) => string>> = {
  clue: () => "улика",
  deduction: () => "вывод",
  address: () => "адрес",
  objective: () => "цель",
  sanity: (e) => `рассудок ${e.text}`,
  hp: (e) => `здоровье ${e.text}`,
  attitude: (e) => `доверие ${(e.delta ?? 0) > 0 ? "+" : "−"}${Math.abs(e.delta ?? 1)}`,
  caught: () => "ложь раскрыта",
};

/** Находки о человеке — ярлыком у его последней реплики, а не у рассказчика. */
const ABOUT_SPEAKER: TurnEffect["kind"][] = ["attitude", "caught"];

/** Находки, которые видны в тексте всегда: без пометки мастера — ярлыком в конце реплики. */
const ALWAYS: TurnEffect["kind"][] = ["clue", "deduction", "address", "sanity", "caught"];

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
      marks.push({ kind: e.kind, quote: findQuote(b.text, r.quote), label: LABEL[e.kind]!(e), ...(e.ref ? { ref: e.ref } : {}) });
    }
    return marks.length ? { ...rest, marks } : rest;
  });
  return tagLast(out, markable.filter((e) => !used.has(e)));
}

/** Ярлыки находок в конце последней реплики рассказчика (или последней вообще) — для того, что движок добавил сам. */
export function tagLast(beats: Beat[], effects: TurnEffect[]): Beat[] {
  if (!beats.length) return beats;
  const out = [...beats];
  const narr = out.map((b) => b.speaker).lastIndexOf(null);
  for (const e of effects) {
    if (!LABEL[e.kind]) continue;
    // О человеке — у его последней реплики; если он не говорил — у рассказчика (ложь) или нигде (отношение).
    let i = -1;
    if (ABOUT_SPEAKER.includes(e.kind) && e.ref) for (let k = out.length - 1; k >= 0 && i < 0; k--) if (out[k]!.speaker && sameName(out[k]!.speaker!, e.ref)) i = k;
    if (i < 0 && ALWAYS.includes(e.kind)) i = narr >= 0 ? narr : out.length - 1;
    if (i < 0) continue;
    const b = out[i]!;
    out[i] = { ...b, marks: [...(b.marks ?? []), { kind: e.kind, quote: null, label: LABEL[e.kind]!(e), ...(e.ref ? { ref: e.ref } : {}) }] };
  }
  return out;
}

/** Пометки — тоже предложение мастера: рассказал о находке, значит нашёл. Улики и адреса из них идут в проверку движка вместе с clues и reveal. */
export function proposedFromFinds(w: Campaign, beats: Beat[]): { clues: string[]; reveal: string[] } {
  const refs = [...new Set(beats.flatMap((b) => (b.refs ?? []).map((r) => r.ref.trim())))].filter((r) => !/^(sanity|hp)$/i.test(r));
  const cs = w.case;
  if (!cs) return { clues: [], reveal: [] };
  const clues = refs.filter((r) => cs.clues.some((x) => x.id === r));
  const reveal = refs.filter((r) => !clues.includes(r) && findPlace(w, r));
  return { clues, reveal };
}

/**
 * Подсветка, пока мастер ещё пишет: те же проверки, что сделает движок (улика здесь и не найдена,
 * не больше двух за ход; адрес ещё не известен). Игрок видит находку на той реплике, где она случилась,
 * а не после конца хода. Цели не подсвечиваются заранее — их засчитывает только questDone.
 */
export function previewMarks(c: Character, w: Campaign, beats: Beat[]): Beat[] {
  const cs = w.case;
  const seen = new Set<string>();
  let clues = 0;
  return beats.map((b, i) => {
    const { refs, marks: _old, ...rest } = b;
    const marks: BeatMark[] = [];
    // Последняя реплика ещё пишется: пометку без найденных слов не показываем — слова, скорее всего, ещё не дописаны.
    const writing = i === beats.length - 1;
    for (const r of refs ?? []) {
      const ref = r.ref.trim();
      if (!ref || seen.has(ref)) continue;
      const quote = findQuote(b.text, r.quote);
      if (writing && !quote) continue;
      let m: BeatMark | null = null;
      const clue = cs?.clues.find((x) => x.id === ref);
      if (clue) {
        if (!clue.found && !clue.requires && clue.at === w.current && clues < CASE_LIMITS.cluesPerTurn) {
          clues++;
          m = { kind: "clue", quote, label: "улика", ref: clue.id };
        }
      } else if (norm(ref) === "sanity") {
        if (c.sanity !== undefined) m = { kind: "sanity", quote, label: "рассудок" };
      } else if (norm(ref) === "hp") {
        m = { kind: "hp", quote, label: "здоровье" };
      } else if (cs) {
        const place = findPlace(w, ref);
        if (place && !cs.known.includes(place.id)) m = { kind: "address", quote, label: "адрес", ref: place.id };
      }
      if (m) {
        seen.add(ref);
        marks.push(m);
      }
    }
    return marks.length ? { ...rest, marks } : rest;
  });
}
