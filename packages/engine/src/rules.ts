/** Справочник правил: упрощённая D&D 5e, перенесено из прототипа «Хроники Пепла». */

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

export const SKILLS = {
  Атлетика: "str",
  Акробатика: "dex",
  "Ловкость рук": "dex",
  Скрытность: "dex",
  Магия: "int",
  История: "int",
  Расследование: "int",
  Природа: "int",
  Религия: "int",
  Внимательность: "wis",
  Проницательность: "wis",
  Медицина: "wis",
  Выживание: "wis",
  Обман: "cha",
  Запугивание: "cha",
  Выступление: "cha",
  Убеждение: "cha",
} as const satisfies Record<string, StatKey>;
export type SkillName = keyof typeof SKILLS;
export const SKILL_NAMES = Object.keys(SKILLS) as SkillName[];

/** Что можно проверять: навык или характеристика целиком («Сила»). */
export const CHECKABLE = [...SKILL_NAMES, ...STAT_KEYS.map((k) => STATS[k].full)];

export const RACE_KEYS = ["human", "elf", "dwarf", "halfling", "tiefling", "halforc"] as const;
export type RaceKey = (typeof RACE_KEYS)[number];

export const RACES: Record<RaceKey, { name: string; desc: string; bonus: Partial<Stats> }> = {
  human: { name: "Человек", desc: "Гибкие и честолюбивые. +1 ко всем характеристикам.", bonus: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 } },
  elf: { name: "Эльф", desc: "Долгоживущие, зоркие и изящные. +2 ЛОВ, +1 ИНТ.", bonus: { dex: 2, int: 1 } },
  dwarf: { name: "Дварф", desc: "Крепкие как камень горных залов. +2 ТЕЛ, +1 МДР.", bonus: { con: 2, wis: 1 } },
  halfling: { name: "Полурослик", desc: "Малы ростом, удачливы и храбры. +2 ЛОВ, +1 ХАР.", bonus: { dex: 2, cha: 1 } },
  tiefling: { name: "Тифлинг", desc: "Наследие преисподней в крови. +2 ХАР, +1 ИНТ.", bonus: { cha: 2, int: 1 } },
  halforc: { name: "Полуорк", desc: "Сила и ярость двух народов. +2 СИЛ, +1 ТЕЛ.", bonus: { str: 2, con: 1 } },
};

export type AbilityKind = "heal" | "strike" | "auto" | "mark";
export interface ClassAbility {
  name: string;
  uses: number;
  kind: AbilityKind;
  expr: string;
  desc: string;
}

export const CLASS_KEYS = ["fighter", "rogue", "wizard", "cleric", "ranger"] as const;
export type ClassKey = (typeof CLASS_KEYS)[number];

export interface ClassDef {
  name: string;
  desc: string;
  hitDie: number;
  baseAc: number;
  attackStat: StatKey;
  damage: string;
  weapon: string;
  skills: SkillName[];
  items: string[];
  ability: ClassAbility;
}

export const CLASSES: Record<ClassKey, ClassDef> = {
  fighter: {
    name: "Воин", desc: "Мастер оружия и доспеха. Много здоровья.", hitDie: 10, baseAc: 16, attackStat: "str", damage: "1d10", weapon: "длинным мечом",
    skills: ["Атлетика"], items: ["Длинный меч", "Кольчуга", "Щит", "Зелье лечения"],
    ability: { name: "Второе дыхание", uses: 1, kind: "heal", expr: "1d10+1", desc: "восстанавливает 1к10+1 здоровья" },
  },
  rogue: {
    name: "Плут", desc: "Тень, клинок и ловкие пальцы.", hitDie: 8, baseAc: 14, attackStat: "dex", damage: "1d6", weapon: "коротким клинком",
    skills: ["Скрытность"], items: ["Короткий меч", "Пара кинжалов", "Воровские инструменты", "Зелье лечения"],
    ability: { name: "Скрытая атака", uses: 1, kind: "strike", expr: "2d6", desc: "удар с дополнительными 2к6 урона" },
  },
  wizard: {
    name: "Маг", desc: "Тайное знание и разрушительные чары.", hitDie: 6, baseAc: 12, attackStat: "int", damage: "1d10", weapon: "огненным снарядом",
    skills: ["Магия"], items: ["Посох", "Книга заклинаний", "Мешочек компонентов", "Зелье лечения"],
    ability: { name: "Волшебная стрела", uses: 2, kind: "auto", expr: "3d4+3", desc: "три снаряда, всегда попадают (3к4+3)" },
  },
  cleric: {
    name: "Жрец", desc: "Голос божества: лечит и карает.", hitDie: 8, baseAc: 16, attackStat: "wis", damage: "1d8", weapon: "священным пламенем",
    skills: ["Религия"], items: ["Булава", "Священный символ", "Чешуйчатый доспех", "Зелье лечения"],
    ability: { name: "Лечение ран", uses: 2, kind: "heal", expr: "1d8+3", desc: "восстанавливает 1к8+3 здоровья" },
  },
  ranger: {
    name: "Следопыт", desc: "Охотник диких земель и меткий лучник.", hitDie: 10, baseAc: 14, attackStat: "dex", damage: "1d8", weapon: "длинным луком",
    skills: ["Выживание"], items: ["Длинный лук", "Колчан стрел", "Охотничий нож", "Зелье лечения"],
    ability: { name: "Метка охотника", uses: 1, kind: "mark", expr: "1d6", desc: "до конца боя каждое попадание +1к6" },
  },
};

/** Стоимость значения при распределении 27 очков. */
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;

export const RECOMMENDED_STATS: Record<ClassKey, Stats> = {
  fighter: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 10 },
  rogue: { str: 8, dex: 15, con: 13, int: 12, wis: 10, cha: 12 },
  wizard: { str: 8, dex: 13, con: 14, int: 15, wis: 12, cha: 8 },
  cleric: { str: 12, dex: 8, con: 14, int: 10, wis: 15, cha: 12 },
  ranger: { str: 10, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
};

/** Сколько навыков игрок выбирает сам, сверх навыка класса. */
export const CHOSEN_SKILLS = 2;

export const NAMES: Record<RaceKey, { m: string[]; f: string[] }> = {
  human: { m: ["Альдрик", "Бран", "Корвин", "Эдмунд", "Гарет", "Ланс"], f: ["Изольда", "Мирена", "Элайна", "Ровена", "Сейла", "Брия"] },
  elf: { m: ["Аэлар", "Тарион", "Фаэлин", "Сильвар", "Эрдан"], f: ["Аэлина", "Лириэль", "Наэви", "Шаэра", "Иллит"] },
  dwarf: { m: ["Торин", "Бруэнор", "Гримбальд", "Дургин", "Хальвар"], f: ["Хильда", "Ведра", "Бриана", "Торгга", "Ингрид"] },
  halfling: { m: ["Перрин", "Милло", "Тобиас", "Финнан", "Корри"], f: ["Розалия", "Лилли", "Мэрри", "Верна", "Пейша"] },
  tiefling: { m: ["Мордай", "Акмен", "Каррион", "Зевиль", "Дамакос"], f: ["Нимея", "Орианна", "Ксанти", "Мерисса", "Эвира"] },
  halforc: { m: ["Гром", "Хаск", "Тарг", "Дренч", "Укрог"], f: ["Шара", "Вола", "Энга", "Ульма", "Баггра"] },
};

export const LOCATION_TYPES = {
  tavern: "Таверна", village: "Деревня", forest: "Лес", road: "Тракт", cave: "Пещера", ruins: "Руины",
  castle: "Крепость", swamp: "Топи", mountains: "Горы", temple: "Храм", city: "Город", camp: "Лагерь",
} as const;
export type LocationType = keyof typeof LOCATION_TYPES;
export const LOCATION_TYPE_KEYS = Object.keys(LOCATION_TYPES) as LocationType[];
export const START_LOCATION_TYPES: LocationType[] = ["tavern", "village", "city", "camp"];

/** Шкала сложности проверок, как в плане: 10/13/15/18. */
export const DC = { easy: 10, medium: 13, hard: 15, veryHard: 18 } as const;
export const DC_MIN = 5;
export const DC_MAX = 25;

export const PROFICIENCY_BY_LEVEL = [0, 2, 2, 2, 2, 3] as const;
export const MAX_LEVEL = 5;
