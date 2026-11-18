/** Генерация картинок и вырезание фона. Ключи и модели — только из окружения. */

export type ImageShape = "portrait" | "landscape";

/** LoRA стиля мира: URL весов (fal) и сила. */
export interface LoraRef {
  url: string;
  scale: number;
}

export interface GenerateRequest {
  prompt: string;
  shape: ImageShape;
  /** Портреты — качественной моделью, фоны — дешёвой. */
  quality: "portrait" | "background";
  seed?: number;
  /** С LoRA картинка идёт через LoRA-эндпоинт (FAL_LORA_MODEL). */
  lora?: LoraRef;
  signal?: AbortSignal;
}

export interface ImageResult {
  bytes: Buffer;
  contentType: string;
  model: string;
  costUsd: number;
}

export interface ImageProvider {
  readonly name: string;
  generate(req: GenerateRequest): Promise<ImageResult>;
  /** PNG с прозрачным фоном. */
  removeBackground(image: Buffer, signal?: AbortSignal): Promise<ImageResult>;
  /** LoRA стиля для мира, если она настроена у этого провайдера. */
  loraFor?(worldId: string): LoraRef | undefined;
}

export interface FalConfig {
  key: string;
  portraitModel: string;
  backgroundModel: string;
  cutoutModel: string;
  /** Эндпоинт для генерации с LoRA. */
  loraModel?: string;
  /** LoRA по id мира. */
  loras?: Record<string, LoraRef>;
  fetchImpl?: typeof fetch;
}

/**
 * Эндпоинт для генерации с LoRA. LoRA обучаются тренером klein 9B **Base** (тренер 4B на fal закрыт),
 * а LoRA работает только с той моделью, на которой обучена: Base, не дистиллированная klein 9B.
 * На `klein/9b/lora` та же LoRA почти не меняла картинку ни на какой силе.
 */
export const DEFAULT_LORA_MODEL = "fal-ai/flux-2/klein/9b/base/lora";

/** FAL_LORA_<ID>_URL / FAL_LORA_<ID>_SCALE → LoRA по мирам; сила по умолчанию 1, допустимо 0…2. */
export function lorasFromEnv(env: Record<string, string | undefined>): Record<string, LoraRef> {
  const out: Record<string, LoraRef> = {};
  for (const [k, v] of Object.entries(env)) {
    const m = /^FAL_LORA_([A-Z0-9_]+)_URL$/.exec(k);
    if (!m || !v?.trim()) continue;
    const raw = Number(env[`FAL_LORA_${m[1]}_SCALE`]);
    const scale = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 2) : 1;
    out[m[1]!.toLowerCase()] = { url: v.trim(), scale };
  }
  return out;
}

export function falConfigFromEnv(env: Record<string, string | undefined> = process.env): FalConfig | null {
  if (!env.FAL_KEY || env.IMAGES_FAKE === "1") return null;
  return {
    key: env.FAL_KEY,
    portraitModel: env.FAL_PORTRAIT_MODEL || "fal-ai/flux-2/klein/4b",
    backgroundModel: env.FAL_BACKGROUND_MODEL || "fal-ai/flux-2/klein/4b",
    cutoutModel: env.FAL_CUTOUT_MODEL || "fal-ai/birefnet/v2",
    loraModel: env.FAL_LORA_MODEL || DEFAULT_LORA_MODEL,
    loras: lorasFromEnv(env),
  };
}

/**
 * Размер фона. Фон растягивается на весь экран, поэтому 1024×576 (landscape_16_9) на больших мониторах
 * выглядит мыльным. 1920×1088 — кратно 16; fal не рисует klein больше 2048 по длинной стороне.
 */
export const BACKGROUND_SIZE = { width: 1920, height: 1088 } as const;
const PORTRAIT_SIZE = { width: 1024, height: 1024 } as const;

/** Модели, которые fal считает за мегапиксель (цена ниже — за 1 Мп), остальные — за картинку. */
const PER_MP = /flux-2\/klein/;

/** Примерная цена — для учёта; точную fal не возвращает. */
const PRICE: Record<string, number> = {
  "fal-ai/flux-pro/kontext/text-to-image": 0.04,
  "fal-ai/flux-2/klein/4b": 0.003,
  "fal-ai/flux-2/klein/4b/lora": 0.01,
  "fal-ai/flux-2/klein/9b/lora": 0.015,
  "fal-ai/flux-2/klein/4b/base/lora": 0.015,
  "fal-ai/flux-2/klein/9b/base/lora": 0.02,
  "fal-ai/birefnet/v2": 0.002,
};

const price = (model: string, megapixels: number) => (PRICE[model] ?? 0) * (PER_MP.test(model) ? megapixels : 1);

export class FalImageProvider implements ImageProvider {
  readonly name = "fal";
  constructor(private readonly cfg: FalConfig) {}

  private async call(model: string, input: Record<string, unknown>, signal?: AbortSignal, megapixels = 1): Promise<ImageResult> {
    const f = this.cfg.fetchImpl ?? fetch;
    // sync_mode: картинка приходит прямо в ответе (data URI), без скачивания с fal.media.
    const res = await f(`https://fal.run/${model}`, {
      method: "POST",
      signal,
      headers: { Authorization: `Key ${this.cfg.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, sync_mode: true }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`fal ${model} ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    const url: string | undefined = body.images?.[0]?.url ?? body.image?.url;
    if (!url) throw new Error(`fal ${model}: no image in response`);
    const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
    if (m) return { bytes: Buffer.from(m[2]!, "base64"), contentType: m[1]!, model, costUsd: price(model, megapixels) };
    const img = await f(url, { signal });
    if (!img.ok) throw new Error(`fal download ${img.status}`);
    return { bytes: Buffer.from(await img.arrayBuffer()), contentType: img.headers.get("content-type") ?? "image/png", model, costUsd: price(model, megapixels) };
  }

  loraFor(worldId: string): LoraRef | undefined {
    return this.cfg.loras?.[worldId];
  }

  generate(req: GenerateRequest): Promise<ImageResult> {
    const base = req.quality === "portrait" ? this.cfg.portraitModel : this.cfg.backgroundModel;
    const model = req.lora ? this.cfg.loraModel || DEFAULT_LORA_MODEL : base;
    const isKontext = model.includes("kontext");
    const dims = req.shape === "portrait" ? PORTRAIT_SIZE : BACKGROUND_SIZE;
    const size = isKontext ? { aspect_ratio: req.shape === "portrait" ? "1:1" : "16:9" } : { image_size: { ...dims } };
    const loras = req.lora ? { loras: [{ path: req.lora.url, scale: req.lora.scale }] } : {};
    const mp = (dims.width * dims.height) / 1_000_000;
    return this.call(model, { prompt: req.prompt, num_images: 1, ...size, ...loras, ...(req.seed !== undefined ? { seed: req.seed } : {}) }, req.signal, mp);
  }

  removeBackground(image: Buffer, signal?: AbortSignal): Promise<ImageResult> {
    const dataUri = `data:image/png;base64,${image.toString("base64")}`;
    return this.call(this.cfg.cutoutModel, { image_url: dataUri, model: "Portrait", refine_foreground: true, output_format: "png" }, signal);
  }
}
