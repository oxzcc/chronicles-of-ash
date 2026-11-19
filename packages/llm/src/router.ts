import { FakeProvider } from "./fake";
import { OpenRouterProvider } from "./openrouter";
import type { LlmProvider, ReasoningEffort } from "./types";

export type Tier = "free" | "paid";
export type Role = "narrator" | "utility";

export interface RouterConfig {
  openRouterKey?: string;
  reasoningEffort?: ReasoningEffort;
  fake: boolean;
  /** vision — модель со зрением для проверки портретов (руки, кадр); не задана — проверки нет. */
  models: { narratorPaid: string; narratorFree: string; utility: string; vision?: string };
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): RouterConfig {
  return {
    openRouterKey: env.OPENROUTER_API_KEY || undefined,
    fake: env.LLM_FAKE === "1" || !env.OPENROUTER_API_KEY,
    reasoningEffort: (env.LLM_REASONING_EFFORT || "low") as ReasoningEffort,
    models: {
      narratorPaid: env.NARRATOR_MODEL_PAID || "deepseek/deepseek-v4.1-flash",
      narratorFree: env.NARRATOR_MODEL_FREE || "deepseek/deepseek-v4.1-flash",
      utility: env.UTILITY_MODEL || "deepseek/deepseek-v4.1-flash",
      vision: env.VISION_MODEL || undefined,
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
    /** Модель со зрением: только настоящая и только если задана в VISION_MODEL. */
    vision(): Route | null {
      return real && cfg.models.vision ? { provider: real, model: cfg.models.vision } : null;
    },
    /** Произвольная модель — для слепого теста. */
    direct(model: string): Route {
      return { provider: real ?? fake, model: real ? model : "fake" };
    },
  };
}

export type ModelRouter = ReturnType<typeof createRouter>;
