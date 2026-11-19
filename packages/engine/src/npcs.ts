import { clamp } from "./dice";
import { effect, type TurnEffect } from "./effects";
import { matchName, normName } from "./names";
import type { Campaign } from "./world";

/**
 * Память мастера о людях, которых встретил герой: как говорит, как относится к герою,
 * что уже рассказал. Мастер только предлагает (npcs в ответе), движок проверяет и режет:
 * писать можно лишь о тех, кто говорил в этом ответе; отношение — на шаг за ход.
 */
export interface NpcMemory {
  name: string;
  role: string;
  /** Манера речи, 5–10 слов: задаётся при первой встрече. */
  voice: string;
  /** Отношение к герою: −2 враждебно … +2 доверяет. */
  attitude: number;
  /** Что человек уже рассказал герою — показания (в деле их видно в досье). */
  told: string[];
  /** Где герой видел его в последний раз (id места). */
  at: string;
  /** Ход последней встречи. */
  met: number;
}

/** Что предлагает мастер о NPC в этом ответе. attitude — сдвиг: −1, 0 или +1. */
export interface NpcNote {
  name: string;
  voice?: string;
  attitude?: number;
  told?: string[];
}

export const NPC_LIMITS = {
  /** Сколько людей помнит кампания: дальше забываются давно не встречавшиеся. */
  people: 30,
  told: 6,
  toldPerTurn: 2,
  toldLen: 160,
  voiceLen: 100,
  notesPerTurn: 3,
  attitude: 2,
} as const;

export const ATTITUDE_WORDS: Record<string, string> = { "-2": "враждебен", "-1": "насторожен", "0": "нейтрален", "1": "расположен", "2": "доверяет" };
export const attitudeWord = (a: number) => ATTITUDE_WORDS[String(clamp(Math.round(a), -2, 2))]!;

const cut = (s: unknown, n: number) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, n);

/** Карточка человека по имени (точно или по короткому имени) — или undefined. */
export function findNpc(w: Pick<Campaign, "memory">, name: string): NpcMemory | undefined {
  const all = w.memory ?? [];
  const i = matchName(name, all.map((m) => m.name));
  return i >= 0 ? all[i] : undefined;
}

export interface AppliedNpcNotes {
  effects: TurnEffect[];
  rejected: string[];
}

/**
 * Применяет заметки мастера о людях. speakers — кто говорил в этом ответе (имя и роль):
 * у каждого появляется карточка, даже если мастер ничего о нём не написал.
 * Заметки о тех, кто не говорил, отклоняются: мастер не может «вспомнить за кадром».
 */
export function applyNpcNotes(w: Campaign, speakers: { name: string; role?: string }[], notes: NpcNote[]): AppliedNpcNotes {
  const out: AppliedNpcNotes = { effects: [], rejected: [] };
  const mem = (w.memory ??= []);
  const touched = new Set<NpcMemory>();
  const card = (name: string, role = "") => {
    let m = findNpc(w, name);
    if (!m) {
      m = { name: cut(name, 40), role: cut(role, 60), voice: "", attitude: 0, told: [], at: w.current, met: w.turn };
      mem.push(m);
    }
    if (!m.role && role) m.role = cut(role, 60);
    m.at = w.current;
    m.met = w.turn;
    touched.add(m);
    return m;
  };
  for (const s of speakers) if (s.name.trim()) card(s.name, s.role);

  for (const n of notes.slice(0, NPC_LIMITS.notesPerTurn)) {
    const m = n.name.trim() ? findNpc(w, n.name) : undefined;
    if (!m || !touched.has(m)) {
      out.rejected.push(`npcs: ${n.name || "без имени"} не говорил в этом ответе`);
      continue;
    }
    if (n.voice && !m.voice) m.voice = cut(n.voice, NPC_LIMITS.voiceLen);
    const step = clamp(Math.round(Number(n.attitude) || 0), -1, 1);
    if (step) {
      const before = m.attitude;
      m.attitude = clamp(before + step, -NPC_LIMITS.attitude, NPC_LIMITS.attitude);
      if (m.attitude !== before) out.effects.push(effect.attitude(m.name, m.attitude - before, attitudeWord(m.attitude)));
    }
    if (Math.abs(Number(n.attitude) || 0) > 1) out.rejected.push(`npcs: ${m.name} attitude ${n.attitude} урезано до ${step}`);
    const known = new Set(m.told.map(normName));
    let added = 0;
    for (const raw of n.told ?? []) {
      const t = cut(raw, NPC_LIMITS.toldLen);
      if (!t || known.has(normName(t))) continue;
      if (added >= NPC_LIMITS.toldPerTurn) {
        out.rejected.push(`npcs: ${m.name} — больше ${NPC_LIMITS.toldPerTurn} показаний за ход`);
        break;
      }
      m.told.push(t);
      known.add(normName(t));
      added++;
    }
    if (m.told.length > NPC_LIMITS.told) m.told.splice(0, m.told.length - NPC_LIMITS.told);
  }
  // Память не бесконечна: давно не встречавшиеся забываются первыми.
  if (mem.length > NPC_LIMITS.people) {
    mem.sort((a, b) => b.met - a.met);
    mem.length = NPC_LIMITS.people;
  }
  return out;
}
