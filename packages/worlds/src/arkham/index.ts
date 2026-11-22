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
    version: "arkham-6",
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
  // Внешность постоянная: рассказчик описывает их только так, портрет — один на мир.
  // portrait — по подписям нового датасета LoRA: естественные пропорции, характер, одежда и одно действие рук.
  cast: {
    mentor: {
      id: "wakefield", name: "доктор Сайлас Уэйкфилд", label: "доктор Сайлас Уэйкфилд", role: "наставник, отставной профессор антропологии", gender: "m",
      look: "высокий сухопарый старик под семьдесят, слегка сутулый, глубоко изрезанное морщинами лицо, седые бакенбарды, редеющие зачёсанные назад волосы, пенсне на чёрном шнурке, поношенная коричневая твидовая тройка, трубка в руке",
      portrait: "a tall gaunt elderly man in his late sixties, a retired anthropology professor and discreet mentor. Thin wiry build, stooped only slightly, a deeply lined long face, white mutton-chop whiskers, thinning silver hair combed back, pince-nez on a black cord. He wears a worn brown tweed three-piece suit, a buttoned shirt, a dark tie and a watch chain. He holds an unlit briar pipe loosely in one hand at waist level, the other arm relaxed at his side",
    },
    allies: [
      {
        id: "caldwell", name: "Хэтти Колдуэлл", label: "библиотекарь Хэтти Колдуэлл", role: "младший библиотекарь Мискатоника", gender: "f",
        look: "молодая женщина лет двадцати пяти, обычное телосложение, слегка сутулые от работы за столом плечи, круглые очки в черепаховой оправе, открытое умное лицо, каштановое каре волной, застёгнутая кремовая блузка, простой коричневый кардиган, тёмная юбка с высокой талией, стопка книг",
        portrait: "a young woman librarian about twenty-five, of average build with slightly rounded shoulders from long hours at a desk. Round tortoiseshell spectacles, an intelligent open face with a faintly asymmetrical mouth, chestnut finger-waved bob. She wears a high-collared cream cotton blouse buttoned to the neck, a plain brown cardigan and a high-waisted dark skirt. She supports a stack of three old books at waist level with both hands, one finger marking a page",
      },
      {
        id: "malloy", name: "сержант Деннис Маллой", label: "сержант Деннис Маллой", role: "полицейский сержант", gender: "m",
        look: "грузный широкоплечий ирландец за пятьдесят, мягкий живот, рабочая осанка, рыжие с проседью усы, румяные обветренные щёки, слегка кривой нос, застёгнутая тёмно-синяя форма с медными пуговицами, фуражка, обе руки на вертикальной деревянной дубинке",
        portrait: "a heavyset broad-shouldered Irish man police sergeant in his fifties, with a soft belly and strong ordinary working posture. Bushy ginger-grey moustache, ruddy weathered cheeks, deep eye creases and a slightly crooked nose. He wears a buttoned navy 1920s police uniform with brass buttons and a period peaked cap. Both hands rest together over the top of a vertical wooden nightstick",
      },
      {
        id: "pike", name: "доктор Лоренс Пайк", label: "коронер Лоренс Пайк", role: "коронер городской больницы", gender: "m",
        look: "худой сутулый мужчина за пятьдесят с узкими плечами, впалые щёки, редеющие зачёсанные назад седые волосы, круглые очки в стальной оправе, полностью застёгнутый белый халат поверх тёмного жилета, пятна реактивов на манжетах, руки заложены за спину",
        portrait: "a thin gaunt man coroner in his fifties with narrow shoulders and a slightly forward stoop. Hollow cheeks, thinning slicked grey hair, round steel-rimmed glasses, faint chemical stains on the cuffs. He wears a white coroner’s coat fully buttoned over a dark waistcoat, shirt and tie. His hands are clasped behind his back",
      },
      {
        id: "ashworth", name: "Рут Эшворт", label: "репортёр Рут Эшворт", role: "репортёр «Вестника»", gender: "f",
        look: "худощавая женщина чуть за тридцать, угловатое лицо, гладкое чёрное каре, тёмные выразительные брови, минимум косметики, застёгнутая белая рубашка, мужской жилет в тонкую полоску, свободный галстук, брюки с высокой талией, раскрытый блокнот и карандаш",
        portrait: "a lean average-built woman newspaper reporter in her early thirties, with an angular face, sleek black bob and dark expressive eyebrows. Minimal period makeup. She wears a fully buttoned white shirt, a man’s pinstripe waistcoat, a loose dark tie and high-waisted trousers with practical shoes. She holds an open spiral notepad at waist level with both hands, a pencil between the fingers of her right hand",
      },
      {
        id: "finnegan", name: "Тео Финнеган", label: "Тео Финнеган из бакалеи", role: "хозяин подпольного бара", gender: "m",
        look: "коренастый широкий мужчина лет сорока, сломанный нос, щетина на квадратной челюсти, редеющие тёмные волосы, закатанные до локтей рукава, жилет и фартук бакалейщика, вытирает стакан тряпкой обеими руками",
        portrait: "a stocky broad man about forty, a grocer and hidden speakeasy owner, with thick work-worn forearms. Broken nose, stubbled square jaw, receding dark hair. He wears a shirt with sleeves rolled to the elbows, a plain waistcoat and a grocer’s apron. He dries one plain tumbler with a cloth, using both hands in a single action",
      },
      {
        id: "reznik", name: "мадам Иоланта Резник", label: "букинистка мадам Иоланта Резник", role: "букинистка и гадалка", gender: "f",
        look: "высокая крепко сложенная женщина за сорок, естественные зрелые пропорции, широкие плечи, прямая собранная осанка, морщинки у глаз, тяжёлые чёрные кудри с проседью в низком узле, слегка подведённые тёмные глаза, закрытое бархатное платье с высоким воротом и длинными рукавами, шаль с бахромой, несколько старых колец, одна нить простых бус, веер потёртых карт таро",
        portrait: "a tall solid-built woman bookseller and fortune teller in her mid-forties, with natural mature proportions, broad shoulders and an upright composed stance. Fine lines around the eyes, heavy black curls streaked with grey and pinned into a low knot, subtly kohl-rimmed dark eyes. She wears a high-necked dark velvet dress with long sleeves, a fringed shawl, a few old rings and one string of plain beads. She holds a small fan of worn tarot cards at waist level with both hands",
      },
    ],
    insiderChance: 0.1,
  },
  art: arkhamArt,
};
