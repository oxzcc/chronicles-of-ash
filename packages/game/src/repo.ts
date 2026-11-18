import { and, asc, desc, eq, sql } from "drizzle-orm";
import { campaigns, characters, turns, users, type Db } from "@ash/db";
import type { Campaign, Character } from "@ash/engine";
import type { Tier } from "@ash/llm";
import { DEFAULT_WORLD } from "@ash/worlds";
import { HISTORY_WINDOW } from "./history";
import { GameError, type GameState, type TurnRecord } from "./types";

/** Временный игрок по cookie — до входа через почту и соцсети (фаза 4). */
export async function ensureUser(db: Db, id: string): Promise<{ id: string; tier: Tier }> {
  await db.insert(users).values({ id }).onConflictDoNothing();
  const [u] = await db.select({ id: users.id, tier: users.tier }).from(users).where(eq(users.id, id));
  if (!u) throw new GameError("Игрок не найден.", 404);
  return u;
}

export async function createCampaign(db: Db, userId: string, s: GameState): Promise<string> {
  return db.transaction(async (tx) => {
    const [ch] = await tx.insert(characters).values({ userId, name: s.character.name, sheet: s.character }).returning({ id: characters.id });
    const [cp] = await tx
      .insert(campaigns)
      .values({ userId, characterId: ch!.id, title: s.campaign.questTitle, state: s.campaign })
      .returning({ id: campaigns.id });
    return cp!.id;
  });
}

export interface LoadedCampaign {
  id: string;
  characterId: string;
  turnNo: number;
  state: GameState;
  /** Последние записи журнала, от старых к новым. */
  recent: TurnRow[];
}

export type TurnRow = Pick<TurnRecord, "kind" | "action" | "narration" | "beats" | "speaker" | "line" | "rolls" | "suggestions"> & {
  turnNo: number;
  combatEvents: TurnRecord["combatEvents"];
  createdAt: Date;
};

function toRow(t: typeof turns.$inferSelect): TurnRow {
  const resp = (t.response ?? {}) as { beats?: TurnRecord["beats"]; suggestions?: (string | TurnRecord["suggestions"][number])[]; combatEvents?: TurnRecord["combatEvents"] };
  // Ходы до gm-2: текст без реплик, варианты строками.
  const beats = resp.beats ?? (t.narration && t.kind !== "combat"
    ? [...t.narration.split(/\n\s*\n/).map((text) => ({ speaker: null, text })), ...(t.line ? [{ speaker: t.speaker ?? "Голос", text: t.line }] : [])]
    : []);
  return {
    turnNo: t.turnNo, kind: t.kind as TurnRow["kind"], action: t.action, narration: t.narration,
    beats, speaker: t.speaker, line: t.line ?? "", rolls: t.rolls ?? [],
    suggestions: (resp.suggestions ?? []).map((x) => (typeof x === "string" ? { text: x } : x)), combatEvents: resp.combatEvents ?? [], createdAt: t.createdAt,
  };
}

export async function loadCampaign(db: Db, userId: string, id: string, limit = HISTORY_WINDOW): Promise<LoadedCampaign> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new GameError("Кампания не найдена.", 404);
  const [row] = await db
    .select({ id: campaigns.id, characterId: campaigns.characterId, turnNo: campaigns.turnNo, state: campaigns.state, sheet: characters.sheet })
    .from(campaigns)
    .innerJoin(characters, eq(characters.id, campaigns.characterId))
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)));
  if (!row) throw new GameError("Кампания не найдена.", 404);
  const recent = (await db.select().from(turns).where(eq(turns.campaignId, id)).orderBy(desc(turns.turnNo)).limit(limit)).reverse().map(toRow);
  // Листы до миров: поля world нет — это фэнтези.
  const character: Character = { ...row.sheet, world: row.sheet.world || DEFAULT_WORLD };
  return { id: row.id, characterId: row.characterId, turnNo: row.turnNo, state: { character, campaign: row.state }, recent };
}

export async function listCampaigns(db: Db, userId: string) {
  return db
    .select({
      id: campaigns.id, title: campaigns.title, turnNo: campaigns.turnNo, updatedAt: campaigns.updatedAt, hero: characters.name,
      world: sql<string>`coalesce(${characters.sheet}->>'world', ${DEFAULT_WORLD})`,
    })
    .from(campaigns)
    .innerJoin(characters, eq(characters.id, campaigns.characterId))
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.updatedAt));
}

export async function campaignTurns(db: Db, campaignId: string): Promise<TurnRow[]> {
  return (await db.select().from(turns).where(eq(turns.campaignId, campaignId)).orderBy(asc(turns.turnNo))).map(toRow);
}

export class ConflictError extends GameError {
  constructor() {
    super("Ход уже сделан в другой вкладке — обнови страницу.", 409);
  }
}

/**
 * Сохраняет ход атомарно. Оптимистичная блокировка: если за время хода кто-то уже
 * сохранил другой ход (turn_no сдвинулся), ничего не пишем и бросаем ConflictError.
 */
export async function saveTurn(db: Db, c: { id: string; characterId: string; turnNo: number }, state: GameState, records: TurnRecord[]): Promise<number> {
  return db.transaction(async (tx) => {
    const next = c.turnNo + records.length;
    const updated = await tx
      .update(campaigns)
      .set({ state: state.campaign as Campaign, turnNo: next, title: state.campaign.questTitle })
      .where(and(eq(campaigns.id, c.id), eq(campaigns.turnNo, c.turnNo)))
      .returning({ id: campaigns.id });
    if (!updated.length) throw new ConflictError();
    await tx.update(characters).set({ sheet: state.character as Character, name: state.character.name }).where(eq(characters.id, c.characterId));
    if (records.length)
      await tx.insert(turns).values(
        records.map((r, i) => ({
          campaignId: c.id,
          turnNo: c.turnNo + i + 1,
          kind: r.kind,
          action: r.action,
          narration: r.narration,
          speaker: r.speaker,
          line: r.line,
          response: { ...(r.response ?? {}), suggestions: r.suggestions, combatEvents: r.combatEvents, ...(r.raw ? { raw: r.raw } : {}) },
          applied: r.applied,
          rolls: r.rolls,
          model: r.model,
          promptVersion: r.promptVersion,
          inputTokens: r.usage.inputTokens,
          outputTokens: r.usage.outputTokens,
          cachedTokens: r.usage.cachedTokens,
          costUsd: r.usage.costUsd.toFixed(6),
          degraded: r.degraded,
        })),
      );
    return next;
  });
}

/** Сумма расходов кампании — для учёта стоимости. */
export async function campaignCost(db: Db, campaignId: string): Promise<number> {
  const [r] = await db.select({ s: sql<string>`coalesce(sum(${turns.costUsd}), 0)` }).from(turns).where(eq(turns.campaignId, campaignId));
  return Number(r?.s ?? 0);
}
