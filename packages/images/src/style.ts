import type { TimeOfDay, World } from "@ash/worlds";
import type { LoraRef } from "./provider";

export type { TimeOfDay } from "@ash/worlds";

/**
 * Промпты картинок. Стиль, эпоха и словарь (расы, классы, места) — из мира (world.art),
 * здесь — только кадр, общий для всех миров. FLUX лучше понимает английский,
 * поэтому промпты картинок — на английском, а тексты игроку — на русском.
 */

/**
 * Портреты рисуются на светлом ровном фоне и с ярким светом на лице:
 * так фон чисто вырезается, а персонаж потом читается на тёмной сцене.
 * Один кадр для всех: по пояс, голова в верхней трети и не касается края — тогда портреты одного масштаба и не обрезаны.
 * Позу и ракурс («low angle», «looking over her shoulder») даёт описание персонажа, как в подписях датасета LoRA:
 * без «centered» и пустоты над головой герои не стоят навытяжку, как в каталоге.
 * Свет — тёплый и сбоку: лицо читается на тёмной сцене, но без глянца фронтального света.
 */
const PORTRAIT_LIGHT =
  "waist-up portrait of a single character, head in the upper third not touching the top edge, shoulders and elbows fully inside the frame, cut at the waist, warm directional side light on the face, matte shading, plain flat light grey studio background";

/**
 * Начало промпта: стиль мира. С LoRA — триггер из датасета и короткий префикс (эпоха и запреты),
 * технику и палитру держит сама LoRA; без LoRA — полный stylePrefix.
 */
export const stylePart = (world: World, lora = false) =>
  lora && world.art.lora ? `${world.art.lora.trigger}, ${world.art.lora.stylePrefix}` : world.art.stylePrefix;

export const portraitPrompt = (world: World, description: string, lora = false) => `${stylePart(world, lora)}, ${PORTRAIT_LIGHT}, ${description}`;

export const backgroundPrompt = (world: World, description: string, time: TimeOfDay, lora = false) =>
  `${stylePart(world, lora)}, ${world.art.backgroundLight}, ${description}, ${world.art.timeEn[time]}`;

/** LoRA, которую провайдер даст этому миру, — только если у мира есть триггер. */
export const worldLora = (world: World, provider: { loraFor?(worldId: string): LoraRef | undefined }) =>
  world.art.lora ? provider.loraFor?.(world.id) : undefined;

/** Раса с учётом пола — словами мира. */
export const raceEn = (world: World, race: string, gender: "m" | "f") => world.art.raceEn(race, gender);

/** Места, которые рисуются изнутри. */
export const isInterior = (world: World, type: string) => world.art.interiorTypes.includes(type);
