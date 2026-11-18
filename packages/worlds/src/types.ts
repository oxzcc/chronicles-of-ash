import type { Gender, LocationType, QuestSeed, RaceKey, Ruleset } from "@ash/engine";

/**
 * Мир игры — всё, что отличает одно приключение от другого: правила (расы, классы, навыки, места),
 * куски промптов мастера и служебной модели, запасной квест и визуальный стиль.
 * Ядро (engine, llm, images, game) миров не знает и получает их параметром.
 * Описание мира для промпта — файл `world.md` в папке мира; читает его сервер.
 */
export interface World {
  id: string;
  /** Название игры в этом мире. */
  title: string;
  /** Одна строка под названием. */
  tagline: string;
  rules: Ruleset;
  /** Куски правил мастера. Общие разделы (проверки, бой, форма ответа) собирает @ash/llm. */
  gm: GmText;
  /** Жанр для служебных промптов: «тёмного фэнтези (в духе Baldur's Gate 3)». */
  genre: string;
  /** Запасной квест — если модель дважды не вернула годный JSON. */
  fallbackQuest: QuestSeed;
  art: ArtStyle;
}

export interface GmText {
  /** Первая фраза правил: кто такой мастер и в какой игре. */
  role: string;
  /** Что указывать в changes: «здоровье, золото или снаряжение». */
  stateNoun: string;
  /** Начало раздела ГРАНИЦЫ: какой контент допустим. */
  boundaries: string;
  /** Пояснение к проверкам в вариантах: « (как в Baldur's Gate 3)». */
  choicesNote: string;
  /** Пример варианта с проверкой в JSON-образце. */
  suggestionExample: { text: string; skill: string; dc: number };
}

export type TimeOfDay = "day" | "dusk" | "night";

/** Визуальный стиль мира для FLUX. Промпты картинок — по-английски. */
export interface ArtStyle {
  /** Префикс каждого промпта: техника, палитра, эпоха. */
  stylePrefix: string;
  /** Добавка к фонам: настроение, частицы в воздухе. */
  backgroundLight: string;
  timeEn: Record<TimeOfDay, string>;
  /** Жанр в служебных промптах: "dark fantasy". */
  genreEn: string;
  /** Кто такой незнакомец, если модель ничего не описала. */
  strangerEn: string;
  /** Кто такой местный житель для запасного описания. */
  localEn: string;
  /** Как назвать место в просьбе описать фон: "medieval dark fantasy location". */
  locationNounEn: string;
  /** Ограничение эпохи для фонов: "Only medieval objects: …". */
  eraRuleEn: string;
  raceEn: (race: RaceKey, gender: Gender) => string;
  classEn: Record<string, string>;
  locationEn: Record<LocationType, string>;
  /** Места, которые рисуются изнутри (и ночью). */
  interiorTypes: LocationType[];
}
