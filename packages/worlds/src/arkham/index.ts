import type { World } from "../types";
import { arkhamArt } from "./art";
import { ARKHAM_FALLBACK_CASE } from "./case";
import { arkhamRules } from "./rules";

/**
 * «Таинственные дела в Аркхэме»: мистический детектив по мотивам Лавкрафта, осень 1926 года.
 * Описание мира — world.md рядом, стиль — style.md. Вместо квеста — дело (case.ts — запасное):
 * улики, справочник, газета, реконструкция и закрытие дела со счётом против наставника.
 */
export const arkham: World = {
  id: "arkham",
  title: "Таинственные дела в Аркхэме",
  tagline: "Мистический детектив, 1926 год: улики, свидетели и то, чего лучше не знать",
  rules: arkhamRules,
  gm: {
    role: "Ты — Мастер (рассказчик) мистической детективной ролевой игры по мотивам Лавкрафта: Аркхэм, Новая Англия, осень 1926 года. Механика — проверки d20, дух — расследование странного.",
    stateNoun: "здоровье, деньги (поле gold, в долларах) или снаряжение",
    boundaries: "мистический ужас и насилие допустимы, без смакования; откровенных сексуальных сцен нет — уводи сцену затемнением. Предрассудки эпохи не воспроизводи: ужас — в неведомом, а не в людях другого происхождения.",
    choicesNote: "",
    suggestionExample: { text: "Убеждаю сержанта показать протокол", skill: "Убеждение", dc: 13 },
    extra: [
      "РАССЛЕДОВАНИЕ: это детектив, а не боевик. Ключевую улику герой находит, если ищет в правильном месте; проверка решает цену (время, опасность, неприятные последствия) и дополнительные детали, а не то, найдёт ли он главное. Свидетели лгут, недоговаривают и боятся, но не молчат бесконечно, если герой нашёл подход. Сверхъестественное — через детали, звуки, запахи и недосказанность; не показывай его целиком.",
      "ЭПОХА И БОЙ: 1926 год — никаких фэнтезийных рас, мечей, таверн и заклинаний из книжек о драконах; деньги — доллары и центы. Бой редок: противники-люди (громила с ножом, культист с револьвером) — по обычным числам; против тварей бой не объявляй, а опиши угрозу и дай герою бежать, спрятаться или найти другой выход.",
    ],
    version: "arkham-5",
  },
  genre: "мистического детектива по мотивам Лавкрафта (Аркхэм, Новая Англия, 1926 год)",
  ui: {
    quest: "Дело",
    questDone: "Дело закрыто.",
    newGameHint: "Доктор Уэйкфилд подберёт дело под героя и его прошлое.",
    start: "Взяться за дело",
    starting: "Доктор Уэйкфилд ищет папку…",
  },
  fallbackQuest: {
    questTitle: "Последний сеанс миссис Вейл",
    hook: "Вдова Корделия Вейл умерла во время спиритического сеанса в собственной гостиной, и полиция записала это в сердечный приступ. Её дочь не верит: в ту ночь соседи слышали, как в доме пели на чужом языке. Доктор Уэйкфилд просит тебя разобраться, пока похороны не стёрли следы.",
    objectives: ["Узнать, кто был на сеансе у миссис Вейл", "Выяснить, какая книга пропала из её дома", "Остановить того, кто продолжает сеансы"],
    locations: [
      { name: "Кабинет доктора Уэйкфилда", type: "office", desc: "Тесный кабинет в Старом городе, заваленный папками и чужими письмами." },
      { name: "Дом Вейлов на Сосновой улице", type: "mansion", desc: "Задёрнутые шторы, запах воска и остановленные часы." },
      { name: "Полицейский участок", type: "police", desc: "Сержант Маллой не любит, когда закрытые дела открывают снова." },
      { name: "Библиотека Мискатоника", type: "library", desc: "Зелёные лампы, скрип лестниц и закрытый фонд под замком." },
      { name: "Бакалея Финнегана", type: "speakeasy", desc: "За мешками с мукой — дверь, за дверью — джаз и слухи." },
      { name: "Морг городской больницы", type: "hospital", desc: "Кафель, холод и коронер, который пьёт, чтобы не помнить." },
      { name: "Кладбище Святого Варфоломея", type: "cemetery", desc: "Сланцевые надгробия, свежая могила и следы у ограды." },
      { name: "Подвал под старой мельницей", type: "cellar", desc: "Сырые камни, оплывшие свечи и круг, начерченный мелом." },
    ],
    target: 7,
  },
  features: { case: true },
  fallbackCase: ARKHAM_FALLBACK_CASE,
  // Владелец: «союзники и доктор могут быть замешаны, но редко» — одно дело из десяти.
  // Внешность постоянная: рассказчик описывает их только так, портрет — один на мир (женщины — с формами, мужчины — суровые).
  cast: {
    mentor: {
      id: "wakefield", name: "доктор Сайлас Уэйкфилд", label: "доктор Сайлас Уэйкфилд", role: "наставник, отставной профессор антропологии", gender: "m",
      look: "высокий сухопарый старик под семьдесят, седые бакенбарды, пенсне на чёрном шнурке, поношенная твидовая тройка, трубка",
      portrait: "male, ordinary 1920s American, tall gaunt man in his late sixties, stern deeply lined face, white mutton-chop whiskers, pince-nez on a black cord, worn tweed three-piece suit with a watch chain, briar pipe in hand, sharp knowing eyes",
    },
    allies: [
      {
        id: "caldwell", name: "Хэтти Колдуэлл", label: "библиотекарь Хэтти Колдуэлл", role: "младший библиотекарь Мискатоника", gender: "f",
        look: "молодая женщина лет двадцати пяти, круглые очки, каштановые волосы волной, пышная фигура, приталенная блузка с камеей, стопка книг",
        portrait: "female, ordinary 1920s American, young woman about twenty-five, curvy build with a full bust and wide hips, round tortoiseshell spectacles, chestnut finger-waved bob, pencil behind the ear, fitted cream blouse with a cameo brooch and a high-waisted skirt, hugging a stack of old books to her chest, shy clever sidelong glance",
      },
      {
        id: "malloy", name: "сержант Деннис Маллой", label: "сержант Деннис Маллой", role: "полицейский сержант", gender: "m",
        look: "грузный ирландец за пятьдесят, полицейская форма с медными пуговицами, рыжие с проседью усы, усталые суровые глаза",
        portrait: "male, ordinary 1920s American, heavyset Irish police sergeant in his fifties, dark blue 1920s police uniform with brass buttons and a peaked cap, bushy ginger-grey moustache, broken-veined cheeks, tired stern eyes",
      },
      {
        id: "pike", name: "доктор Лоренс Пайк", label: "коронер Лоренс Пайк", role: "коронер городской больницы", gender: "m",
        look: "худой мужчина за пятьдесят, впалые щёки, круглые очки в стальной оправе, белый халат поверх жилета, пятна реактивов на пальцах",
        portrait: "male, ordinary 1920s American, thin hollow-cheeked man in his fifties, round steel-rimmed glasses, thinning slicked grey hair, white coroner's coat over a waistcoat, chemical stains on his fingers, haunted sleepless eyes",
      },
      {
        id: "ashworth", name: "Рут Эшворт", label: "репортёр Рут Эшворт", role: "репортёр «Вестника»", gender: "f",
        look: "женщина около тридцати, чёрное каре, алая помада, пышная фигура, шёлковая блуза с расстёгнутым воротом под мужским жилетом, блокнот",
        portrait: "female, ordinary 1920s American, woman about thirty, curvy voluptuous build with a large bust and wide hips, sleek black bob, red lipstick, silk blouse open at the collar under a man's pinstripe waistcoat, small spiral reporter's notepad and a pencil in hand, hand on hip, confident sly smirk, low angle",
      },
      {
        id: "finnegan", name: "Тео Финнеган", label: "Тео Финнеган из бакалеи", role: "хозяин подпольного бара", gender: "m",
        look: "крепкий мужчина лет сорока, сломанный нос, закатанные рукава, фартук бакалейщика поверх жилета, хитрая улыбка",
        portrait: "male, ordinary 1920s American, burly man about forty, broken nose, stubbled square jaw, shirt sleeves rolled up over thick forearms, grocer's apron over a waistcoat, flat cap, sly crooked smile",
      },
      {
        id: "reznik", name: "мадам Иоланта Резник", label: "букинистка мадам Иоланта Резник", role: "букинистка и гадалка", gender: "f",
        look: "статная женщина за сорок, чёрные кудри с проседью, подведённые глаза, пышная фигура, бархатное платье с глубоким вырезом, шаль с бахромой, кольца",
        portrait: "female, ordinary 1920s American, statuesque woman in her mid-forties, voluptuous curvy build with a very large bust, fine lines around the eyes, heavy black curls streaked with grey, kohl-rimmed dark eyes, dark velvet dress with a deep neckline under a fringed shawl, strings of beads and many rings, shuffling a deck of tarot cards, knowing enigmatic look",
      },
    ],
    insiderChance: 0.1,
  },
  art: arkhamArt,
};
