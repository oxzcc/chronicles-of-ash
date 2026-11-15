import { CLASSES, LOCATION_TYPE_KEYS, RACES, sheetText, type Character, type CharacterDraft } from "@ash/engine";
import type { HistoryEntry } from "./gm";

export function questPrompt(c: Character, locationCount = 8): string {
  return `Придумай завязку для одиночного приключения тёмного фэнтези (в духе Baldur's Gate 3) для героя ${c.level} уровня. Всё по-русски.
Герой: ${sheetText(c)}
Свяжи завязку с предысторией героя, если это возможно.
Верни строго один JSON без пояснений:
{"questTitle":"короткое название квеста","hook":"2–3 предложения: что случилось и почему герой взялся за дело","objectives":["цель 1","цель 2","цель 3"],"locations":[{"name":"Название","type":"${LOCATION_TYPE_KEYS.join("|")}","desc":"одно атмосферное предложение"}],"target":${locationCount - 1}}
Ровно ${locationCount} локаций: первая — стартовая (таверна, деревня, город или лагерь), локация с индексом target — место финала. Названия звучные и разные, типы разнообразные.`;
}

export function backstoryPrompt(d: CharacterDraft): string {
  const skills = [...CLASSES[d.cls].skills, ...d.skills].join(", ");
  return `Напиши по-русски предысторию героя тёмного фэнтези (в духе Baldur's Gate 3) в 3–4 предложениях, от третьего лица, без заголовков и кавычек. Герой: ${d.name || "безымянный"}, ${d.gender === "f" ? "женщина" : "мужчина"}, ${RACES[d.race].name}, ${CLASSES[d.cls].name}. Владеет: ${skills}. ${d.backstory ? `Учти заметки игрока: ${d.backstory}` : ""} Дай одну тайну или незавершённое дело, которое тянет его в дорогу.`;
}

export function chroniclePrompt(previous: string, entries: HistoryEntry[]): string {
  const txt = entries
    .map((e) => (e.who === "player" ? `Игрок: ${e.text}` : e.who === "gm" ? `Мастер: ${e.text}${e.line ? ` ${e.speaker}: «${e.line}»` : ""}` : `[${e.text}]`))
    .join("\n");
  return `Сожми эти события ролевой игры в 3–5 предложений летописи по-русски: имена NPC, обещания, находки, решения героя, открытые нити. Только текст.\n\nУже записано: ${previous || "—"}\n\nНовые события:\n${txt}`;
}
