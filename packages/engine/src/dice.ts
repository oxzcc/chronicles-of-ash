import type { Rng } from "./rng";

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function die(sides: number, rng: Rng): number {
  return 1 + Math.floor(rng() * sides);
}

/** Модификатор характеристики по D&D 5e. */
export const abilityMod = (score: number) => Math.floor((score - 10) / 2);

export const signed = (n: number) => (n >= 0 ? "+" : "−") + Math.abs(n);

const EXPR = /^\s*(\d{1,2})d(\d{1,3})\s*(?:([+-])\s*(\d{1,2}))?\s*$/i;

/** Допустимая формула кубиков: «2d6», «1d8+3», «3d4-1». */
export function isDiceExpr(e: unknown): e is string {
  return typeof e === "string" && EXPR.test(e);
}

export interface DiceResult {
  total: number;
  rolls: number[];
  bonus: number;
}

/** Бросок формулы. При крите удваивается число кубиков, а не бонус. */
export function rollExpr(expr: string, rng: Rng, crit = false): DiceResult {
  const m = EXPR.exec(expr);
  if (!m) throw new Error(`Bad dice expression: ${expr}`);
  let n = Number(m[1]);
  const sides = Number(m[2]);
  if (crit) n *= 2;
  const rolls = Array.from({ length: n }, () => die(sides, rng));
  const bonus = m[3] ? (m[3] === "-" ? -1 : 1) * Number(m[4]) : 0;
  return { total: Math.max(0, rolls.reduce((a, b) => a + b, 0) + bonus), rolls, bonus };
}

/** Максимум формулы — для ограничения урона врагов. */
export function maxOfExpr(expr: string): number {
  const m = EXPR.exec(expr);
  if (!m) return 0;
  const bonus = m[3] ? (m[3] === "-" ? -1 : 1) * Number(m[4]) : 0;
  return Number(m[1]) * Number(m[2]) + bonus;
}
