import sharp from "sharp";

/**
 * Постобработка, найденная на макетах:
 * - портрет: вырезанный фон, светлее и чуть контрастнее сцены. Холст НЕ обрезается по силуэту:
 *   кадр у всех один (квадрат, по пояс), и целый холст держит один масштаб — широкий
 *   полуорк и тонкая эльфийка стоят с головой на одной высоте;
 * - фон: темнее и приглушённее, чтобы персонаж на нём читался.
 * Тёплый контур по силуэту рисует CSS (drop-shadow), а не картинка.
 */
export async function finishPortrait(cutout: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> {
  const img = sharp(cutout).ensureAlpha();
  // Чистим полупрозрачный ореол по краю: альфа < 16% — прозрачно.
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 40) data[i] = 0;
  const cleaned = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  const out = await cleaned
    .modulate({ brightness: 1.18, saturation: 1.06 })
    .linear(1.08, -8)
    .resize({ height: 1100, withoutEnlargement: true })
    .webp({ quality: 88, alphaQuality: 90 })
    .toBuffer({ resolveWithObject: true });
  return { bytes: out.data, width: out.info.width, height: out.info.height };
}

/**
 * Насколько силуэт обрезан рамкой: полоса 3 px сверху и по бокам (низ не считаем — портрет должен быть срезан).
 * Верх и бока — по отдельности: срезанная макушка или шляпа заметна, даже если это узкая полоса
 * (общий порог по всей рамке её пропускал), а бёдра и локти у края в кадре 2:3 — обычное дело.
 * Ответ — доля от допустимого: больше CLIP_LIMIT (1) — кадр надо перерисовать.
 */
export const CLIP_LIMIT = 1;
const TOP_LIMIT = 0.01;
const SIDE_LIMIT = 0.04;
export async function clippedShare(cutout: Buffer): Promise<number> {
  const { data, info } = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const band = 3;
  const opaque = (x: number, y: number) => data[(y * w + x) * 4 + 3]! > 128;
  let top = 0;
  let side = 0;
  for (let y = 0; y < band; y++) for (let x = 0; x < w; x++) if (opaque(x, y)) top++;
  for (let y = band; y < h; y++) for (const x of [0, 1, 2, w - 3, w - 2, w - 1]) if (opaque(x, y)) side++;
  return Math.max(top / (band * w) / TOP_LIMIT, side / (6 * (h - band)) / SIDE_LIMIT);
}

export async function finishBackground(image: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> {
  const out = await sharp(image)
    .resize({ width: 1920, withoutEnlargement: true })
    .modulate({ brightness: 0.82, saturation: 0.9 })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return { bytes: out.data, width: out.info.width, height: out.info.height };
}
