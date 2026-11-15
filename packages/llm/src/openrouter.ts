import { LlmError, emptyUsage, type ChatMessage, type CompletionRequest, type CompletionResult, type LlmProvider, type ToolCall } from "./types";

const BASE_URL = "https://openrouter.ai/api/v1";

/** Сообщения в формате OpenAI; системный промпт помечается для кэша провайдера (Anthropic). */
export function toWireMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    switch (m.role) {
      case "system":
        return m.cache
          ? { role: "system", content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] }
          : { role: "system", content: m.content };
      case "user":
        return { role: "user", content: m.content };
      case "assistant":
        return {
          role: "assistant",
          content: m.content ?? "", // некоторые провайдеры (Qwen) не принимают null
          ...(m.toolCalls?.length
            ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })) }
            : {}),
        };
      case "tool":
        return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    }
  });
}

/** Разбор потока SSE: строки «data: {...}», комментарии «: ...» пропускаются. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data);
      } catch {
        /* неполная строка — пропускаем */
      }
    }
  }
}

export interface OpenRouterOptions {
  apiKey: string;
  baseUrl?: string;
  /** Название приложения в статистике OpenRouter. */
  appName?: string;
  fetchImpl?: typeof fetch;
  /** Повторы при сбое сети и 429/5xx до начала ответа. */
  retries?: number;
}

export class OpenRouterProvider implements LlmProvider {
  readonly name = "openrouter";
  constructor(private readonly opts: OpenRouterOptions) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    // Повтор только до начала ответа: сбой сети или 429/5xx. Оборванный поток не повторяем — текст уже ушёл игроку.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(req);
      } catch (e) {
        const retryable = e instanceof LlmError ? e.retryable && !e.streamStarted : e instanceof TypeError;
        if (!retryable || attempt >= (this.opts.retries ?? 2) || req.signal?.aborted) throw e;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }

  private async once(req: CompletionRequest): Promise<CompletionResult> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(`${this.opts.baseUrl ?? BASE_URL}/chat/completions`, {
      method: "POST",
      signal: req.signal,
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        "Content-Type": "application/json",
        "X-Title": this.opts.appName ?? "Chronicles of Ash",
      },
      body: JSON.stringify({
        model: req.model,
        messages: toWireMessages(req.messages),
        stream: true,
        usage: { include: true },
        max_tokens: req.maxTokens ?? 1200,
        temperature: req.temperature ?? 0.9,
        ...(req.tools?.length
          ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
          : {}),
      }),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new LlmError(`OpenRouter ${res.status}: ${text.slice(0, 300)}`, res.status, res.status === 429 || res.status >= 500);
    }

    let text = "";
    let model = req.model;
    let finishReason = "";
    const usage = emptyUsage();
    const calls = new Map<number, ToolCall>();

    for await (const chunk of readSse(res.body)) {
      if (chunk.error) throw new LlmError(`OpenRouter: ${chunk.error.message ?? "stream error"}`, chunk.error.code, true, text.length > 0);
      if (chunk.model) model = chunk.model;
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) {
        text += delta.content;
        req.onText?.(delta.content, text);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const cur = calls.get(idx) ?? { id: "", name: "", arguments: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        calls.set(idx, cur);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
        usage.outputTokens = chunk.usage.completion_tokens ?? 0;
        usage.cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
        usage.costUsd = Number(chunk.usage.cost ?? 0);
      }
    }
    const toolCalls = [...calls.values()].map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
    return { text, toolCalls, usage, model, finishReason };
  }
}
