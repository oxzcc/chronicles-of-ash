import { getWorld } from "@ash/worlds";
import { roughVerdict } from "./prompts/case";
import { emptyUsage, type CompletionRequest, type CompletionResult, type LlmProvider } from "./types";

/**
 * Фейковая модель для разработки интерфейса без ключей и для тестов.
 * На ход игрока сначала просит одну проверку, затем отвечает валидным JSON по контракту.
 */
const FAKE_QUEST = {
  questTitle: "Пепел над Чернолесьем",
  hook: "В деревне Вересковый Брод пропадают люди, а над Чернолесьем по ночам поднимается пепельный дым.",
  objectives: ["Расспросить жителей о пропавших", "Найти источник дыма", "Остановить похитителя"],
  locations: [
    { name: "Вересковый Брод", type: "village", desc: "Деревня у реки, где по ночам запирают ставни." },
    { name: "Таверна «Хромой гусь»", type: "tavern", desc: "Шумная корчма у переправы." },
    { name: "Королевский тракт", type: "road", desc: "Старая дорога без патрулей." },
    { name: "Чернолесье", type: "forest", desc: "Ельник, где тропы меняются местами." },
    { name: "Руины Дозорной башни", type: "ruins", desc: "Обломки башни прошлой войны." },
    { name: "Пепельная пещера", type: "cave", desc: "Из расщелины тянет дымом." },
  ],
  target: 5,
};

/** Тот же цикл для мира Аркхэма: фейковая модель узнаёт мир по тексту промпта. */
const FAKE_ARKHAM_QUEST = {
  questTitle: "Последний сеанс миссис Вейл",
  hook: "Вдова Вейл умерла во время спиритического сеанса, и полиция записала это в сердечный приступ.",
  objectives: ["Узнать, кто был на сеансе", "Найти пропавшую книгу", "Остановить того, кто продолжает сеансы"],
  locations: [
    { name: "Кабинет доктора Уэйкфилда", type: "office", desc: "Тесный кабинет, заваленный папками." },
    { name: "Дом Вейлов", type: "mansion", desc: "Задёрнутые шторы и остановленные часы." },
    { name: "Полицейский участок", type: "police", desc: "Сержант не любит открывать закрытые дела." },
    { name: "Библиотека Мискатоника", type: "library", desc: "Зелёные лампы и закрытый фонд." },
    { name: "Кладбище Святого Варфоломея", type: "cemetery", desc: "Свежая могила и следы у ограды." },
    { name: "Подвал под мельницей", type: "cellar", desc: "Круг, начерченный мелом." },
  ],
  target: 5,
};

const FAKE_SCENES = {
  fantasy: {
    beats: [
      { speaker: null, text: "Ветер гонит пепел по пустой улице. Где-то хлопает ставня, и в тишине слышно, как капает вода с карниза." },
      { speaker: null, text: "Старик у колодца поднимает на тебя мутные глаза." },
      { speaker: "Старый Ведун", text: "Ты не первый, кто спрашивает. Те, кто спрашивал, не вернулись." },
    ],
    speaker: { name: "Старый Ведун", race: "human", gender: "m", role: "деревенский знахарь" },
    enemy: { name: "Культист в сером", hp: 9, ac: 12, attack: 3, damage: "1d6+1" },
    suggestions: [
      { text: "Спрашиваю, кто пропал первым" },
      { text: "Убеждаю его рассказать правду", skill: "Убеждение", dc: 13 },
      { text: "Осматриваю колодец", skill: "Внимательность", dc: 12 },
    ],
    bio: "Бывший стражник, изгнанный за то, что отпустил пеплорождённую девочку. Теперь он ищет её — и ответ, почему она смотрела на него так, будто знала его имя.",
  },
  arkham: {
    beats: [
      { speaker: null, text: "С реки тянет туманом, газовый фонарь шипит и мигает. На мокрой мостовой — следы, которые обрываются у стены." },
      { speaker: null, text: "Сержант в мокром плаще прикуривает и смотрит на тебя без особой радости." },
      { speaker: "Сержант Маллой", text: "Опять вы. Дело закрыто, сердце у старушки встало. Если хотите копать — копайте тихо." },
    ],
    speaker: { name: "Сержант Маллой", race: "human", gender: "m", role: "полицейский сержант" },
    enemy: { name: "Громила из Нижнего города", hp: 9, ac: 11, attack: 3, damage: "1d6+1" },
    suggestions: [
      { text: "Спрашиваю, кто нашёл тело" },
      { text: "Убеждаю его показать протокол", skill: "Убеждение", dc: 13 },
      { text: "Осматриваю следы у стены", skill: "Внимательность", dc: 12 },
    ],
    bio: "Бывший полицейский из Бостона, ушедший со службы после дела, которое закрыли слишком быстро. В Аркхэм он приехал за ответом, который ему так и не дали.",
  },
} as const;

/** Мир по тексту промпта: в промптах Аркхэма всегда есть его название. */
const worldOfPrompt = (text: string) => (/Аркхэм/.test(text) ? FAKE_SCENES.arkham : FAKE_SCENES.fantasy);

export class FakeProvider implements LlmProvider {
  readonly name = "fake";
  constructor(private readonly opts: { askRoll?: boolean; delayMs?: number } = {}) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const last = req.messages.at(-1);
    const prompt = last?.role === "user" ? last.content : "";
    const system = req.messages[0]?.role === "system" ? req.messages[0].content : "";
    const fake = worldOfPrompt(system + prompt);
    // Дело (Аркхэм): запасное дело мира — тот же формат, что просит промпт.
    if (prompt.includes('"truth"') && prompt.includes('"clues"')) return this.plain(JSON.stringify(getWorld("arkham").fallbackCase));
    // Закрытие дела: грубая проверка по словам правильного ответа.
    if (prompt.startsWith("Ты проверяешь ответы игрока")) {
      const verdicts: Record<string, string> = {};
      for (const m of prompt.matchAll(/\[(\w+)\] Вопрос: .*\nПравильный ответ: (.*)\nОтвет игрока: (.*)/g)) verdicts[m[1]!] = roughVerdict(m[3]!, m[2]!);
      return this.plain(JSON.stringify(verdicts));
    }
    // Реконструкция: развёрнутая версия совпадает с первым доступным выводом.
    if (prompt.includes("восстанавливает картину событий")) {
      const first = /\n\[(c\d+)\] /.exec(prompt.slice(prompt.indexOf("Выводы:")))?.[1] ?? null;
      const version = /Версия игрока: (.*)/.exec(prompt)?.[1] ?? "";
      return this.plain(JSON.stringify({ match: version.length > 20 ? first : null }));
    }
    if (prompt.includes('"questTitle"')) return this.plain(JSON.stringify(fake === FAKE_SCENES.arkham ? FAKE_ARKHAM_QUEST : FAKE_QUEST));
    if (prompt.includes("предысторию")) return this.plain(fake.bio);
    // Финал дела: несколько уже знакомых участников и отдельная последняя реплика рассказчика.
    if (prompt.includes("[Дело закрыто]")) {
      const verdict = prompt.includes("«Дело раскрыто»") ? "Дело раскрыто" : "Дело не раскрыто";
      return this.plain(JSON.stringify({
        beats: [
          { speaker: null, text: "В кабинете стихает дождь. Уэйкфилд раскладывает твои записи рядом с протоколом, и разрозненные мелочи наконец образуют одну цепочку." },
          { speaker: "доктор Сайлас Уэйкфилд", text: "Теперь видно главное: сеанс использовали как прикрытие, а книга понадобилась тому, кто знал её содержимое заранее." },
          { speaker: "Кит Ларкин", text: "Я думал, всё сойдёт за несчастный случай. Но чашку и страницу из книги я действительно забрал." },
          { speaker: null, text: `${verdict}. Полиция получает признание и улики, но последняя страница рукописи так и остаётся пустой — словно часть истории ещё не решилась показаться на свет.` },
        ],
        speaker: { name: "доктор Сайлас Уэйкфилд", race: "human", gender: "m", role: "наставник, отставной профессор" },
        changes: { hp: 0, sanity: 0, gold: 0, addItems: [], removeItems: [] }, combat: null, questDone: [], questComplete: false, suggestions: [], clues: [], reveal: [],
      }));
    }
    const wantsRoll = (this.opts.askRoll ?? true) && !!req.tools?.length && last?.role === "user" && !prompt.includes("[Проверка уже брошена игрой]");
    if (wantsRoll) {
      return {
        text: "",
        toolCalls: [{ id: "fake_1", name: "roll_check", arguments: JSON.stringify({ skill: "Внимательность", dc: 13, reason: "осмотреться" }) }],
        usage: { ...emptyUsage(), inputTokens: 800, outputTokens: 30 },
        model: "fake",
        finishReason: "tool_calls",
      };
    }
    // «Нападаю» / «атакую» в ходе игрока — фейковая модель объявляет бой (для проверки интерфейса боя).
    const scene = req.messages.find((m) => m.role === "user")?.content ?? "";
    const playerAction = /ХОД ИГРОКА: (.*)$/s.exec(scene)?.[1] ?? "";
    const fight = /напада|атаку/i.test(playerAction);
    const rollNote = last?.role === "tool" ? ` Бросок: ${last.content}.` : "";
    const json = JSON.stringify({
      beats: fake.beats.map((b, i) => (i === 0 ? { ...b, text: b.text + rollNote } : b)),
      speaker: fake.speaker,
      changes: { hp: 0, gold: 0, addItems: [], removeItems: [] },
      combat: fight ? { enemies: [fake.enemy] } : null,
      questDone: [],
      questComplete: false,
      suggestions: fake.suggestions,
    });
    let text = "";
    for (const piece of json.match(/.{1,40}/gs) ?? []) {
      text += piece;
      req.onText?.(piece, text);
      if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
    }
    return { text, toolCalls: [], usage: { ...emptyUsage(), inputTokens: 900, outputTokens: 220 }, model: "fake", finishReason: "stop" };
  }

  private plain(text: string): CompletionResult {
    return { text, toolCalls: [], usage: { ...emptyUsage(), inputTokens: 300, outputTokens: 300 }, model: "fake", finishReason: "stop" };
  }
}
