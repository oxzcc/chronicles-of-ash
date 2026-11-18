import type { Ruleset } from "@ash/engine";

/**
 * Правила мира «Таинственные дела в Аркхэме». Та же основа (d20, характеристики, 27 очков),
 * но герой — обычный человек 1920-х: вместо рас — один народ, вместо классов — профессии,
 * навыки сыщика, мало здоровья, без доспехов. Лечение — аптечка, деньги — доллары.
 */
export const arkhamRules: Ruleset = {
  id: "arkham",
  skills: {
    Атлетика: "str",
    Уклонение: "dex",
    Скрытность: "dex",
    Взлом: "dex",
    Расследование: "int",
    Архивы: "int",
    Оккультизм: "int",
    История: "int",
    Естествознание: "int",
    Внимательность: "wis",
    Психология: "wis",
    Медицина: "wis",
    Убеждение: "cha",
    Обман: "cha",
    Запугивание: "cha",
  },
  races: {
    human: { name: "Человек", desc: "Обычный человек 1920-х годов. +1 ко всем характеристикам.", bonus: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 } },
  },
  classes: {
    detective: {
      name: "Частный сыщик", desc: "Бывший полицейский с лицензией и револьвером. Видит, где лгут.", hitDie: 8, baseAc: 12, attackStat: "dex", damage: "1d8", weapon: "револьвером",
      attackText: { miss: (t) => `Ты стреляешь в «${t}» — мимо.`, hit: (t, d) => `Пуля попадает в «${t}»: ${d} урона.` },
      skills: ["Расследование"], items: ["Револьвер .38", "Коробка патронов", "Блокнот и карандаш", "Электрический фонарик", "Аптечка"],
      ability: { name: "Точный выстрел", uses: 1, kind: "strike", expr: "2d6", desc: "выстрел с дополнительными 2к6 урона" },
    },
    journalist: {
      name: "Журналист", desc: "Репортёр «Аркхэмского вестника». Разговорит кого угодно.", hitDie: 8, baseAc: 12, attackStat: "dex", damage: "1d6", weapon: "кастетом",
      skills: ["Убеждение"], items: ["Фотоаппарат со вспышкой", "Кастет", "Блокнот и карандаш", "Редакционное удостоверение", "Аптечка"],
      ability: { name: "Вспышка магния", uses: 1, kind: "mark", expr: "1d6", desc: "до конца боя каждое попадание +1к6", hitText: "противник ослеплён вспышкой" },
    },
    professor: {
      name: "Профессор", desc: "Преподаватель Мискатоникского университета. Знает, где искать.", hitDie: 6, baseAc: 11, attackStat: "str", damage: "1d6", weapon: "тяжёлой тростью",
      skills: ["Архивы"], items: ["Трость с набалдашником", "Лупа", "Записная книжка", "Пропуск в библиотеку университета", "Аптечка"],
      ability: { name: "Слабое место", uses: 1, kind: "mark", expr: "1d6", desc: "до конца боя каждое попадание +1к6", hitText: "ты замечаешь, куда бить" },
    },
    doctor: {
      name: "Врач", desc: "Хирург городской больницы. Лечит раны и читает тела.", hitDie: 8, baseAc: 11, attackStat: "dex", damage: "1d4", weapon: "скальпелем",
      skills: ["Медицина"], items: ["Докторский саквояж", "Скальпель", "Нюхательная соль", "Аптечка", "Аптечка"],
      ability: { name: "Первая помощь", uses: 2, kind: "heal", expr: "1d8+3", desc: "восстанавливает 1к8+3 здоровья" },
    },
    veteran: {
      name: "Ветеран войны", desc: "Вернулся из Франции живым. Крепкий, стреляет без колебаний.", hitDie: 10, baseAc: 12, attackStat: "str", damage: "1d10", weapon: "дробовиком",
      attackText: { miss: (t) => `Заряд дроби уходит мимо «${t}».`, hit: (t, d) => `Дробь рвёт «${t}»: ${d} урона.` },
      skills: ["Атлетика"], items: ["Дробовик", "Патроны", "Армейский нож", "Фляга", "Аптечка"],
      ability: { name: "Окопная выдержка", uses: 1, kind: "heal", expr: "1d10+1", desc: "восстанавливает 1к10+1 здоровья" },
    },
    occultist: {
      name: "Оккультист", desc: "Антиквар и собиратель запретных книг. Знает знаки, которых лучше не знать.", hitDie: 6, baseAc: 11, attackStat: "dex", damage: "1d4", weapon: "ритуальным кинжалом",
      skills: ["Оккультизм"], items: ["Ритуальный кинжал", "Мел и свечи", "Потрёпанный гримуар", "Аптечка"],
      ability: { name: "Охранный знак", uses: 2, kind: "auto", expr: "3d4+3", desc: "начерченный знак всегда бьёт (3к4+3)", hitText: "начерченный знак опаляет" },
    },
  },
  recommended: {
    detective: { str: 10, dex: 15, con: 12, int: 14, wis: 12, cha: 8 },
    journalist: { str: 10, dex: 12, con: 12, int: 12, wis: 12, cha: 15 },
    professor: { str: 10, dex: 10, con: 12, int: 15, wis: 14, cha: 10 },
    doctor: { str: 8, dex: 12, con: 13, int: 14, wis: 15, cha: 10 },
    veteran: { str: 15, dex: 12, con: 14, int: 8, wis: 13, cha: 10 },
    occultist: { str: 8, dex: 12, con: 12, int: 15, wis: 14, cha: 10 },
  },
  names: {
    human: {
      m: ["Уолтер", "Эдгар", "Фрэнк", "Томас", "Генри", "Артур", "Сэмюэл", "Чарльз", "Мэттью", "Джозеф", "Лео", "Майлз"],
      f: ["Элеонора", "Агнес", "Дороти", "Хелен", "Маргарет", "Рут", "Эдит", "Клара", "Луиза", "Вивиан", "Айрис", "Норма"],
    },
  },
  locationTypes: {
    office: { name: "Контора", safe: true, start: true, public: true },
    hotel: { name: "Гостиница", safe: true, start: true, public: true },
    diner: { name: "Закусочная", safe: true, start: true, public: true },
    police: { name: "Полицейский участок", safe: true, start: true, public: true },
    university: { name: "Университет", safe: true, public: true },
    library: { name: "Библиотека", safe: true, public: true },
    newspaper: { name: "Редакция", safe: true, public: true },
    church: { name: "Церковь", safe: true, public: true },
    hospital: { name: "Больница", public: true },
    street: { name: "Улица", public: true },
    mansion: { name: "Особняк" },
    speakeasy: { name: "Подпольный бар" },
    docks: { name: "Пристань" },
    warehouse: { name: "Склад" },
    cemetery: { name: "Кладбище", public: true },
    cellar: { name: "Подвал" },
    woods: { name: "Лес за городом" },
    farm: { name: "Ферма" },
  },
  defaultLocationType: "street",
  defaultStartType: "office",
  money: {
    amount: (n) => `$${n}`,
    sheet: (n) => `деньги $${n}`,
    short: (n) => `$${n}`,
  },
  healing: {
    pattern: /аптечк/i,
    label: "Аптечка",
    countLabel: "Аптечек",
    expr: "2d4+2",
    used: (hp) => `Ты наскоро перевязываешь раны: +${hp} здоровья.`,
    none: "Аптечек не осталось.",
  },
  fleeSkill: "Уклонение",
};
