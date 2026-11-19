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
 * Начало промпта фона: стиль мира. С LoRA — триггер из датасета и короткий префикс (эпоха и запреты),
 * технику и палитру держит сама LoRA; без LoRA — полный stylePrefix. У портретов с LoRA префикса нет.
 */
export const stylePart = (world: World, lora = false) =>
  lora && world.art.lora ? `${world.art.lora.trigger}, ${world.art.lora.stylePrefix}` : world.art.stylePrefix;

/**
 * Портрет с LoRA — строго по образцу подписей датасета: «<триггер>, waist-up portrait of <кто это,
 * телосложение, внешность, одежда, поза, выражение>, plain light grey background». Любые лишние слова
 * (техника, свет, кадр) разбавляют триггер: на подписях из датасета LoRA повторяет оригиналы почти один в один,
 * а с прежним префиксом рисовала сдержанно и «по каталогу» (data/lora/captest). Кадр — 2:3, как в датасете.
 */
// «waist-up» — как 23 из 38 портретов датасета: с «three-quarter» масштаб скакал от крупного плана до фигуры по бёдра.
export const LORA_PORTRAIT_FRAME = "waist-up portrait of";
export const LORA_PORTRAIT_BACKGROUND = "plain light grey background";

export const portraitPrompt = (world: World, description: string, lora = false) =>
  lora && world.art.lora
    ? `${world.art.lora.trigger}, ${LORA_PORTRAIT_FRAME} ${description}, ${LORA_PORTRAIT_BACKGROUND}`
    : `${stylePart(world, lora)}, ${PORTRAIT_LIGHT}, ${description}`;

export const backgroundPrompt = (world: World, description: string, time: TimeOfDay, lora = false) =>
  `${stylePart(world, lora)}, ${world.art.backgroundLight}, ${description}, ${world.art.timeEn[time]}`;

/** LoRA, которую провайдер даст этому миру, — только если у мира есть триггер. */
export const worldLora = (world: World, provider: { loraFor?(worldId: string): LoraRef | undefined }) =>
  world.art.lora ? provider.loraFor?.(world.id) : undefined;

/** Раса с учётом пола — словами мира. */
export const raceEn = (world: World, race: string, gender: "m" | "f") => world.art.raceEn(race, gender);

/** Места, которые рисуются изнутри. */
export const isInterior = (world: World, type: string) => world.art.interiorTypes.includes(type);

/**
 * Промпт правки портрета (эмоция): тот же человек, меняется только выражение. Описание облика — обязательно:
 * без него правка теряла очки героини во всех состояниях (проверка 19 ноября).
 */
export const editPrompt = (world: World, look: string, change: string) =>
  `${world.art.lora ? `${world.art.lora.trigger}, ` : ""}the same person as in the reference image${look ? ` (${look})` : ""}: keep the exact same face, identity and age, hairstyle, glasses and every accessory, clothing, body, pose, framing and plain light grey background. Change only the facial expression to ${change}.`;

/** Облик из промпта готового портрета: без триггера, кадра и фона — для промпта правки. */
export function lookFromPrompt(world: World, prompt: string): string {
  let s = prompt.trim();
  if (world.art.lora && s.startsWith(`${world.art.lora.trigger}, `)) s = s.slice(world.art.lora.trigger.length + 2);
  if (s.startsWith(`${LORA_PORTRAIT_FRAME} `)) s = s.slice(LORA_PORTRAIT_FRAME.length + 1);
  s = s.replace(new RegExp(`,\\s*${LORA_PORTRAIT_BACKGROUND}\\s*$`), "");
  // Без LoRA впереди стоят техника и свет мира — они длинные и не про человека.
  for (const head of [world.art.stylePrefix, PORTRAIT_LIGHT]) if (s.startsWith(head)) s = s.slice(head.length).replace(/^,\s*/, "");
  return s.slice(0, 600);
}
