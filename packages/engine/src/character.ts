import { abilityMod, die } from "./dice";
import type { Rng } from "./rng";
import {
  CHOSEN_SKILLS, CLASSES, CLASS_KEYS, POINT_BUY_BUDGET, POINT_BUY_COST, PROFICIENCY_BY_LEVEL, RACES, RACE_KEYS,
  SKILLS, STATS, STAT_KEYS, type ClassKey, type RaceKey, type SkillName, type Stats,
} from "./rules";

export type Gender = "m" | "f";

export interface CharacterDraft {
  name: string;
  gender: Gender;
  race: RaceKey;
  cls: ClassKey;
  /** Значения до расовых бонусов, 8–15. */
  base: Stats;
  /** Навыки, выбранные игроком сверх навыка класса. */
  skills: SkillName[];
  backstory?: string;
}

export interface Character {
  name: string;
  gender: Gender;
  race: RaceKey;
  cls: ClassKey;
  level: number;
  xp: number;
  stats: Stats;
  skills: SkillName[];
  hp: number;
  hpMax: number;
  ac: number;
  gold: number;
  items: string[];
  abilityUses: number;
  backstory: string;
}

export const MAX_NAME = 24;
export const MAX_BACKSTORY = 1200;

export function pointsSpent(base: Stats): number {
  return STAT_KEYS.reduce((sum, k) => sum + (POINT_BUY_COST[base[k]] ?? Infinity), 0);
}

export function finalStats(race: RaceKey, base: Stats): Stats {
  const bonus = RACES[race].bonus;
  const out = {} as Stats;
  for (const k of STAT_KEYS) out[k] = base[k] + (bonus[k] ?? 0);
  return out;
}

/** Ошибки черновика по-русски — показываются игроку как есть. Пустой массив — всё верно. */
export function validateDraft(d: CharacterDraft): string[] {
  const errors: string[] = [];
  const name = d.name?.trim() ?? "";
  if (!name) errors.push("Дай герою имя.");
  else if (name.length > MAX_NAME) errors.push(`Имя не длиннее ${MAX_NAME} символов.`);
  if (!RACE_KEYS.includes(d.race)) errors.push("Неизвестная раса.");
  if (!CLASS_KEYS.includes(d.cls)) errors.push("Неизвестный класс.");
  if (d.gender !== "m" && d.gender !== "f") errors.push("Неизвестный пол.");
  for (const k of STAT_KEYS) {
    const v = d.base?.[k];
    if (!Number.isInteger(v) || v < 8 || v > 15) errors.push("Каждая характеристика — от 8 до 15 до бонусов расы.");
  }
  if (errors.length === 0 && pointsSpent(d.base) > POINT_BUY_BUDGET) errors.push(`Потрачено больше ${POINT_BUY_BUDGET} очков.`);
  const classSkills = CLASSES[d.cls]?.skills ?? [];
  const chosen = new Set(d.skills ?? []);
  if (chosen.size !== CHOSEN_SKILLS) errors.push(`Выбери ровно ${CHOSEN_SKILLS} навыка.`);
  for (const s of chosen) {
    if (!(s in SKILLS)) errors.push(`Неизвестный навык: ${s}.`);
    else if (classSkills.includes(s)) errors.push(`Навык «${s}» уже даёт класс.`);
  }
  if ((d.backstory ?? "").length > MAX_BACKSTORY) errors.push(`Предыстория не длиннее ${MAX_BACKSTORY} символов.`);
  return [...new Set(errors)];
}

export function createCharacter(d: CharacterDraft, rng: Rng): Character {
  const errors = validateDraft(d);
  if (errors.length) throw new Error(errors.join(" "));
  const cls = CLASSES[d.cls];
  const stats = finalStats(d.race, d.base);
  const hpMax = Math.max(4, cls.hitDie + abilityMod(stats.con));
  // Лёгкий и средний доспех добавляет до +2 ЛОВ, тяжёлый — нет.
  const ac = cls.baseAc + (cls.baseAc <= 14 ? Math.min(2, abilityMod(stats.dex)) : 0);
  return {
    name: d.name.trim(),
    gender: d.gender,
    race: d.race,
    cls: d.cls,
    level: 1,
    xp: 0,
    stats,
    skills: [...cls.skills, ...d.skills],
    hp: hpMax,
    hpMax,
    ac,
    gold: 10 + die(10, rng),
    items: [...cls.items],
    abilityUses: cls.ability.uses,
    backstory: (d.backstory ?? "").trim(),
  };
}

export const proficiency = (level: number) => PROFICIENCY_BY_LEVEL[Math.min(level, PROFICIENCY_BY_LEVEL.length - 1)] ?? 2;

/** Лист персонажа для промпта мастера. */
export function sheetText(c: Character): string {
  const stats = STAT_KEYS.map((k) => {
    const m = abilityMod(c.stats[k]);
    return `${STATS[k].short} ${c.stats[k]} (${m >= 0 ? "+" : ""}${m})`;
  }).join(", ");
  return [
    `${c.name}, ${c.gender === "f" ? "женщина" : "мужчина"}, ${RACES[c.race].name}, ${CLASSES[c.cls].name} ${c.level} уровня. HP ${c.hp}/${c.hpMax}, КД ${c.ac}, золото ${c.gold}.`,
    `Характеристики: ${stats}.`,
    `Владеет навыками: ${c.skills.join(", ")}.`,
    `Снаряжение: ${c.items.join(", ") || "ничего"}.`,
    `Предыстория: ${c.backstory || "не указана"}`,
  ].join("\n");
}
