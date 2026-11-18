/**
 * Автоплейтест: играет кампанию на настоящей модели без базы и пишет стенограмму.
 * Проверка фазы 1 — 30 ходов подряд без сломанного JSON и без решений за игрока.
 *
 *   pnpm playtest -- --tier free --turns 30 --out tools/playtest/out/deepseek
 *   pnpm playtest -- --world arkham --turns 10        (мир Аркхэма; по умолчанию — фэнтези)
 *
 * Состояние сохраняется после каждого хода, поэтому прогон можно прервать и продолжить
 * той же командой. --budget <сек> — остановиться после этого времени (по умолчанию без лимита).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isHealing, neighbors, secureRng, type CharacterDraft } from "@ash/engine";
import { getWorld, worldBiblePath, worldOf } from "@ash/worlds";
import { configFromEnv, createRouter, type Tier } from "@ash/llm";
import { newGame, playTurn, type GameState, type TurnInput, type TurnRecord } from "@ash/game";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
};
const tier = arg("tier", "free") as Tier;
const target = Number(arg("turns", "30"));
const budgetMs = Number(arg("budget", "0")) * 1000;
const worldId = arg("world", "fantasy");
const out = arg("out", `tools/playtest/out/${worldId === "fantasy" ? tier : `${worldId}-${tier}`}`);
const started = Date.now();

const router = createRouter(configFromEnv());
if (router.isFake) console.warn("⚠ Нет OPENROUTER_API_KEY — играет фейковая модель.");
let worldBible = "";
try {
  worldBible = readFileSync(worldBiblePath(getWorld(worldId).id), "utf8");
} catch {}

interface Save {
  state: GameState;
  records: TurnRecord[];
  /** Ходы игрока (не считая боевых раундов и служебных записей). */
  playerTurns: number;
}

mkdirSync(out, { recursive: true });
const savePath = join(out, "save.json");
let save: Save;
if (existsSync(savePath)) save = JSON.parse(readFileSync(savePath, "utf8"));
else {
  /** Герой-«игрок» для каждого мира. */
  const HEROES: Record<string, Omit<CharacterDraft, "base">> = {
    fantasy: { world: "fantasy", name: "Ровена", gender: "f", race: "human", cls: "ranger", skills: ["Внимательность", "Убеждение"], backstory: "Охотница с пограничья. Её брат ушёл с караваном на север и не вернулся." },
    arkham: { world: "arkham", name: "Уолтер Грей", gender: "m", race: "human", cls: "detective", skills: ["Внимательность", "Психология"], backstory: "Бывший полицейский из Бостона. Ушёл со службы после дела, которое закрыли слишком быстро." },
  };
  const hero = HEROES[worldId];
  if (!hero) throw new Error(`Нет героя для мира ${worldId}`);
  const draft: CharacterDraft = { ...hero, base: { ...getWorld(worldId).rules.recommended[hero.cls]! } };
  const g = await newGame({ router, tier, draft, rng: secureRng, seed: String(Date.now()) });
  console.log(`Квест: «${g.campaign.questTitle}»${g.usedFallback ? " (запасной)" : ""}, $${g.usage.costUsd.toFixed(4)}`);
  save = { state: { character: g.character, campaign: g.campaign }, records: [], playerTurns: 0 };
}

/** Что делает «игрок»: чередует подсказки мастера, свой текст, переходы и отдых; в бою атакует. */
function nextInput(s: Save): TurnInput {
  const w = s.state.campaign;
  const c = s.state.character;
  if (s.records.length === 0) return { kind: "start" };
  if (w.combat) return { kind: "combat", move: c.hp < c.hpMax / 3 && c.items.some((i) => isHealing(worldOf(c).rules, i)) ? "potion" : c.abilityUses > 0 ? "ability" : "attack" };
  const n = s.playerTurns;
  if (c.hp < c.hpMax / 2 && n % 4 === 3) return { kind: "rest" };
  if (n % 5 === 4) {
    // Идём к ещё не посещённому соседу, иначе — к любому.
    const nb = neighbors(w, w.current);
    const pick = nb.find((l) => !l.visited) ?? nb[n % nb.length]!;
    return { kind: "travel", to: pick.id };
  }
  const last = [...s.records].reverse().find((r) => r.suggestions.length);
  const free = ["Осматриваюсь внимательнее и прислушиваюсь", "Спрашиваю, что здесь недавно случилось", "Пытаюсь незаметно проследить за подозрительным типом"];
  if (n % 3 === 2 || !last) return { kind: "action", text: free[n % free.length]! };
  // Варианты мастера выбираем по номеру: так проверяется путь с заранее брошенной проверкой.
  return { kind: "choice", index: n % last.suggestions.length };
}

function transcript(s: Save): string {
  const w = s.state.campaign;
  const lines = [`# Плейтест: ${w.questTitle}`, "", `Тариф: ${tier}. ${w.hook}`, ""];
  for (const [i, r] of s.records.entries()) {
    lines.push(`## ${i + 1}. ${r.kind === "action" || r.kind === "choice" ? `> ${r.action}` : `[${r.action}]`}`);
    for (const roll of r.rolls) lines.push(`- 🎲 ${roll.summary}`);
    for (const b of r.beats?.length ? r.beats : [{ speaker: null, text: r.narration }]) lines.push("", b.speaker ? `**${b.speaker}:** «${b.text}»` : b.text);
    if (r.suggestions.length) lines.push("", `_Варианты: ${r.suggestions.map((x) => (x.check ? `[${x.check.skill} ${x.check.dc}] ${x.text}` : x.text)).join(" · ")}_`);
    if (r.applied?.notes.length) lines.push("", `_Изменения: ${r.applied.notes.join(" · ")}_`);
    if (r.applied?.rejected.length) lines.push("", `_Отклонено движком: ${r.applied.rejected.join("; ")}_`);
    if (r.degraded) lines.push("", "**⚠ JSON не разобран.** Сырой ответ:", "", "```", r.raw ?? "", "```");
    lines.push("");
  }
  return lines.join("\n");
}

function report(s: Save) {
  const narr = s.records.filter((r) => r.model !== "engine");
  const cost = narr.reduce((a, r) => a + r.usage.costUsd, 0);
  const degraded = narr.filter((r) => r.degraded).length;
  const rejected = narr.flatMap((r) => r.applied?.rejected ?? []);
  const cached = narr.reduce((a, r) => a + r.usage.cachedTokens, 0);
  const input = narr.reduce((a, r) => a + r.usage.inputTokens, 0);
  return {
    tier, model: narr.at(-1)?.model, playerTurns: s.playerTurns, narratorTurns: narr.length, degraded,
    rolls: narr.reduce((a, r) => a + r.rolls.length, 0), combats: s.records.filter((r) => r.action === "Начало боя").length,
    knockouts: s.records.filter((r) => r.kind === "knockout").length, rejected, costUsd: Number(cost.toFixed(4)),
    costPerTurn: Number((cost / Math.max(1, narr.length)).toFixed(5)), cacheHitShare: Number((cached / Math.max(1, input)).toFixed(2)),
    objectivesDone: s.state.campaign.objectives.filter((o) => o.done).length + "/" + s.state.campaign.objectives.length,
    visited: s.state.campaign.locations.filter((l) => l.visited).length + "/" + s.state.campaign.locations.length,
    hero: { hp: `${s.state.character.hp}/${s.state.character.hpMax}`, gold: s.state.character.gold, items: s.state.character.items.length },
  };
}

while (save.playerTurns < target) {
  if (budgetMs && Date.now() - started > budgetMs) break;
  const input = nextInput(save);
  const t0 = Date.now();
  try {
    const r = await playTurn({ router, tier, worldBible, rng: secureRng }, save.state, save.records, input);
    save.records.push(...r.records);
    if (input.kind !== "combat") save.playerTurns++;
    const main = r.records.find((x) => x.model !== "engine");
    console.log(`${save.playerTurns}/${target} ${input.kind}${"text" in input ? `: ${input.text.slice(0, 50)}` : ""}${"index" in input ? ` #${input.index}` : ""} — ${Date.now() - t0} мс${main?.degraded ? " ⚠ JSON" : ""}${r.records.some((x) => x.kind === "combat") ? " ⚔" : ""}`);
  } catch (e) {
    console.log(`ошибка на ходу ${input.kind}: ${(e as Error).message}`);
    if (input.kind === "start") break;
    save.playerTurns++;
  }
  writeFileSync(savePath, JSON.stringify(save));
}

writeFileSync(join(out, "transcript.md"), transcript(save));
writeFileSync(join(out, "report.json"), JSON.stringify(report(save), null, 2));
console.log(JSON.stringify(report(save), null, 2));
