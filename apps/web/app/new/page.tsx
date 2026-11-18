"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  abilityMod, CHOSEN_SKILLS, classKeys, finalStats, POINT_BUY_BUDGET, POINT_BUY_COST, pointsSpent, raceKeys, sanityMaxFor,
  skillNames, STATS, STAT_KEYS, validateDraft,
  type CharacterDraft, type ClassKey, type Gender, type RaceKey, type SkillName, type StatKey,
} from "@ash/engine";
import { DEFAULT_WORLD, getWorld, isWorldId, WORLDS, type World } from "@ash/worlds";
import { api, streamSse, type CreateStreamEvent } from "@/lib/client";

const firstRace = (w: World) => raceKeys(w.rules)[0]!;
const firstClass = (w: World) => classKeys(w.rules)[0]!;

const randomName = (w: World, race: RaceKey, g: Gender) => {
  const list = w.rules.names[race]?.[g] ?? [];
  return list[Math.floor(Math.random() * list.length)] ?? "";
};

export default function NewHero() {
  const router = useRouter();
  const [worldId, setWorldId] = useState(DEFAULT_WORLD);
  const world = getWorld(worldId);
  const R = world.rules;
  const [race, setRace] = useState<RaceKey>(firstRace(world));
  const [cls, setCls] = useState<ClassKey>(firstClass(world));
  const [gender, setGender] = useState<Gender>("m");
  // Случайное имя — только на клиенте, иначе разметка сервера и браузера разойдётся.
  const [name, setName] = useState(R.names[firstRace(world)]?.m[0] ?? "");
  const [base, setBase] = useState({ ...R.recommended[firstClass(world)]! });
  const [skills, setSkills] = useState<SkillName[]>([]);
  const [backstory, setBackstory] = useState("");
  const [phobia, setPhobia] = useState("");
  const [busy, setBusy] = useState<"" | "story" | "create" | "faces">("");
  const [look, setLook] = useState("");
  const [faces, setFaces] = useState<{ id: string; label: string; status: string; url: string | null }[]>([]);
  const [face, setFace] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Extract<CreateStreamEvent, { type: "progress" }> | null>(null);

  /** Смена мира: расы, классы и навыки у миров свои — черновик начинается заново. */
  const pickWorld = (id: string) => {
    const w = getWorld(id);
    setWorldId(id);
    setRace(firstRace(w));
    setCls(firstClass(w));
    setBase({ ...w.rules.recommended[firstClass(w)]! });
    setSkills([]);
    setName(randomName(w, firstRace(w), gender));
    setFaces([]);
    setFace(null);
    setBackstory("");
    setPhobia("");
  };
  // Мир из ссылки с главной (/new?world=arkham) и случайное имя — после загрузки.
  useEffect(() => {
    const w = new URLSearchParams(window.location.search).get("world");
    if (isWorldId(w) && w !== DEFAULT_WORLD) pickWorld(w);
    else setName(randomName(world, firstRace(world), "m"));
  }, []);

  const draft: CharacterDraft = { world: world.id, name, gender, race, cls, base, skills, backstory, ...(R.sanity ? { phobia } : {}) };
  const errors = useMemo(() => validateDraft(R, draft), [worldId, name, gender, race, cls, base, skills, backstory, phobia]);
  const left = POINT_BUY_BUDGET - pointsSpent(base);
  const stats = finalStats(R, race, base);
  const classSkills = R.classes[cls]?.skills ?? [];

  const pickClass = (k: ClassKey) => {
    setCls(k);
    setBase({ ...R.recommended[k]! });
    setSkills((s) => s.filter((x) => !R.classes[k]!.skills.includes(x)));
  };
  const bump = (k: StatKey, d: number) => {
    const v = base[k] + d;
    if (v < 8 || v > 15) return;
    const next = { ...base, [k]: v };
    if (pointsSpent(next) > POINT_BUY_BUDGET) return;
    setBase(next);
  };
  const toggleSkill = (s: SkillName) =>
    setSkills((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : cur.length < CHOSEN_SKILLS ? [...cur, s] : cur));

  /**
   * Ранний старт: пока игрок выбирает портрет или читает предысторию, мастер уже придумывает дело.
   * Ответ не ждём; неполный герой сервер просто пропустит. Если потом герой изменится —
   * при старте дело придумается заново.
   */
  const pregen = (d: CharacterDraft) => {
    if (validateDraft(R, d).length === 0) void fetch("/api/campaigns/pregen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: d }) }).catch(() => undefined);
  };

  async function writeStory() {
    setBusy("story");
    setError("");
    try {
      const text = (await api<{ text: string }>("/api/backstory", { draft })).text;
      setBackstory(text);
      pregen({ ...draft, backstory: text });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function drawFaces() {
    setBusy("faces");
    setError("");
    setFace(null);
    pregen(draft);
    try {
      const r = await api<{ options: { id: string; label: string }[] }>("/api/portraits", { draft, notes: look });
      setFaces(r.options.map((o) => ({ ...o, status: "queued", url: null })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  // Портреты рисуются в фоне — опрашиваем, пока не будут готовы все четыре.
  const facesPending = faces.some((f) => f.status === "queued" || f.status === "working");
  useEffect(() => {
    if (!facesPending) return;
    const t = setInterval(async () => {
      const r = await api<{ images: { id: string; status: string; url: string | null }[] }>(`/api/portraits?ids=${faces.map((f) => f.id).join(",")}`).catch(() => null);
      if (!r) return;
      setFaces((cur) => cur.map((f) => ({ ...f, ...(r.images.find((i) => i.id === f.id) ?? {}) })));
    }, 1000);
    return () => clearInterval(t);
  }, [facesPending, faces]);

  async function create() {
    setBusy("create");
    setError("");
    setProgress(null);
    let id = "";
    let failed = "";
    try {
      // Поток событий: полоса загрузки, пока мастер придумывает квест или дело.
      await streamSse<CreateStreamEvent>("/api/campaigns", { draft, portraitId: face ?? undefined }, (e) => {
        if (e.type === "progress") setProgress(e);
        else if (e.type === "done") {
          id = e.id;
          setProgress((p) => (p ? { ...p, value: 1, etaSec: null } : p));
        } else failed = e.message;
      });
    } catch {
      failed = "Связь прервалась. Попробуй ещё раз.";
    }
    if (id) return router.push(`/play/${id}`);
    setError(failed || "Мастер сбился с мысли. Попробуй ещё раз.");
    setProgress(null);
    setBusy("");
  }

  return (
    <main className="wrap">
      <h1>Новый герой</h1>

      <div className="section">
        <h2>Мир</h2>
        <div className="choices worlds">
          {WORLDS.map((w) => (
            <button key={w.id} className={`choice ${worldId === w.id ? "on" : ""}`} onClick={() => worldId !== w.id && pickWorld(w.id)} disabled={!!busy}>
              <b>{w.title}</b>
              <span>{w.tagline}</span>
            </button>
          ))}
        </div>
      </div>

      {/* В мире с одним народом выбирать нечего — шаг скрыт. */}
      {raceKeys(R).length > 1 && (
        <div className="section">
          <h2>Раса</h2>
          <div className="choices">
            {raceKeys(R).map((k) => (
              <button key={k} className={`choice ${race === k ? "on" : ""}`} onClick={() => (setRace(k), setName(randomName(world, k, gender)))}>
                <b>{R.races[k]!.name}</b>
                <span>{R.races[k]!.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <h2>{raceKeys(R).length > 1 ? "Класс" : "Профессия"}</h2>
        <div className="choices">
          {classKeys(R).map((k) => (
            <button key={k} className={`choice ${cls === k ? "on" : ""}`} onClick={() => pickClass(k)}>
              <b>{R.classes[k]!.name}</b>
              <span>
                {R.classes[k]!.desc} Умение: {R.classes[k]!.ability.name} — {R.classes[k]!.ability.desc}.
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <h2>Имя</h2>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} style={{ minWidth: 240 }} />
          <button className="btn ghost small" onClick={() => setName(randomName(world, race, gender))}>
            Случайное
          </button>
          <div className="chips">
            {(["m", "f"] as const).map((g) => (
              <button key={g} className={`chip ${gender === g ? "on" : ""}`} onClick={() => (setGender(g), setName(randomName(world, race, g)))}>
                {g === "m" ? "Мужчина" : "Женщина"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Характеристики</h2>
        <p className="small muted">
          Осталось очков: <b style={{ color: left ? "var(--gold)" : "inherit" }}>{left}</b> из {POINT_BUY_BUDGET}. Значения{raceKeys(R).length > 1 ? " до бонусов расы" : ""} — от 8 до 15.
        </p>
        <div className="stats">
          {STAT_KEYS.map((k) => {
            const m = abilityMod(stats[k]);
            const next = base[k] + 1;
            const canUp = next <= 15 && (POINT_BUY_COST[next] ?? 99) - (POINT_BUY_COST[base[k]] ?? 0) <= left;
            return (
              <div key={k} className="stat">
                <div className="small muted">{STATS[k].full}</div>
                <div className="row" style={{ justifyContent: "center" }}>
                  <button onClick={() => bump(k, -1)} disabled={base[k] <= 8} aria-label="меньше">
                    −
                  </button>
                  <span className="v">{stats[k]}</span>
                  <button onClick={() => bump(k, 1)} disabled={!canUp} aria-label="больше">
                    +
                  </button>
                </div>
                <div className="m">{m >= 0 ? `+${m}` : `−${-m}`}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="section">
        <h2>Навыки</h2>
        <p className="small muted">
          {raceKeys(R).length > 1 ? "Класс" : "Профессия"} даёт «{classSkills.join(", ")}». Выбери ещё {CHOSEN_SKILLS}.
        </p>
        <div className="chips">
          {skillNames(R).map((s) => {
            const fixed = classSkills.includes(s);
            return (
              <button key={s} disabled={fixed} className={`chip ${fixed ? "fixed on" : skills.includes(s) ? "on" : ""}`} onClick={() => toggleSkill(s)}>
                {s} <span className="muted">{STATS[R.skills[s]!].short}</span>
              </button>
            );
          })}
        </div>
      </div>

      {R.sanity && (
        <div className="section">
          <h2>Фобия</h2>
          <p className="small muted">
            У каждого сыщика есть страх, с которым он не справляется. В такой ситуации проверки идут с помехой. Рассудок героя — {sanityMaxFor(stats.wis)}: он тает от встреч с
            непостижимым и не возвращается отдыхом.
          </p>
          <div className="chips">
            {R.sanity.phobias.map((p) => (
              <button key={p} className={`chip ${phobia === p ? "on" : ""}`} onClick={() => setPhobia(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <h2>Облик</h2>
        <p className="small muted">Опиши внешность или оставь пустым — мастер нарисует четыре разных варианта. Выбранный портрет станет лицом героя во всех сценах.</p>
        <div className="row">
          <input value={look} onChange={(e) => setLook(e.target.value)} maxLength={300} placeholder="Например: рыжая, шрам через бровь, потёртый кожаный плащ" style={{ flex: 1, minWidth: 260 }} />
          <button className="btn ghost small" onClick={drawFaces} disabled={!!busy || facesPending}>
            {busy === "faces" ? "Мастер придумывает образы…" : faces.length ? "Ещё 4 варианта" : "Нарисовать 4 варианта"}
          </button>
        </div>
        {faces.length > 0 && (
          <div className="faces">
            {faces.map((f) => (
              <button key={f.id} className={`face ${face === f.id ? "on" : ""}`} disabled={f.status !== "ready"} onClick={() => setFace(f.id)} aria-label={`Портрет: ${f.label}`}>
                {f.url ? <img src={f.url} alt="" /> : <span className="face-wait">{f.status === "failed" ? "Не вышло" : "Рисую…"}</span>}
                <span className="face-label">{f.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h2>Предыстория</h2>
        <textarea
          value={backstory}
          onChange={(e) => setBackstory(e.target.value)}
          // Дописал предысторию сам — дело начинает придумываться под неё.
          onBlur={() => faces.length > 0 && pregen(draft)}
          maxLength={1200}
          rows={4}
          style={{ width: "100%" }}
          placeholder="Кем был герой до того, как всё началось? Можно оставить пустым или попросить мастера."
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn ghost small" onClick={writeStory} disabled={!!busy}>
            {busy === "story" ? "Мастер пишет…" : backstory ? "Переписать с учётом заметок" : "Придумать предысторию"}
          </button>
        </div>
      </div>

      <div className="section card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 20 }}>
              {name || "Безымянный"} — {raceKeys(R).length > 1 ? `${R.races[race]?.name}, ` : ""}{R.classes[cls]?.name}
            </div>
            <div className="small muted">{world.ui.newGameHint}</div>
          </div>
          <button className="btn" onClick={create} disabled={!!busy || errors.length > 0}>
            {busy === "create" ? world.ui.starting : world.ui.start}
          </button>
        </div>
        {errors.length > 0 && <p className="small error">{errors.join(" ")}</p>}
        {error && <p className="small error">{error}</p>}
      </div>

      {busy === "create" && <CreateProgress world={world} progress={progress} />}
    </main>
  );
}

/** Экран ожидания, пока рассказчик придумывает квест или дело: настоящий прогресс и примерное время. */
function CreateProgress({ world, progress }: { world: World; progress: Extract<CreateStreamEvent, { type: "progress" }> | null }) {
  const value = progress?.value ?? 0;
  const eta = progress?.etaSec;
  return (
    <div className="gen-overlay" role="dialog" aria-modal="true" aria-label="Создание кампании">
      <div className="gen-card">
        <div className="gen-title">{world.title}</div>
        <div className="gen-label">{progress?.label ?? world.ui.starting}</div>
        <div className="gen-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
          <div className="gen-fill" style={{ width: `${Math.max(2, value * 100)}%` }} />
        </div>
        <div className="gen-meta">
          <span>{Math.round(value * 100)}%</span>
          <span>{value >= 1 ? "Готово" : eta ? `осталось около ${eta} с` : "почти готово"}</span>
        </div>
        <p className="gen-hint">Не закрывай вкладку: {world.features.case ? "дело" : "приключение"} придумывается целиком, обычно {world.features.case ? "около минуты" : "секунд 15"}.</p>
      </div>
    </div>
  );
}
