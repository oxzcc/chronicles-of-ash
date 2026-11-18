import { createCharacter, layoutCampaign, layoutCase, validateDraft, type Campaign, type CaseSeed, type CharacterDraft, type QuestSeed, type Rng } from "@ash/engine";
import { addUsage, backstoryPrompt, casePrompt, emptyUsage, extractJson, questPrompt, type ModelRouter, type Tier, type Usage } from "@ash/llm";
import { isWorldId, worldOf, type World } from "@ash/worlds";
import { progressTracker, type GenProgress } from "./progress";
import { GameError, type GameState } from "./types";

/** Мир черновика от клиента: неизвестный id — понятная ошибка, а не падение. */
export function draftWorld(d: Pick<CharacterDraft, "world">): World {
  if (d.world !== undefined && !isWorldId(d.world)) throw new GameError("Неизвестный мир.");
  return worldOf(d);
}

export interface NewGameResult extends GameState {
  /** В этом деле замешан кто-то из своих (редкий поворот). */
  insider: boolean;
  usage: Usage;
  model: string;
  usedFallback: boolean;
}

/** Создание героя и кампании: проверка черновика, квест (или дело) от рассказчика, раскладка карты. */
export async function newGame(o: {
  router: ModelRouter;
  tier: Tier;
  draft: CharacterDraft;
  rng: Rng;
  seed: string;
  signal?: AbortSignal;
  /** Полоса загрузки: прогресс рассказчика, пока он придумывает квест или дело. */
  onProgress?: (p: GenProgress) => void;
}): Promise<NewGameResult> {
  const world = draftWorld(o.draft);
  const errors = validateDraft(world.rules, o.draft);
  if (errors.length) throw new GameError(errors.join(" "));
  const character = createCharacter(world.rules, o.draft, o.rng);
  const { provider, model } = o.router.route("narrator", o.tier);
  let usage = emptyUsage();
  let campaign: Campaign | null = null;
  // Лимит — с запасом на скрытые рассуждения: DeepSeek V4.1 Flash тратит на дело 6–10 тыс. токенов
  // рассуждений даже при effort low; с прежними 6000 ответ обрывался пустым, и каждая игра шла на запасном деле.
  // Квест фэнтези — до 2,5 тыс. из прежних 3000, тоже впритык.
  const isCase = !!world.features.case;
  // Замешан ли в деле кто-то из своих (наставник, союзники) — редкий бросок кода, не решение модели.
  const insider = isCase && !!world.cast && o.rng() < world.cast.insiderChance;
  const layout = (seed: object) => (isCase ? layoutCase(world.rules, seed as CaseSeed, o.seed) : layoutCampaign(world.rules, seed as QuestSeed, o.seed));
  const progress = o.onProgress ? progressTracker({ kind: isCase ? "case" : "quest", thinkingLabel: world.ui.starting, onProgress: o.onProgress }) : null;
  progress?.start();
  // Если провайдер не присылает рассуждения, полоса идёт по времени — её подталкивает таймер.
  const ticker = progress ? setInterval(() => progress.tick(), 500) : null;
  try {
    for (let attempt = 0; attempt < 2 && !campaign; attempt++) {
      if (attempt > 0) progress?.retry();
      const r = await provider.complete({
        model, signal: o.signal, maxTokens: isCase ? 16000 : 6000, temperature: 1,
        onReasoning: progress ? (n) => progress.reasoning(n) : undefined,
        onText: progress ? (_d, full) => progress.text(full) : undefined,
        messages: [{ role: "user", content: isCase ? casePrompt(world, character, 8, insider) : questPrompt(world, character) }],
      });
      usage = addUsage(usage, r.usage);
      const raw = extractJson(r.text);
      try {
        if (raw && typeof raw === "object") campaign = layout(raw);
      } catch {
        campaign = null;
      }
    }
  } finally {
    if (ticker) clearInterval(ticker);
  }
  const usedFallback = !campaign;
  return { character, campaign: campaign ?? layout(isCase && world.fallbackCase ? world.fallbackCase : world.fallbackQuest), insider: insider && !usedFallback, usage, model, usedFallback };
}

/** Предыстория по выбору игрока — служебной моделью. */
export async function generateBackstory(o: { router: ModelRouter; draft: CharacterDraft; signal?: AbortSignal }): Promise<{ text: string; usage: Usage }> {
  const { provider, model } = o.router.route("utility");
  // Лимит с запасом: служебная модель тратит до 2000 токенов на скрытые рассуждения.
  const r = await provider.complete({ model, signal: o.signal, maxTokens: 3000, reasoningEffort: "minimal", temperature: 1, messages: [{ role: "user", content: backstoryPrompt(draftWorld(o.draft), o.draft) }] });
  if (!r.text.trim()) throw new GameError("Мастер не успел придумать предысторию — попробуй ещё раз.");
  return { text: r.text.trim().replace(/^["«]|["»]$/g, "").slice(0, 1200), usage: r.usage };
}
