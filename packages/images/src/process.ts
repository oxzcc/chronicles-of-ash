import sharp from "sharp";

/**
 * Постобработка, найденная на макетах:
 * - портрет: вырезанный фон, светлее и чуть контрастнее сцены. Холст НЕ обрезается по силуэту:
 *   кадр у всех один (квадрат, по пояс), и целый холст держит один масштаб — широкий
 *   полуорк и тонкая эльфийка стоят с головой на одной высоте;
 * - фон: темнее и приглушённее, чтобы персонаж на нём читался.
 * Тёплый контур по силуэту рисует CSS (drop-shadow), а не картинка.
 */
export async function finishPortrait(cutout: Buffer, frame?: HeadFrame): Promise<{ bytes: Buffer; width: number; height: number }> {
  const img = sharp(await zoomTo(cutout, frame)).ensureAlpha();
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

/** Цвет фона, на котором рисуются портреты (plain light grey) — на нём же готовый портрет уходит в правку. */
const PORTRAIT_GREY = { r: 205, g: 205, b: 205, alpha: 1 };

/**
 * Готовый портрет (webp с прозрачностью) → кадр для правки: тот же масштаб на сером фоне, width×height.
 * Портрет не обрезается и не сдвигается — лицо-вариант ляжет точно поверх исходного.
 */
export async function portraitOnGrey(finished: Buffer, width: number, height: number): Promise<Buffer> {
  const fg = await sharp(finished).resize(width, height, { fit: "fill" }).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: PORTRAIT_GREY } })
    .composite([{ input: fg }])
    .flatten({ background: PORTRAIT_GREY })
    .png()
    .toBuffer();
}

/**
 * Вариант лица после правки и вырезки — в размер исходного портрета. Свет не трогаем: правка повторяет
 * яркость исходника (уже осветлённого finishPortrait), второе осветление сделало бы вариант светлее.
 */
export async function finishVariant(cutout: Buffer, width: number, height: number): Promise<{ bytes: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(cutout).ensureAlpha().resize(width, height, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 40) data[i] = 0;
  const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
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

/**
 * Доля непрозрачного в вырезанном портрете. Почти ноль — фигуры нет: fal заменил картинку чёрной
 * (фильтр безопасности) или вырезание съело всё. Такой портрет проверяющий со зрением пропускает —
 * на пустом сером кадре лишних рук нет, — поэтому меряем сами.
 */
export const EMPTY_LIMIT = 0.03;
export async function opaqueShare(cutout: Buffer): Promise<number> {
  const { data } = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 128) n++;
  return n / (data.length / 4);
}

export async function finishBackground(image: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> {
  const out = await sharp(image)
    .resize({ width: 1920, withoutEnlargement: true })
    .modulate({ brightness: 0.82, saturation: 0.9 })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return { bytes: out.data, width: out.info.width, height: out.info.height };
}

/**
 * Размер головы в кадре: макушка — по маске (первая строка, где силуэт шире 1% кадра; шляпа считается),
 * подбородок — от модели со зрением. Портрет в сцене стоит на нижнем крае и растворяется книзу, поэтому
 * мелкую фигуру можно приблизить (низ уйдёт за край), а крупную — только перерисовать: уменьшенная повиснет.
 */
export interface HeadFrame {
  top: number;
  head: number;
  /** Центр головы по горизонтали, доля ширины. */
  cx: number;
  tooClose: boolean;
  zoom: number;
}
/** Голова (с причёской или шляпой) больше этой доли высоты — кадр слишком крупный. */
export const TOO_CLOSE = 0.4;
/** Голова меньше — приближаем до TARGET_HEAD, но не больше чем в MAX_ZOOM раз. */
export const SMALL_HEAD = 0.22;
const TARGET_HEAD = 0.26;
const MAX_ZOOM = 1.25;

export async function headFrame(cutout: Buffer, chin: number): Promise<HeadFrame | undefined> {
  const { data, info } = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const opaque = (x: number, y: number) => data[(y * w + x) * 4 + 3]! > 128;
  const rowCount = (y: number) => {
    let n = 0;
    for (let x = 0; x < w; x++) if (opaque(x, y)) n++;
    return n;
  };
  let top = 0;
  while (top < h && rowCount(top) < w * 0.01) top++;
  const head = chin - top / h;
  if (!(head > 0.04)) return undefined;
  let sx = 0;
  let n = 0;
  for (let y = top; y < Math.min(h, Math.round(chin * h)); y++)
    for (let x = 0; x < w; x++)
      if (opaque(x, y)) {
        sx += x;
        n++;
      }
  return {
    top: top / h,
    head,
    cx: n ? sx / n / w : 0.5,
    tooClose: head > TOO_CLOSE,
    zoom: head < SMALL_HEAD ? Math.min(MAX_ZOOM, TARGET_HEAD / head) : 1,
  };
}

/** Приблизить мелкую фигуру: вырезать окно у головы (над макушкой — 4% окна) и растянуть до прежнего холста. */
async function zoomTo(cutout: Buffer, frame?: HeadFrame): Promise<Buffer> {
  if (!frame || frame.zoom <= 1.001) return cutout;
  const { width: w = 0, height: h = 0 } = await sharp(cutout).metadata();
  const cw = Math.round(w / frame.zoom);
  const ch = Math.round(h / frame.zoom);
  const left = Math.max(0, Math.min(w - cw, Math.round(frame.cx * w - cw / 2)));
  const top = Math.max(0, Math.min(h - ch, Math.round(frame.top * h - 0.04 * ch)));
  return sharp(cutout).extract({ left, top, width: cw, height: ch }).resize(w, h).png().toBuffer();
}
