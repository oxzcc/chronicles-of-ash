/**
 * Прогон тестовых сцен на нескольких моделях.
 *   pnpm arena:run -- anthropic/claude-sonnet-5.5 deepseek/deepseek-v4.1-flash google/gemini-3.8-flash
 *   pnpm arena:run -- --scenes 02,05 <модели…>
 *   pnpm arena:run -- --world arkham <модели…>       (сцены мира Аркхэма; по умолчанию — фэнтези)
 * Без аргументов берёт модели из ARENA_MODELS (через запятую).
 * Все модели получают одинаковые броски: генератор сидируется по id сцены.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyCaseChanges, hashStr, mulberry32, storyMove } from "@ash/engine";
import { configFromEnv, createRouter, runNarratorTurn } from "@ash/llm";
import { worldBiblePath } from "@ash/worlds";
import { buildScene, type SceneSet } from "./scene";
import { FANTASY_SCENES } from "./scenes";
import { ARKHAM_SCENES } from "./scenes-arkham";

const SETS: Record<string, SceneSet> = { fantasy: FANTASY_SCENES, arkham: ARKHAM_SCENES };

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => a !== "--");
const sceneArg = args.indexOf("--scenes");
const only = sceneArg >= 0 ? args.splice(sceneArg, 2)[1]!.split(",") : null;
const worldArg = args.indexOf("--world");
const set = SETS[worldArg >= 0 ? args.splice(worldArg, 2)[1]! : "fantasy"];
if (!set) {
  console.error(`Нет сцен для этого мира. Есть: ${Object.keys(SETS).join(", ")}`);
  process.exit(1);
}
const models = args.length ? args : (process.env.ARENA_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const router = createRouter(configFromEnv());
if (router.isFake) console.warn("⚠ OPENROUTER_API_KEY не задан — прогон на фейковой модели (для проверки самого инструмента).");
if (!models.length) models.push(...(router.isFake ? ["fake-a", "fake-b"] : []));
if (!models.length) {
  console.error("Укажи модели: pnpm arena:run -- <model> <model> …");
  process.exit(1);
}

let worldBible = "";
try {
  worldBible = readFileSync(join(here, "..", "..", worldBiblePath(set.world)), "utf8");
} catch {}

const scenes = set.scenes.filter((s) => !only || only.some((o) => s.id.startsWith(o)));
const results: any[] = [];
let total = 0;

for (const scene of scenes) {
  for (const model of models) {
    const { provider, model: id } = router.direct(model);
    const t0 = Date.now();
    process.stdout.write(`${scene.id} × ${model} … `);
    try {
      const { world, ...built } = buildScene(set, scene);
      const r = await runNarratorTurn({ provider, model: id, world, worldBible, scene: built, rng: mulberry32(hashStr(scene.id)) });
      total += r.usage.costUsd;
      // Переход по рассказу: что скажет движок (на копии кампании, после reveal из этого же ответа).
      let move: string | null = null;
      if (r.response.move) {
        const w = structuredClone(built.campaign);
        applyCaseChanges(w, { clues: r.response.clues, reveal: r.response.reveal });
        const m = storyMove(world.rules, w, r.response.move, mulberry32(1));
        move = `«${r.response.move}» → ${!m ? "то же место" : "error" in m ? `отклонён: ${m.error}` : `принят: ${m.to.name}`}`;
      }
      results.push({ scene: scene.id, model, ms: Date.now() - t0, response: r.response, move, rolls: r.rolls.map((x) => x.summary), usage: r.usage, degraded: r.degraded, requests: r.requests });
      // Эмоции реплик (gm-7): у кого и какие — сверить с текстом при оценке.
      const emotions = r.response.beats.filter((b) => b.emotion).map((b) => `${b.speaker}: ${b.emotion}`);
      console.log(`${Date.now() - t0} мс, $${r.usage.costUsd.toFixed(4)}${r.degraded ? ", JSON не разобран" : ""}${move ? `, move ${move}` : ""}${emotions.length ? `, эмоции ${emotions.join("; ")}` : ""}`);
    } catch (e) {
      results.push({ scene: scene.id, model, error: (e as Error).message });
      console.log(`ошибка: ${(e as Error).message}`);
    }
  }
}

const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), world: set.world, models, scenes: scenes.map(({ tweak, ...s }) => s), results }, null, 2));
console.log(`\nСохранено: ${file}\nИтого: $${total.toFixed(4)}\nДальше: pnpm arena:ballot ${file}`);
