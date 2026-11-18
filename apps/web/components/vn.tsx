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

/** Подпись плашки. Пусто — текст говорит сам за себя («+5 золота»). */
const FX_LABEL: Record<EffectKind, string> = {
  clue: "Улика", deduction: "Вывод", address: "Новый адрес", objective: "Цель выполнена", quest: "",
  hp: "Здоровье", sanity: "Рассудок", gold: "", item: "Получено", lost: "Потеряно",
};
/** В деле цель — то, что нужно выяснить. */
const fxLabel = (e: TurnEffect, isCase?: boolean) => (e.kind === "objective" && isCase ? "Выяснено" : FX_LABEL[e.kind]);
/** Крупные плашки — находки, мелкие — числа и вещи. */
const BIG: EffectKind[] = ["clue", "deduction", "address", "objective", "quest"];

/**
 * Итог хода в сцене: что нашёл герой и что потерял. Находки — отдельными строками
 * (по клику — досье или справочник), числа и вещи — фишками в ряд.
 */
export function Effects({ items, isCase, onOpen }: { items: TurnEffect[]; isCase?: boolean; onOpen?: (e: TurnEffect) => void }) {
  if (!items.length) return null;
  const all = sortEffects(items);
  const big = all.filter((e) => BIG.includes(e.kind));
  const small = all.filter((e) => !BIG.includes(e.kind));
  const label = (e: TurnEffect) => fxLabel(e, isCase);
  let n = 0;
  const delay = () => ({ animationDelay: `${0.12 * n++}s` });
  return (
    <div className="vn-effects" aria-live="polite">
      {big.map((e, i) => (
        <button key={`b${i}`} type="button" className={`vn-fx ${e.kind}`} style={delay()} onClick={onOpen ? () => onOpen(e) : undefined} title={e.text}>
          {label(e) && <span className="k">{label(e)}</span>}
          <span className="t">{e.text}</span>
        </button>
      ))}
      {small.length > 0 && (
        <div className="vn-fx-row">
          {small.map((e, i) => (
            <span key={`s${i}`} className={`vn-fx-chip ${e.kind} ${e.good ? "" : "bad"}`} style={delay()}>
              {label(e) && `${label(e)}${e.kind === "item" || e.kind === "lost" ? ":" : ""} `}
              {e.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Те же плашки в «Истории» — тихо, без анимации. */
export function EffectChips({ items, isCase }: { items: TurnEffect[] | undefined; isCase?: boolean }) {
  if (!items?.length) return null;
  return (
    <div className="fx-chips">
      {sortEffects(items).map((e, i) => {
        const k = fxLabel(e, isCase);
        return (
          <span key={i} className={`vn-fx-chip still ${e.kind} ${e.good ? "" : "bad"}`}>
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
