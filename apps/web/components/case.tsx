"use client";

import Link from "next/link";
import { useState } from "react";
import { attitudeWord, CASE_HUB_ID, caseSolved, locationById, sameName, type CaseResult, type PublicCampaign, type PublicCase, type Verdict } from "@ash/engine";

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
/** Подвести панель к записи, на которую игрок нажал в тексте, и подсветить её. */
const focusRef = (on: boolean) => (el: HTMLElement | null) => {
  if (on && el) el.scrollIntoView({ block: "center", behavior: "smooth" });
};

/**
 * Люди, которых встретил герой: отношение и что рассказали. В деле это показания свидетелей.
 * focus — имя человека, к которому привёл клик по подсветке в тексте.
 */
export function People({ w, focus, title = "Показания" }: { w: PublicCampaign; focus?: string | null; title?: string }) {
  const people = [...(w.memory ?? [])].filter((m) => m.told.length || m.attitude).sort((a, b) => b.met - a.met);
  if (!people.length) return null;
  return (
    <>
      <h3 className="case-h">{title}</h3>
      <ul className="case-people">
        {people.map((m) => {
          const on = !!focus && sameName(m.name, focus);
          return (
            <li key={m.name} ref={focusRef(on)} className={on ? "focus" : undefined}>
              <div className="who">
                <b>{m.name}</b>
                {m.role && <span className="muted"> — {m.role}</span>}
                <span className={`att a${m.attitude}`}>{attitudeWord(m.attitude)}</span>
              </div>
              {m.told.length > 0 && (
                <ul>
                  {m.told.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function CaseFile({ w, busy, focus, onReconstruct, onClose, onPresent }: { w: PublicCampaign; busy: boolean; focus?: string | null; onReconstruct: (text: string) => void; onClose: () => void; onPresent?: (clueId: string) => void }) {
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
          {c.sanityLost ? ` · рассудка потеряно: ${c.sanityLost}` : ""}
        </p>
      </div>

      <h3 className="case-h">Улики</h3>
      {clues.length ? (
        <ul className="case-clues">
          {clues.map((x) => (
            <li key={x.id} ref={focusRef(x.id === focus)} className={x.id === focus ? "focus" : undefined}>
              <span className="case-where">{placeName(w, x.at)}</span>
              {x.title && <strong className="case-title">{x.title}. </strong>}
              {x.text}
              {/* Предъявить улику тому, с кем говоришь: уличит ли она его — решает игра. */}
              {w.npc && onPresent && !c.result && (
                <button className="btn ghost small case-present" disabled={busy || !!w.combat} onClick={() => onPresent(x.id)}>
                  Показать: {w.npc.name}
                </button>
              )}
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
              <li key={x.id} ref={focusRef(x.id === focus)} className={x.id === focus ? "focus" : undefined}>
                {x.title && <strong className="case-title">{x.title}. </strong>}
                {x.text}
              </li>
            ))}
          </ul>
        </>
      )}

      <People w={w} focus={focus} />

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
        {r.penalty ? ` — штраф ${r.penalty}` : ""}.{r.sanityPenalty ? ` Потеряно рассудка: ${c.sanityLost} — штраф ${r.sanityPenalty}.` : ""}
        {r.timeUp ? " Время вышло." : ""} {beat ? "Наставник снимает шляпу." : ""}
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

/** Подтверждение до смены сцены: само расследование здесь ещё не заканчивается. */
export function CloseCaseConfirm({ busy, onConfirm, onCancel }: { busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="vn-close-veil" role="dialog" aria-modal="true" aria-labelledby="close-confirm-title">
      <div className="vn-close-confirm">
        <div className="eyebrow">Завершение расследования</div>
        <h2 id="close-confirm-title">Перейти к выводам?</h2>
        <p>В кабинете доктора Уэйкфилда ты ответишь на вопросы дела. До отправки ответов можно вернуться к поискам; после неё расследование закончится.</p>
        <div className="row">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>Ещё поищу</button>
          <button className="btn" onClick={onConfirm} disabled={busy}>В кабинет наставника</button>
        </div>
      </div>
    </div>
  );
}

/** Финальный экран: исход считает движок, последнюю реплику написал рассказчик. */
export function CaseFinale({ result, text }: { result: CaseResult; text: string }) {
  const solved = caseSolved(result);
  return (
    <div className={`vn-finale ${solved ? "solved" : "unsolved"}`}>
      <div className="eyebrow">Завершение дела</div>
      <h2>{solved ? "Дело раскрыто" : "Дело не раскрыто"}</h2>
      <p className="vn-finale-text">{text}</p>
      <div className="vn-finale-score">Ответы: {result.points} из {result.max} · Итоговый счёт: {result.score}</div>
      <Link className="btn" href="/">Выйти на главный экран</Link>
    </div>
  );
}

/** Вопросы дела на отдельной сцене. Ответы хранятся снаружи, чтобы ошибка развязки их не стёрла. */
export function CloseCase({ c, busy, answers, onChange, onSubmit, onCancel }: { c: PublicCase; busy: boolean; answers: Record<string, string>; onChange: (answers: Record<string, string>) => void; onSubmit: (answers: Record<string, string>) => void; onCancel: () => void }) {
  const [incomplete, setIncomplete] = useState(false);
  const filled = c.questions.some((q) => answers[q.id]?.trim());
  const allFilled = c.questions.every((q) => answers[q.id]?.trim());
  const submit = () => {
    if (!allFilled) setIncomplete(true);
    else onSubmit(answers);
  };
  return (
    <div className="case-close">
      <div className="case-close-head">
        <div className="eyebrow">Кабинет доктора Уэйкфилда</div>
        <h2>Сложи свою версию</h2>
        <p>Ответь своими словами. Пустые ответы будут засчитаны как неверные. После отправки начнётся развязка, и вернуться к поискам уже нельзя.</p>
      </div>
      <div className="case-close-questions">
        {c.questions.map((q) => (
          <label key={q.id} className="case-q">
            <span>{q.text} <span className="muted small">· {q.points} очков</span></span>
            <textarea rows={3} maxLength={400} value={answers[q.id] ?? ""} onChange={(e) => onChange({ ...answers, [q.id]: e.target.value })} disabled={busy} />
          </label>
        ))}
      </div>
      {incomplete && !allFilled && (
        <div className="case-close-warning" role="alert">
          <span>Остались пустые ответы. Закрыть дело с тем, что удалось узнать?</span>
          <button className="btn ghost small" onClick={() => setIncomplete(false)} disabled={busy}>Дописать</button>
          <button className="btn small" onClick={() => onSubmit(answers)} disabled={busy}>Закрыть с пропусками</button>
        </div>
      )}
      <div className="row case-close-actions">
        <button className="btn ghost" onClick={onCancel} disabled={busy}>Вернуться к поискам</button>
        <button className="btn" onClick={submit} disabled={busy || !filled}>Изложить версию</button>
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

/** Улица-хаб: следующий адрес выбирает игрок, а не рассказчик. */
export function StreetHub({ w, busy, onTravel }: { w: PublicCampaign; busy: boolean; onTravel: (id: string) => void }) {
  const c = w.case!;
  const blocked = busy || !!w.combat || !!c.result || c.visits >= c.limit;
  const places = w.locations.filter((l) => l.id !== CASE_HUB_ID);
  return (
    <div className="street-hub">
      <div className="eyebrow">Улицы Аркхэма</div>
      <h3>Куда отправиться?</h3>
      <p className="small muted">Выход на улицу времени не стоит. Следующий выбранный адрес — новый визит.</p>
      <div className="suggestions street-addresses">
        {places.map((l) => (
          <button key={l.id} disabled={blocked} onClick={() => onTravel(l.id)}>
            {l.name}{l.visited ? " · уже был" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Справочник: поиск по имени или названию и список известных адресов с жителями. */
export function Directory({ w, busy, focus, onLookup, onTravel }: { w: PublicCampaign; busy: boolean; focus?: string | null; onLookup: (q: string) => void; onTravel: (id: string) => void }) {
  const c = w.case!;
  const [q, setQ] = useState("");
  const atHub = w.current === CASE_HUB_ID;
  const blocked = busy || !!w.combat || !!c.result || c.visits >= c.limit || !atHub;
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
      <p className="small muted">Услышал имя — найди его здесь: адрес появится на карте. Каждый визит по адресу стоит времени.{!atHub ? " Чтобы выбрать адрес, сначала выйди на улицу." : ""}</p>
      {w.locations.map((l) => {
        const here = l.id === w.current;
        const people = c.people.filter((p) => p.at === l.id);
        return (
          <div key={l.id} ref={focusRef(l.id === focus)} className={`dir-entry ${here ? "here" : ""} ${l.id === focus ? "focus" : ""}`}>
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
