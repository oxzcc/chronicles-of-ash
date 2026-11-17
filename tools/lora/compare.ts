/**
 * Сравнение картинок мира с LoRA стиля и без: одни описания и seed, несколько сил LoRA.
 *
 *   pnpm lora:compare -- --world arkham                       LoRA из data/lora/<мир>_lora.json или .env
 *   pnpm lora:compare -- --world arkham --scales 0.6,0.8,1    свои силы
 *   pnpm lora:compare -- --world arkham --lora <url>          другие веса
 *
 * Рисует 6 портретов (через тот же конвейер, что и игра: вырезание фона, проверка кадра) и 3 фона
 * на каждую колонку. Итог — data/lora/compare/<мир>-<время>/index.html. Стоит порядка $0.1 за колонку.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LocationType } from "@ash/engine";
import { getWorld, type TimeOfDay } from "@ash/worlds";
import { baseHero, falConfigFromEnv, FalImageProvider, LocalStorage, renderBackground, renderPortrait, type LoraRef } from "@ash/images";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
};
const world = getWorld(arg("world", "arkham"));
const scales = arg("scales", "0.6,0.8,1").split(",").map(Number).filter((x) => x > 0 && x <= 2);

const cfg = falConfigFromEnv();
if (!cfg) throw new Error("Нужен FAL_KEY в .env (и IMAGES_FAKE не 1)");
if (!world.art.lora) throw new Error(`У мира ${world.id} нет art.lora (триггера) — сравнивать нечего`);

let loraUrl = arg("lora", "");
if (!loraUrl) {
  try {
    loraUrl = JSON.parse(readFileSync(join("data/lora", `${world.id}_lora.json`), "utf8")).loraUrl ?? "";
  } catch {}
}
loraUrl ||= cfg.loras?.[world.id]?.url ?? "";
if (!loraUrl) throw new Error("Не нашёл веса LoRA: передай --lora <url> или сначала pnpm lora:train");

// Что рисуем: три облика героя, три жителя, три места.
const races = Object.keys(world.rules.races);
const classes = Object.keys(world.art.classEn).slice(0, 3);
const portraits = [
  ...classes.map((cls, i) => baseHero(world, { race: races[0]!, cls, gender: i % 2 ? "m" : "f" })),
  `an old woman, ${world.art.localEn}, sharp suspicious eyes`,
  `a young man, ${world.art.strangerEn}`,
  `a heavyset middle-aged man, ${world.art.localEn}, friendly grin`,
];
const outdoor = (Object.keys(world.art.locationEn) as LocationType[]).filter((t) => !world.art.interiorTypes.includes(t));
const places: { type: LocationType; time: TimeOfDay }[] = [
  { type: world.art.interiorTypes[0]!, time: "night" },
  { type: outdoor[0]!, time: "dusk" },
  { type: outdoor[1] ?? outdoor[0]!, time: "night" },
];

const columns: { id: string; title: string; lora?: LoraRef }[] = [
  { id: "base", title: "Без LoRA" },
  ...scales.map((s) => ({ id: `s${Math.round(s * 100)}`, title: `LoRA ${s}`, lora: { url: loraUrl, scale: s } })),
];

const dir = join("data/lora/compare", `${world.id}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
const storage = new LocalStorage(dir);
const cells: Record<string, Record<string, string>> = {};
let cost = 0;

for (const col of columns) {
  const provider = new FalImageProvider({ ...cfg, loras: col.lora ? { [world.id]: col.lora } : {} });
  console.log(`\n${col.title}`);
  for (const [i, description] of portraits.entries()) {
    const key = `${col.id}/p${i + 1}`;
    const r = await renderPortrait({ world, provider, storage, description, key, seed: 1000 + i });
    (cells[`p${i + 1}`] ??= {})[col.id] = `${key}.webp`;
    cost += r.costUsd;
    console.log(`  портрет ${i + 1}${r.redrawn ? " (перерисован)" : ""}`);
  }
  for (const [i, p] of places.entries()) {
    const key = `${col.id}/b${i + 1}`;
    const r = await renderBackground({ world, provider, storage, description: world.art.locationEn[p.type]!, time: p.time, key, seed: 2000 + i });
    (cells[`b${i + 1}`] ??= {})[col.id] = `${key}.webp`;
    cost += r.costUsd;
    console.log(`  фон ${p.type}`);
  }
}

const rows = [
  ...portraits.map((d, i) => ({ id: `p${i + 1}`, label: d })),
  ...places.map((p, i) => ({ id: `b${i + 1}`, label: `${p.type}, ${p.time}` })),
];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
writeFileSync(
  join(dir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>LoRA ${world.id}</title>
<style>body{font:14px system-ui;background:#1b1b1b;color:#ddd;margin:16px}table{border-collapse:collapse}td,th{padding:6px;vertical-align:top}
th{position:sticky;top:0;background:#1b1b1b}img{width:300px;display:block;background:#3a3a3a}td.l{max-width:180px;font-size:12px;color:#999}</style>
<h1>${esc(world.id)}: с LoRA и без</h1><p>Веса: ${esc(loraUrl)}<br>Цена прогона ≈ $${cost.toFixed(2)}</p>
<table><tr><th></th>${columns.map((c) => `<th>${esc(c.title)}</th>`).join("")}</tr>
${rows.map((r) => `<tr><td class="l">${esc(r.label)}</td>${columns.map((c) => `<td><img src="${cells[r.id]?.[c.id] ?? ""}" loading="lazy"></td>`).join("")}</tr>`).join("\n")}
</table>`,
);
console.log(`\nГотово: ${join(dir, "index.html")} (≈ $${cost.toFixed(2)})`);
