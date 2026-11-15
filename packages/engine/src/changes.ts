import type { Character } from "./character";
import { clamp } from "./dice";
import type { Campaign } from "./world";

/** Изменения, которые предлагает модель. Код применяет их с ограничениями. */
export interface ProposedChanges {
  hp?: number;
  gold?: number;
  addItems?: string[];
  removeItems?: string[];
  questDone?: string[];
  questComplete?: boolean;
}

export interface AppliedChanges {
  hp: number;
  gold: number;
  added: string[];
  removed: string[];
  questDone: string[];
  questComplete: boolean;
  /** Что отклонено и почему — в лог для разбора промптов. */
  rejected: string[];
  /** Короткие строки для игрока: «+5 золота · получено: Ключ». */
  notes: string[];
}

export const LIMITS = {
  /** Максимум золота, которое можно получить за обычный ход, на уровень героя. */
  goldPerTurnPerLevel: 25,
  /** То же за ход, в котором завершён квест. */
  goldOnQuestCompletePerLevel: 100,
  itemsPerTurn: 3,
  inventoryMax: 30,
  itemNameMax: 40,
} as const;

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");

/** Применяет изменения к герою и кампании (мутирует их) и возвращает, что реально применилось. */
export function applyChanges(c: Character, w: Campaign, p: ProposedChanges): AppliedChanges {
  const out: AppliedChanges = { hp: 0, gold: 0, added: [], removed: [], questDone: [], questComplete: false, rejected: [], notes: [] };

  // Цели квеста — первыми: от них зависит лимит золота.
  for (const id of p.questDone ?? []) {
    const o = w.objectives.find((x) => x.id === id);
    if (!o) out.rejected.push(`questDone: неизвестная цель ${id}`);
    else if (!o.done) {
      o.done = true;
      out.questDone.push(id);
      out.notes.push(`цель выполнена: ${o.text}`);
    }
  }
  if (p.questComplete && !w.complete) {
    const open = w.objectives.filter((o) => !o.done);
    // Завершить квест можно, только если открыта не больше одной цели — финальная.
    if (open.length <= 1) {
      w.complete = true;
      for (const o of open) o.done = true;
      out.questComplete = true;
      out.notes.push("квест выполнен!");
    } else out.rejected.push(`questComplete: открыто целей ${open.length}`);
  }

  if (Number.isFinite(p.hp) && p.hp) {
    const delta = clamp(Math.round(p.hp!), -c.hpMax, c.hpMax);
    const before = c.hp;
    c.hp = clamp(c.hp + delta, 0, c.hpMax);
    out.hp = c.hp - before;
    if (out.hp) out.notes.push(out.hp > 0 ? `+${out.hp} здоровья` : `${out.hp} здоровья`);
  }

  if (Number.isFinite(p.gold) && p.gold) {
    const perLevel = out.questComplete ? LIMITS.goldOnQuestCompletePerLevel : LIMITS.goldPerTurnPerLevel;
    const maxGain = perLevel * c.level;
    let delta = Math.round(p.gold!);
    if (delta > maxGain) {
      out.rejected.push(`gold: ${delta} урезано до ${maxGain}`);
      delta = maxGain;
    }
    const before = c.gold;
    c.gold = Math.max(0, c.gold + delta);
    out.gold = c.gold - before;
    if (out.gold) out.notes.push(out.gold > 0 ? `+${out.gold} золота` : `${out.gold} золота`);
  }

  for (const raw of p.removeItems ?? []) {
    const i = c.items.findIndex((x) => norm(x) === norm(String(raw)));
    if (i >= 0) {
      out.removed.push(c.items[i]!);
      c.items.splice(i, 1);
      out.notes.push(`потеряно: ${out.removed.at(-1)}`);
    } else out.rejected.push(`removeItems: нет предмета «${raw}»`);
  }

  for (const raw of p.addItems ?? []) {
    const name = String(raw).trim().slice(0, LIMITS.itemNameMax);
    if (!name) continue;
    if (out.added.length >= LIMITS.itemsPerTurn) {
      out.rejected.push(`addItems: больше ${LIMITS.itemsPerTurn} за ход («${name}»)`);
      continue;
    }
    if (c.items.length >= LIMITS.inventoryMax) {
      out.rejected.push(`addItems: инвентарь полон («${name}»)`);
      continue;
    }
    c.items.push(name);
    out.added.push(name);
    out.notes.push(`получено: ${name}`);
  }

  return out;
}

/** Поражение не убивает: герой приходит в себя с 1 HP и теряет половину золота. */
export function knockOut(c: Character): { goldLost: number } {
  const goldLost = Math.floor(c.gold / 2);
  c.gold -= goldLost;
  c.hp = 1;
  return { goldLost };
}
