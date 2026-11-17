import {
  createCharacter, layoutCampaign, mulberry32,
  type Campaign, type Character, type CharacterDraft, type ClassKey, type QuestSeed, type RaceKey, type SkillName,
} from "@ash/engine";
import type { HistoryEntry } from "@ash/llm";
import { getWorld, type World } from "@ash/worlds";

/**
 * Тестовые сцены для слепого сравнения рассказчиков и для проверки промптов перед выкаткой.
 * Каждая проверяет что-то своё — поле `checks` подсказывает оценщику, на что смотреть.
 * Сцены собраны в наборы по мирам: у каждого мира свой квест и свои герои.
 */
export interface Scene {
  id: string;
  title: string;
  checks: string;
  hero: { name: string; gender: "m" | "f"; race: RaceKey; cls: ClassKey; skills: [SkillName, SkillName]; backstory: string };
  /** Индекс текущей локации на общей карте. */
  at: number;
  done?: string[];
  summary?: string;
  npc?: Campaign["npc"];
  history?: HistoryEntry[];
  /** Изменения героя перед сценой. */
  tweak?: (c: Character) => void;
  action: string;
}

export interface SceneSet {
  /** id мира. */
  world: string;
  /** Общий квест всех сцен набора. */
  quest: QuestSeed;
  scenes: Scene[];
}

export function buildScene(set: SceneSet, s: Scene): { world: World; character: Character; campaign: Campaign; history: HistoryEntry[]; action: string } {
  const world = getWorld(set.world);
  const R = world.rules;
  const draft: CharacterDraft = { world: world.id, ...s.hero, base: { ...R.recommended[s.hero.cls]! }, skills: [...s.hero.skills] };
  const character = createCharacter(R, draft, mulberry32(7));
  character.gold = 18;
  s.tweak?.(character);
  const campaign = layoutCampaign(R, set.quest, "arena");
  campaign.current = `L${s.at}`;
  for (const o of campaign.objectives) o.done = !!s.done?.includes(o.id);
  campaign.summary = s.summary ?? "";
  campaign.npc = s.npc ?? null;
  return { world, character, campaign, history: s.history ?? [], action: s.action };
}
