import { proficiency, type Character } from "./character";
import { abilityMod, clamp, die, signed } from "./dice";
import type { Rng } from "./rng";
import { DC_MAX, DC_MIN, STATS, STAT_KEYS, type Ruleset, type SkillName, type StatKey } from "./rules";

export type Edge = "none" | "advantage" | "disadvantage";

export interface CheckRequest {
  skill: string;
  dc: number;
  reason?: string;
  edge?: Edge;
}

export interface CheckResult {
  skill: string;
  stat: StatKey;
  dc: number;
  /** Все брошенные d20 (два при преимуществе/помехе). */
  d20s: number[];
  /** Засчитанный d20. */
  d20: number;
  modifier: number;
  total: number;
  success: boolean;
  crit: "success" | "fail" | null;
  verdict: string;
  /** Короткая строка для журнала и для модели. */
  summary: string;
}

/** Навык или характеристика → характеристика броска и признак владения. */
export function resolveSkill(r: Ruleset, name: string): { stat: StatKey; skill: SkillName | null } | null {
  const stat0 = r.skills[name];
  if (stat0) return { stat: stat0, skill: name };
  const stat = STAT_KEYS.find((k) => STATS[k].full.toLowerCase() === name.trim().toLowerCase());
  return stat ? { stat, skill: null } : null;
}

/**
 * Проверка навыка. Бросает только сервер; модель лишь просит проверку через roll_check.
 * 20 — всегда успех, 1 — всегда провал.
 */
export function skillCheck(r: Ruleset, c: Character, req: CheckRequest, rng: Rng): CheckResult {
  const resolved = resolveSkill(r, req.skill) ?? { stat: "wis" as StatKey, skill: null };
  const label = resolved.skill ?? (STAT_KEYS.includes(resolved.stat) ? STATS[resolved.stat].full : req.skill);
  const dc = clamp(Math.round(Number(req.dc) || 13), DC_MIN, DC_MAX);
  const prof = resolved.skill && c.skills.includes(resolved.skill) ? proficiency(c.level) : 0;
  const modifier = abilityMod(c.stats[resolved.stat]) + prof;
  const edge = req.edge ?? "none";
  const d20s = edge === "none" ? [die(20, rng)] : [die(20, rng), die(20, rng)];
  const d20 = edge === "advantage" ? Math.max(...d20s) : edge === "disadvantage" ? Math.min(...d20s) : d20s[0]!;
  const total = d20 + modifier;
  const crit = d20 === 20 ? "success" : d20 === 1 ? "fail" : null;
  const success = crit === "success" || (crit !== "fail" && total >= dc);
  const verdict = crit === "success" ? "Критический успех!" : crit === "fail" ? "Критический провал" : success ? "Успех" : "Провал";
  const edgeNote = edge === "advantage" ? " (преимущество)" : edge === "disadvantage" ? " (помеха)" : "";
  return {
    skill: label, stat: resolved.stat, dc, d20s, d20, modifier, total, success, crit, verdict,
    summary: `${label}${edgeNote}: ${d20}${signed(modifier)}=${total} против СЛ ${dc} — ${verdict.toLowerCase()}`,
  };
}
