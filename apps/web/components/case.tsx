"use client";

import { useState } from "react";
import { locationById, type PublicCampaign, type PublicCase, type Verdict } from "@ash/engine";

/**
 * Интерфейс детективного дела (мир Аркхэма): досье, газета, справочник, закрытие дела и разбор.
 * Всё, что здесь видно, пришло из publicCampaign — разгадку и ответы клиент получает только после закрытия.
 */

const placeName = (w: PublicCampaign, id: string) => locationById(w, id)?.name ?? "неизвестное место";
const VERDICT: Record<Verdict, { text: string; cls: string }> = {
  right: { text: "верно", cls: "ok" },
  partial: { text: "отчасти", cls: "half" },
  wrong: { text: "неверно", cls: "bad" },
};

/** Досье: цели, найденные улики, выводы, визиты; кнопки реконструкции и закрытия. */
export function CaseFile({ w, busy, onReconstruct, onClose }: { w: PublicCampaign; busy: boolean; onReconstruct: (text: string) => void; onClose: () => void }) {
  const c = w.case!;
  const [version, setVersion] = useState("");
  const clues = c.clues.filter((x) => !x.requires);
  const deductions = c.clues.filter((x) => x.requires);
  const left = c.limit - c.visits;
  return (
    <div className="case">
      <div className="card">
        <h3>{w.questTitle}</h3>
        <p className="small muted">{w.hook}</p>
        {w.objectives.map((o) => (
          <p key={o.id} className={`obj ${o.done ? "done" : ""}`}>
            {o.done ? "✓" : "○"} {o.text}
          </p>
        ))}
        <p className={`case-visits ${left <= 2 && !c.result ? "late" : ""}`}>
          Визиты: {c.visits} из {c.limit}
          {!c.result && (left > 0 ? ` · осталось ${left}` : " · время вышло")}
        </p>
      </div>

      <h3 className="case-h">Улики</h3>
      {clues.length ? (
        <ul className="case-clues">
          {clues.map((x) => (
            <li key={x.id}>
              <span className="case-where">{placeName(w, x.at)}</span>
              {x.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Пока ничего. Ищи там, где что-то могло остаться: в вещах, бумагах, словах свидетелей.</p>
      )}

      {deductions.length > 0 && (
        <>
          <h3 className="case-h">Выводы</h3>
          <ul className="case-clues deductions">
            {deductions.map((x) => (
              <li key={x.id}>{x.text}</li>
            ))}
          </ul>
        </>
      )}

      {!c.result && (
        <>
          <h3 className="case-h">Реконструкция</h3>
          <p className="small muted">
            {c.canDeduce > 0
              ? "Улик достаточно, чтобы сложить часть картины. Опиши своими словами, что, по-твоему, произошло."
              : "Улик пока мало, чтобы сложить картину. Возвращайся, когда найдёшь больше."}
          </p>
          <textarea value={version} onChange={(e) => setVersion(e.target.value)} rows={3} maxLength={500} placeholder="Например: чай подал племянник, и он же…" disabled={busy || c.canDeduce === 0} />
          <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
            <button className="btn ghost small" disabled={busy || c.canDeduce === 0 || version.trim().length < 10} onClick={() => onReconstruct(version.trim())}>
              Сложить картину
            </button>
            <button className="btn small" disabled={busy || !!w.combat} onClick={onClose}>
              Закрыть дело…
            </button>
          </div>
        </>
      )}
      {c.result && <CaseResultView c={c} />}
    </div>
  );
}

/** Разбор после закрытия: счёт против наставника, ответы с правильными, разгадка. */
export function CaseResultView({ c }: { c: PublicCase }) {
  const r = c.result!;
  const beat = r.score >= r.mentor;
  return (
    <div className="case-result">
      <h3 className="case-h">Дело закрыто</h3>
      <div className="case-score">
        <div>
          <div className="n">{r.score}</div>
          <div className="small muted">твой счёт</div>
        </div>
        <div>
          <div className="n mentor">{r.mentor}</div>
          <div className="small muted">доктор Уэйкфилд</div>
        </div>
      </div>
      <p className="small muted">
        Ответы: {r.points} из {r.max}. Визиты: {c.visits}
        {c.reveal ? ` при пути наставника в ${c.reveal.par}` : ""}
        {r.penalty ? ` — штраф ${r.penalty}` : ""}.{r.timeUp ? " Время вышло." : ""} {beat ? "Наставник снимает шляпу." : ""}
      </p>
      {c.questions.map((q, i) => {
        const a = r.answers[i];
        const v = VERDICT[a?.verdict ?? "wrong"];
        return (
          <div key={q.id} className="case-answer">
            <div className="q">{q.text}</div>
            <div className="small">
              Твой ответ: {a?.answer || "—"} <span className={`verdict ${v.cls}`}>{v.text}</span>
            </div>
            {c.reveal && a?.verdict !== "right" && <div className="small muted">Правильно: {c.reveal.answers[q.id]}</div>}
          </div>
        );
      })}
      {c.reveal && (
        <>
          <h3 className="case-h">Что произошло на самом деле</h3>
          <p className="small">{c.reveal.truth}</p>
        </>
      )}
    </div>
  );
}

/** Вопросы дела: игрок отвечает своими словами. Вопросы видны только здесь — как в Mythos Tales. */
export function CloseCase({ c, busy, onSubmit, onCancel }: { c: PublicCase; busy: boolean; onSubmit: (answers: Record<string, string>) => void; onCancel: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const filled = Object.values(answers).some((x) => x.trim());
  return (
    <div className="case-close">
      <p className="small muted">
        Ответь на вопросы своими словами. Ответы оценят по сути; после этого дело закроется, и ты узнаешь, что произошло на самом деле.
        {c.visits < c.limit ? " Можно вернуться и поискать ещё — но каждый визит стоит очков." : ""}
      </p>
      {c.questions.map((q) => (
        <label key={q.id} className="case-q">
          <span>
            {q.text} <span className="muted small">· {q.points} очков</span>
          </span>
          <textarea rows={2} maxLength={400} value={answers[q.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} disabled={busy} />
        </label>
      ))}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="btn ghost small" onClick={onCancel} disabled={busy}>
          Ещё поищу
        </button>
        <button className="btn" onClick={() => onSubmit(answers)} disabled={busy || !filled}>
          Закрыть дело
        </button>
      </div>
    </div>
  );
}

/** Газета на день начала дела: зацепки прячутся среди обычных новостей. */
export function Newspaper({ c }: { c: PublicCase }) {
  return (
    <div className="paper">
      <div className="paper-head">
        <div className="paper-title">Аркхэмский вестник</div>
        <div className="paper-date">{c.newspaper.date}</div>
      </div>
      {c.newspaper.articles.map((a, i) => (
        <article key={i}>
          <h4>{a.headline}</h4>
          <p>{a.text}</p>
        </article>
      ))}
    </div>
  );
}

/** Справочник: поиск по имени или названию и список известных адресов с жителями. */
export function Directory({ w, busy, onLookup, onTravel }: { w: PublicCampaign; busy: boolean; onLookup: (q: string) => void; onTravel: (id: string) => void }) {
  const c = w.case!;
  const [q, setQ] = useState("");
  const blocked = busy || !!w.combat || !!c.result || c.visits >= c.limit;
  return (
    <div className="directory">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 3) onLookup(q.trim());
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя или название: Финнеган, Хоу…" maxLength={60} style={{ flex: 1 }} disabled={busy} />
        <button className="btn ghost small" disabled={busy || q.trim().length < 3}>
          Найти
        </button>
      </form>
      <p className="small muted">Услышал имя — найди его здесь: адрес появится на карте. Каждый визит по адресу стоит времени.</p>
      {w.locations.map((l) => {
        const here = l.id === w.current;
        const people = c.people.filter((p) => p.at === l.id);
        return (
          <div key={l.id} className={`dir-entry ${here ? "here" : ""}`}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{l.name}</b>
              {here ? (
                <span className="small muted">ты здесь</span>
              ) : (
                <button className="btn ghost small" disabled={blocked} onClick={() => onTravel(l.id)}>
                  Пойти
                </button>
              )}
            </div>
            {people.length > 0 && <div className="small muted">{people.map((p) => `${p.name} — ${p.role}`).join("; ")}</div>}
          </div>
        );
      })}
    </div>
  );
}
