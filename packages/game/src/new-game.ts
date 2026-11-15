import { createCharacter, layoutCampaign, validateDraft, type Campaign, type CharacterDraft, type QuestSeed, type Rng } from "@ash/engine";
import { addUsage, backstoryPrompt, emptyUsage, extractJson, questPrompt, type ModelRouter, type Tier, type Usage } from "@ash/llm";
import { GameError, type GameState } from "./types";

/** Запасной квест — если модель дважды не вернула годный JSON, игрок всё равно начинает игру. */
export const FALLBACK_QUEST: QuestSeed = {
  questTitle: "Пепел над Чернолесьем",
  hook: "В деревне Вересковый Брод пропадают люди, а над Чернолесьем по ночам поднимается пепельный дым. Староста обещает награду тому, кто вернёт пропавших.",
  objectives: ["Расспросить жителей Брода о пропавших", "Найти источник пепельного дыма", "Остановить того, кто похищает людей"],
  locations: [
    { name: "Вересковый Брод", type: "village", desc: "Деревня у реки, где по ночам запирают ставни." },
    { name: "Таверна «Хромой гусь»", type: "tavern", desc: "Шумная корчма у переправы, где сплетни дешевле эля." },
    { name: "Королевский тракт", type: "road", desc: "Старая дорога, где патрули давно не появлялись." },
    { name: "Лагерь лесорубов", type: "camp", desc: "Брошенные палатки и остывшие кострища." },
    { name: "Чернолесье", type: "forest", desc: "Густой ельник, где тропы будто меняются местами." },
    { name: "Топи Морн", type: "swamp", desc: "Гнилая вода и огни, манящие с тропы." },
    { name: "Руины Дозорной башни", type: "ruins", desc: "Обломки сторожевой башни времён прошлой войны." },
    { name: "Пепельная пещера", type: "cave", desc: "Из расщелины тянет дымом и чем-то сладким." },
  ],
  target: 7,
};

export interface NewGameResult extends GameState {
  usage: Usage;
  model: string;
  usedFallback: boolean;
}

/** Создание героя и кампании: проверка черновика, квест от рассказчика, раскладка карты. */
export async function newGame(o: { router: ModelRouter; tier: Tier; draft: CharacterDraft; rng: Rng; seed: string; signal?: AbortSignal }): Promise<NewGameResult> {
  const errors = validateDraft(o.draft);
  if (errors.length) throw new GameError(errors.join(" "));
  const character = createCharacter(o.draft, o.rng);
  const { provider, model } = o.router.route("narrator", o.tier);
  let usage = emptyUsage();
  let campaign: Campaign | null = null;
  for (let attempt = 0; attempt < 2 && !campaign; attempt++) {
    const r = await provider.complete({
      model, signal: o.signal, maxTokens: 3000, temperature: 1,
      messages: [{ role: "user", content: questPrompt(character) }],
    });
    usage = addUsage(usage, r.usage);
    const raw = extractJson(r.text);
    try {
      if (raw && typeof raw === "object") campaign = layoutCampaign(raw as QuestSeed, o.seed);
    } catch {
      campaign = null;
    }
  }
  const usedFallback = !campaign;
  return { character, campaign: campaign ?? layoutCampaign(FALLBACK_QUEST, o.seed), usage, model, usedFallback };
}

/** Предыстория по выбору игрока — служебной моделью. */
export async function generateBackstory(o: { router: ModelRouter; draft: CharacterDraft; signal?: AbortSignal }): Promise<{ text: string; usage: Usage }> {
  const { provider, model } = o.router.route("utility");
  const r = await provider.complete({ model, signal: o.signal, maxTokens: 400, temperature: 1, messages: [{ role: "user", content: backstoryPrompt(o.draft) }] });
  return { text: r.text.trim().replace(/^["«]|["»]$/g, "").slice(0, 1200), usage: r.usage };
}
