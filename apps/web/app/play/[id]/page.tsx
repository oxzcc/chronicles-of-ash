"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CLASSES, LOCATION_TYPES, locationById, RACES, type CheckResult, type CombatEvent, type CombatMove } from "@ash/engine";
import { api, sleep, streamTurn, type Beat, type CampaignView, type SceneView, type Suggestion, type TurnView } from "@/lib/client";
import { CheckDialog, CombatPanel, Dice, diceFromCheck, diceFromCombat, Entry, Quest, Sheet, Suggestions, WorldMap, type DiceView } from "@/components/game";
import { beatsOf, Bust, Drawer, Icon, Pips, TextFrame } from "@/components/vn";

type Input =
  | { kind: "start" }
  | { kind: "action"; text: string }
  | { kind: "choice"; index: number }
  | { kind: "travel"; to: string }
  | { kind: "rest" }
  | { kind: "combat"; move: CombatMove; target?: number };

interface Live {
  label: string;
  kind: Input["kind"];
  beats: Beat[];
  waiting: string;
  rolls: CheckResult[];
  combatEvents: CombatEvent[];
  done?: boolean;
}

type Panel = null | "history" | "quest" | "map" | "hero";

const key = (name: string) => name.trim().toLowerCase().replace(/ё/g, "е");

export default function Play({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [view, setView] = useState<CampaignView | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  /** Ходы последнего действия игрока — их реплики листаются в окне. */
  const [batch, setBatch] = useState<TurnView[]>([]);
  const [cursor, setCursor] = useState(0);
  const [dice, setDice] = useState<DiceView | null>(null);
  const [asking, setAsking] = useState<{ index: number; s: Suggestion & { check: { skill: string; dc: number } } } | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [arrival, setArrival] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const busy = live !== null;
  const started = useRef(false);
  const diceQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    api<CampaignView>(`/api/campaigns/${id}`)
      .then((v) => {
        setView(v);
        const last = v.turns.at(-1);
        if (last) {
          setBatch([last]);
          setCursor(Math.max(0, beatsOf(last).length - 1));
        }
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const showDice = (d: DiceView) => {
    diceQueue.current = diceQueue.current.then(async () => {
      setDice(d);
      await sleep(1600);
      setDice(null);
    });
  };

  const waitingLabel = useCallback(
    (kind: Input["kind"]) => {
      const npc = view?.campaign.npc?.name;
      if (kind === "action" || kind === "choice") return npc ? `${npc} отвечает` : "Мир откликается";
      if (kind === "travel") return "Дорога ведёт дальше";
      if (kind === "rest") return "Привал";
      if (kind === "start") return "История начинается";
      return "Пыль оседает";
    },
    [view?.campaign.npc?.name],
  );

  const send = useCallback(
    async (input: Input, label: string) => {
      if (live) return;
      setError("");
      setPanel(null);
      setCursor(0);
      const before = view?.campaign.current;
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
          setBatch(e.turns);
          setView((v) => v && { ...v, turnNo: e.turnNo, character: e.character, campaign: e.campaign, turns: [...v.turns, ...e.turns], costUsd: v.costUsd + e.costUsd, scene: e.scene });
          if (input.kind === "action") setText("");
          // Заставка с названием места — при входе в новую локацию и в начале приключения.
          if (input.kind === "start" || (input.kind === "travel" && e.campaign.current !== before)) {
            setArrival(locationById(e.campaign, e.campaign.current)?.name ?? null);
          }
        } else if (e.type === "error") setError(e.message);
      }).catch((err) => setError((err as Error).message));
      await diceQueue.current;
      setLive(null);
    },
    [id, live, view?.campaign.current, waitingLabel],
  );

  // Новая кампания — мастер сразу рассказывает завязку.
  useEffect(() => {
    if (view && view.turns.length === 0 && !started.current) {
      started.current = true;
      send({ kind: "start" }, "Начало приключения");
    }
  }, [view, send]);

  // Заставка новой локации гаснет сама.
  useEffect(() => {
    if (!arrival) return;
    const t = setTimeout(() => setArrival(null), 2600);
    return () => clearTimeout(t);
  }, [arrival]);

  // Реплики, которые листает игрок: пока ход идёт — потоковые, после — сохранённые.
  const beats: Beat[] = useMemo(() => {
    if (live && !live.done) return [...live.beats, ...live.combatEvents.map((e) => ({ speaker: null, text: e.text }))];
    return batch.flatMap(beatsOf);
  }, [live, batch]);
  const atEnd = cursor >= beats.length - 1;
  const streaming = !!live && !live.done;

  const advance = useCallback(() => {
    setCursor((c) => (c < beats.length - 1 ? c + 1 : c));
  }, [beats.length]);

  // Пробел и Enter листают реплики (кроме полей ввода и открытых панелей).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON" || panel || asking) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, panel, asking]);

  // Пока картинки сцены рисуются — опрашиваем сервер.
  const scene: SceneView | undefined = view?.scene;
  const pending = useMemo(() => {
    if (!view || !scene) return false;
    const bg = scene.locations[view.campaign.current];
    const npc = view.campaign.npc ? scene.npcs[key(view.campaign.npc.name)] : undefined;
    return [bg, npc, scene.hero].some((x) => x && (x.status === "queued" || x.status === "working"));
  }, [view, scene]);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      api<SceneView>(`/api/campaigns/${id}/scene`)
        .then((s) => setView((v) => v && { ...v, scene: s }))
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  }, [pending, id]);

  if (!view) return <main className="wrap">{error ? <p className="error">{error}</p> : <p className="muted">Открываю летопись…</p>}</main>;

  const { character: c, campaign: w } = view;
  const here = locationById(w, w.current)!;
  const bgUrl = scene?.locations[w.current]?.url;
  const beat = beats[Math.min(cursor, beats.length - 1)];
  const speakerName = beat?.speaker ?? null;
  // На сцене — тот, кто говорит; когда звучит голос рассказчика — последний собеседник, приглушённо.
  const onStage = speakerName ?? (w.combat ? null : (w.npc?.name ?? null));
  const stage = onStage ? scene?.npcs[key(onStage)] : undefined;
  const role = speakerName && w.npc && key(w.npc.name) === key(speakerName) ? w.npc.role : undefined;
  const lastWithSuggestions = [...view.turns].reverse().find((t) => t.suggestions.length);
  const suggestions = !w.combat && lastWithSuggestions ? lastWithSuggestions.suggestions : [];
  const showChoices = !busy && atEnd && !w.combat;
  const submit = () => text.trim() && send({ kind: "action", text: text.trim() }, text.trim());
  const ab = CLASSES[c.cls].ability;

  return (
    <div className="vn">
      {bgUrl ? <img className="vn-bg" key={bgUrl} src={bgUrl} alt="" /> : <div className="vn-bg vn-bg-empty" />}
      <div className="vn-shade" />
      {w.combat ? (
        <>
          <Bust url={scene?.hero?.url} name={c.name} side="left" />
          <Bust url={null} name="Противник" side="right" />
        </>
      ) : (
        onStage && <Bust url={stage?.url} name={onStage} side="left" dim={!speakerName} />
      )}

      <header className="vn-hud">
        <div className="vn-place">
          <div className="name">{here.name}</div>
          <div className="sub">{LOCATION_TYPES[here.type]}</div>
        </div>
        <div className="vn-hud-right">
          <button className="vn-hero" onClick={() => setPanel("hero")} aria-label="Лист героя">
            {scene?.hero?.url ? <img src={scene.hero.url} alt="" /> : <span className="vn-hero-ph">{c.name[0]}</span>}
            <span className="vn-hero-info">
              <span className="n">{c.name}</span>
              <span className="vn-hp" role="img" aria-label={`Здоровье ${c.hp} из ${c.hpMax}`}>
                <span style={{ width: `${(100 * c.hp) / c.hpMax}%` }} />
              </span>
              <span className="vn-stat">
                {c.hp}/{c.hpMax} · КД {c.ac} · {c.gold} зол.
              </span>
            </span>
          </button>
          <nav className="vn-tools" aria-label="Панели">
            <button className="vn-icon" onClick={() => setPanel("quest")} aria-label="Журнал квеста">
              {Icon.journal}
            </button>
            <button className="vn-icon" onClick={() => setPanel("map")} aria-label="Карта" disabled={!!w.combat}>
              {Icon.map}
            </button>
            <Link className="vn-icon" href="/" aria-label="Все герои">
              {Icon.home}
            </Link>
          </nav>
        </div>
      </header>

      <section className="vn-dock">
        {(beat || streaming) && (
          <TextFrame speaker={speakerName} role={role} onAdvance={!atEnd ? advance : undefined} hint={!atEnd ? "Пробел" : undefined}>
            {beat ? beat.text : <span className="vn-writing">{live?.waiting}</span>}
            {beat && streaming && atEnd && <span className="vn-caret" aria-hidden="true" />}
          </TextFrame>
        )}
        <Pips total={beats.length} at={cursor} />
        {error && <p className="error small">{error}</p>}

        {w.combat && atEnd && !streaming && <CombatPanel w={w} c={c} disabled={busy} onMove={(move, target) => send({ kind: "combat", move, target }, move)} />}

        {showChoices && (
          <div className="vn-choices">
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
            <form
              className="vn-free"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <label htmlFor="free" className="sr-only">
                Свой вариант
              </label>
              <input id="free" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Или напиши, что делаешь сам…" autoComplete="off" />
              <button className="btn" disabled={!text.trim()}>
                Действовать
              </button>
            </form>
          </div>
        )}
      </section>

      <button className="vn-history" onClick={() => setPanel("history")}>
        {Icon.history}
        История
      </button>

      {arrival && (
        <div className="vn-arrival" aria-live="polite">
          <div className="rule">
            <span />
            Новое место
            <span />
          </div>
          <div className="title">{arrival}</div>
          <div className="sub">{LOCATION_TYPES[here.type]}</div>
        </div>
      )}

      {panel === "history" && (
        <Drawer title="История" onClose={() => setPanel(null)}>
          {view.turns.map((t) => (
            <Entry key={t.turnNo} t={t} />
          ))}
        </Drawer>
      )}
      {panel === "quest" && (
        <Drawer title="Журнал" onClose={() => setPanel(null)}>
          <Quest w={w} />
          <p className="small muted" style={{ marginTop: 12 }}>
            {w.hook}
          </p>
        </Drawer>
      )}
      {panel === "map" && (
        <Drawer title="Карта" onClose={() => setPanel(null)}>
          <WorldMap
            w={w}
            disabled={busy || !!w.combat}
            onTravel={(to) => send({ kind: "travel", to }, `Путь в «${locationById(w, to)?.name}»`)}
            onRest={() => send({ kind: "rest" }, "Привал")}
          />
        </Drawer>
      )}
      {panel === "hero" && (
        <Drawer title="Герой" onClose={() => setPanel(null)}>
          {scene?.hero?.url && <img className="vn-sheet-portrait" src={scene.hero.url} alt={c.name} />}
          <Sheet c={c} />
          <p className="small muted" style={{ marginTop: 10 }}>
            {RACES[c.race].name}, {CLASSES[c.cls].name}. {ab.name}: {ab.desc}. {c.backstory}
          </p>
          <p className="small muted">
            Ходов: {view.turnNo} · расход: ${view.costUsd.toFixed(3)}
          </p>
        </Drawer>
      )}

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
