import { CLIP_LIMIT, clippedShare, EMPTY_LIMIT, finishBackground, finishPortrait, headFrame, opaqueShare } from "./process";
import type { PortraitInspector } from "./inspect";
import type { ImageProvider } from "./provider";
import type { ImageStorage } from "./storage";
import type { World } from "@ash/worlds";
import { backgroundPrompt, portraitPrompt, worldLora, type TimeOfDay } from "./style";

export interface Rendered {
  url: string;
  prompt: string;
  model: string;
  costUsd: number;
  width: number;
  height: number;
}

/**
 * Портрет: генерация → вырезание фона → проверка → свет → webp с прозрачностью → хранилище.
 * Проверка: фигуры нет (пустой кадр), силуэт упёрся в край (обрезана голова или плечи); если задан проверяющий (VISION_MODEL) —
 * ещё лишние руки и слишком крупный кадр. Есть беда — перерисовка с другим seed (без проверяющего — одна,
 * с ним — до двух), берём лучший вариант: лишняя рука хуже крупного кадра, крупный кадр хуже обрезки.
 * Мелкую фигуру конвейер приближает сам (headFrame).
 */
export async function renderPortrait(o: {
  world: World;
  provider: ImageProvider;
  storage: ImageStorage;
  description: string;
  key: string;
  seed?: number;
  signal?: AbortSignal;
  inspect?: PortraitInspector;
}): Promise<Rendered & { redrawn: boolean; issues: string[] }> {
  const lora = worldLora(o.world, o.provider);
  const prompt = portraitPrompt(o.world, o.description, !!lora);
  const seed = o.seed ?? Math.floor(Math.random() * 1e6);
  let cost = 0;
  let model = "";
  const attempt = async (s: number) => {
    const raw = await o.provider.generate({ prompt, shape: "portrait", quality: "portrait", seed: s, lora, signal: o.signal });
    const cut = await o.provider.removeBackground(raw.bytes, o.signal);
    cost += raw.costUsd + cut.costUsd;
    model = `${raw.model}+${cut.model}`;
    // Пустой кадр — сразу на перерисовку, без проверяющего: смотреть там не на что.
    if ((await opaqueShare(cut.bytes)) < EMPTY_LIMIT) return { bytes: cut.bytes, frame: undefined, issues: ["empty"], score: 1000 };
    const clip = await clippedShare(cut.bytes);
    const check = o.inspect ? await o.inspect(cut.bytes, o.signal) : null;
    cost += check?.costUsd ?? 0;
    const frame = check?.chin !== undefined ? await headFrame(cut.bytes, check.chin) : undefined;
    const issues = [clip > CLIP_LIMIT && "clipped", check?.limbs && `extra limbs${check.note ? ` (${check.note})` : ""}`, frame?.tooClose && "too close"].filter(
      (x): x is string => !!x,
    );
    return { bytes: cut.bytes, frame, issues, score: (check?.limbs ? 100 : 0) + (frame?.tooClose ? 10 : 0) + Math.min(clip, 9) };
  };
  let best = await attempt(seed);
  const redraws = o.inspect ? 2 : 1;
  let redrawn = false;
  for (let k = 1; k <= redraws && best.issues.length; k++) {
    redrawn = true;
    const next = await attempt(seed + 7919 * k);
    if (next.score < best.score) best = next;
  }
  const done = await finishPortrait(best.bytes, best.frame);
  const url = await o.storage.put(`${o.key}.webp`, done.bytes, "image/webp");
  return { url, prompt, model, costUsd: cost, width: done.width, height: done.height, redrawn, issues: best.issues };
}

/** Фон локации: генерация → приглушение → webp → хранилище. */
export async function renderBackground(o: { world: World; provider: ImageProvider; storage: ImageStorage; description: string; time: TimeOfDay; key: string; seed?: number; signal?: AbortSignal }): Promise<Rendered> {
  const lora = worldLora(o.world, o.provider);
  const prompt = backgroundPrompt(o.world, o.description, o.time, !!lora);
  const raw = await o.provider.generate({ prompt, shape: "landscape", quality: "background", seed: o.seed, lora, signal: o.signal });
  const done = await finishBackground(raw.bytes);
  const url = await o.storage.put(`${o.key}.webp`, done.bytes, "image/webp");
  return { url, prompt, model: raw.model, costUsd: raw.costUsd, width: done.width, height: done.height };
}
