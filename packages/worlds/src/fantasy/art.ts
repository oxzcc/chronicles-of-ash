import type { ArtStyle } from "../types";

/** Стиль «Хроник Пепла» (см. style.md рядом). */
export const fantasyArt: ArtStyle = {
  stylePrefix:
    "dark fantasy painterly illustration, oil painting texture, muted earthy palette with ember orange accents, detailed but soft brushwork, in the style of a classic CRPG character art, medieval world with no modern or industrial objects, no text, no watermark, no signature",
  backgroundLight: "wide establishing shot, empty scene with no people, atmospheric depth, drifting grey ash in the air, no lettering, signs without text",
  timeEn: {
    day: "overcast daylight",
    dusk: "at dusk, ember-orange sky",
    night: "at night, cold moonlight and warm firelight",
  },
  genreEn: "dark fantasy",
  strangerEn: "a stranger of a dark fantasy village, weathered face, period clothing",
  localEn: "a local of a dark fantasy village",
  locationNounEn: "medieval dark fantasy location",
  eraRuleEn: "Only medieval objects: no ships with engines, no machines, no modern items.",
  // «Борода» в описании дварфа перевешивала пол — все дварфийки выходили бородачами.
  raceEn: (race, gender) => {
    if (race === "dwarf") return gender === "f" ? "stocky dwarf woman, beardless" : "stocky dwarf with a braided beard";
    return RACE_EN[race] ?? "human";
  },
  classEn: {
    fighter: "warrior in chainmail with a longsword",
    rogue: "rogue in dark leather with daggers",
    wizard: "wizard in worn robes with a staff",
    cleric: "cleric in scale armour with a holy symbol",
    ranger: "ranger in a hooded cloak with a longbow",
  },
  locationEn: {
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
  },
  interiorTypes: ["tavern", "temple", "cave"],
};

const RACE_EN: Record<string, string> = {
  human: "human",
  elf: "elf with pointed ears",
  dwarf: "stocky dwarf",
  halfling: "halfling, small and nimble",
  tiefling: "tiefling with curved horns and dusky red skin",
  halforc: "half-orc with grey-green skin and small tusks",
};
