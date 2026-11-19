/**
 * Пробные варианты лица (эмоции своих и состояния героя) — тем же конвейером, что игра:
 * готовый портрет → правка (klein 9B Base + LoRA) → вырезка → размер исходника.
 *
 *   pnpm emotions:preview -- --world arkham [--cast hattie,wakefield] [--hero <портрет героя .webp> --hero-look "<облик по-английски>"]
 *
 * Свои: портрет — тем же описанием и seed, что в игре, затем все эмоции мира (art.emotions.npc).
 * Герой: готовый портрет из data/images/hero — все состояния (art.emotions.hero).
 * Итог — data/emotions/<мир>-<время>/index.html. ≈ $0.053 за вариант, ≈ $0.035 за портрет своего.
 * Проверка 19 ноября (до конвейера) — data/emotions/arkham-2026-11-19.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashStr } from "@ash/engine";
import { getWorld } from "@ash/worlds";
import { falConfigFromEnv, FalImageProvider, LocalStorage, renderPortrait, renderVariant } from "@ash/images";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const world = getWorld(arg("--world") ?? "arkham");
const emotions = world.art.emotions;
if (!emotions) throw new Error(`У мира ${world.id} нет эмоций (art.emotions)`);
const cfg = falConfigFromEnv();
if (!cfg) throw new Error("Нужен FAL_KEY в .env (и IMAGES_FAKE не 1)");
const provider = new FalImageProvider(cfg);
if (!provider.loraFor(world.id)) console.warn(`Внимание: LoRA мира ${world.id} не задана — правка уйдёт без стиля мира`);

const dir = arg("--out") ?? join("data/emotions", `${world.id}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const storage = new LocalStorage(dir, "");
let total = 0;
const rows: string[] = [];
const fig = (url: string, label: string) => `<figure><img src="${url}" alt=""><figcaption>${label}</figcaption></figure>`;

async function variants(id: string, name: string, baseUrl: string, look: string, list: [string, string, string][]) {
  const cells = [fig(baseUrl, "исходный")];
  for (const [mood, label, change] of list) {
    process.stdout.write(`${name}: ${label} … `);
    try {
      const r = await renderVariant({ world, provider, storage, baseUrl, look, change, key: `${id}-${mood}`, seed: hashStr(id + mood) % 1_000_000 });
      total += r.costUsd;
      cells.push(fig(r.url, label));
      console.log(`$${r.costUsd.toFixed(4)}`);
    } catch (e) {
      console.log(String(e));
      cells.push(`<figure><figcaption>${label}: ошибка</figcaption></figure>`);
    }
  }
  rows.push(`<h2>${name}</h2><main>${cells.join("")}</main>`);
}

const npcList = Object.entries(emotions.npc).map(([k, v]): [string, string, string] => [k, v.ru, v.en]);
const only = (arg("--cast") ?? "caldwell,wakefield,malloy").split(",").filter(Boolean);
for (const m of world.cast ? [world.cast.mentor, ...world.cast.allies].filter((m) => only.includes(m.id)) : []) {
  process.stdout.write(`${m.name}: портрет … `);
  const base = await renderPortrait({ world, provider, storage, description: m.portrait, key: m.id, seed: hashStr(m.id) % 1_000_000 });
  total += base.costUsd;
  console.log(`$${base.costUsd.toFixed(4)}`);
  await variants(m.id, m.name, base.url, m.portrait, npcList);
}

const hero = arg("--hero");
if (hero) {
  const url = await storage.put("hero.webp", readFileSync(hero));
  const labels: Record<string, string> = { wounded: "ранен", edge: "на грани", breakdown: "срыв" };
  await variants("hero", "Герой: состояния движка", url, arg("--hero-look") ?? "", Object.entries(emotions.hero).map(([k, v]) => [k, labels[k] ?? k, v]));
}

writeFileSync(
  join(dir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>${world.title}: варианты лица</title>
<style>body{background:#1b1612;color:#e8dcc8;font:15px/1.4 Georgia,serif;margin:24px}main{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin-bottom:28px}
figure{margin:0;background:#2a221b;border-radius:8px;padding:8px}img{width:100%;background:#cdcdcd;border-radius:4px}figcaption{margin-top:6px;text-align:center}</style>
<h1>${world.title}: варианты лица</h1><p>Итого: $${total.toFixed(3)}</p>${rows.join("")}`,
);
console.log(`\nГотово: ${join(dir, "index.html")}\nИтого: $${total.toFixed(3)}`);
