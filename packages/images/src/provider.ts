/** Генерация картинок и вырезание фона. Ключи и модели — только из окружения. */

export type ImageShape = "portrait" | "landscape";

export interface GenerateRequest {
  prompt: string;
  shape: ImageShape;
  /** Портреты — качественной моделью, фоны — дешёвой. */
  quality: "portrait" | "background";
  seed?: number;
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
}

export interface FalConfig {
  key: string;
  portraitModel: string;
  backgroundModel: string;
  cutoutModel: string;
  fetchImpl?: typeof fetch;
}

export function falConfigFromEnv(env: Record<string, string | undefined> = process.env): FalConfig | null {
  if (!env.FAL_KEY || env.IMAGES_FAKE === "1") return null;
  return {
    key: env.FAL_KEY,
    portraitModel: env.FAL_PORTRAIT_MODEL || "fal-ai/flux-2/klein/4b",
    backgroundModel: env.FAL_BACKGROUND_MODEL || "fal-ai/flux-2/klein/4b",
    cutoutModel: env.FAL_CUTOUT_MODEL || "fal-ai/birefnet/v2",
  };
}

/** Примерная цена за картинку — для учёта; точную fal не возвращает. */
const PRICE: Record<string, number> = {
  "fal-ai/flux-pro/kontext/text-to-image": 0.04,
  "fal-ai/flux-2/klein/4b": 0.003,
  "fal-ai/birefnet/v2": 0.002,
};

export class FalImageProvider implements ImageProvider {
  readonly name = "fal";
  constructor(private readonly cfg: FalConfig) {}

  private async call(model: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ImageResult> {
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
    if (m) return { bytes: Buffer.from(m[2]!, "base64"), contentType: m[1]!, model, costUsd: PRICE[model] ?? 0 };
    const img = await f(url, { signal });
    if (!img.ok) throw new Error(`fal download ${img.status}`);
    return { bytes: Buffer.from(await img.arrayBuffer()), contentType: img.headers.get("content-type") ?? "image/png", model, costUsd: PRICE[model] ?? 0 };
  }

  generate(req: GenerateRequest): Promise<ImageResult> {
    const model = req.quality === "portrait" ? this.cfg.portraitModel : this.cfg.backgroundModel;
    const isKontext = model.includes("kontext");
    const size = isKontext
      ? { aspect_ratio: req.shape === "portrait" ? "3:4" : "16:9" }
      : { image_size: req.shape === "portrait" ? "portrait_4_3" : "landscape_16_9" };
    return this.call(model, { prompt: req.prompt, num_images: 1, ...size, ...(req.seed !== undefined ? { seed: req.seed } : {}) }, req.signal);
  }

  removeBackground(image: Buffer, signal?: AbortSignal): Promise<ImageResult> {
    const dataUri = `data:image/png;base64,${image.toString("base64")}`;
    return this.call(this.cfg.cutoutModel, { image_url: dataUri, model: "Portrait", refine_foreground: true, output_format: "png" }, signal);
  }
}
