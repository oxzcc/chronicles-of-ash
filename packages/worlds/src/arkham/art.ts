import type { ArtStyle } from "../types";

/**
 * Стиль Аркхэма — черновик до утверждения по макетам (см. style.md рядом):
 * нуар 1920-х, гуашь и тушь, сепия и бутылочная зелень, туман и газовый свет.
 */
export const arkhamArt: ArtStyle = {
  stylePrefix:
    "1920s film noir painterly illustration, gouache and ink texture, muted sepia and bottle-green palette with sickly yellow lamplight accents, heavy soft shadows, detailed but loose brushwork, New England in 1926, period-accurate clothing and objects, no fantasy elements, no modern objects, no text, no watermark, no signature",
  backgroundLight: "wide establishing shot, empty scene with no people, atmospheric depth, low drifting fog, wet reflective surfaces, no lettering, signs without text",
  timeEn: {
    day: "grey overcast daylight, fine drizzle",
    dusk: "at dusk, gas street lamps just lit, bruised violet sky",
    night: "at night, cold moonlight through fog, warm yellow electric and gas light",
  },
  genreEn: "1920s Lovecraftian mystery",
  strangerEn: "a townsperson of 1920s Massachusetts, tired face, period clothing",
  localEn: "a local of a 1920s New England town",
  locationNounEn: "place in a gloomy 1920s New England college town",
  eraRuleEn:
    "Only objects of 1926: gas and early electric lamps, Ford Model T cars, trams, telephones on the wall, typewriters, steam trains; no modern cars, no plastic, no screens, no fantasy creatures or castles.",
  raceEn: () => "ordinary 1920s American",
  classEn: {
    detective: "private detective in a belted trench coat and fedora, revolver holster",
    journalist: "newspaper reporter in a flat cap and waistcoat with a notebook and a press camera",
    professor: "university professor in a tweed three-piece suit with round spectacles and a cane",
    doctor: "doctor in shirt sleeves and waistcoat with a leather medical bag, stethoscope",
    veteran: "Great War veteran in a worn army greatcoat, weathered face",
    occultist: "antiquarian occultist in a dark overcoat with an old leather-bound book",
  },
  locationEn: {
    office: "interior of a cramped 1920s office, frosted glass door, desk lamp, filing cabinets",
    hotel: "interior of a modest 1920s hotel lobby, worn carpet, brass key rack",
    diner: "interior of a 1920s diner, counter stools, coffee urn, steamed windows",
    police: "interior of a 1920s police station, wooden counter, wanted posters without text, gaslight",
    university: "old brick university buildings with ivy and a clock tower",
    library: "interior of an old university library, tall oak shelves, green reading lamps",
    newspaper: "interior of a 1920s newspaper office, typewriters, stacked papers, hanging lamps",
    church: "interior of an old New England church, white pews, tall windows",
    hospital: "a 1920s hospital corridor with tiled walls and iron beds",
    street: "a narrow street of old gambrel-roofed houses in a New England town",
    mansion: "a decaying Victorian mansion with a gated garden",
    speakeasy: "interior of a hidden 1920s speakeasy, smoky bar, dim red lamps",
    docks: "river wharf with wooden piers, moored boats and fishing sheds",
    warehouse: "interior of a dusty brick warehouse with crates and hanging chains",
    cemetery: "an old colonial cemetery with slate headstones and bare trees",
    cellar: "interior of a stone cellar with damp walls and old barrels",
    woods: "dark New England woods with old stone walls and fallen leaves",
    farm: "an isolated New England farmhouse with a barn and a dry field",
  },
  interiorTypes: ["office", "hotel", "diner", "police", "library", "newspaper", "church", "speakeasy", "warehouse", "cellar"],
};
