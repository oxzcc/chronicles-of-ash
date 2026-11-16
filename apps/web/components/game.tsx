"use client";

import {
  abilityMod, CLASSES, LOCATION_TYPES, neighbors, proficiency, RACES, isPotion, resolveSkill, STATS,
  type Campaign, type Character, type CheckResult, type CombatMove, type DiceShow,
} from "@ash/engine";
import type { Beat, Suggestion, TurnView } from "@/lib/client";

/** Кубик на экране — из проверки навыка или из боя. */
export type DiceView = { label: string; d20: number; calc: string; verdict: string; tone: "crit" | "ok" | "bad" };

export const diceFromCheck = (r: CheckResult): DiceView => ({
  label: r.skill,
  d20: r.d20,
  calc: `${r.d20s.length > 1 ? `(${r.d20s.join(" и ")}) ` : ""}${r.d20} ${r.modifier >= 0 ? "+" : "−"} ${Math.abs(r.modifier)} = ${r.total} против СЛ ${r.dc}`,
  verdict: r.verdict,
  tone: r.crit === "success" ? "crit" : r.success ? "ok" : "bad",
});
export const diceFromCombat = (d: DiceShow): DiceView => d;

export function Dice({ dice }: { dice: DiceView }) {
  return (
    <div className="dice-veil" role="status" aria-live="polite">
      <div className="dice">
        <div className="label">{dice.label}</div>
        <div className="d20 spin" key={dice.calc}>
          {dice.d20}
        </div>
        <div className="label">{dice.calc}</div>
        <div className={`verdict ${dice.tone}`}>{dice.verdict}</div>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { travel: "Путь", rest: "Привал", knockout: "Поражение", start: "" };

/** Реплики хода: повествование отдельными абзацами, речь NPC — в рамке с именем, как в новелле. */
export function Beats({ beats }: { beats: Beat[] }) {
  return (
    <>
      {beats.map((b, i) =>
        b.speaker ? (
          <div key={i} className="say">
            <div className="say-name">{b.speaker}</div>
            <div className="say-text">{b.text}</div>
          </div>
        ) : (
          b.text.split(/\n+/).filter(Boolean).map((p, k) => (
            <p key={`${i}-${k}`} className="narr">
              {p}
            </p>
          ))
        ),
      )}
    </>
  );
}

export function Entry({ t }: { t: Pick<TurnView, "kind" | "action" | "beats" | "rolls" | "combatEvents"> }) {
  const player = t.kind === "action" || t.kind === "choice";
  return (
    <div className="entry">
      {player && <div className="you">{t.action}</div>}
      {!player && t.kind !== "start" && t.kind !== "combat" && <div className="you">{KIND_LABEL[t.kind] ?? ""} · {t.action}</div>}
      {t.rolls.map((r, i) => (
        <span key={i} className={`roll-chip ${r.success ? "" : "fail"}`}>
          🎲 {r.summary}
        </span>
      ))}
      {t.combatEvents.length > 0 && (
        <div className="combat-log">
          {t.combatEvents.map((e, i) => (
            <div key={i} className={e.tone}>
              {e.text}
            </div>
          ))}
        </div>
      )}
      <Beats beats={t.beats} />
    </div>
  );
}

/** Модификатор и шанс успеха проверки — игрок видит их до броска, как в BG3. */
export function checkOdds(c: Character, skill: string, dc: number) {
  const r = resolveSkill(skill) ?? { stat: "wis" as const, skill: null };
  const mod = abilityMod(c.stats[r.stat]) + (r.skill && c.skills.includes(r.skill) ? proficiency(c.level) : 0);
  let wins = 0;
  for (let d = 1; d <= 20; d++) if (d === 20 || (d !== 1 && d + mod >= dc)) wins++;
  return { mod, chance: wins * 5, stat: STATS[r.stat].short, proficient: !!(r.skill && c.skills.includes(r.skill)) };
}

export function Suggestions({ items, c, disabled, onPick }: { items: Suggestion[]; c: Character; disabled: boolean; onPick: (index: number) => void }) {
  return (
    <div className="suggestions">
      {items.map((s, i) => (
        <button key={i} disabled={disabled} onClick={() => onPick(i)}>
          {s.check && (
            <span className="check-tag">
              {s.check.skill} · СЛ {s.check.dc}
            </span>
          )}
          {s.text}
        </button>
      ))}
    </div>
  );
}

export function CheckDialog({ s, c, onRoll, onCancel }: { s: Suggestion & { check: { skill: string; dc: number } }; c: Character; onRoll: () => void; onCancel: () => void }) {
  const o = checkOdds(c, s.check.skill, s.check.dc);
  return (
    <div className="dice-veil" onClick={onCancel}>
      <div className="check-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Проверка навыка">
        <div className="small muted">Проверка</div>
        <h2>{s.check.skill}</h2>
        <div className="check-dc">СЛ {s.check.dc}</div>
        <p className="small muted">«{s.text}»</p>
        <div className="kv" style={{ justifyContent: "center", gap: 18 }}>
          <span>
            Бонус {o.mod >= 0 ? "+" : "−"}
            {Math.abs(o.mod)} ({o.stat}
            {o.proficient ? ", владение" : ""})
          </span>
          <span>Шанс {o.chance}%</span>
        </div>
        <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
          <button className="btn" onClick={onRoll} autoFocus>
            Бросить d20
          </button>
          <button className="btn ghost" onClick={onCancel}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sheet({ c }: { c: Character }) {
  const ab = CLASSES[c.cls].ability;
  return (
    <div className="card">
      <h3>{c.name}</h3>
      <div className="small muted">
        {RACES[c.race].name}, {CLASSES[c.cls].name} {c.level} уровня
      </div>
      <div className="bar" aria-label={`Здоровье ${c.hp} из ${c.hpMax}`}>
        <div style={{ width: `${(100 * c.hp) / c.hpMax}%` }} />
      </div>
      <div className="kv">
        <span>
          Здоровье {c.hp}/{c.hpMax}
        </span>
        <span>КД {c.ac}</span>
        <span>Золото {c.gold}</span>
      </div>
      <div className="kv" style={{ marginTop: 6 }}>
        <span>
          {ab.name}: {c.abilityUses}/{ab.uses}
        </span>
        <span>Зелий: {c.items.filter(isPotion).length}</span>
      </div>
      <h3 style={{ marginTop: 14 }}>Снаряжение</h3>
      <ul className="items">
        {c.items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

export function Quest({ w }: { w: Campaign }) {
  return (
    <div className="card">
      <h3>{w.questTitle}</h3>
      {w.objectives.map((o) => (
        <p key={o.id} className={`obj ${o.done ? "done" : ""}`}>
          {o.done ? "✓" : "○"} {o.text}
        </p>
      ))}
      {w.complete && <p className="obj" style={{ color: "var(--gold)" }}>Квест выполнен.</p>}
    </div>
  );
}

export function WorldMap({ w, disabled, onTravel, onRest }: { w: Campaign; disabled: boolean; onTravel: (id: string) => void; onRest: () => void }) {
  const near = new Set(neighbors(w, w.current).map((l) => l.id));
  const W = 300;
  const H = 200;
  // Поля по краям, чтобы подписи крайних точек не обрезались.
  const px = (x: number) => 30 + x * (W - 60);
  const py = (y: number) => 12 + y * (H - 32);
  const pos = (id: string) => {
    const l = w.locations.find((x) => x.id === id)!;
    return [px(l.x), py(l.y)] as const;
  };
  return (
    <div className="card">
      <h3>Карта</h3>
      <svg className="map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Карта локаций">
        {w.edges.map(([a, b]) => {
          const [x1, y1] = pos(a);
          const [x2, y2] = pos(b);
          const active = (a === w.current && near.has(b)) || (b === w.current && near.has(a));
          return <line key={a + b} x1={x1} y1={y1} x2={x2} y2={y2} stroke={active ? "#8a5a33" : "#3a2e24"} strokeWidth={active ? 2 : 1.2} strokeDasharray={active ? "" : "3 3"} />;
        })}
        {w.locations.map((l) => {
          const [x, y] = [px(l.x), py(l.y)];
          const anchor = l.x < 0.15 ? "start" : l.x > 0.85 ? "end" : "middle";
          const here = l.id === w.current;
          const can = near.has(l.id) && !disabled;
          return (
            <g key={l.id} className={`node ${can ? "near" : ""}`} onClick={() => can && onTravel(l.id)}>
              <title>{`${l.name} — ${LOCATION_TYPES[l.type]}. ${l.desc}${can ? " Нажми, чтобы отправиться." : ""}`}</title>
              <circle cx={x} cy={y} r={here ? 7 : 5.5} fill={here ? "#d9773a" : l.visited ? "#6b5640" : "#2b2119"} stroke={l.id === w.target ? "#d9b25c" : "#5a4630"} strokeWidth={l.id === w.target ? 2 : 1} />
              <text x={anchor === "start" ? x - 8 : anchor === "end" ? x + 8 : x} y={y + 15} textAnchor={anchor}>
                {l.name.length > 18 ? l.name.slice(0, 17) + "…" : l.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="small muted" style={{ marginTop: 8 }}>
        Здесь: {w.locations.find((l) => l.id === w.current)?.name}. Дороги ведут в: {[...near].map((id) => w.locations.find((l) => l.id === id)?.name).join(", ")}.
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        {[...near].map((id) => (
          <button key={id} className="btn ghost small" disabled={disabled} onClick={() => onTravel(id)}>
            → {w.locations.find((l) => l.id === id)?.name}
          </button>
        ))}
        <button className="btn ghost small" disabled={disabled} onClick={onRest}>
          Привал
        </button>
      </div>
    </div>
  );
}

const MOVES: { move: CombatMove; label: string }[] = [
  { move: "attack", label: "Атаковать" },
  { move: "ability", label: "Умение" },
  { move: "potion", label: "Зелье" },
  { move: "dodge", label: "Защита" },
  { move: "flee", label: "Бежать" },
];

export function CombatPanel({ w, c, disabled, onMove }: { w: Campaign; c: Character; disabled: boolean; onMove: (m: CombatMove, target?: number) => void }) {
  const cb = w.combat!;
  return (
    <div className="composer">
      <div className="small muted" style={{ marginBottom: 8 }}>
        Бой · раунд {cb.round}. Выбери цель и действие.
      </div>
      <div className="enemies">
        {cb.enemies.map((e) => (
          <button key={e.id} className={`enemy ${e.id === cb.target ? "target" : ""} ${e.hp <= 0 ? "dead" : ""}`} disabled={disabled || e.hp <= 0} onClick={() => onMove("attack", e.id)}>
            {e.name} — {Math.max(0, e.hp)}/{e.hpMax} HP · КД {e.ac}
          </button>
        ))}
      </div>
      <div className="moves">
        {MOVES.map((m) => (
          <button
            key={m.move}
            className={m.move === "attack" ? "btn" : "btn ghost"}
            disabled={disabled || (m.move === "ability" && c.abilityUses <= 0) || (m.move === "potion" && !c.items.some(isPotion))}
            onClick={() => onMove(m.move, cb.target)}
          >
            {m.move === "ability" ? CLASSES[c.cls].ability.name : m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
