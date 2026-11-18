/**
 * Обучение LoRA стиля мира на fal (FLUX.2 [klein] 9B Base; тренер 4B на fal закрыт).
 * Такая LoRA работает только на 9B Base — в игре её рисует fal-ai/flux-2/klein/9b/base/lora (FAL_LORA_MODEL).
 * На дистиллированной klein/9b/lora она почти не действует.
 *
 *   pnpm lora:train -- --world arkham                 загрузить датасет и обучить (спросит подтверждение)
 *   pnpm lora:train -- --world arkham --steps 1500 --lr 0.0002   больше шагов и выше learning rate
 *     (по умолчанию 1000 шагов и 5e-5, как у fal; на 58 картинках стиля этого не хватило — LoRA почти не меняла картинку)
 *   pnpm lora:train -- --world arkham --resume <id>    дождаться уже запущенного обучения
 *
 * Датасет — data/lora/<мир>_dataset.zip (pnpm lora:dataset). Ключ — FAL_KEY из .env, в вывод не попадает.
 * Итог пишется в data/lora/<мир>_lora.json, в конце — строки для .env.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { fal } from "@fal-ai/client";

const TRAINER_DEFAULT = "fal-ai/flux-2-klein-9b-base-trainer";
/** Эндпоинт генерации, который понимает LoRA этого тренера. */
const INFERENCE: Record<string, string> = {
  "fal-ai/flux-2-klein-9b-base-trainer": "fal-ai/flux-2/klein/9b/base/lora",
  "fal-ai/flux-2-klein-4b-base-trainer": "fal-ai/flux-2/klein/4b/base/lora",
};

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
};
const world = arg("world", "arkham");
const TRAINER = arg("trainer", TRAINER_DEFAULT);
const steps = Number(arg("steps", "1000"));
const lr = Number(arg("lr", "0.00005"));
const resume = arg("resume", "");
const zipPath = arg("zip", join("data/lora", `${world}_dataset.zip`));
const statePath = join("data/lora", `${world}_lora.json`);

if (!process.env.FAL_KEY) throw new Error("FAL_KEY не задан в .env");
if (!Number.isInteger(steps) || steps < 100 || steps > 20000 || steps % 100) throw new Error("--steps: от 100 до 20000, кратно 100");
fal.config({ credentials: process.env.FAL_KEY });

const save = (data: Record<string, unknown>) => {
  let prev: Record<string, unknown> = {};
  try {
    prev = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {}
  writeFileSync(statePath, JSON.stringify({ ...prev, ...data }, null, 2));
};

let requestId = resume;
if (!requestId) {
  const zip = readFileSync(zipPath);
  console.log(`Датасет: ${zipPath} (${(zip.length / 1024 / 1024).toFixed(0)} МБ)`);
  console.log(`Тренер: ${TRAINER}, шагов ${steps}, learning rate ${lr}. Цена — по тарифу fal за шаг (страница тренера на fal.ai).`);
  if (!process.argv.includes("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ok = (await rl.question("Запустить обучение? (y/N) ")).trim().toLowerCase();
    rl.close();
    if (ok !== "y" && ok !== "yes" && ok !== "д" && ok !== "да") process.exit(0);
  }
  console.log("Загружаю датасет в хранилище fal…");
  const url = await fal.storage.upload(new Blob([zip], { type: "application/zip" }));
  const sub = await fal.queue.submit(TRAINER, { input: { image_data_url: url, steps, learning_rate: lr } });
  requestId = sub.request_id;
  save({ world, trainer: TRAINER, inference: INFERENCE[TRAINER], steps, learningRate: lr, requestId, startedAt: new Date().toISOString() });
  console.log(`Обучение запущено: ${requestId}\nЕсли прервёшь скрипт, обучение продолжится; дождаться: pnpm lora:train -- --world ${world} --resume ${requestId}`);
}

let seen = 0;
let quietSince = Date.now();
const t0 = Date.now();
const mins = () => `${Math.round((Date.now() - t0) / 60000)} мин`;
// Опрос раз в 15 с (а не поток событий): так видно, что скрипт жив, даже если fal молчит.
await fal.queue.subscribeToStatus(TRAINER, {
  requestId,
  logs: true,
  mode: "polling",
  pollInterval: 15_000,
  onQueueUpdate: (u) => {
    const logs = "logs" in u && Array.isArray(u.logs) ? u.logs : [];
    for (const l of logs.slice(seen)) console.log(`  ${l.message}`);
    if (logs.length > seen) quietSince = Date.now();
    seen = Math.max(seen, logs.length);
    if (u.status === "IN_QUEUE") {
      const pos = "queue_position" in u ? ` позиция ${u.queue_position}` : "";
      console.log(`  в очереди${pos} (${mins()})`);
    } else if (u.status === "IN_PROGRESS" && Date.now() - quietSince > 60_000) {
      console.log(`  обучается… (${mins()})`);
      quietSince = Date.now();
    }
  },
});
const { data } = (await fal.queue.result(TRAINER, { requestId })) as { data: { diffusers_lora_file?: { url: string }; config_file?: { url: string } } };
const loraUrl = data.diffusers_lora_file?.url;
if (!loraUrl) throw new Error(`В ответе тренера нет весов: ${JSON.stringify(data).slice(0, 300)}`);
save({ loraUrl, configUrl: data.config_file?.url, finishedAt: new Date().toISOString() });

const id = world.toUpperCase();
console.log(`\nГотово за ${Math.round((Date.now() - t0) / 60000)} мин. Веса: ${statePath}`);
console.log(`Сравнить с LoRA и без: pnpm lora:compare -- --world ${world}`);
console.log(`Включить в игре — добавь в .env:\n  FAL_LORA_${id}_URL="${loraUrl}"\n  FAL_LORA_${id}_SCALE="1.2"\n  FAL_LORA_MODEL="${INFERENCE[TRAINER] ?? "fal-ai/flux-2/klein/9b/base/lora"}"`);
