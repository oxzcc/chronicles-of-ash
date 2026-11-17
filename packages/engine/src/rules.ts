/**
 * Общие правила (упрощённая D&D 5e) и форма набора правил мира.
 * Сами расы, классы, навыки и типы мест лежат в пакете мира (@ash/worlds) —
 * движок получает их параметром `Ruleset` и сам ничего о мире не знает.
 */

export const STAT_KEYS = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const STATS: Record<StatKey, { short: string; full: string }> = {
  str: { short: "СИЛ", full: "Сила" },
  dex: { short: "ЛОВ", full: "Ловкость" },
  con: { short: "ТЕЛ", full: "Телосложение" },
  int: { short: "ИНТ", full: "Интеллект" },
  wis: { short: "МДР", full: "Мудрость" },
  cha: { short: "ХАР", full: "Харизма" },
};

/** Ключи из набора правил мира — просто строки: у каждого мира свои. */
export type RaceKey = string;
export type ClassKey = string;
export type SkillName = string;
export type LocationType = string;

export interface RaceDef {
  name: string;
  desc: string;
  bonus: Partial<Stats>;
}

export type AbilityKind = "heal" | "strike" | "auto" | "mark";
export interface ClassAbility {
  name: string;
  uses: number;
  kind: AbilityKind;
  expr: string;
  desc: string;
  /**
   * Как звучит умение в журнале боя. kind "auto": чем бьёт («три сияющих снаряда бьют»);
   * kind "mark": что помечено («добыча помечена»).
   */
  hitText?: string;
}

export interface ClassDef {
  name: string;
  desc: string;
  hitDie: number;
  baseAc: number;
  attackStat: StatKey;
  damage: string;
  /** Творительный падеж: «длинным мечом» — «Ты бьёшь длинным мечом по цели». */
  weapon: string;
  /** Свои строки журнала атаки (огнестрел не «бьёт»). Без них — «Ты бьёшь {weapon}…». */
  attackText?: {
    miss: (target: string) => string;
    hit: (target: string, dmg: number) => string;
  };
  skills: SkillName[];
  items: string[];
  ability: ClassAbility;
}

export interface LocationTypeDef {
  /** Название для игрока: «Таверна». */
  name: string;
  /** На дороге к такому месту встречи редки. */
  safe?: boolean;
  /** Годится для начала приключения. */
  start?: boolean;
  /** Общественное место: в деле известно с начала (его адрес есть в любом справочнике). */
  public?: boolean;
}

/** Лечебный предмет, который можно применить в бою. */
export interface HealingItem {
  /** Как узнать предмет в инвентаре. */
  pattern: RegExp;
  /** Подпись кнопки в бою: «Зелье». */
  label: string;
  /** Подпись счётчика на листе героя: «Зелий». */
  countLabel: string;
  expr: string;
  /** Строка журнала боя по количеству восстановленного здоровья. */
  used: (hp: number) => string;
  /** Ошибка, если предметов не осталось. */
  none: string;
}

/** Деньги мира: золото, доллары. */
export interface Money {
  /** Сумма: «5 золота», «$5». */
  amount: (n: number) => string;
  /** Строка листа персонажа: «золото 12». */
  sheet: (n: number) => string;
  /** Коротко, для плашки героя: «12 зол.», «$12». */
  short: (n: number) => string;
}

/** Всё, что движку нужно знать о мире. Неизменяемые данные, без состояния. */
export interface Ruleset {
  /** id мира: "fantasy", "arkham". Пишется в лист героя. */
  id: string;
  skills: Record<SkillName, StatKey>;
  races: Record<RaceKey, RaceDef>;
  classes: Record<ClassKey, ClassDef>;
  /** Рекомендуемое распределение характеристик для класса. */
  recommended: Record<ClassKey, Stats>;
  /** Имена по расе и полу. */
  names: Record<RaceKey, { m: string[]; f: string[] }>;
  locationTypes: Record<LocationType, LocationTypeDef>;
  /** Тип места, если модель назвала неизвестный. */
  defaultLocationType: LocationType;
  /** Тип первого места, если модель поставила в начало что-то негодное для старта. */
  defaultStartType: LocationType;
  money: Money;
  healing: HealingItem;
  /** Навык, который помогает сбежать из боя. */
  fleeSkill: SkillName;
}

export const raceKeys = (r: Ruleset): RaceKey[] => Object.keys(r.races);
export const classKeys = (r: Ruleset): ClassKey[] => Object.keys(r.classes);
export const skillNames = (r: Ruleset): SkillName[] => Object.keys(r.skills);
export const locationTypeKeys = (r: Ruleset): LocationType[] => Object.keys(r.locationTypes);
export const startLocationTypes = (r: Ruleset): LocationType[] => locationTypeKeys(r).filter((t) => r.locationTypes[t]!.start);

/** Что можно проверять: навык или характеристика целиком («Сила»). */
export const checkable = (r: Ruleset): string[] => [...skillNames(r), ...STAT_KEYS.map((k) => STATS[k].full)];

/** Стоимость значения при распределении 27 очков. */
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;

/** Сколько навыков игрок выбирает сам, сверх навыка класса. */
export const CHOSEN_SKILLS = 2;

/** Шкала сложности проверок, как в плане: 10/13/15/18. */
export const DC = { easy: 10, medium: 13, hard: 15, veryHard: 18 } as const;
export const DC_MIN = 5;
export const DC_MAX = 25;

export const PROFICIENCY_BY_LEVEL = [0, 2, 2, 2, 2, 3] as const;
export const MAX_LEVEL = 5;
