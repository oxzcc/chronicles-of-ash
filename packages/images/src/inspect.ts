import sharp from "sharp";
import { extractJson, type Route } from "@ash/llm";

/**
 * Проверка готового портрета моделью со зрением (VISION_MODEL): лишние руки и кисти, где подбородок.
 * FLUX иногда дорисовывает третью руку, когда в промпте несколько занятий для рук; поймать это по маске
 * нельзя. Макушку берём по маске (модель её путает), а подбородок — у модели: вместе это размер головы,
 * по нему конвейер решает, перерисовать слишком крупный кадр или приблизить слишком мелкий.
 * Проверка — подсказка, а не приговор: нет ответа — портрет принимается как есть.
 */
export interface PortraitCheck {
  /** Рук или кистей больше двух, или модель увидела лишнюю конечность. */
  limbs: boolean;
  /** Подбородок — доля высоты кадра (0 — верх); нет — модель не сказала. */
  chin?: number;
  note: string;
  costUsd: number;
}

export type PortraitInspector = (cutout: Buffer, signal?: AbortSignal) => Promise<PortraitCheck | null>;

export const INSPECT_PROMPT = `This is a character portrait from a game, background removed. Check the anatomy.
Count every arm (shoulder to wrist) and every hand that belongs to the depicted person, including ones partly hidden. Look carefully for an extra arm or hand coming out of a sleeve, a hand with no arm, or two hands on the same side of the body.
Also give the vertical position of the chin as a fraction of the image height (0 = top, 1 = bottom).
Return JSON only: {"arms":n,"hands":n,"extra_limb":true|false,"chin":0.xx,"note":"short"}`;

export function parseCheck(text: string, costUsd = 0): PortraitCheck | null {
  const j = extractJson(text) as Record<string, unknown> | null;
  if (!j) return null;
  const arms = Number(j.arms);
  const hands = Number(j.hands);
  const chin = Number(j.chin);
  return {
    limbs: j.extra_limb === true || (Number.isFinite(arms) && arms > 2) || (Number.isFinite(hands) && hands > 2),
    ...(Number.isFinite(chin) && chin > 0.03 && chin < 0.9 ? { chin } : {}),
    note: String(j.note ?? "").slice(0, 200),
    costUsd,
  };
}

/** Проверяющий для конвейера; без VISION_MODEL (и на фейковой модели) — undefined, проверки нет. */
export function portraitInspector(router: { vision?: () => Route | null }): PortraitInspector | undefined {
  const r = router.vision?.();
  if (!r) return undefined;
  return async (cutout, signal) => {
    try {
      const jpg = await sharp(cutout).flatten({ background: "#d8d8d8" }).resize({ height: 768, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      const res = await r.provider.complete({
        model: r.model,
        maxTokens: 400,
        temperature: 0,
        reasoningEffort: "none",
        signal,
        messages: [{ role: "user", content: INSPECT_PROMPT, images: [`data:image/jpeg;base64,${jpg.toString("base64")}`] }],
      });
      return parseCheck(res.text, res.usage.costUsd);
    } catch {
      return null;
    }
  };
}
