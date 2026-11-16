import sharp from "sharp";

/**
 * Постобработка, найденная на макетах:
 * - портрет: вырезанный фон, обрезка по силуэту, светлее и чуть контрастнее сцены;
 * - фон: темнее и приглушённее, чтобы персонаж на нём читался.
 * Тёплый контур по силуэту рисует CSS (drop-shadow), а не картинка.
 */
export async function finishPortrait(cutout: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> {
  const img = sharp(cutout).ensureAlpha();
  // Чистим полупрозрачный ореол по краю: альфа < 16% — прозрачно.
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 40) data[i] = 0;
  const cleaned = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  const trimmed = await cleaned.png().toBuffer();
  const out = await sharp(trimmed)
    .trim({ threshold: 1 })
    .modulate({ brightness: 1.18, saturation: 1.06 })
    .linear(1.08, -8)
    .resize({ height: 1100, withoutEnlargement: true })
    .webp({ quality: 88, alphaQuality: 90 })
    .toBuffer({ resolveWithObject: true });
  return { bytes: out.data, width: out.info.width, height: out.info.height };
}

export async function finishBackground(image: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> {
  const out = await sharp(image)
    .resize({ width: 1920, withoutEnlargement: true })
    .modulate({ brightness: 0.82, saturation: 0.9 })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return { bytes: out.data, width: out.info.width, height: out.info.height };
}
