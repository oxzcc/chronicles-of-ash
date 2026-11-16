"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { LOCATION_TYPES, locationById, type CheckResult, type CombatEvent, type CombatMove } from "@ash/engine";
import { api, sleep, streamTurn, type Beat, type CampaignView, type Suggestion } from "@/lib/client";
import { CheckDialog, CombatPanel, Dice, diceFromCheck, diceFromCombat, Entry, Quest, Sheet, Suggestions, WorldMap, type DiceView } from "@/components/game";

type Input =
  | { kind: "start" }
  | { kind: "action"; text: string }
  | { kind: "choice"; index: number }
  | { kind: "travel"; to: string }
  | { kind: "rest" }
  | { kind: "combat"; move: CombatMove; target?: number };

interface Live {
  label: string;
  kind: string;
  beats: Beat[];
  /** Что показать, пока нет текста: «Годрик отвечает…». */
  waiting: string;
  rolls: CheckResult[];
  combatEvents: CombatEvent[];
  /** Ход сохранён и уже в журнале; ждём только, пока доиграет кубик. */
  done?: boolean;
}

export default function Play({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [view, setView] = useState<CampaignView | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [dice, setDice] = useState<DiceView | null>(null);
  const [text, setText] = useState("");
  const [asking, setAsking] = useState<{ index: number; s: Suggestion & { check: { skill: string; dc: number } } } | null>(null);
  const [error, setError] = useState("");
  const busy = live !== null;
  const journal = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const diceQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    api<CampaignView>(`/api/campaigns/${id}`).then(setView).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    journal.current?.scrollTo({ top: journal.current.scrollHeight, behavior: "smooth" });
  }, [view?.turns.length, live?.beats, live?.combatEvents.length]);

  /** Кубики показываются по очереди, каждый ~1.6 с, не задерживая поток текста. */
  const showDice = (d: DiceView) => {
    diceQueue.current = diceQueue.current.then(async () => {
      setDice(d);
      await sleep(1600);
      setDice(null);
    });
  };

  const send = useCallback(
    async (input: Input, label: string) => {
      if (live) return;
      setError("");
      setLive({ label, kind: input.kind, beats: [], waiting: waitingLabel(input.kind), rolls: [], combatEvents: [] });
      await streamTurn(`/api/campaigns/${id}/turn`, input, (e) => {
        if (e.type === "beats") setLive((l) => l && { ...l, beats: e.beats });
        else if (e.type === "roll") {
          showDice(diceFromCheck(e.roll));
          setLive((l) => l && { ...l, rolls: [...l.rolls, e.roll] });
        } else if (e.type === "combat") {
          const d = e.events.find((x) => x.dice)?.dice;
          if (d) showDice(diceFromCombat(d));
          setLive((l) => l && { ...l, combatEvents: [...l.combatEvents, ...e.events] });
          setView((v) => v && { ...v, campaign: { ...v.campaign, combat: e.combat } });
        } else if (e.type === "done") {
          setLive((l) => l && { ...l, done: true });
          setView((v) => v && { ...v, turnNo: e.turnNo, character: e.character, campaign: e.campaign, turns: [...v.turns, ...e.turns], costUsd: v.costUsd + e.costUsd });
          if (input.kind === "action") setText("");
        } else if (e.type === "error") setError(e.message);
      }).catch((err) => setError((err as Error).message));
      await diceQueue.current;
      setLive(null);
    },
    [id, live],
  );

  /** Подпись ожидания по контексту: кто сейчас «говорит». */
  function waitingLabel(kind: Input["kind"]): string {
    const npc = view?.campaign.npc?.name;
    if (kind === "action" || kind === "choice") return npc ? `${npc} отвечает` : "Мир откликается";
    if (kind === "travel") return "Дорога ведёт дальше";
    if (kind === "rest") return "Привал";
    if (kind === "start") return "История начинается";
    return "Пыль оседает";
  }

  // Новая кампания — мастер сразу рассказывает завязку.
  useEffect(() => {
    if (view && view.turns.length === 0 && !started.current) {
      started.current = true;
      send({ kind: "start" }, "Начало приключения");
    }
  }, [view, send]);

  if (!view) return <main className="wrap">{error ? <p className="error">{error}</p> : <p className="muted">Открываю летопись…</p>}</main>;

  const { character: c, campaign: w } = view;
  const here = locationById(w, w.current)!;
  const lastWithSuggestions = [...view.turns].reverse().find((t) => t.suggestions.length);
  const suggestions = !w.combat && lastWithSuggestions ? lastWithSuggestions.suggestions : [];
  const submit = () => text.trim() && send({ kind: "action", text: text.trim() }, text.trim());

  return (
    <div className="game">
      <section className="scene">
        <div className="scene-head">
          <div>
            <h2>{here.name}</h2>
            <div className="small muted">
              {LOCATION_TYPES[here.type]} · {here.desc}
            </div>
          </div>
          <Link href="/" className="small">
            Все герои
          </Link>
        </div>

        <div className="journal" ref={journal}>
          {view.turns.map((t) => (
            <Entry key={t.turnNo} t={t} />
          ))}
          {live && !live.done && (
            <>
              {(live.kind === "action" || live.kind === "choice") && <div className="entry"><div className="you">{live.label}</div></div>}
              <Entry t={{ kind: "start", action: "", beats: live.beats, rolls: live.rolls, combatEvents: live.combatEvents }} />
              {!live.beats.length && <p className="writing">{live.waiting}</p>}
            </>
          )}
        </div>

        {error && <p className="error small">{error}</p>}

        {w.combat ? (
          <CombatPanel w={w} c={c} disabled={busy} onMove={(move, target) => send({ kind: "combat", move, target }, move)} />
        ) : (
          <div className="composer">
            {suggestions.length > 0 && (
              <Suggestions
                items={suggestions}
                c={c}
                disabled={busy}
                onPick={(index) => {
                  const s = suggestions[index]!;
                  if (s.check) setAsking({ index, s: s as typeof s & { check: NonNullable<typeof s.check> } });
                  else send({ kind: "choice", index }, s.text);
                }}
              />
            )}
            <textarea
              value={text}
              maxLength={500}
              disabled={busy}
              placeholder="Что ты делаешь? Можно что угодно: говорить, обыскивать, лгать, лезть на стену…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
              <span className="small muted">Enter — отправить, Shift+Enter — новая строка</span>
              <button className="btn" disabled={busy || !text.trim()} onClick={submit}>
                {busy ? `${live?.waiting ?? ""}…` : "Действовать"}
              </button>
            </div>
          </div>
        )}
      </section>

      <aside className="side">
        <Sheet c={c} />
        <Quest w={w} />
        <WorldMap
          w={w}
          disabled={busy || !!w.combat}
          onTravel={(to) => send({ kind: "travel", to }, `Путь в «${locationById(w, to)?.name}»`)}
          onRest={() => send({ kind: "rest" }, "Привал")}
        />
        <div className="small muted">
          Ходов: {view.turnNo} · расход: ${view.costUsd.toFixed(3)}
        </div>
      </aside>

      {asking && (
        <CheckDialog
          s={asking.s}
          c={c}
          onCancel={() => setAsking(null)}
          onRoll={() => {
            const a = asking;
            setAsking(null);
            send({ kind: "choice", index: a.index }, a.s.text);
          }}
        />
      )}
      {dice && <Dice dice={dice} />}
    </div>
  );
}
