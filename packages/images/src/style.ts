import type { TimeOfDay, World } from "@ash/worlds";

export type { TimeOfDay } from "@ash/worlds";

/**
 * Промпты картинок. Стиль, эпоха и словарь (расы, классы, места) — из мира (world.art),
 * здесь — только кадр, общий для всех миров. FLUX лучше понимает английский,
 * поэтому промпты картинок — на английском, а тексты игроку — на русском.
 */

/**
 * Портреты рисуются на светлом ровном фоне и с ярким светом на лице:
 * так фон чисто вырезается, а персонаж потом читается на тёмной сцене.
 * Один кадр для всех: по пояс, голова в верхней трети с запасом сверху — тогда портреты одного масштаба и не обрезаны.
 */
const PORTRAIT_LIGHT =
  "waist-up portrait of a single character, centered, three-quarter view, head in the upper third with empty space above it, shoulders and elbows fully inside the frame, cut at the waist, bright warm key light on the face, soft rim light, plain flat light grey studio background";

export const portraitPrompt = (world: World, description: string) => `${world.art.stylePrefix}, ${PORTRAIT_LIGHT}, ${description}`;

export const backgroundPrompt = (world: World, description: string, time: TimeOfDay) =>
  `${world.art.stylePrefix}, ${world.art.backgroundLight}, ${description}, ${world.art.timeEn[time]}`;

/** Раса с учётом пола — словами мира. */
export const raceEn = (world: World, race: string, gender: "m" | "f") => world.art.raceEn(race, gender);

/** Места, которые рисуются изнутри. */
export const isInterior = (world: World, type: string) => world.art.interiorTypes.includes(type);
