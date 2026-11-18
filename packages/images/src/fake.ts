import sharp from "sharp";
import type { GenerateRequest, ImageProvider, ImageResult } from "./provider";

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h ^ c.codePointAt(0)!, 16777619) >>> 0), 2166136261);

/**
 * Фейковые картинки для разработки без ключа fal: фон — градиент в палитре игры,
 * портрет — силуэт. Цвет зависит от промпта, чтобы разные NPC различались.
 */
export class FakeImageProvider implements ImageProvider {
  readonly name = "fake";
  constructor(private readonly delayMs = 0) {}

  async generate(req: GenerateRequest): Promise<ImageResult> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const h = hash(req.prompt + (req.seed ?? ""));
    const hue = 15 + (h % 40);
    const [w, ht] = req.shape === "portrait" ? [1024, 1024] : [1344, 768];
    const svg =
      req.shape === "portrait"
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}"><rect width="100%" height="100%" fill="#d8d4cc"/>
           <g fill="hsl(${hue},35%,${30 + (h % 25)}%)"><circle cx="512" cy="330" r="150"/><path d="M238 1024 C258 690 378 560 512 560 C646 560 766 690 786 1024 Z"/></g></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0" stop-color="hsl(${hue},40%,${18 + (h % 12)}%)"/><stop offset="1" stop-color="hsl(${hue + 10},30%,6%)"/></linearGradient></defs>
           <rect width="100%" height="100%" fill="url(#g)"/><path d="M0 560 Q 340 ${430 + (h % 80)} 680 520 T 1344 ${480 + (h % 60)} V768 H0 Z" fill="hsl(${hue},25%,9%)"/></svg>`;
    return { bytes: await sharp(Buffer.from(svg)).png().toBuffer(), contentType: "image/png", model: "fake", costUsd: 0 };
  }

  async removeBackground(image: Buffer): Promise<ImageResult> {
    // Делаем прозрачным всё, что близко к светло-серому фону фейкового портрета.
    const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) if (data[i]! > 190 && data[i + 1]! > 190 && data[i + 2]! > 190) data[i + 3] = 0;
    const bytes = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    return { bytes, contentType: "image/png", model: "fake", costUsd: 0 };
  }
}
