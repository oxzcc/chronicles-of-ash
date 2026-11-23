"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CASE_HUB_ID, emotionAt, heroMood, locationById, locationTypeName, matchName, type CheckResult, type CombatEvent, type CombatMove, type CombatState, type LocationType } from "@ash/engine";
import { worldOf } from "@ash/worlds";
import { api, sleep, streamTurn, type Beat, type CampaignView, type SceneView, type Suggestion, type TurnEffect, type TurnView } from "@/lib/client";
import { CheckDialog, CombatPanel, Dice, diceFromCheck, diceFromCombat, Entry, Quest, Sheet, Suggestions, WorldMap, type DiceView } from "@/components/game";
import { BeatText, beatsOf, Bust, Drawer, heroBeat, Icon, Pips, playerKinds, TextFrame, type Mark, type Shown } from "@/components/vn";
import { CaseFile, CaseFinale, CloseCase, CloseCaseConfirm, Directory, Newspaper, People, StreetHub } from "@/components/case";

type Input =
  | { kind: "start" }
  | { kind: "action"; text: string }
  | { kind: "choice"; index: number }
  | { kind: "travel"; to: string }
  | { kind: "leave" }
  | { kind: "rest" }
  | { kind: "combat"; move: CombatMove; target?: number }
  | { kind: "lookup"; query: string }
  | { kind: "reconstruct"; text: string }
  | { kind: "close"; answers: Record<string, string> }
  | { kind: "present"; clue: string; text?: string };

interface Live {
  label: string;
  kind: Input["kind"];
  beats: Beat[];
  waiting: string;
  rolls: CheckResult[];
  combatEvents: CombatEvent[];
  done?: boolean;
}

type Panel = null | "history" | "quest" | "map" | "hero" | "paper" | "directory";
type Closing = null | "confirm" | "answers" | "resolution";

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
/** Сколько держится кадр с действием героя, прежде чем сам уступит ответу мира. */
const HERO_LINE_MS = 1200;

/** Портрет NPC по имени: точно или по похожему имени («Эзра» = «Эзра Кроу») — так же, как сервер. */
function npcView(scene: SceneView | undefined, name: string | null | undefined) {
  if (!scene || !name) return undefined;
  const all = Object.values(scene.npcs);
  const i = matchName(name, all.map((n) => n.name));
  return i >= 0 ? all[i] : undefined;
}

/** Портрет с устойчивой эмоцией: наследует её между репликами и ходами, но не между сценами и NPC. */
function StageBust({ name, sceneLocation, beats, index, stage, dim = false }: {
  name: string;
  sceneLocation: string;
  beats: Shown[];
  index: number;
  stage: SceneView["npcs"][string] | undefined;
  dim?: boolean;
}) {
  const carry = useRef<{ key: string; emotion?: string }>({ key: "" });
  const key = `${sceneLocation}|${name}`;
  const initial = carry.current.key === key ? carry.current.emotion : undefined;
  const emotion = emotionAt(beats, index, name, initial);
  useEffect(() => {
    carry.current = { key, ...(emotion ? { emotion } : {}) };
  }, [key, emotion]);
  const over = emotion ? stage?.emotions?.[emotion] : undefined;
  return <Bust url={stage?.url} over={over} name={name} side="left" dim={dim} failed={!stage || stage.status === "failed" || stage.status === "none"} />;
}

/** Противник на сцене: выбранная цель, если жива, иначе первый живой. */
const foeOf = (cb: CombatState) => cb.enemies.find((e) => e.id === cb.target && e.hp > 0) ?? cb.enemies.find((e) => e.hp > 0) ?? cb.enemies[0];

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
  /** Куда навести панель: id улики в досье или места в справочнике (клик по подсвеченной находке). */
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!panel) setFocus(null);
  }, [panel]);
  const [enter, setEnter] = useState<Enter | null>(null);
  const [closing, setClosing] = useState<Closing>(null);
  const [closeAnswers, setCloseAnswers] = useState<Record<string, string>>({});
  const [preparingClose, setPreparingClose] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const busy = live !== null || preparingClose;
  const started = useRef(false);
  const diceQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    api<CampaignView>(`/api/campaigns/${id}`)
      .then((v) => {
        setView(v);
        const last = v.turns.at(-1);
        const shown = v.campaign.case?.result ? ([...v.turns].reverse().find((t) => t.kind === "close") ?? last) : last;
        if (shown) {
          setBatch([shown]);
          setCursor(Math.max(0, beatsOf(shown, v.character.name, worldOf(v.character).features.combat !== false).length - 1));
          // Закрытое дело всегда открывается на финальном экране, а не на старом диалоге.
          if (v.campaign.case?.result) setClosing("resolution");
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
      if (kind === "leave") return "Выход на улицу";
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
      if (live) return false;
      let succeeded = false;
      setError("");
      setPanel(null);
      setCursor(0);
      // Начало и переход: заставка сразу, ещё до ответа сервера.
      const dest = input.kind === "travel" ? input.to : input.kind === "leave" ? CASE_HUB_ID : input.kind === "start" ? view?.campaign.current : undefined;
      const loc = dest && view ? locationById(view.campaign, dest) : undefined;
      setEnter(loc ? { to: loc.id, name: loc.name, type: loc.type, phase: "title", imageId: null } : null);
      setLive({ label, kind: input.kind, beats: [], waiting: waitingLabel(input.kind), rolls: [], combatEvents: [] });
      await streamTurn(`/api/campaigns/${id}/turn`, input, (e) => {
        if (e.type === "beats") setLive((l) => l && { ...l, beats: e.beats });
        else if (e.type === "arrive") {
          // Переход по рассказу (мастер довёл героя до другого места посреди хода): без заставки — сразу новая сцена.
          setEnter((x) => (x ? (x.to === e.location ? { ...x, imageId: e.imageId } : x) : { to: e.location, name: e.name, type: e.locType, phase: "open", imageId: e.imageId }));
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
          succeeded = true;
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
      return succeeded;
    },
    [id, live, view, waitingLabel],
  );

  const beginClosing = async () => {
    if (busy) return;
    setError("");
    setPanel(null);
    setEnter(null);
    setClosing("answers");
    setPreparingClose(true);
    try {
      const prepared = await api<{ scene: SceneView }>(`/api/campaigns/${id}/closing`, {});
      setView((v) => v && { ...v, scene: prepared.scene });
    } catch (e) {
      setClosing(null);
      setError((e as Error).message);
    } finally {
      setPreparingClose(false);
    }
  };

  const submitClose = async (answers: Record<string, string>) => {
    if (busy) return;
    setClosing("resolution");
    setBatch([]);
    const ok = await send({ kind: "close", answers }, "Дело закрыто");
    // Ответы остаются во внешнем состоянии: после сетевой или LLM-ошибки их не нужно вводить заново.
    if (!ok) setClosing("answers");
  };

  // Новая кампания — мастер сразу рассказывает завязку.
  useEffect(() => {
    if (view && view.turns.length === 0 && !started.current) {
      started.current = true;
      send({ kind: "start" }, "Начало приключения");
    }
  }, [view, send]);

  const combatEnabled = view ? worldOf(view.character).features.combat !== false : true;
  const combat = combatEnabled && view ? view.campaign.combat : null;
  // Реплики хода: пока ход идёт — потоковые, после — сохранённые. Первым кадром — действие самого героя.
  const heroName = view?.character.name;
  const all: Shown[] = useMemo(() => {
    if (live && !live.done)
      return [
        ...(heroName && playerKinds.has(live.kind) ? [heroBeat(heroName, live.label)] : []),
        ...live.beats,
        ...(combatEnabled ? live.combatEvents : []).map((e) => ({ speaker: null, text: e.text })),
      ];
    return batch.flatMap((t) => beatsOf(t, heroName, combatEnabled));
  }, [live, batch, heroName, combatEnabled]);
  const firstSpeaker = all.findIndex((b) => b.speaker && !b.hero);
  // При входе в локацию: во время заставки реплик нет, потом — только рассказчик, пока NPC не вышел.
  const gate = !enter || enter.phase === "open" ? all.length : enter.phase === "title" ? 0 : firstSpeaker < 0 ? all.length : firstSpeaker;
  const beats = useMemo(() => all.slice(0, gate), [all, gate]);
  const atEnd = cursor >= beats.length - 1;
  const streaming = !!live && !live.done;

  // Кадр с действием героя сам уступает первой реплике ответа, если игрок ещё на нём.
  const replyArrived = streaming && all.length > 1 && !!all[0]?.hero;
  useEffect(() => {
    if (!replyArrived) return;
    const t = setTimeout(() => setCursor((c) => (c === 0 ? 1 : c)), HERO_LINE_MS);
    return () => clearTimeout(t);
  }, [replyArrived]);

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
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON" || t.classList.contains("vn-mark") || panel || asking) return;
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
    const npc = npcView(scene, view.campaign.npc?.name);
    // Все, кто говорит в текущих репликах, — их портреты тоже ждём. И противника в бою.
    const speakers = all.map((b) => npcView(scene, b.speaker));
    const foe = combat ? npcView(scene, foeOf(combat)?.name) : undefined;
    // Варианты лица (эмоции, состояние героя) тоже приходят опросом.
    return !!scene.variantsPending || [bg, npc, foe, scene.hero, ...speakers].some((x) => x && (x.status === "queued" || x.status === "working"));
  }, [view, scene, all, enter?.to, combat]);
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

  // Готовые варианты лица — в кэш браузера заранее: эмоция появляется сразу, а не по мере загрузки.
  useEffect(() => {
    if (!scene) return;
    const urls = [...Object.values(scene.heroMoods ?? {}), ...Object.values(scene.npcs).flatMap((n) => Object.values(n.emotions ?? {}))];
    for (const u of urls) new Image().src = u;
  }, [scene]);

  if (!view) return <main className="wrap">{error ? <p className="error">{error}</p> : <p className="muted">Открываю летопись…</p>}</main>;

  const { character: c, campaign: w } = view;
  const here = locationById(w, w.current)!;
  const closureActive = closing === "answers" || closing === "resolution";
  const office = w.locations.find((l) => l.type === "office" && /Уэйкфилд/i.test(l.name)) ?? w.locations.find((l) => l.type === "office");
  // Ответы и развязка — отдельная сцена в кабинете, а не панель поверх текущего диалога.
  const place = closureActive && office ? office : enter ? { name: enter.name, type: enter.type } : here;
  const sceneLocation = closureActive && office ? office.id : (enter?.to ?? w.current);
  const bgUrl = scene?.locations[sceneLocation]?.url;
  const titleCard = !closureActive && enter?.phase === "title";
  const beat = beats[Math.min(cursor, beats.length - 1)];
  // Кадр героя: говорит он сам, на сцене остаётся собеседник — приглушённо, как при голосе рассказчика.
  const heroLine = !!beat?.hero;
  const speakerName = heroLine ? null : (beat?.speaker ?? null);
  // Лицо героя — по состоянию движка (ранен, на грани, срыв), если вариант уже нарисован.
  const mood = heroMood(c, w);
  const heroOver = mood ? scene?.heroMoods?.[mood] : undefined;
  const heroFace = heroOver ?? scene?.hero?.url;
  // На сцене — тот, кто говорит; когда звучит голос рассказчика — последний собеседник, приглушённо.
  // При входе в локацию прежний собеседник остался позади: до выхода NPC сцена пуста, потом — тот, кто заговорит.
  const nextNpc = all.find((b) => b.speaker)?.speaker ?? null;
  const onStage = closureActive ? speakerName : enter ? (enter.phase === "open" ? (speakerName ?? nextNpc) : null) : (speakerName ?? (combat ? null : (w.npc?.name ?? null)));
  const stage = npcView(scene, onStage);
  // До первой реплики развязки остаётся задумчивый герой; затем на сцене только говорящие NPC.
  const closingHero = closing === "answers" || (closing === "resolution" && !beat);
  const role = speakerName && w.npc && matchName(speakerName, [w.npc.name]) === 0 ? w.npc.role : undefined;
  const foe = combat ? foeOf(combat) : undefined;
  const foeImg = npcView(scene, foe?.name);
  const lastWithSuggestions = [...view.turns].reverse().find((t) => t.suggestions.length);
  const suggestions = !combat && lastWithSuggestions ? lastWithSuggestions.suggestions : [];
  const showChoices = !busy && !enter && atEnd && !combat && !closureActive;
  const atHub = w.current === CASE_HUB_ID;
  const showHub = showChoices && !!w.case && atHub && !w.case.result;
  const finale = closing === "resolution" && !!w.case?.result && atEnd && !streaming && !live && !!beat && !beat.speaker && !beat.hero;
  const submit = () => text.trim() && send({ kind: "action", text: text.trim() }, text.trim());
  const world = worldOf(c);
  const R = world.rules;
  const ab = R.classes[c.cls]!.ability;
  // Итог последнего действия: полоски здоровья и рассудка вспыхивают при потере.
  const fx = batch.flatMap((t) => t.effects ?? []);
  const hurt = (kind: TurnEffect["kind"]) => fx.some((e) => e.kind === kind && !e.good);
  // Клик по подсвеченной находке: улика — в досье, адрес — в справочник (или на карту), рассудок и здоровье — лист героя.
  const openMark = (m: Mark) => {
    if (closureActive) return;
    setFocus(m.ref ?? null);
    if (m.kind === "address") setPanel(w.case ? "directory" : "map");
    else if (m.kind === "clue" || m.kind === "deduction" || m.kind === "objective" || m.kind === "attitude" || m.kind === "caught") setPanel("quest");
    else setPanel("hero");
  };

  return (
    <div className={`vn ${closureActive ? "vn-closing" : ""} ${closing === "answers" ? "vn-answering" : ""}`}>
      {bgUrl ? <img className="vn-bg" key={bgUrl} src={bgUrl} alt="" /> : <div className="vn-bg vn-bg-empty" />}
      <div className="vn-shade" />
      {titleCard ? null : closureActive ? (
        closingHero ? (
          <Bust url={scene?.hero?.url} over={scene?.heroMoods?.thinking} name={c.name} side="left" />
        ) : (
          onStage && <StageBust name={onStage} sceneLocation={sceneLocation} beats={all} index={cursor} stage={stage} />
        )
      ) : combat ? (
        <>
          <Bust url={scene?.hero?.url} over={heroOver} name={c.name} side="left" />
          <Bust url={foeImg?.url} name={foe?.name ?? "Противник"} side="right" failed={!foeImg || foeImg.status === "failed" || foeImg.status === "none"} />
        </>
      ) : (
        onStage && <StageBust name={onStage} sceneLocation={sceneLocation} beats={all} index={cursor} stage={stage} dim={!speakerName} />
      )}

      <header className="vn-hud">
        <div className="vn-place">
          <div className="name">{place.name}</div>
          <div className="sub">{locationTypeName(R, place.type)}</div>
        </div>
        <div className="vn-hud-right">
          <button className="vn-hero" onClick={() => setPanel("hero")} aria-label="Лист героя">
            {heroFace ? <img key={heroFace} src={heroFace} alt="" /> : <span className="vn-hero-ph">{c.name[0]}</span>}
            <span className="vn-hero-info">
              <span className="n">{c.name}</span>
              <span key={`hp${view.turnNo}`} className={`vn-hp ${hurt("hp") ? "hurt" : ""}`} role="img" aria-label={`Здоровье ${c.hp} из ${c.hpMax}`}>
                <span style={{ width: `${(100 * c.hp) / c.hpMax}%` }} />
              </span>
              {c.sanity !== undefined && c.sanityMax ? (
                <span key={`sn${view.turnNo}`} className={`vn-hp vn-sanity ${c.sanity * 3 <= c.sanityMax ? "low" : ""} ${hurt("sanity") ? "hurt" : ""}`} role="img" aria-label={`Рассудок ${c.sanity} из ${c.sanityMax}`}>
                  <span style={{ width: `${(100 * c.sanity) / c.sanityMax}%` }} />
                </span>
              ) : null}
              <span className="vn-stat">
                {c.hp}/{c.hpMax}{combatEnabled ? ` · КД ${c.ac}` : ""} · {R.money.short(c.gold)}
              </span>
            </span>
          </button>
          <nav className="vn-tools" aria-label="Панели">
            <button className="vn-icon" onClick={() => setPanel("quest")} aria-label={`Журнал: ${worldOf(c).ui.quest.toLowerCase()}`}>
              {Icon.journal}
            </button>
            <button className="vn-icon" onClick={() => setPanel("map")} aria-label="Карта" disabled={!!combat}>
              {Icon.map}
            </button>
            {w.case && (
              <>
                <button className="vn-icon" onClick={() => setPanel("paper")} aria-label="Газета">
                  {Icon.newspaper}
                </button>
                <button className="vn-icon" onClick={() => setPanel("directory")} aria-label="Справочник" disabled={!!combat}>
                  {Icon.directory}
                </button>
              </>
            )}
            <Link className="vn-icon" href="/" aria-label="Главный экран">
              {Icon.home}
            </Link>
          </nav>
        </div>
      </header>

      <section className={`vn-dock ${closing === "answers" ? "vn-dock-close" : ""}`} hidden={titleCard}>
        {closing === "answers" && w.case ? (
          <CloseCase c={w.case} busy={busy} answers={closeAnswers} onChange={setCloseAnswers} onSubmit={submitClose} onCancel={() => { setClosing(null); setError(""); }} />
        ) : finale && w.case?.result && beat ? (
          <CaseFinale result={w.case.result} text={beat.text} />
        ) : (
          <>
            {(beat || streaming) && (
              <TextFrame
                speaker={heroLine ? c.name : speakerName}
                role={heroLine ? undefined : role}
                hero={heroLine}
                avatar={heroLine ? heroFace : undefined}
                onAdvance={!atEnd ? advance : undefined}
                hint={!atEnd ? "Пробел" : undefined}
              >
                {beat ? <BeatText beat={beat} onMark={openMark} /> : <span className="vn-writing">{live?.waiting}</span>}
                {heroLine && streaming && atEnd ? (
                  <div className="vn-writing vn-after">{live?.waiting}</div>
                ) : (
                  beat && streaming && atEnd && <span className="vn-caret" aria-hidden="true" />
                )}
              </TextFrame>
            )}
            {closing !== "answers" && <Pips total={beats.length} at={cursor} />}
          </>
        )}
        {error && <p className="error small">{error}</p>}

        {combat && atEnd && !streaming && !enter && <CombatPanel w={w} c={c} disabled={busy} onMove={(move, target) => send({ kind: "combat", move, target }, move)} />}

        {showChoices && !w.case?.result && w.case && w.case.visits >= w.case.limit && (
          <button className="btn vn-case-done" onClick={() => setClosing("confirm")}>
            Время вышло — закрыть дело
          </button>
        )}
        {showHub && (
          <StreetHub w={w} busy={busy} onTravel={(to) => send({ kind: "travel", to }, `Путь в «${locationById(w, to)?.name}»`)} />
        )}
        {showChoices && w.case && !atHub && !w.case.result && (
          <button className="btn ghost vn-leave" onClick={() => send({ kind: "leave" }, "Выхожу на улицу")}>
            Выйти на улицу
          </button>
        )}
        {showChoices && !atHub && (
          <div className="vn-choices">
            {suggestions.length > 0 && (
              <Suggestions
                items={suggestions}
                c={c}
                disabled={busy}
                onPick={(index) => {
                  const s = suggestions[index]!;
                  // «Предъявить» — свой ход: уличит ли улика собеседника, решает игра.
                  if (s.present && w.case && w.npc) send({ kind: "present", clue: s.present, text: s.text }, s.text);
                  else if (s.check) setAsking({ index, s: s as typeof s & { check: NonNullable<typeof s.check> } });
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

      {!closureActive && (
        <button className="vn-history" onClick={() => setPanel("history")}>
          {Icon.history}
          История
        </button>
      )}

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
          {view.turns.filter((t) => combatEnabled || t.kind !== "combat" || t.beats.length > 0).map((t) => (
            <Entry key={t.turnNo} t={t} isCase={!!w.case} combat={combatEnabled} />
          ))}
        </Drawer>
      )}
      {panel === "quest" && (
        <Drawer title={w.case ? "Досье" : "Журнал"} onClose={() => setPanel(null)}>
          {w.case ? (
            <CaseFile
              w={w}
              busy={busy}
              focus={focus}
              onPresent={(clue) => {
                const x = w.case?.clues.find((k) => k.id === clue);
                send({ kind: "present", clue }, `Показываю ${w.npc?.name ?? ""}: ${x?.title ?? x?.text ?? "улику"}`);
              }}
              onReconstruct={(t) => send({ kind: "reconstruct", text: t }, `Реконструкция: ${t}`)}
              onClose={() => { setPanel(null); setClosing("confirm"); }}
            />
          ) : (
            <>
              <Quest w={w} doneText={worldOf(c).ui.questDone} />
              <People w={w} focus={focus} title="Знакомые" />
              <p className="small muted" style={{ marginTop: 12 }}>
                {w.hook}
              </p>
            </>
          )}
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
            focus={focus}
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
            disabled={busy || !!combat}
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
            {R.classes[c.cls]?.name}. {combatEnabled ? `${ab.name}: ${ab.desc}. ` : ""}{c.backstory}
          </p>
          <p className="small muted">
            Ходов: {view.turnNo} · расход: ${view.costUsd.toFixed(3)}
          </p>
        </Drawer>
      )}

      {closing === "confirm" && <CloseCaseConfirm busy={preparingClose} onConfirm={beginClosing} onCancel={() => setClosing(null)} />}

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
