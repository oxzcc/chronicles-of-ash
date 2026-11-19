"use client";

import type { ReactNode } from "react";
import { sortEffects, type EffectKind } from "@ash/engine";
import type { Beat, TurnEffect, TurnView } from "@/lib/client";

/** Реплики хода в порядке показа: ответ мастера, раунды боя — голосом рассказчика. */
export function beatsOf(t: Pick<TurnView, "beats" | "combatEvents" | "narration" | "kind">): Beat[] {
  if (t.beats?.length) return t.beats;
  if (t.combatEvents?.length) return t.combatEvents.map((e) => ({ speaker: null, text: e.text }));
  return t.narration ? [{ speaker: null, text: t.narration }] : [];
}

/** Силуэт, пока портрет рисуется. */
/** Силуэт: пульсирует, пока портрет рисуется; без пульса — если портрета не будет. */
export function Silhouette({ side = "left", still }: { side?: "left" | "right"; still?: boolean }) {
  return (
    <svg className={`vn-bust vn-silhouette ${still ? "still" : ""} ${side}`} viewBox="0 0 400 560" aria-hidden="true">
      <defs>
        <radialGradient id="sil" cx="50%" cy="35%" r="60%">
          <stop offset="0" stopColor="#3b2c20" />
          <stop offset="1" stopColor="#140e0a" />
        </radialGradient>
      </defs>
      <circle cx="200" cy="170" r="92" fill="url(#sil)" />
      <path d="M30 560 C40 380 110 300 200 300 C290 300 360 380 370 560 Z" fill="url(#sil)" />
    </svg>
  );
}

/** Бюст говорящего: готовый портрет или силуэт. Тусклый, когда говорит рассказчик. */
export function Bust({ url, name, side = "left", dim, failed }: { url: string | null | undefined; name: string; side?: "left" | "right"; dim?: boolean; failed?: boolean }) {
  return (
    <div className={`vn-bust-wrap ${side} ${dim ? "dim" : ""}`}>
      {url ? <img key={url} className={`vn-bust ${side}`} src={url} alt={name} /> : <Silhouette side={side} still={failed} />}
    </div>
  );
}

export function TextFrame({ speaker, role, children, onAdvance, hint }: { speaker?: string | null; role?: string; children: ReactNode; onAdvance?: () => void; hint?: string }) {
  return (
    <div
      className={`vn-frame ${speaker ? "" : "narrator"} ${onAdvance ? "clickable" : ""}`}
      onClick={onAdvance}
      role={onAdvance ? "button" : undefined}
      tabIndex={onAdvance ? 0 : undefined}
      aria-label={onAdvance ? "Дальше" : undefined}
    >
      {speaker && (
        <div className="vn-nameplate">
          <div className="who">{speaker}</div>
          {role && <div className="role">{role}</div>}
        </div>
      )}
      <div className={speaker ? "vn-line" : "vn-narr"}>{children}</div>
      {hint && (
        <div className="vn-advance">
          <span>{hint}</span>
          <svg width="16" height="11" viewBox="0 0 18 12" aria-hidden="true">
            <path d="M1 1h16L9 11z" fill="currentColor" />
          </svg>
        </div>
      )}
    </div>
  );
}

/** Подпись находки. Пусто — текст говорит сам за себя. */
const FX_LABEL: Record<EffectKind, string> = {
  clue: "Улика", deduction: "Вывод", address: "Адрес", objective: "Цель", quest: "Квест",
  hp: "Здоровье", sanity: "Рассудок", gold: "Деньги", item: "Вещь", lost: "Потеряно",
};
/** В деле цель — то, что нужно выяснить. */
const fxLabel = (e: TurnEffect, isCase?: boolean) => (e.kind === "objective" && isCase ? "Выяснено" : FX_LABEL[e.kind]);

/** Подсвеченная находка в тексте реплики. */
export type Mark = NonNullable<Beat["marks"]>[number];

/**
 * Текст реплики с подсвеченными находками: слова, где герой нашёл улику, узнал адрес
 * или потерял рассудок, и ярлык рядом. С onMark находка — кнопка: ведёт к улике в досье,
 * к адресу в справочнике, к листу героя. Пометка без найденных слов — ярлыком в конце.
 */
export function BeatText({ beat, onMark }: { beat: Beat; onMark?: (m: Mark) => void }) {
  const marks = beat.marks ?? [];
  if (!marks.length) return <>{beat.text}</>;
  const placed = marks
    .map((m) => ({ m, i: m.quote ? beat.text.indexOf(m.quote) : -1 }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i);
  const one = (m: Mark, key: string, tail: boolean) => {
    const inner = (
      <>
        {!tail && <span className="hl">{m.quote}</span>}
        <span className="vn-tag">{m.label}</span>
      </>
    );
    const cls = `vn-mark ${m.kind} ${tail ? "tail" : ""}`;
    // Не <button>: кнопка не переносится по строкам, а подсвеченная фраза бывает длинной. Клавиатура — Enter и пробел.
    return onMark ? (
      <span
        key={key}
        role="button"
        tabIndex={0}
        className={`${cls} link`}
        title={MARK_HINT[m.kind] ?? undefined}
        onClick={(e) => {
          e.stopPropagation();
          onMark(m);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          onMark(m);
        }}
      >
        {inner}
      </span>
    ) : (
      <span key={key} className={cls}>
        {inner}
      </span>
    );
  };
  const parts: ReactNode[] = [];
  const shown = new Set<Mark>();
  let at = 0;
  for (const { m, i } of placed) {
    if (i < at) continue;
    if (i > at) parts.push(beat.text.slice(at, i));
    parts.push(one(m, `m${i}`, false));
    shown.add(m);
    at = i + m.quote!.length;
  }
  parts.push(beat.text.slice(at));
  return (
    <>
      {parts}
      {marks.filter((m) => !shown.has(m)).map((m, k) => one(m, `t${k}`, true))}
    </>
  );
}

/** Подсказка при наведении: куда ведёт находка. */
const MARK_HINT: Record<string, string> = {
  clue: "Открыть в досье", deduction: "Открыть в досье", objective: "Открыть журнал",
  address: "Открыть адрес", sanity: "Лист героя", hp: "Лист героя",
};

/** Те же плашки в «Истории» — тихо, без анимации. */
export function EffectChips({ items, isCase }: { items: TurnEffect[] | undefined; isCase?: boolean }) {
  if (!items?.length) return null;
  return (
    <div className="fx-chips">
      {sortEffects(items).map((e, i) => {
        const k = fxLabel(e, isCase);
        return (
          <span key={i} className={`vn-fx-chip ${e.kind} ${e.good ? "" : "bad"}`} title={e.detail}>
            {k ? `${k}: ${e.text}` : e.text}
          </span>
        );
      })}
    </div>
  );
}

export function Pips({ total, at }: { total: number; at: number }) {
  if (total < 2) return null;
  return (
    <div className="vn-pips" aria-label={`Реплика ${at + 1} из ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i <= at ? "on" : ""} />
      ))}
    </div>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="vn-drawer-veil" onClick={onClose}>
      <aside className="vn-drawer" onClick={(e) => e.stopPropagation()} aria-label={title}>
        <div className="vn-drawer-head">
          <h2>{title}</h2>
          <button className="vn-icon" onClick={onClose} aria-label="Закрыть">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="vn-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export const Icon = {
  journal: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 21V5" />
      <path d="M9 7h6M9 11h6" />
    </svg>
  ),
  map: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  ),
  hero: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 8v4l3 2" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </svg>
  ),
  newspaper: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h13v14H6a2 2 0 0 1-2-2z" />
      <path d="M17 9h3v8a2 2 0 0 1-2 2" />
      <path d="M7 9h7M7 12h7M7 15h4" />
    </svg>
  ),
  directory: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
      <path d="M8 9h5M8 12h3" />
    </svg>
  ),
};
