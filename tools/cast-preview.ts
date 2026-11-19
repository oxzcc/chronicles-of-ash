/**
 * Пробные портреты постоянных лиц мира (наставник, союзники) — до того, как их нарисует игра.
 *
 *   pnpm cast:preview -- --world arkham
 *
 * Тот же конвейер, описание и seed, что у игры, с LoRA и силой из .env (и проверкой рук, если задана VISION_MODEL).
 * Итог — data/cast/<мир>-<время>/index.html. Около $0.035 за портрет на klein 9B Base 2:3 (перерисовка — ещё столько же).
 * Не понравился портрет — правим `portrait` в данных мира: игра перерисует его сама
 * (отпечаток описания — в теге картинки).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashStr } from "@ash/engine";
import { getWorld } from "@ash/worlds";
import { configFromEnv, createRouter } from "@ash/llm";
import { falConfigFromEnv, FalImageProvider, LocalStorage, portraitInspector, renderPortrait } from "@ash/images";

const i = process.argv.indexOf("--world");
const world = getWorld(i >= 0 ? process.argv[i + 1]! : "arkham");
if (!world.cast) throw new Error(`У мира ${world.id} нет постоянных лиц`);
const cfg = falConfigFromEnv();
if (!cfg) throw new Error("Нужен FAL_KEY в .env (и IMAGES_FAKE не 1)");

const dir = join("data/cast", `${world.id}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const storage = new LocalStorage(dir, "");
const provider = new FalImageProvider(cfg);
const inspect = portraitInspector(createRouter(configFromEnv()));
const cast = [world.cast.mentor, ...world.cast.allies];
let total = 0;
const cards: string[] = [];
for (const m of cast) {
  process.stdout.write(`${m.name} … `);
  const r = await renderPortrait({ world, provider, storage, description: m.portrait, key: m.id, seed: hashStr(m.id) % 1_000_000, inspect });
  total += r.costUsd;
  console.log(`$${r.costUsd.toFixed(4)}${r.redrawn ? ` (перерисован${r.issues.length ? `; осталось: ${r.issues.join(", ")}` : ""})` : ""}`);
  cards.push(`<figure><img src="${r.url}" alt=""><figcaption><b>${m.name}</b><br><i>${m.role}</i><br>${m.look}</figcaption></figure>`);
}
writeFileSync(
  join(dir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>${world.title}: постоянные лица</title>
<style>body{background:#1b1612;color:#e8dcc8;font:15px/1.4 Georgia,serif;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}
figure{margin:0;background:#2a221b;border-radius:8px;padding:10px}img{width:100%;background:#d8d8d8;border-radius:4px}figcaption{margin-top:8px;font-size:13px}b{font-size:15px}</style>
<h1>${world.title}: постоянные лица</h1><main>${cards.join("")}</main>`,
);
console.log(`\nГотово: ${join(dir, "index.html")}\nИтого: $${total.toFixed(4)}`);
