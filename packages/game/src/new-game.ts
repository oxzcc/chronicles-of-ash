import { createCharacter, layoutCampaign, validateDraft, type Campaign, type CharacterDraft, type QuestSeed, type Rng } from "@ash/engine";
import { addUsage, backstoryPrompt, emptyUsage, extractJson, questPrompt, type ModelRouter, type Tier, type Usage } from "@ash/llm";
import { isWorldId, worldOf, type World } from "@ash/worlds";
import { GameError, type GameState } from "./types";

/** Мир черновика от клиента: неизвестный id — понятная ошибка, а не падение. */
export function draftWorld(d: Pick<CharacterDraft, "world">): World {
  if (d.world !== undefined && !isWorldId(d.world)) throw new GameError("Неизвестный мир.");
  return worldOf(d);
}

export interface NewGameResult extends GameState {
  usage: Usage;
  model: string;
  usedFallback: boolean;
}

/** Создание героя и кампании: проверка черновика, квест от рассказчика, раскладка карты. */
export async function newGame(o: { router: ModelRouter; tier: Tier; draft: CharacterDraft; rng: Rng; seed: string; signal?: AbortSignal }): Promise<NewGameResult> {
  const world = draftWorld(o.draft);
  const errors = validateDraft(world.rules, o.draft);
  if (errors.length) throw new GameError(errors.join(" "));
  const character = createCharacter(world.rules, o.draft, o.rng);
  const { provider, model } = o.router.route("narrator", o.tier);
  let usage = emptyUsage();
  let campaign: Campaign | null = null;
  for (let attempt = 0; attempt < 2 && !campaign; attempt++) {
    const r = await provider.complete({
      model, signal: o.signal, maxTokens: 3000, temperature: 1,
      messages: [{ role: "user", content: questPrompt(world, character) }],
    });
    usage = addUsage(usage, r.usage);
    const raw = extractJson(r.text);
    try {
      if (raw && typeof raw === "object") campaign = layoutCampaign(world.rules, raw as QuestSeed, o.seed);
    } catch {
      campaign = null;
    }
  }
  const usedFallback = !campaign;
  return { character, campaign: campaign ?? layoutCampaign(world.rules, world.fallbackQuest, o.seed), usage, model, usedFallback };
}

/** Предыстория по выбору игрока — служебной моделью. */
export async function generateBackstory(o: { router: ModelRouter; draft: CharacterDraft; signal?: AbortSignal }): Promise<{ text: string; usage: Usage }> {
  const { provider, model } = o.router.route("utility");
  // Лимит с запасом: служебная модель тратит до 2000 токенов на скрытые рассуждения.
  const r = await provider.complete({ model, signal: o.signal, maxTokens: 3000, reasoningEffort: "minimal", temperature: 1, messages: [{ role: "user", content: backstoryPrompt(draftWorld(o.draft), o.draft) }] });
  if (!r.text.trim()) throw new GameError("Мастер не успел придумать предысторию — попробуй ещё раз.");
  return { text: r.text.trim().replace(/^["«]|["»]$/g, "").slice(0, 1200), usage: r.usage };
}
