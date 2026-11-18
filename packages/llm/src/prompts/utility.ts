import { locationTypeKeys, startLocationTypes, sheetText, type Character, type CharacterDraft } from "@ash/engine";
import type { World } from "@ash/worlds";
import type { HistoryEntry } from "./gm";

/** «а, б, в или г». */
const orList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} или ${xs.at(-1)}` : (xs[0] ?? ""));

export function questPrompt(world: World, c: Character, locationCount = 8): string {
  const R = world.rules;
  const starts = orList(startLocationTypes(R).map((t) => R.locationTypes[t]!.name.toLowerCase()));
  return `Придумай завязку для одиночного приключения ${world.genre} для героя ${c.level} уровня. Всё по-русски.
Герой: ${sheetText(R, c)}
Свяжи завязку с предысторией героя, если это возможно.
Верни строго один JSON без пояснений:
{"questTitle":"короткое название квеста","hook":"2–3 предложения: что случилось и почему герой взялся за дело","objectives":["цель 1","цель 2","цель 3"],"locations":[{"name":"Название","type":"${locationTypeKeys(R).join("|")}","desc":"одно атмосферное предложение"}],"target":${locationCount - 1}}
Описания коротко: hook до 60 слов, цель до 15 слов, desc локации до 15 слов. Ровно ${locationCount} локаций: первая — стартовая (${starts}), локация с индексом target — место финала. Названия звучные и разные, типы разнообразные.`;
}

export function backstoryPrompt(world: World, d: CharacterDraft): string {
  const R = world.rules;
  const skills = [...(R.classes[d.cls]?.skills ?? []), ...d.skills].join(", ");
  return `Напиши по-русски предысторию героя ${world.genre} в 3–4 предложениях, от третьего лица, без заголовков и кавычек. Герой: ${d.name || "безымянный"}, ${d.gender === "f" ? "женщина" : "мужчина"}, ${R.races[d.race]?.name ?? d.race}, ${R.classes[d.cls]?.name ?? d.cls}. Владеет: ${skills}. ${d.backstory ? `Учти заметки игрока: ${d.backstory}` : ""} Дай одну тайну или незавершённое дело, которое тянет его в дорогу.`;
}

export function chroniclePrompt(previous: string, entries: HistoryEntry[]): string {
  const txt = entries
    .map((e) => (e.who === "player" ? `Игрок: ${e.text}` : e.who === "gm" ? `Мастер: ${e.text}${e.line ? ` ${e.speaker}: «${e.line}»` : ""}` : `[${e.text}]`))
    .join("\n");
  return `Сожми эти события ролевой игры в 3–5 предложений летописи по-русски: имена NPC, обещания, находки, решения героя, открытые нити. Только текст.\n\nУже записано: ${previous || "—"}\n\nНовые события:\n${txt}`;
}
