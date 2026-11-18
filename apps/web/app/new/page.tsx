"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  abilityMod, CHOSEN_SKILLS, CLASSES, CLASS_KEYS, finalStats, NAMES, POINT_BUY_BUDGET, POINT_BUY_COST, pointsSpent,
  RACES, RACE_KEYS, RECOMMENDED_STATS, SKILL_NAMES, SKILLS, STATS, STAT_KEYS, validateDraft,
  type CharacterDraft, type ClassKey, type Gender, type RaceKey, type SkillName, type StatKey,
} from "@ash/engine";
import { api } from "@/lib/client";

const randomName = (race: RaceKey, g: Gender) => {
  const list = NAMES[race][g];
  return list[Math.floor(Math.random() * list.length)]!;
};

export default function NewHero() {
  const router = useRouter();
  const [race, setRace] = useState<RaceKey>("human");
  const [cls, setCls] = useState<ClassKey>("fighter");
  const [gender, setGender] = useState<Gender>("m");
  // Случайное имя — только на клиенте, иначе разметка сервера и браузера разойдётся.
  const [name, setName] = useState(NAMES.human.m[0]!);
  useEffect(() => setName(randomName("human", "m")), []);
  const [base, setBase] = useState({ ...RECOMMENDED_STATS.fighter });
  const [skills, setSkills] = useState<SkillName[]>([]);
  const [backstory, setBackstory] = useState("");
  const [busy, setBusy] = useState<"" | "story" | "create" | "faces">("");
  const [look, setLook] = useState("");
  const [faces, setFaces] = useState<{ id: string; label: string; status: string; url: string | null }[]>([]);
  const [face, setFace] = useState<string | null>(null);
  const [error, setError] = useState("");

  const draft: CharacterDraft = { name, gender, race, cls, base, skills, backstory };
  const errors = useMemo(() => validateDraft(draft), [name, gender, race, cls, base, skills, backstory]);
  const left = POINT_BUY_BUDGET - pointsSpent(base);
  const stats = finalStats(race, base);
  const classSkills = CLASSES[cls].skills;

  const pickClass = (k: ClassKey) => {
    setCls(k);
    setBase({ ...RECOMMENDED_STATS[k] });
    setSkills((s) => s.filter((x) => !CLASSES[k].skills.includes(x)));
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

  async function writeStory() {
    setBusy("story");
    setError("");
    try {
      setBackstory((await api<{ text: string }>("/api/backstory", { draft })).text);
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
    try {
      const r = await api<{ id: string }>("/api/campaigns", { draft, portraitId: face ?? undefined });
      router.push(`/play/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }

  return (
    <main className="wrap">
      <h1>Новый герой</h1>

      <div className="section">
        <h2>Раса</h2>
        <div className="choices">
          {RACE_KEYS.map((k) => (
            <button key={k} className={`choice ${race === k ? "on" : ""}`} onClick={() => (setRace(k), setName(randomName(k, gender)))}>
              <b>{RACES[k].name}</b>
              <span>{RACES[k].desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <h2>Класс</h2>
        <div className="choices">
          {CLASS_KEYS.map((k) => (
            <button key={k} className={`choice ${cls === k ? "on" : ""}`} onClick={() => pickClass(k)}>
              <b>{CLASSES[k].name}</b>
              <span>
                {CLASSES[k].desc} Умение: {CLASSES[k].ability.name} — {CLASSES[k].ability.desc}.
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <h2>Имя</h2>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} style={{ minWidth: 240 }} />
          <button className="btn ghost small" onClick={() => setName(randomName(race, gender))}>
            Случайное
          </button>
          <div className="chips">
            {(["m", "f"] as const).map((g) => (
              <button key={g} className={`chip ${gender === g ? "on" : ""}`} onClick={() => (setGender(g), setName(randomName(race, g)))}>
                {g === "m" ? "Мужчина" : "Женщина"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Характеристики</h2>
        <p className="small muted">
          Осталось очков: <b style={{ color: left ? "var(--gold)" : "inherit" }}>{left}</b> из {POINT_BUY_BUDGET}. Значения до бонусов расы — от 8 до 15.
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
        <p className="small muted">Класс даёт «{classSkills.join(", ")}». Выбери ещё {CHOSEN_SKILLS}.</p>
        <div className="chips">
          {SKILL_NAMES.map((s) => {
            const fixed = classSkills.includes(s);
            return (
              <button key={s} disabled={fixed} className={`chip ${fixed ? "fixed on" : skills.includes(s) ? "on" : ""}`} onClick={() => toggleSkill(s)}>
                {s} <span className="muted">{STATS[SKILLS[s]].short}</span>
              </button>
            );
          })}
        </div>
      </div>

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
              {name || "Безымянный"} — {RACES[race].name}, {CLASSES[cls].name}
            </div>
            <div className="small muted">Мастер придумает квест под героя и его предысторию.</div>
          </div>
          <button className="btn" onClick={create} disabled={!!busy || errors.length > 0}>
            {busy === "create" ? "Мастер готовит приключение…" : "Начать приключение"}
          </button>
        </div>
        {errors.length > 0 && <p className="small error">{errors.join(" ")}</p>}
        {error && <p className="small error">{error}</p>}
      </div>
    </main>
  );
}
