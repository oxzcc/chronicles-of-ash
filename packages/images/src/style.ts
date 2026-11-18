import type { ClassKey, Gender, LocationType, RaceKey } from "@ash/engine";

/**
 * Единый стиль всех картинок (docs/style.md). FLUX лучше понимает английский,
 * поэтому промпты картинок — на английском, а тексты игроку — на русском.
 */
export const STYLE_PREFIX =
  "dark fantasy painterly illustration, oil painting texture, muted earthy palette with ember orange accents, detailed but soft brushwork, in the style of a classic CRPG character art, medieval world with no modern or industrial objects, no text, no watermark, no signature";

/**
 * Портреты рисуются на светлом ровном фоне и с ярким светом на лице:
 * так фон чисто вырезается, а персонаж потом читается на тёмной сцене.
 */
/** Один кадр для всех: по пояс, голова в верхней трети с запасом сверху — тогда портреты одного масштаба и не обрезаны. */
const PORTRAIT_LIGHT =
  "waist-up portrait of a single character, centered, three-quarter view, head in the upper third with empty space above it, shoulders and elbows fully inside the frame, cut at the waist, bright warm key light on the face, soft rim light, plain flat light grey studio background";

const BACKGROUND_LIGHT = "wide establishing shot, empty scene with no people, atmospheric depth, drifting grey ash in the air, no lettering, signs without text";

export const RACE_EN: Record<RaceKey, string> = {
  human: "human",
  elf: "elf with pointed ears",
  dwarf: "stocky dwarf",
  halfling: "halfling, small and nimble",
  tiefling: "tiefling with curved horns and dusky red skin",
  halforc: "half-orc with grey-green skin and small tusks",
};

/** Раса с учётом пола: «борода» в описании дварфа перевешивала пол — все дварфийки выходили бородачами. */
export function raceEn(race: RaceKey, gender: Gender): string {
  if (race === "dwarf") return gender === "f" ? "stocky dwarf woman, beardless" : "stocky dwarf with a braided beard";
  return RACE_EN[race];
}

/** Места, которые рисуются изнутри. */
export const INTERIOR_TYPES: LocationType[] = ["tavern", "temple", "cave"];

export const CLASS_EN: Record<ClassKey, string> = {
  fighter: "warrior in chainmail with a longsword",
  rogue: "rogue in dark leather with daggers",
  wizard: "wizard in worn robes with a staff",
  cleric: "cleric in scale armour with a holy symbol",
  ranger: "ranger in a hooded cloak with a longbow",
};

export const LOCATION_EN: Record<LocationType, string> = {
  tavern: "interior of a medieval tavern, smoky wooden beams, fireplace glow",
  village: "a small medieval village with timber houses",
  forest: "a dark spruce forest",
  road: "an old stone road through wild countryside",
  cave: "a damp cave with rough rock walls",
  ruins: "crumbling stone ruins overgrown with moss",
  castle: "a grim stone fortress",
  swamp: "a misty swamp with dead trees and still black water",
  mountains: "a rocky mountain pass",
  temple: "an old stone temple interior with candles",
  city: "a crowded medieval city street",
  camp: "a camp with tents and a campfire",
};

export type TimeOfDay = "day" | "dusk" | "night";
const TIME_EN: Record<TimeOfDay, string> = {
  day: "overcast daylight",
  dusk: "at dusk, ember-orange sky",
  night: "at night, cold moonlight and warm firelight",
};

export const portraitPrompt = (description: string) => `${STYLE_PREFIX}, ${PORTRAIT_LIGHT}, ${description}`;

export const backgroundPrompt = (description: string, time: TimeOfDay) => `${STYLE_PREFIX}, ${BACKGROUND_LIGHT}, ${description}, ${TIME_EN[time]}`;
