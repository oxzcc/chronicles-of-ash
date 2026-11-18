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
  heroOutfitsEn: {
    fighter: [
      "warrior in chainmail with a longsword",
      "warrior in a dented steel breastplate over a padded gambeson, holding a round wooden shield and an axe",
      "warrior in a fur-trimmed leather jerkin with a heavy belt, a greatsword resting on the shoulder",
      "warrior in a tattered surcoat over mail, holding a spear and a battered helmet",
    ],
    rogue: [
      "rogue in dark leather with daggers",
      "rogue in a hooded short cape and a buckled vest, flipping a gold coin",
      "rogue in a patched coat with many pockets, holding a ring of lockpicks",
      "rogue in a fitted dark doublet with a scarf over the lower face pulled down, holding a throwing knife",
    ],
    wizard: [
      "wizard in worn robes with a staff",
      "wizard in a high-collared embroidered coat, holding an open spellbook with a faint glow",
      "wizard in a travelling cloak over a scholar's tunic, a satchel of scrolls, holding a crystal orb",
      "wizard in layered dark robes with talismans on cords, holding a wand and a burning candle",
    ],
    cleric: [
      "cleric in scale armour with a holy symbol",
      "cleric in a white tabard over chainmail, holding a flanged mace",
      "cleric in a plain hooded habit with a rope belt, holding a prayer book and a censer",
      "cleric in ornate vestments over a breastplate, holding a raised shining holy symbol",
    ],
    ranger: [
      "ranger in a hooded cloak with a longbow",
      "ranger in a green leather jerkin and bracers, a quiver on the back, holding an arrow",
      "ranger in a fur mantle and hide boots, holding a hunting knife and a coil of rope",
      "ranger in a weathered oilskin coat with a feathered hat, holding a crossbow",
    ],
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
