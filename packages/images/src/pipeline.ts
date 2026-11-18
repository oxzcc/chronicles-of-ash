import { CLIP_LIMIT, clippedShare, finishBackground, finishPortrait } from "./process";
import type { ImageProvider } from "./provider";
import type { ImageStorage } from "./storage";
import { backgroundPrompt, portraitPrompt, type TimeOfDay } from "./style";

export interface Rendered {
  url: string;
  prompt: string;
  model: string;
  costUsd: number;
  width: number;
  height: number;
}

/** Портрет: генерация → вырезание фона → свет → webp с прозрачностью → хранилище. */
/**
 * Портрет: генерация → вырезание фона → проверка кадра → свет → webp с прозрачностью → хранилище.
 * Если силуэт упёрся в край (обрезана голова или плечи) — одна перерисовка с другим seed,
 * берём менее обрезанный вариант.
 */
export async function renderPortrait(o: { provider: ImageProvider; storage: ImageStorage; description: string; key: string; seed?: number; signal?: AbortSignal }): Promise<Rendered & { redrawn: boolean }> {
  const prompt = portraitPrompt(o.description);
  const seed = o.seed ?? Math.floor(Math.random() * 1e6);
  let cost = 0;
  let model = "";
  const attempt = async (s: number) => {
    const raw = await o.provider.generate({ prompt, shape: "portrait", quality: "portrait", seed: s, signal: o.signal });
    const cut = await o.provider.removeBackground(raw.bytes, o.signal);
    cost += raw.costUsd + cut.costUsd;
    model = `${raw.model}+${cut.model}`;
    return { bytes: cut.bytes, clip: await clippedShare(cut.bytes) };
  };
  let best = await attempt(seed);
  let redrawn = false;
  if (best.clip > CLIP_LIMIT) {
    redrawn = true;
    const second = await attempt(seed + 7919);
    if (second.clip < best.clip) best = second;
  }
  const done = await finishPortrait(best.bytes);
  const url = await o.storage.put(`${o.key}.webp`, done.bytes, "image/webp");
  return { url, prompt, model, costUsd: cost, width: done.width, height: done.height, redrawn };
}

/** Фон локации: генерация → приглушение → webp → хранилище. */
export async function renderBackground(o: { provider: ImageProvider; storage: ImageStorage; description: string; time: TimeOfDay; key: string; seed?: number; signal?: AbortSignal }): Promise<Rendered> {
  const prompt = backgroundPrompt(o.description, o.time);
  const raw = await o.provider.generate({ prompt, shape: "landscape", quality: "background", seed: o.seed, signal: o.signal });
  const done = await finishBackground(raw.bytes);
  const url = await o.storage.put(`${o.key}.webp`, done.bytes, "image/webp");
  return { url, prompt, model: raw.model, costUsd: raw.costUsd, width: done.width, height: done.height };
}
