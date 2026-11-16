"use client";

import type { ReactNode } from "react";
import type { Beat, TurnView } from "@/lib/client";

/** Реплики хода в порядке показа: ответ мастера, раунды боя — голосом рассказчика. */
export function beatsOf(t: Pick<TurnView, "beats" | "combatEvents" | "narration" | "kind">): Beat[] {
  if (t.beats?.length) return t.beats;
  if (t.combatEvents?.length) return t.combatEvents.map((e) => ({ speaker: null, text: e.text }));
  return t.narration ? [{ speaker: null, text: t.narration }] : [];
}

/** Силуэт, пока портрет рисуется. */
export function Silhouette({ side = "left" }: { side?: "left" | "right" }) {
  return (
    <svg className={`vn-bust vn-silhouette ${side}`} viewBox="0 0 400 560" aria-hidden="true">
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
export function Bust({ url, name, side = "left", dim }: { url: string | null | undefined; name: string; side?: "left" | "right"; dim?: boolean }) {
  return (
    <div className={`vn-bust-wrap ${side} ${dim ? "dim" : ""}`}>
      {url ? <img key={url} className={`vn-bust ${side}`} src={url} alt={name} /> : <Silhouette side={side} />}
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
};
