/** Общие типы слоя моделей. Формат сообщений — OpenAI-совместимый (его понимает OpenRouter). */

export interface ToolCall {
  id: string;
  name: string;
  /** Сырые аргументы — JSON-строка от модели. */
  arguments: string;
}

export type ChatMessage =
  | { role: "system"; content: string; cache?: boolean }
  /** images — data: или https-адреса картинок для модели со зрением (проверка портретов). */
  | { role: "user"; content: string; images?: string[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** Стоимость в долларах, если провайдер её сообщил. */
  costUsd: number;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

/** none — без скрытых рассуждений (DeepSeek: ответ за 1–2 с вместо 5). */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
  temperature?: number;
  /** Сколько модель «думает» перед ответом. Для рассказчика хватает low: быстрее и дешевле. */
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
  /** Каждый новый кусок текста по мере генерации. */
  onText?: (delta: string, full: string) => void;
  /** Скрытые рассуждения по мере генерации: сколько символов пришло всего (для полосы загрузки). */
  onReasoning?: (totalChars: number) => void;
}

export interface CompletionResult {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  model: string;
  finishReason: string;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class LlmError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false, readonly streamStarted = false) {
    super(message);
    this.name = "LlmError";
  }
}
