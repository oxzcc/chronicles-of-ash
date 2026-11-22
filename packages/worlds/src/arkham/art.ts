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
      "private detective in a rumpled grey three-piece suit with rolled shirt sleeves and loosened tie, a shoulder holster, with a magnifying glass",
      "private detective in a dark double-breasted overcoat with the collar turned up and a wide-brimmed hat, with a lit cigarette",
      "private detective in a leather car coat over a knitted vest, flat cap, with a small notebook and a pencil",
    ],
    journalist: [
      "newspaper reporter in a flat cap and waistcoat with a notebook and a boxy 1920s folding bellows press camera",
      "newspaper reporter in a checked tweed jacket and wide trousers, a fedora with a press card in its hatband, with a folded newspaper",
      "newspaper reporter in a light raincoat over a sweater, a boxy 1920s folding bellows press camera on a leather strap, a pencil tucked behind the ear",
      "newspaper reporter in shirt sleeves with arm garters and a loose tie, a pencil tucked behind the ear, with typed pages",
    ],
    professor: [
      "university professor in a tweed three-piece suit with round spectacles and a cane",
      "university professor in a black academic gown over a dark suit, pince-nez, with a rolled map",
      "university professor in a cardigan and bow tie, wire spectacles, with a pipe and an open notebook",
      "university professor in a long camel overcoat and scarf, horn-rimmed glasses, with a stack of books with a strap",
    ],
    doctor: [
      "doctor in shirt sleeves and waistcoat with a leather medical bag, stethoscope",
      "doctor in a white hospital coat buttoned to the collar, a head mirror on a band, with a glass syringe",
      "doctor in a dark wool travelling coat and hat, carrying a leather medical bag and a lantern",
      "doctor in a surgical gown with sleeves rolled up, a cloth mask hanging at the neck, with a brown medicine bottle",
    ],
    veteran: [
      "Great War veteran in a worn army greatcoat, weathered face",
      "Great War veteran in an old khaki tunic with a medal ribbon and a webbing belt, with a trench knife",
      "Great War veteran in a shabby civilian suit with an army cap, a gas mask bag on a strap, with a hip flask",
      "Great War veteran in a sheepskin flying jacket and a knitted scarf, leather gloves, with a service revolver",
    ],
    occultist: [
      "antiquarian occultist in a dark overcoat with an old leather-bound book",
      "antiquarian occultist in a velvet smoking jacket with a silk scarf, rings on the fingers, with a carved bone amulet",
      "antiquarian occultist in a hooded travelling cloak over a waistcoat, with a candle and a rolled parchment",
      "antiquarian occultist in a dusty frock coat with a magnifying monocle, with a small brass astrolabe",
    ],
  },
  // Героини: одежда женщин 1926 года, у каждого класса один облик в мужском костюме (как сыщица в датасете).
  // Предметы — по одному и «with …»: два предмета и глагол в наряде дают третью руку.
  heroOutfitsFemaleEn: {
    detective: [
      "private detective in a belted trench coat {under} and a black cloche hat, with a small notebook",
      "private detective in a charcoal menswear three-piece suit with a loose necktie and a fedora, a shoulder holster, with a magnifying glass",
      "private detective in a dark wool wrap coat with a fur collar {under}, a felt cloche hat, with a cigarette in a long holder",
      "private detective in a pleated tweed skirt and a long cardigan, a knitted cloche hat, with a snub-nosed revolver",
    ],
    journalist: [
      "newspaper reporter in a flat cap and a man's waistcoat over a white blouse, high-waisted trousers, with a boxy 1920s folding bellows press camera",
      "newspaper reporter in a belted tweed jacket {under} and a pleated skirt, a cloche hat with a press card in its band, with a spiral notepad",
      "newspaper reporter in a light raincoat {under} and a beret, with a boxy 1920s folding bellows press camera on a leather strap",
      "newspaper reporter in a drop-waist day dress with a long beaded necklace, a pencil tucked behind the ear, with a sheaf of typed pages",
    ],
    professor: [
      "university professor in a tweed jacket {under} and a long pleated wool skirt, round spectacles, with a walking cane",
      "university professor in a black academic gown over a dark dress, pince-nez on a chain, with a rolled map",
      "university professor in a cardigan over a blouse with a bow at the collar, wire spectacles, with an open notebook",
      "university professor in a tailored menswear tweed three-piece suit and a long scarf, horn-rimmed glasses, with a stack of books on a strap",
    ],
    doctor: [
      "doctor in a long-sleeved white physician's coat {under}, a stethoscope around the neck, with a leather medical bag",
      "doctor in a long-sleeved white hospital coat buttoned to the collar, a head mirror on a cloth band, with a 1920s glass syringe with nickel finger rings",
      "doctor in a dark wool travelling coat {under} and a cloche hat, with a kerosene lantern",
      "doctor in a white surgical apron over a long grey dress with the sleeves rolled up, a cloth mask hanging at the neck, with a brown glass medicine bottle",
    ],
    veteran: [
      "Great War veteran ambulance driver in a worn army greatcoat {under}, leather driving gloves, with a hip flask",
      "Great War veteran in an old khaki tunic with a medal ribbon and a webbing belt over a long khaki skirt, with a trench knife",
      "Great War veteran field nurse in a faded grey uniform dress with a red cross armband and an army cap, with a gas mask bag",
      "Great War veteran in a sheepskin flying jacket {under} and a knitted scarf, a leather flying helmet pushed back, with a service revolver",
    ],
    occultist: [
      "antiquarian occultist in a dark overcoat {under}, with an old leather-bound book",
      "antiquarian occultist in a velvet evening dress with a silk shawl, rings on the fingers, with a carved bone amulet",
      "antiquarian occultist in a hooded travelling cloak {under}, with a lit candle",
      "antiquarian occultist in a dusty menswear frock coat and waistcoat, a monocle, with a small brass astrolabe",
    ],
  },
  // Под верхней одеждой — обычные слои эпохи. «Открытый» вариант означает лишь свободный ворот,
  // не оголение; роль, возраст и фигура не делают одежду сексуализированной.
  underlayersEn: {
    closed: [
      "over a high-necked lace blouse",
      "over a buttoned silk blouse with a bow at the collar",
      "over a fitted ribbed knit sweater",
      "over a plain cotton blouse with a rounded collar",
    ],
    open: ["over a cotton blouse with a softly folded open collar", "over a plain blouse with the top button undone"],
    openShare: 0.25,
    modestRoles: /учительниц|монахин|настоятельниц|вдов|гувернантк|жена (пастора|священника)|бабушк|скорбящ/i,
  },
  // Причёски 1926 года: боб, волны, короткая стрижка; длинные волосы — только убранными.
  hairstylesEn: {
    f: [
      "a sleek chin-length bob",
      "a short shingle bob with a side part",
      "finger waves pinned close to the head",
      "marcel waves gathered in a low chignon",
      "a short boyish Eton crop",
      "a curly bob held with a ribbon",
      "long hair pinned up in a soft loose bun",
      "a low braided knot at the nape",
    ],
    m: [
      "short back and sides slicked back with pomade",
      "neatly combed hair with a sharp side part",
      "a wavy pompadour",
      "close-cropped hair",
      "tousled hair falling over the forehead",
      "thinning hair combed straight back",
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
  // Новый принцип датасета: естественные пропорции и разнообразие обычных людей. Характер,
  // профессия, возраст и осанка важнее гипертрофированной атлетичности или сексуализации.
  figures: {
    young: {
      f: [
        { en: "average build", weight: 2 },
        { en: "lean average-built figure", weight: 1 },
        { en: "slim narrow-shouldered build", weight: 1 },
        { en: "solid full build with rounded shoulders", weight: 1 },
        { en: "sturdy broad-shouldered build", weight: 1 },
      ],
      m: [
        { en: "average build", weight: 1 },
        { en: "wiry lean build", weight: 1 },
        { en: "broad solid build with a soft belly", weight: 1 },
        { en: "heavyset stocky build", weight: 1 },
        { en: "sturdy broad-shouldered build", weight: 1 },
        { en: "slim narrow-shouldered build", weight: 1 },
      ],
    },
    elderly: {
      f: [
        { en: "thin wiry build", weight: 1 },
        { en: "solid full build with rounded shoulders", weight: 1 },
        { en: "average build with a slight stoop", weight: 1 },
        { en: "sturdy broad-shouldered build", weight: 1 },
      ],
      m: [
        { en: "thin wiry build", weight: 1 },
        { en: "gaunt narrow-shouldered build", weight: 1 },
        { en: "heavyset stocky build", weight: 1 },
        { en: "average build with a slight stoop", weight: 1 },
      ],
    },
    frail: "thin frail build",
    // Четыре облика героя — четыре разных естественных силуэта, без обязательной атлетичности
    // у мужчин и без акцента на груди, талии или бёдрах у женщин.
    hero: {
      f: [
        "average build with slightly rounded shoulders",
        "slim narrow-shouldered build",
        "solid full build with rounded shoulders",
        "sturdy broad-shouldered build",
      ],
      m: ["wiry lean build", "broad solid build with a soft belly", "heavyset stocky build", "sturdy broad-shouldered build"],
    },
  },
  interiorTypes: ["office", "hotel", "diner", "police", "library", "newspaper", "church", "speakeasy", "warehouse", "cellar"],
  // Проверено 19 ноября (data/emotions/arkham-2026-11-19): правка держит лицо, одежду, позу и стиль LoRA.
  // Без шрамов и «dark circles» — LoRA рисует их ранами и потёками; «на грани» без «pale drawn face» — старило лицо.
  emotions: {
    npc: {
      fear: { ru: "страх", en: "frightened: eyes wide open, eyebrows raised and drawn together, lips parted in alarm" },
      anger: { ru: "гнев", en: "furious: brows sharply lowered and knitted, glaring eyes, nostrils flared, teeth bared, jaw clenched" },
      sorrow: { ru: "печаль", en: "grieving: inner eyebrows raised, eyes glistening and downcast, corners of the mouth turned down" },
      joy: { ru: "улыбка", en: "a warm genuine smile, eyes crinkled with amusement" },
      shock: { ru: "потрясение", en: "stunned and caught out: eyes wide, eyebrows high, mouth slightly open, face frozen" },
    },
    hero: {
      wounded: "in pain: wincing, teeth gritted, a thin trickle of blood from the temple, a few strands of hair loose and messy",
      edge: "haunted: a hollow thousand-yard stare, tense jaw, a sheen of sweat on the brow, hair slightly dishevelled, the face as young as before",
      breakdown: "in the grip of terror: eyes wide and staring, mouth open in a silent scream, hair dishevelled",
    },
    perNpc: 2,
    perCampaign: 12,
  },
  // Датасет: data/lora/arkham_dataset (80 изображений владельца, подписи — data/lora/arkham_captions.json).
  lora: {
    trigger: "mthnr style",
    // «painterly…» обязательно: без слов о технике 9B рисует фотографию, и слабая LoRA её не перебивает.
    stylePrefix:
      "painterly digital illustration, visible brushstrokes, New England in 1926, period-accurate clothing and objects, no fantasy elements, no modern objects, no text, no watermark, no signature",
  },
};
