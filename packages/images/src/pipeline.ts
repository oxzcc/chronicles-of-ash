import { finishBackground, finishPortrait } from "./process";
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
export async function renderPortrait(o: { provider: ImageProvider; storage: ImageStorage; description: string; key: string; seed?: number; signal?: AbortSignal }): Promise<Rendered> {
  const prompt = portraitPrompt(o.description);
  const raw = await o.provider.generate({ prompt, shape: "portrait", quality: "portrait", seed: o.seed, signal: o.signal });
  const cut = await o.provider.removeBackground(raw.bytes, o.signal);
  const done = await finishPortrait(cut.bytes);
  const url = await o.storage.put(`${o.key}.webp`, done.bytes, "image/webp");
  return { url, prompt, model: `${raw.model}+${cut.model}`, costUsd: raw.costUsd + cut.costUsd, width: done.width, height: done.height };
}

/** Фон локации: генерация → приглушение → webp → хранилище. */
export async function renderBackground(o: { provider: ImageProvider; storage: ImageStorage; description: string; time: TimeOfDay; key: string; seed?: number; signal?: AbortSignal }): Promise<Rendered> {
  const prompt = backgroundPrompt(o.description, o.time);
  const raw = await o.provider.generate({ prompt, shape: "landscape", quality: "background", seed: o.seed, signal: o.signal });
  const done = await finishBackground(raw.bytes);
  const url = await o.storage.put(`${o.key}.webp`, done.bytes, "image/webp");
  return { url, prompt, model: raw.model, costUsd: raw.costUsd, width: done.width, height: done.height };
}
