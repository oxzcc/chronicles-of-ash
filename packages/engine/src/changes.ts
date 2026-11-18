import type { Character } from "./character";
import { clamp } from "./dice";
import type { Ruleset } from "./rules";
import type { Campaign } from "./world";
import { effect, type TurnEffect } from "./effects";

/** Изменения, которые предлагает модель. Код применяет их с ограничениями. */
export interface ProposedChanges {
  hp?: number;
  /** Рассудок: потеря — отрицательное число. Только в мирах с рассудком. */
  sanity?: number;
  gold?: number;
  addItems?: string[];
  removeItems?: string[];
  questDone?: string[];
  questComplete?: boolean;
}

export interface AppliedChanges {
  hp: number;
  sanity: number;
  gold: number;
  added: string[];
  removed: string[];
  questDone: string[];
  questComplete: boolean;
  /** Что отклонено и почему — в лог для разбора промптов. */
  rejected: string[];
  /** Короткие строки для журнала: «+5 золота · получено: Ключ». */
  notes: string[];
  /** То же для экрана игрока — плашки в сцене и в истории. */
  effects: TurnEffect[];
}

/** Пустой итог — для ходов без изменений от мастера (справочник). */
export const emptyApplied = (): AppliedChanges => ({ hp: 0, sanity: 0, gold: 0, added: [], removed: [], questDone: [], questComplete: false, rejected: [], notes: [], effects: [] });

export const LIMITS = {
  /** Максимум золота, которое можно получить за обычный ход, на уровень героя. */
  goldPerTurnPerLevel: 25,
  /** То же за ход, в котором завершён квест. */
  goldOnQuestCompletePerLevel: 100,
  itemsPerTurn: 3,
  inventoryMax: 30,
  itemNameMax: 40,
  /** Рассудок за один ход: потерять — не больше 4 (встреча с тварью целиком), вернуть — не больше 1. */
  sanityLossPerTurn: 4,
  sanityGainPerTurn: 1,
} as const;

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");

/** Применяет изменения к герою и кампании (мутирует их) и возвращает, что реально применилось. */
/** Название предмета до лимита: режем по слову и без висящей кавычки («футляр с экслибрисом «Из» → «футляр с экслибрисом»). */
export function itemName(raw: unknown): string {
  const s = String(raw).trim().replace(/\s+/g, " ");
  if (s.length <= LIMITS.itemNameMax) return s;
  const cut = s.slice(0, LIMITS.itemNameMax + 1);
  const atWord = cut.lastIndexOf(" ") > 10 ? cut.slice(0, cut.lastIndexOf(" ")) : cut.slice(0, LIMITS.itemNameMax);
  return atWord.replace(/[\s«"(„,:;—-]+$/, "").replace(/\s+«[^»]*$/, "").trim();
}

export function applyChanges(r: Ruleset, c: Character, w: Campaign, p: ProposedChanges): AppliedChanges {
  const out = emptyApplied();

  // Цели квеста — первыми: от них зависит лимит золота.
  for (const id of p.questDone ?? []) {
    const o = w.objectives.find((x) => x.id === id);
    if (!o) out.rejected.push(`questDone: неизвестная цель ${id}`);
    else if (!o.done) {
      o.done = true;
      out.questDone.push(id);
      out.notes.push(`цель выполнена: ${o.text}`);
      out.effects.push(effect.objective(o.id, o.text));
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
      out.effects.push(effect.quest());
    } else out.rejected.push(`questComplete: открыто целей ${open.length}`);
  }

  if (Number.isFinite(p.hp) && p.hp) {
    const delta = clamp(Math.round(p.hp!), -c.hpMax, c.hpMax);
    const before = c.hp;
    c.hp = clamp(c.hp + delta, 0, c.hpMax);
    out.hp = c.hp - before;
    if (out.hp) {
      out.notes.push(out.hp > 0 ? `+${out.hp} здоровья` : `${out.hp} здоровья`);
      out.effects.push(effect.hp(out.hp));
    }
  }

  if (Number.isFinite(p.sanity) && p.sanity) {
    if (c.sanity === undefined || c.sanityMax === undefined) out.rejected.push("sanity: в этом мире нет рассудка");
    else {
      let delta = Math.round(p.sanity!);
      const capped = clamp(delta, -LIMITS.sanityLossPerTurn, LIMITS.sanityGainPerTurn);
      if (capped !== delta) out.rejected.push(`sanity: ${delta} урезано до ${capped}`);
      delta = capped;
      const before = c.sanity;
      c.sanity = clamp(c.sanity + delta, 0, c.sanityMax);
      out.sanity = c.sanity - before;
      if (out.sanity) {
        out.notes.push(out.sanity > 0 ? `+${out.sanity} рассудка` : `${out.sanity} рассудка`);
        out.effects.push(effect.sanity(out.sanity));
      }
    }
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
    if (out.gold) {
      out.notes.push(`${out.gold > 0 ? "+" : "-"}${r.money.amount(Math.abs(out.gold))}`);
      out.effects.push(effect.gold(out.gold, r.money.amount(Math.abs(out.gold))));
    }
  }

  for (const raw of p.removeItems ?? []) {
    const i = c.items.findIndex((x) => norm(x) === norm(String(raw)));
    if (i >= 0) {
      out.removed.push(c.items[i]!);
      c.items.splice(i, 1);
      out.notes.push(`потеряно: ${out.removed.at(-1)}`);
      out.effects.push(effect.lost(out.removed.at(-1)!));
    } else out.rejected.push(`removeItems: нет предмета «${raw}»`);
  }

  for (const raw of p.addItems ?? []) {
    const name = itemName(raw);
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
    out.effects.push(effect.item(name));
  }

  return out;
}

/**
 * Срыв: рассудок кончился. Герой не сходит с ума навсегда — приходит в себя (обычно в Лечебнице на Холме)
 * с половиной рассудка; время потеряно.
 */
export function breakDown(c: Character): { restored: number } {
  const restored = Math.ceil((c.sanityMax ?? 0) / 2);
  c.sanity = restored;
  return { restored };
}

/** Поражение не убивает: герой приходит в себя с 1 HP и теряет половину золота. */
export function knockOut(c: Character): { goldLost: number } {
  const goldLost = Math.floor(c.gold / 2);
  c.gold -= goldLost;
  c.hp = 1;
  return { goldLost };
}
