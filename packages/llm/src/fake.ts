import { emptyUsage, type CompletionRequest, type CompletionResult, type LlmProvider } from "./types";

/**
 * Фейковая модель для разработки интерфейса без ключей и для тестов.
 * На ход игрока сначала просит одну проверку, затем отвечает валидным JSON по контракту.
 */
export class FakeProvider implements LlmProvider {
  readonly name = "fake";
  constructor(private readonly opts: { askRoll?: boolean; delayMs?: number } = {}) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const last = req.messages.at(-1);
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
    const rollNote = last?.role === "tool" ? ` Бросок: ${last.content}.` : "";
    const json = JSON.stringify({
      narration: `Ветер гонит пепел по пустой улице. Где-то хлопает ставня, и в тишине слышно, как капает вода с карниза.${rollNote}\n\nСтарик у колодца поднимает на тебя мутные глаза.`,
      speaker: { name: "Старый Ведун", race: "human", gender: "m", role: "деревенский знахарь" },
      line: "Ты не первый, кто спрашивает. Те, кто спрашивал, не вернулись.",
      changes: { hp: 0, gold: 0, addItems: [], removeItems: [] },
      combat: null,
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
}
