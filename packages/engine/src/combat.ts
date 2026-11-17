import { proficiency, type Character } from "./character";
import { abilityMod, clamp, die, isDiceExpr, maxOfExpr, rollExpr, signed } from "./dice";
import type { Rng } from "./rng";
import type { Ruleset } from "./rules";

/** Враг, как его объявила модель, — до ограничений. */
export interface EnemySpec {
  name?: unknown;
  hp?: unknown;
  ac?: unknown;
  attack?: unknown;
  damage?: unknown;
}

export interface Enemy {
  id: number;
  name: string;
  hp: number;
  hpMax: number;
  ac: number;
  attack: number;
  damage: string;
}

export interface DiceShow {
  label: string;
  d20: number;
  calc: string;
  verdict: string;
  tone: "crit" | "ok" | "bad";
}

export interface CombatEvent {
  text: string;
  tone: "hit" | "miss" | "hurt" | "info";
  /** Анимация броска на клиенте. */
  dice?: DiceShow;
}

export interface CombatState {
  enemies: Enemy[];
  round: number;
  target: number;
  dodge: boolean;
  mark: boolean;
  log: CombatEvent[];
}

export type CombatMove = "attack" | "ability" | "potion" | "dodge" | "flee";
export type CombatOutcome = "ongoing" | "victory" | "fled" | "defeat";

export const MAX_ENEMIES = 3;
const LOG_MAX = 40;

/** Пределы врагов по уровню героя: модель не может выставить непобедимого противника. */
export function enemyLimits(level: number) {
  return {
    hp: [3, 22 + 8 * (level - 1)] as const,
    ac: [8, 15 + Math.floor(level / 2)] as const,
    attack: [0, 5 + (level - 1)] as const,
    maxDamage: 8 + 3 * level,
  };
}

export function normalizeEnemies(specs: EnemySpec[], level: number): Enemy[] {
  const L = enemyLimits(level);
  return specs.slice(0, MAX_ENEMIES).map((e, i) => {
    const hp = clamp(Math.round(Number(e.hp) || 10), ...L.hp);
    const dmg = isDiceExpr(e.damage) && maxOfExpr(e.damage) <= L.maxDamage ? e.damage : "1d6+1";
    return {
      id: i,
      name: (typeof e.name === "string" && e.name.trim() ? e.name.trim() : "Враг").slice(0, 32),
      hp,
      hpMax: hp,
      ac: clamp(Math.round(Number(e.ac) || 12), ...L.ac),
      attack: clamp(Math.round(Number(e.attack) || 3), ...L.attack),
      damage: dmg,
    };
  });
}

const alive = (cb: CombatState) => cb.enemies.filter((e) => e.hp > 0);
const push = (cb: CombatState, ev: CombatEvent, out: CombatEvent[]) => {
  cb.log.push(ev);
  if (cb.log.length > LOG_MAX) cb.log.shift();
  out.push(ev);
};

export interface CombatStep {
  events: CombatEvent[];
  outcome: CombatOutcome;
}

/** Начало боя: инициатива; если враги быстрее, они бьют первыми. */
export function startCombat(c: Character, specs: EnemySpec[], rng: Rng): { state: CombatState } & CombatStep {
  const enemies = normalizeEnemies(specs, c.level);
  if (!enemies.length) throw new Error("No enemies");
  const state: CombatState = { enemies, round: 1, target: 0, dodge: false, mark: false, log: [] };
  const events: CombatEvent[] = [];
  const pi = die(20, rng) + abilityMod(c.stats.dex);
  const ei = die(20, rng) + 2;
  if (pi >= ei) {
    push(state, { text: `Инициатива: ты (${pi}) действуешь первым.`, tone: "info" }, events);
    return { state, events, outcome: "ongoing" };
  }
  push(state, { text: `Инициатива: враги (${ei}) быстрее тебя (${pi}).`, tone: "info" }, events);
  const step = enemyTurn(state, c, rng);
  return { state, events: [...events, ...step.events], outcome: step.outcome };
}

function attackRoll(r: Ruleset, cb: CombatState, c: Character, target: Enemy, rng: Rng, out: CombatEvent[], extra?: string, label?: string) {
  const cls = r.classes[c.cls]!;
  const statMod = abilityMod(c.stats[cls.attackStat]);
  const m = statMod + proficiency(c.level);
  const d = die(20, rng);
  const total = d + m;
  const crit = d === 20;
  const hit = crit || (d !== 1 && total >= target.ac);
  const dice: DiceShow = {
    label: label ?? `Атака: ${target.name}`,
    d20: d,
    calc: `${d} ${signed(m)} = ${total} против КД ${target.ac}`,
    verdict: crit ? "Критическое попадание!" : hit ? "Попадание" : "Промах",
    tone: crit ? "crit" : hit ? "ok" : "bad",
  };
  if (!hit) {
    push(cb, { text: `Ты бьёшь ${cls.weapon} по цели «${target.name}» — промах.`, tone: "miss", dice }, out);
    return;
  }
  let dmg = rollExpr(cls.damage, rng, crit).total + statMod;
  if (extra) dmg += rollExpr(extra, rng, crit).total;
  if (cb.mark) dmg += rollExpr("1d6", rng, crit).total;
  dmg = Math.max(1, dmg);
  target.hp -= dmg;
  push(cb, {
    text: `${crit ? "Сокрушительный удар! " : ""}Ты поражаешь «${target.name}» ${cls.weapon}: ${dmg} урона.${target.hp <= 0 ? " Враг повержен." : ""}`,
    tone: "hit",
    dice,
  }, out);
}

function enemyTurn(cb: CombatState, c: Character, rng: Rng): CombatStep {
  const events: CombatEvent[] = [];
  for (const e of alive(cb)) {
    let r = die(20, rng);
    if (cb.dodge) r = Math.min(r, die(20, rng));
    const total = r + e.attack;
    const crit = r === 20;
    const hit = crit || (r !== 1 && total >= c.ac);
    if (hit) {
      const dmg = rollExpr(e.damage, rng, crit).total;
      c.hp = Math.max(0, c.hp - dmg);
      push(cb, { text: `«${e.name}» ${crit ? "наносит страшный удар" : "попадает"} (${r}${signed(e.attack)}=${total}): −${dmg} здоровья.`, tone: "hurt" }, events);
    } else push(cb, { text: `«${e.name}» атакует (${total}) — мимо.`, tone: "miss" }, events);
    if (c.hp <= 0) break;
  }
  cb.dodge = false;
  cb.round++;
  return { events, outcome: c.hp <= 0 ? "defeat" : "ongoing" };
}

/** Лечебный предмет мира (зелье, аптечка). */
export const isHealing = (r: Ruleset, item: string) => r.healing.pattern.test(item);

/** Ход игрока и ответный ход врагов. Мутирует состояние боя и героя. */
export function playerMove(r: Ruleset, cb: CombatState, c: Character, move: CombatMove, rng: Rng, targetId?: number): CombatStep {
  const events: CombatEvent[] = [];
  if (targetId !== undefined) {
    const t = cb.enemies.find((e) => e.id === targetId && e.hp > 0);
    if (t) cb.target = t.id;
  }
  let target = cb.enemies.find((e) => e.id === cb.target && e.hp > 0) ?? alive(cb)[0];
  if (!target) return { events, outcome: "victory" };
  cb.target = target.id;
  const cls = r.classes[c.cls]!;

  switch (move) {
    case "attack":
      attackRoll(r, cb, c, target, rng, events);
      break;
    case "ability": {
      if (c.abilityUses <= 0) throw new Error("Умение уже потрачено.");
      c.abilityUses--;
      const ab = cls.ability;
      if (ab.kind === "heal") {
        const before = c.hp;
        c.hp = Math.min(c.hpMax, c.hp + rollExpr(ab.expr, rng).total);
        push(cb, { text: `${ab.name}: ты восстанавливаешь ${c.hp - before} здоровья.`, tone: "hit" }, events);
      } else if (ab.kind === "strike") attackRoll(r, cb, c, target, rng, events, ab.expr, `${ab.name}: ${target.name}`);
      else if (ab.kind === "mark") {
        cb.mark = true;
        push(cb, { text: `${ab.name}: добыча помечена, каждое попадание наносит +1к6.`, tone: "hit" }, events);
        attackRoll(r, cb, c, target, rng, events);
      } else {
        const v = rollExpr(ab.expr, rng).total;
        target.hp -= v;
        push(cb, { text: `${ab.name}: ${ab.hitText ?? "удар достигает цели"} «${target.name}» — ${v} урона.${target.hp <= 0 ? " Враг повержен." : ""}`, tone: "hit" }, events);
      }
      break;
    }
    case "potion": {
      const i = c.items.findIndex((x) => isHealing(r, x));
      if (i < 0) throw new Error(r.healing.none);
      c.items.splice(i, 1);
      const before = c.hp;
      c.hp = Math.min(c.hpMax, c.hp + rollExpr(r.healing.expr, rng).total);
      push(cb, { text: r.healing.used(c.hp - before), tone: "hit" }, events);
      break;
    }
    case "dodge":
      cb.dodge = true;
      push(cb, { text: "Ты уходишь в глухую защиту: враги атакуют с помехой.", tone: "info" }, events);
      break;
    case "flee": {
      const m = abilityMod(c.stats.dex) + (c.skills.includes(r.fleeSkill) ? proficiency(c.level) : 0);
      const d = die(20, rng);
      const ok = d + m >= 12;
      const dice: DiceShow = { label: "Бегство", d20: d, calc: `${d} ${signed(m)} = ${d + m} против СЛ 12`, verdict: ok ? "Удалось оторваться" : "Не вышло", tone: ok ? "ok" : "bad" };
      if (ok) {
        push(cb, { text: "Ты вырываешься из схватки и бежишь.", tone: "info", dice }, events);
        return { events, outcome: "fled" };
      }
      push(cb, { text: "Тебе не дают уйти!", tone: "hurt", dice }, events);
      break;
    }
  }

  if (!alive(cb).length) return { events, outcome: "victory" };
  const next = alive(cb)[0];
  if (target.hp <= 0 && next) cb.target = next.id;
  const enemy = enemyTurn(cb, c, rng);
  return { events: [...events, ...enemy.events], outcome: enemy.outcome };
}

/** Строка итога боя для промпта рассказчика. */
export function combatSummary(cb: CombatState): string {
  return cb.enemies.map((e) => `${e.name} (${e.hp <= 0 ? "повержен" : "жив"})`).join(", ");
}
