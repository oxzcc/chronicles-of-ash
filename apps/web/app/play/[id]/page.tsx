"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { locationById, locationTypeName, type CheckResult, type CombatEvent, type CombatMove, type LocationType } from "@ash/engine";
import { worldOf } from "@ash/worlds";
import { api, sleep, streamTurn, type Beat, type CampaignView, type SceneView, type Suggestion, type TurnView } from "@/lib/client";
import { CheckDialog, CombatPanel, Dice, diceFromCheck, diceFromCombat, Entry, Quest, Sheet, Suggestions, WorldMap, type DiceView } from "@/components/game";
import { beatsOf, Bust, Drawer, Icon, Pips, TextFrame } from "@/components/vn";
import { CaseFile, CloseCase, Directory, Newspaper } from "@/components/case";

type Input =
  | { kind: "start" }
  | { kind: "action"; text: string }
  | { kind: "choice"; index: number }
  | { kind: "travel"; to: string }
  | { kind: "rest" }
  | { kind: "combat"; move: CombatMove; target?: number }
  | { kind: "lookup"; query: string }
  | { kind: "reconstruct"; text: string }
  | { kind: "close"; answers: Record<string, string> };

interface Live {
  label: string;
  kind: Input["kind"];
  beats: Beat[];
  waiting: string;
  rolls: CheckResult[];
  combatEvents: CombatEvent[];
  done?: boolean;
}

type Panel = null | "history" | "quest" | "map" | "hero" | "paper" | "directory" | "close";

/**
 * Вход в локацию: заставка с названием → голос рассказчика → через NPC_DELAY_MS появляется NPC.
 * title — только заставка и фон; story — реплики рассказчика, NPC ещё не на сцене; open — всё как обычно.
 */
interface Enter {
  to: string;
  name: string;
  type: LocationType;
  phase: "title" | "story" | "open";
  /** Фон, который рисуется для этой локации, пока ход не сохранён. */
  imageId: string | null;
}

const ARRIVAL_MS = 2600;
const NPC_DELAY_MS = 4000;

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
  const [enter, setEnter] = useState<Enter | null>(null);
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
      if (kind === "lookup") return "Листаю справочник";
      if (kind === "reconstruct") return "Улики складываются в картину";
      if (kind === "close") return "Дело закрывается";
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
      // Начало и переход: заставка сразу, ещё до ответа сервера.
      const dest = input.kind === "travel" ? input.to : input.kind === "start" ? view?.campaign.current : undefined;
      const loc = dest && view ? locationById(view.campaign, dest) : undefined;
      setEnter(loc ? { to: loc.id, name: loc.name, type: loc.type, phase: "title", imageId: null } : null);
      setLive({ label, kind: input.kind, beats: [], waiting: waitingLabel(input.kind), rolls: [], combatEvents: [] });
      await streamTurn(`/api/campaigns/${id}/turn`, input, (e) => {
        if (e.type === "beats") setLive((l) => l && { ...l, beats: e.beats });
        else if (e.type === "arrive") {
          setEnter((x) => x && x.to === e.location ? { ...x, imageId: e.imageId } : x);
          const img = e.image;
          if (img) setView((v) => v && { ...v, scene: { ...v.scene, locations: { ...v.scene.locations, [e.location]: img } } });
        }
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
        } else if (e.type === "error") {
          setError(e.message);
          setEnter(null);
        }
      }).catch((err) => {
        setError((err as Error).message);
        setEnter(null);
      });
      await diceQueue.current;
      setLive(null);
    },
    [id, live, view, waitingLabel],
  );

  // Новая кампания — мастер сразу рассказывает завязку.
  useEffect(() => {
    if (view && view.turns.length === 0 && !started.current) {
      started.current = true;
      send({ kind: "start" }, "Начало приключения");
    }
  }, [view, send]);

  // Реплики хода: пока ход идёт — потоковые, после — сохранённые.
  const all: Beat[] = useMemo(() => {
    if (live && !live.done) return [...live.beats, ...live.combatEvents.map((e) => ({ speaker: null, text: e.text }))];
    return batch.flatMap(beatsOf);
  }, [live, batch]);
  const firstSpeaker = all.findIndex((b) => b.speaker);
  // При входе в локацию: во время заставки реплик нет, потом — только рассказчик, пока NPC не вышел.
  const gate = !enter || enter.phase === "open" ? all.length : enter.phase === "title" ? 0 : firstSpeaker < 0 ? all.length : firstSpeaker;
  const beats = useMemo(() => all.slice(0, gate), [all, gate]);
  const atEnd = cursor >= beats.length - 1;
  const streaming = !!live && !live.done;

  // Заставка → рассказчик.
  useEffect(() => {
    if (enter?.phase !== "title") return;
    const t = setTimeout(() => setEnter((x) => x && { ...x, phase: "story" }), ARRIVAL_MS);
    return () => clearTimeout(t);
  }, [enter?.phase]);

  // Рассказчик → NPC: через NPC_DELAY_MS после первой реплики; сразу, если рассказчик молчит или NPC в ходе нет.
  const storyShown = enter?.phase === "story" && all.length > 0;
  const npcFirst = firstSpeaker === 0;
  const noNpc = firstSpeaker < 0 && !live;
  useEffect(() => {
    if (!storyShown) return;
    const t = setTimeout(() => setEnter((x) => x && { ...x, phase: "open" }), npcFirst || noNpc ? 0 : NPC_DELAY_MS);
    return () => clearTimeout(t);
  }, [storyShown, npcFirst, noNpc]);

  // NPC вышел: если игрок дочитал рассказчика — сразу его реплика. Ход сохранён — вход окончен.
  const firstSpeakerRef = useRef(firstSpeaker);
  firstSpeakerRef.current = firstSpeaker;
  useEffect(() => {
    if (enter?.phase !== "open") return;
    const f = firstSpeakerRef.current;
    if (f > 0) setCursor((c) => (c === f - 1 ? f : c));
    if (!live) setEnter(null);
  }, [enter?.phase, live]);

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
    const bg = scene.locations[enter?.to ?? view.campaign.current];
    const npc = view.campaign.npc ? scene.npcs[key(view.campaign.npc.name)] : undefined;
    // Все, кто говорит в текущих репликах, — их портреты тоже ждём.
    const speakers = all.flatMap((b) => (b.speaker ? [scene.npcs[key(b.speaker)]] : []));
    return [bg, npc, scene.hero, ...speakers].some((x) => x && (x.status === "queued" || x.status === "working"));
  }, [view, scene, all, enter?.to]);
  // Пока ход не сохранён, сервер не знает фон новой локации — передаём его явно.
  const sceneUrl = `/api/campaigns/${id}/scene` + (enter?.imageId ? `?loc=${encodeURIComponent(enter.to)}&bg=${enter.imageId}` : "");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      api<SceneView>(sceneUrl)
        // Фоны не пропадают: ответ без ещё не сохранённой локации не должен затереть её.
        .then((s) => setView((v) => v && { ...v, scene: { ...s, locations: { ...v.scene.locations, ...s.locations } } }))
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(t);
  }, [pending, sceneUrl]);

  if (!view) return <main className="wrap">{error ? <p className="error">{error}</p> : <p className="muted">Открываю летопись…</p>}</main>;

  const { character: c, campaign: w } = view;
  const here = locationById(w, w.current)!;
  // Во время входа — уже новое место, даже пока ход не сохранён.
  const place = enter ? { name: enter.name, type: enter.type } : here;
  const bgUrl = scene?.locations[enter?.to ?? w.current]?.url;
  const titleCard = enter?.phase === "title";
  const beat = beats[Math.min(cursor, beats.length - 1)];
  const speakerName = beat?.speaker ?? null;
  // На сцене — тот, кто говорит; когда звучит голос рассказчика — последний собеседник, приглушённо.
  // При входе в локацию прежний собеседник остался позади: до выхода NPC сцена пуста, потом — тот, кто заговорит.
  const nextNpc = all.find((b) => b.speaker)?.speaker ?? null;
  const onStage = enter ? (enter.phase === "open" ? (speakerName ?? nextNpc) : null) : (speakerName ?? (w.combat ? null : (w.npc?.name ?? null)));
  const stage = onStage ? scene?.npcs[key(onStage)] : undefined;
  const role = speakerName && w.npc && key(w.npc.name) === key(speakerName) ? w.npc.role : undefined;
  const lastWithSuggestions = [...view.turns].reverse().find((t) => t.suggestions.length);
  const suggestions = !w.combat && lastWithSuggestions ? lastWithSuggestions.suggestions : [];
  const showChoices = !busy && !enter && atEnd && !w.combat;
  const submit = () => text.trim() && send({ kind: "action", text: text.trim() }, text.trim());
  const R = worldOf(c).rules;
  const ab = R.classes[c.cls]!.ability;

  return (
    <div className="vn">
      {bgUrl ? <img className="vn-bg" key={bgUrl} src={bgUrl} alt="" /> : <div className="vn-bg vn-bg-empty" />}
      <div className="vn-shade" />
      {titleCard ? null : w.combat ? (
        <>
          <Bust url={scene?.hero?.url} name={c.name} side="left" />
          <Bust url={null} name="Противник" side="right" />
        </>
      ) : (
        onStage && <Bust url={stage?.url} name={onStage} side="left" dim={!speakerName} failed={!stage || stage.status === "failed" || stage.status === "none"} />
      )}

      <header className="vn-hud">
        <div className="vn-place">
          <div className="name">{place.name}</div>
          <div className="sub">{locationTypeName(R, place.type)}</div>
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
                {c.hp}/{c.hpMax} · КД {c.ac} · {R.money.short(c.gold)}
              </span>
            </span>
          </button>
          <nav className="vn-tools" aria-label="Панели">
            <button className="vn-icon" onClick={() => setPanel("quest")} aria-label={`Журнал: ${worldOf(c).ui.quest.toLowerCase()}`}>
              {Icon.journal}
            </button>
            <button className="vn-icon" onClick={() => setPanel("map")} aria-label="Карта" disabled={!!w.combat}>
              {Icon.map}
            </button>
            {w.case && (
              <>
                <button className="vn-icon" onClick={() => setPanel("paper")} aria-label="Газета">
                  {Icon.newspaper}
                </button>
                <button className="vn-icon" onClick={() => setPanel("directory")} aria-label="Справочник" disabled={!!w.combat}>
                  {Icon.directory}
                </button>
              </>
            )}
            <Link className="vn-icon" href="/" aria-label="Все герои">
              {Icon.home}
            </Link>
          </nav>
        </div>
      </header>

      <section className="vn-dock" hidden={titleCard}>
        {(beat || streaming) && (
          <TextFrame speaker={speakerName} role={role} onAdvance={!atEnd ? advance : undefined} hint={!atEnd ? "Пробел" : undefined}>
            {beat ? beat.text : <span className="vn-writing">{live?.waiting}</span>}
            {beat && streaming && atEnd && <span className="vn-caret" aria-hidden="true" />}
          </TextFrame>
        )}
        <Pips total={beats.length} at={cursor} />
        {error && <p className="error small">{error}</p>}

        {w.combat && atEnd && !streaming && !enter && <CombatPanel w={w} c={c} disabled={busy} onMove={(move, target) => send({ kind: "combat", move, target }, move)} />}

        {showChoices && w.case?.result && (
          <button className="btn vn-case-done" onClick={() => setPanel("quest")}>
            Итоги дела: {w.case.result.score} из {w.case.result.mentor} →
          </button>
        )}
        {showChoices && !w.case?.result && w.case && w.case.visits >= w.case.limit && (
          <button className="btn vn-case-done" onClick={() => setPanel("close")}>
            Время вышло — закрыть дело
          </button>
        )}
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

      {enter && titleCard && (
        <div className="vn-arrival" aria-live="polite">
          <div className="rule">
            <span />
            Новое место
            <span />
          </div>
          <div className="title">{enter.name}</div>
          <div className="sub">{locationTypeName(R, enter.type)}</div>
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
        <Drawer title={w.case ? "Досье" : "Журнал"} onClose={() => setPanel(null)}>
          {w.case ? (
            <CaseFile w={w} busy={busy} onReconstruct={(t) => send({ kind: "reconstruct", text: t }, `Реконструкция: ${t}`)} onClose={() => setPanel("close")} />
          ) : (
            <>
              <Quest w={w} doneText={worldOf(c).ui.questDone} />
              <p className="small muted" style={{ marginTop: 12 }}>
                {w.hook}
              </p>
            </>
          )}
        </Drawer>
      )}
      {panel === "close" && w.case && (
        <Drawer title="Закрыть дело" onClose={() => setPanel("quest")}>
          <CloseCase c={w.case} busy={busy} onCancel={() => setPanel("quest")} onSubmit={(answers) => send({ kind: "close", answers }, "Дело закрыто")} />
        </Drawer>
      )}
      {panel === "paper" && w.case && (
        <Drawer title="Газета" onClose={() => setPanel(null)}>
          <Newspaper c={w.case} />
        </Drawer>
      )}
      {panel === "directory" && w.case && (
        <Drawer title="Справочник" onClose={() => setPanel(null)}>
          <Directory
            w={w}
            busy={busy}
            onLookup={(q) => send({ kind: "lookup", query: q }, `Справочник: «${q}»`)}
            onTravel={(to) => send({ kind: "travel", to }, `Путь в «${locationById(w, to)?.name}»`)}
          />
        </Drawer>
      )}
      {panel === "map" && (
        <Drawer title="Карта" onClose={() => setPanel(null)}>
          <WorldMap
            w={w}
            rules={R}
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
            {Object.keys(R.races).length > 1 ? `${R.races[c.race]?.name}, ` : ""}
            {R.classes[c.cls]?.name}. {ab.name}: {ab.desc}. {c.backstory}
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
