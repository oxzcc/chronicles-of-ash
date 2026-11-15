import { FakeProvider } from "./fake";
import { OpenRouterProvider } from "./openrouter";
import type { LlmProvider, ReasoningEffort } from "./types";

export type Tier = "free" | "paid";
export type Role = "narrator" | "utility";

export interface RouterConfig {
  openRouterKey?: string;
  reasoningEffort?: ReasoningEffort;
  fake: boolean;
  models: { narratorPaid: string; narratorFree: string; utility: string };
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): RouterConfig {
  return {
    openRouterKey: env.OPENROUTER_API_KEY || undefined,
    fake: env.LLM_FAKE === "1" || !env.OPENROUTER_API_KEY,
    reasoningEffort: (env.LLM_REASONING_EFFORT || "low") as ReasoningEffort,
    models: {
      narratorPaid: env.NARRATOR_MODEL_PAID || "anthropic/claude-sonnet-5.5",
      narratorFree: env.NARRATOR_MODEL_FREE || "deepseek/deepseek-v4.1-flash",
      utility: env.UTILITY_MODEL || "anthropic/claude-haiku-5.5",
    },
  };
}

export interface Route {
  provider: LlmProvider;
  model: string;
}

/** Выбор модели по роли и тарифу. Модель меняется переменной окружения, без правки кода. */
export function createRouter(cfg: RouterConfig) {
  const real = cfg.fake ? null : new OpenRouterProvider({ apiKey: cfg.openRouterKey!, reasoningEffort: cfg.reasoningEffort });
  const fake = new FakeProvider();
  return {
    isFake: cfg.fake,
    route(role: Role, tier: Tier = "free"): Route {
      const model = role === "utility" ? cfg.models.utility : tier === "paid" ? cfg.models.narratorPaid : cfg.models.narratorFree;
      return { provider: real ?? fake, model: real ? model : "fake" };
    },
    /** Произвольная модель — для слепого теста. */
    direct(model: string): Route {
      return { provider: real ?? fake, model: real ? model : "fake" };
    },
  };
}

export type ModelRouter = ReturnType<typeof createRouter>;
