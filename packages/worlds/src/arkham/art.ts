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
    journalist: "newspaper reporter in a flat cap and waistcoat with a notebook and a boxy 1920s folding bellows press camera",
    professor: "university professor in a tweed three-piece suit with round spectacles and a cane",
    doctor: "doctor in shirt sleeves and waistcoat with a leather medical bag, stethoscope",
    veteran: "Great War veteran in a worn army greatcoat, weathered face",
    occultist: "antiquarian occultist in a dark overcoat with an old leather-bound book",
  },
  // Первый вариант — classEn; остальные — другая одежда и другой предмет в руках той же профессии.
  heroOutfitsEn: {
    detective: [
      "private detective in a belted trench coat and fedora, revolver holster",
      "private detective in a rumpled grey three-piece suit with rolled shirt sleeves and loosened tie, a shoulder holster, holding a magnifying glass",
      "private detective in a dark double-breasted overcoat with the collar turned up and a wide-brimmed hat, holding a lit cigarette",
      "private detective in a leather car coat over a knitted vest, flat cap, holding a small notebook and a pencil",
    ],
    journalist: [
      "newspaper reporter in a flat cap and waistcoat with a notebook and a boxy 1920s folding bellows press camera",
      "newspaper reporter in a checked tweed jacket and wide trousers, a fedora with a press card in its hatband, holding a folded newspaper",
      "newspaper reporter in a light raincoat over a sweater, a boxy 1920s folding bellows press camera on a leather strap, a pencil tucked behind the ear",
      "newspaper reporter in shirt sleeves with arm garters and a loose tie, a pencil tucked behind the ear, holding typed pages",
    ],
    professor: [
      "university professor in a tweed three-piece suit with round spectacles and a cane",
      "university professor in a black academic gown over a dark suit, pince-nez, holding a rolled map",
      "university professor in a cardigan and bow tie, wire spectacles, holding a pipe and an open notebook",
      "university professor in a long camel overcoat and scarf, horn-rimmed glasses, holding a stack of books with a strap",
    ],
    doctor: [
      "doctor in shirt sleeves and waistcoat with a leather medical bag, stethoscope",
      "doctor in a white hospital coat buttoned to the collar, a head mirror on a band, holding a glass syringe",
      "doctor in a dark wool travelling coat and hat, carrying a leather medical bag and a lantern",
      "doctor in a surgical gown with sleeves rolled up, a cloth mask hanging at the neck, holding a brown medicine bottle",
    ],
    veteran: [
      "Great War veteran in a worn army greatcoat, weathered face",
      "Great War veteran in an old khaki tunic with a medal ribbon and a webbing belt, holding a trench knife",
      "Great War veteran in a shabby civilian suit with an army cap, a gas mask bag on a strap, holding a hip flask",
      "Great War veteran in a sheepskin flying jacket and a knitted scarf, leather gloves, holding a service revolver",
    ],
    occultist: [
      "antiquarian occultist in a dark overcoat with an old leather-bound book",
      "antiquarian occultist in a velvet smoking jacket with a silk scarf, rings on the fingers, holding a carved bone amulet",
      "antiquarian occultist in a hooded travelling cloak over a waistcoat, holding a candle and a rolled parchment",
      "antiquarian occultist in a dusty frock coat with a magnifying monocle, holding a small brass astrolabe",
    ],
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
  // Владелец, 18 ноября: пожилые — без утрирования; роковые роли — всегда «песочные часы».
  // 19 ноября: пышных стало слишком много — у молодых и средних лет женщин теперь 4/9 с формами,
  // 2/9 «песочные часы», треть стройные (было 1/2, 1/3, 1/6).
  figures: {
    young: {
      f: [
        { en: "curvy voluptuous build with a large bust and wide hips", weight: 2 },
        { en: "voluptuous hourglass figure with a very large bust and wide hips", weight: 1 },
        { en: "slim slender build", weight: 1 / 2 },
        { en: "petite slender build", weight: 1 / 2 },
        { en: "slim athletic build", weight: 1 / 2 },
      ],
      m: [
        { en: "tall muscular athletic build", weight: 1 },
        { en: "broad burly build", weight: 1 },
        { en: "wiry lean build", weight: 1 },
        { en: "heavyset portly build", weight: 1 },
        { en: "stocky build", weight: 1 },
        { en: "lean slender build", weight: 1 },
      ],
    },
    elderly: {
      f: [
        { en: "stout heavyset build", weight: 1 },
        { en: "slim upright build", weight: 1 },
        { en: "thin wiry build", weight: 1 },
      ],
      m: [
        { en: "stocky build", weight: 1 },
        { en: "thin wiry build", weight: 1 },
        { en: "heavyset portly build", weight: 1 },
        { en: "gaunt bony build", weight: 1 },
      ],
    },
    frail: "thin frail build",
    roles: [{ match: /певиц|актрис|танцовщ|светск|жриц|куртизан|роков|кинозвезд|звезд[аы] /i, f: "voluptuous hourglass figure with a very large bust and wide hips" }],
    // Четыре облика героини — четыре разных силуэта. «С формами» и «пышная» раньше обе были про грудь и бёдра
    // и рисовались почти одинаково; теперь первая — «песочные часы» с очень большой грудью и тонкой талией, вторая — полная и мягкая целиком.
    hero: {
      f: [
        "voluptuous hourglass figure with a very large bust, a narrow cinched waist and wide hips",
        "plump full-figured build, soft rounded body with a thick waist, full arms and a round soft face",
        "slim slender build, narrow shoulders and a flat figure",
        "slim athletic build, lean and fit, not muscular",
      ],
      m: ["tall muscular athletic build", "broad burly build", "wiry lean build", "heavyset stocky build"],
    },
  },
  interiorTypes: ["office", "hotel", "diner", "police", "library", "newspaper", "church", "speakeasy", "warehouse", "cellar"],
  // Датасет: data/lora/arkham_dataset (58 картинок владельца, подписи — data/lora/arkham_captions.json).
  lora: {
    trigger: "mthnr style",
    // «painterly…» обязательно: без слов о технике 9B рисует фотографию, и слабая LoRA её не перебивает.
    stylePrefix:
      "painterly digital illustration, visible brushstrokes, New England in 1926, period-accurate clothing and objects, no fantasy elements, no modern objects, no text, no watermark, no signature",
  },
};
