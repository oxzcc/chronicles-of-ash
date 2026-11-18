/**
 * Перерисовать готовые картинки мира в нынешнем стиле — после смены LoRA, её силы или промптов картинок.
 *
 *   pnpm images:restyle -- --world arkham            посчитать, спросить подтверждение и поставить в очередь
 *   pnpm images:restyle -- --world arkham --heroes   и портреты героев игроков (их выбирали сами игроки)
 *   pnpm images:restyle -- --world arkham --yes      без вопроса
 *
 * Картинки перерисовываются на месте (restyleImages): ссылки из кампаний остаются, файлы — под новым ключом.
 * Рисует воркер игры — нужен запущенный pnpm dev. Задачи идут «про запас», после срочных.
 */
import { createInterface } from "node:readline/promises";
import { createDb } from "@ash/db";
import { restyleImages } from "@ash/game";
import { isWorldId } from "@ash/worlds";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const world = arg("world") ?? "arkham";
if (!isWorldId(world)) throw new Error(`Нет мира ${world}`);
const heroes = process.argv.includes("--heroes");

/** Примерная цена одной картинки с LoRA на klein 9B Base ($0.02 за Мп; портрет 2:3 — 1.57 Мп) с вырезанием фона и редкими перерисовками кадра. */
const PRICE: Record<string, number> = { npc: 0.04, hero: 0.04, background: 0.042 };
const NAMES: Record<string, string> = { npc: "портреты NPC", hero: "портреты героев", background: "фоны" };

const { db, pool } = createDb();
try {
  const counts = await restyleImages(db, world, { heroes, dryRun: true });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) {
    console.log(`У мира ${world} нет готовых картинок — перерисовывать нечего.`);
  } else {
    const cost = Object.entries(counts).reduce((a, [k, n]) => a + (PRICE[k] ?? 0.03) * n, 0);
    console.log(`Мир ${world}: ${Object.entries(counts).map(([k, n]) => `${NAMES[k] ?? k}: ${n}`).join(", ")} — около $${cost.toFixed(2)}.`);
    let ok = process.argv.includes("--yes");
    if (!ok) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      ok = /^(y|yes|д|да)$/i.test((await rl.question("Перерисовать? [y/N] ")).trim());
      rl.close();
    }
    if (ok) {
      await restyleImages(db, world, { heroes });
      console.log("Поставлено в очередь. Рисует воркер игры — держи запущенным pnpm dev.");
    } else console.log("Отменено.");
  }
} finally {
  await pool.end();
}
