import type { CaseSeed, Gender, LocationType, QuestSeed, RaceKey, Ruleset } from "@ash/engine";

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
  /** Слова интерфейса, которые зависят от мира. */
  ui: {
    /** Как называется задание: «Квест», «Дело». */
    quest: string;
    /** Задание выполнено: «Квест выполнен.» */
    questDone: string;
    /** Подсказка над кнопкой старта на экране героя. */
    newGameHint: string;
    /** Кнопка старта и её состояние ожидания. */
    start: string;
    starting: string;
  };
  /** Запасной квест — если модель дважды не вернула годный JSON. */
  fallbackQuest: QuestSeed;
  /** Механики мира сверх общего цикла. */
  features: {
    /** Детективное дело вместо квеста: улики, справочник, газета, закрытие дела. */
    case?: boolean;
  };
  /** Запасное дело (для features.case). */
  fallbackCase?: CaseSeed;
  /**
   * «Свои» в деле: наставник и союзники героя. Обычно они вне подозрений; изредка (insiderChance,
   * бросает код при создании дела) один из них замешан — это поворот, а не правило.
   */
  cast?: { mentor: CastMember; allies: CastMember[]; insiderChance: number };
  art: ArtStyle;
}

/**
 * Постоянное лицо мира (наставник, союзник): одна внешность и один портрет на все кампании.
 * Портрет рисуется один раз на мир и берётся из общей библиотеки, как фоны.
 */
export interface CastMember {
  /** Латиницей, для тега картинки: wakefield. */
  id: string;
  /** Имя, под которым его узнаёт игра («доктор Сайлас Уэйкфилд»): «Уэйкфилд» и «доктор Уэйкфилд» — он же. */
  name: string;
  /** Как он назван в правилах дела: «библиотекарь Хэтти Колдуэлл». */
  label: string;
  role: string;
  gender: "m" | "f";
  /** Внешность по-русски для рассказчика: всегда одна и та же. */
  look: string;
  /** Описание портрета по-английски для FLUX (без стиля — его добавит мир). Поменять → портрет перерисуется. */
  portrait: string;
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
  /** Дополнительные разделы правил мира — идут перед формой ответа. */
  extra?: string[];
  /** Версия кусков мира: пишется к PROMPT_VERSION в каждый ход («gm-3+arkham-3»). Поднимать при правке. */
  version?: string;
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
  /**
   * Телосложение по умолчанию в описаниях людей — художественное решение мира (как в его датасете).
   * Служебная модель берёт его, если роль прямо не требует иного (старуха, измождённая пациентка).
   */
  figureEn?: { f?: string; m?: string };
  /**
   * Своя LoRA стиля (обучена на картинках мира). Веса и сила — только в окружении:
   * FAL_LORA_<ID>_URL и FAL_LORA_<ID>_SCALE. Пока URL не задан, мир рисуется по stylePrefix.
   */
  lora?: {
    /** Триггер из подписей датасета — ставится первым словом промпта. */
    trigger: string;
    /** Префикс фонов вместо stylePrefix: эпоха и запреты без описания техники — технику держит LoRA. Портреты с LoRA идут без префикса. */
    stylePrefix: string;
  };
}
