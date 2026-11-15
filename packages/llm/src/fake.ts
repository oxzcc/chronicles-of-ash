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

export class FakeProvider implements LlmProvider {
  readonly name = "fake";
  constructor(private readonly opts: { askRoll?: boolean; delayMs?: number } = {}) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const last = req.messages.at(-1);
    const prompt = last?.role === "user" ? last.content : "";
    if (prompt.includes('"questTitle"')) return this.plain(JSON.stringify(FAKE_QUEST));
    if (prompt.includes("предысторию")) return this.plain("Бывший стражник, изгнанный за то, что отпустил пеплорождённую девочку. Теперь он ищет её — и ответ, почему она смотрела на него так, будто знала его имя.");
    const wantsRoll = (this.opts.askRoll ?? true) && !!req.tools?.length && last?.role === "user";
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
      narration: `Ветер гонит пепел по пустой улице. Где-то хлопает ставня, и в тишине слышно, как капает вода с карниза.${rollNote}\n\nСтарик у колодца поднимает на тебя мутные глаза.`,
      speaker: { name: "Старый Ведун", race: "human", gender: "m", role: "деревенский знахарь" },
      line: "Ты не первый, кто спрашивает. Те, кто спрашивал, не вернулись.",
      changes: { hp: 0, gold: 0, addItems: [], removeItems: [] },
      combat: fight ? { enemies: [{ name: "Культист в сером", hp: 9, ac: 12, attack: 3, damage: "1d6+1" }] } : null,
      questDone: [],
      questComplete: false,
      suggestions: ["Спрашиваю, кто пропал первым", "Предлагаю ему монету за правду", "Осматриваю колодец"],
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
