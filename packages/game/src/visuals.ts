import { and, eq, inArray, sql } from "drizzle-orm";
import { characters, images, npcs, type Db } from "@ash/db";
import { hashStr, locationById, type Campaign, type CharacterDraft, type LocationType } from "@ash/engine";
import {
  baseHero, describeLocation, describeNpc, heroVariants, renderBackground, renderPortrait,
  type ImageProvider, type ImageStorage, type NpcCard, type TimeOfDay,
} from "@ash/images";
import type { ModelRouter, Speaker } from "@ash/llm";
import { GameError, type GameState, type TurnRecord } from "./types";

/**
 * Картинки рисуются в фоне и не задерживают ход. Очередь — строки таблицы images
 * (status queued → working → ready | failed), забираются через FOR UPDATE SKIP LOCKED.
 */

type Job =
  | { type: "npc"; npcId: string; card: NpcCard }
  | { type: "background"; locType: LocationType; name: string; desc: string; time: TimeOfDay }
  | { type: "hero"; description: string; label: string; seed: number };

export interface VisualDeps {
  db: Db;
  router: ModelRouter;
  provider: ImageProvider;
  storage: ImageStorage;
}

/** Сколько вариантов фона одного типа держим в общей библиотеке. */
export const LIBRARY_PER_TYPE = 3;
export const MAX_ATTEMPTS = 3;

export const npcKey = (name: string) => name.trim().toLowerCase().replace(/ё/g, "е");

/** Будильник воркера: новая задача берётся сразу, а не на следующем опросе. */
const sleepers = new Set<() => void>();
const wakeWorker = () => {
  for (const w of sleepers) w();
  sleepers.clear();
};

async function enqueue(db: Db, v: { kind: string; job: Job; tags?: string[]; userId?: string; campaignId?: string }): Promise<string> {
  const [row] = await db
    .insert(images)
    .values({ kind: v.kind, job: v.job as Record<string, unknown>, tags: v.tags ?? [], userId: v.userId, campaignId: v.campaignId, prompt: "", model: "", status: "queued" })
    .returning({ id: images.id });
  wakeWorker();
  return row!.id;
}

/** Время суток для фона — по типу места, без отдельной системы времени. */
function timeFor(type: LocationType, seed: number): TimeOfDay {
  if (["tavern", "temple", "cave"].includes(type)) return "night";
  return (["dusk", "night", "dusk", "day"] as const)[seed % 4]!;
}

/** Фон текущей локации: ключевым местам — свой, остальным — из общей библиотеки по типу. */
async function ensureBackground(db: Db, campaignId: string, w: Campaign) {
  const loc = locationById(w, w.current);
  if (!loc || loc.imageId) return;
  const seed = hashStr(campaignId + loc.id);
  const key = loc.id === w.target || loc.id === "L0";
  if (!key) {
    const lib = await db
      .select({ id: images.id })
      .from(images)
      .where(and(eq(images.kind, "background"), sql`${images.tags} @> ARRAY[${`bg:${loc.type}`}]::text[]`, inArray(images.status, ["queued", "working", "ready"])))
      .orderBy(images.createdAt);
    if (lib.length >= LIBRARY_PER_TYPE) {
      loc.imageId = lib[seed % lib.length]!.id;
      return;
    }
  }
  loc.imageId = await enqueue(db, {
    kind: "background",
    tags: key ? [`loc:${campaignId}:${loc.id}`] : [`bg:${loc.type}`],
    campaignId: key ? campaignId : undefined,
    job: { type: "background", locType: loc.type, name: loc.name, desc: loc.desc, time: timeFor(loc.type, seed) },
  });
}

/**
 * Новый NPC → карточка и портрет в очередь. Уже известный — ничего не делаем.
 * Зовётся дважды: из потока хода, как только карточка дописана, и после хода (на случай,
 * если ранний вызов не случился); уникальный индекс не даёт задвоить.
 */
export async function ensureNpc(db: Db, campaignId: string, s: Speaker) {
    const [row] = await db
      .insert(npcs)
      .values({ campaignId, name: s.name, nameKey: npcKey(s.name), race: s.race, gender: s.gender, role: s.role, appearance: s.look ?? "" })
      .onConflictDoNothing()
      .returning({ id: npcs.id });
    if (!row) return;
    const imageId = await enqueue(db, {
      kind: "npc",
      campaignId,
      job: { type: "npc", npcId: row.id, card: { name: s.name, race: s.race, gender: s.gender, role: s.role, look: s.look } },
    });
    await db.update(npcs).set({ portraitImageId: imageId }).where(eq(npcs.id, row.id));
}

async function ensureNpcs(db: Db, campaignId: string, records: TurnRecord[]) {
  for (const r of records) if (r.response?.speaker) await ensureNpc(db, campaignId, r.response.speaker);
}

/** Вызывается после хода, до сохранения: может записать фон в состояние кампании. */
export async function prepareVisuals(db: Db, campaignId: string, state: GameState, records: TurnRecord[]) {
  await ensureNpcs(db, campaignId, records);
  await ensureBackground(db, campaignId, state.campaign);
}

export interface ImageView {
  status: string;
  url: string | null;
}

export interface SceneView {
  hero: ImageView | null;
  /** Фоны локаций по id локации. */
  locations: Record<string, ImageView>;
  /** Портреты NPC по имени в нижнем регистре. */
  npcs: Record<string, ImageView & { name: string }>;
}

export async function sceneView(db: Db, campaignId: string, characterId: string, w: Campaign): Promise<SceneView> {
  const [ch] = await db.select({ img: characters.portraitImageId }).from(characters).where(eq(characters.id, characterId));
  const npcRows = await db.select({ name: npcs.name, key: npcs.nameKey, img: npcs.portraitImageId }).from(npcs).where(eq(npcs.campaignId, campaignId));
  const ids = [ch?.img, ...npcRows.map((n) => n.img), ...w.locations.map((l) => l.imageId)].filter((x): x is string => !!x);
  const rows = ids.length ? await db.select({ id: images.id, status: images.status, url: images.url }).from(images).where(inArray(images.id, ids)) : [];
  const byId = new Map(rows.map((r) => [r.id, { status: r.status, url: r.url }]));
  const view = (id?: string | null): ImageView | null => (id ? (byId.get(id) ?? null) : null);
  return {
    hero: view(ch?.img),
    locations: Object.fromEntries(w.locations.filter((l) => l.imageId).map((l) => [l.id, view(l.imageId)!]).filter(([, v]) => v)),
    npcs: Object.fromEntries(npcRows.map((n) => [n.key, { name: n.name, ...(view(n.img) ?? { status: "none", url: null }) }])),
  };
}

/** Четыре разных облика героя: тексты пишет служебная модель, картинки — очередь. */
export async function createHeroOptions(db: Db, router: ModelRouter, userId: string, draft: Pick<CharacterDraft, "race" | "cls" | "gender">, notes: string, signal?: AbortSignal) {
  const variants = await heroVariants(router, draft, notes, signal);
  const base = baseHero(draft);
  const extra = notes.trim() ? `, ${notes.trim().slice(0, 200)}` : "";
  return Promise.all(
    variants.map(async (v, i) => ({
      id: await enqueue(db, { kind: "hero", userId, job: { type: "hero", description: `${base}, ${v.prompt}${extra}`, label: v.label, seed: 1000 + i } }),
      label: v.label,
    })),
  );
}

export async function imageStatuses(db: Db, userId: string, ids: string[]) {
  const ok = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 8);
  if (!ok.length) return [];
  return db.select({ id: images.id, status: images.status, url: images.url }).from(images).where(and(inArray(images.id, ok), eq(images.userId, userId)));
}

/** Портрет героя при создании кампании: только свой и только готовый. */
export async function attachHeroPortrait(db: Db, userId: string, characterId: string, imageId: string) {
  const [img] = await db.select().from(images).where(and(eq(images.id, imageId), eq(images.userId, userId), eq(images.kind, "hero")));
  if (!img || img.status !== "ready") throw new GameError("Этот портрет недоступен.");
  await db.update(characters).set({ portraitImageId: imageId }).where(eq(characters.id, characterId));
}

/** Забрать одну задачу. Зависшие больше 3 минут в работе возвращаются в очередь. */
async function claimNext(db: Db) {
  const res = await db.execute(sql`
    UPDATE images SET status = 'working', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM images
      WHERE status = 'queued' OR (status = 'working' AND updated_at < now() - interval '3 minutes')
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, kind, job, attempts`);
  return (res.rows[0] as { id: string; kind: string; job: Job; attempts: number } | undefined) ?? null;
}

/** Обработать одну задачу. false — очередь пуста. */
export async function processOne(d: VisualDeps, signal?: AbortSignal): Promise<boolean> {
  const row = await claimNext(d.db);
  if (!row) return false;
  try {
    const j = row.job;
    let r;
    if (j.type === "npc") {
      const description = await describeNpc(d.router, j.card, signal);
      r = await renderPortrait({ provider: d.provider, storage: d.storage, description, key: `npc/${row.id}`, signal });
    } else if (j.type === "hero") {
      r = await renderPortrait({ provider: d.provider, storage: d.storage, description: j.description, key: `hero/${row.id}`, seed: j.seed, signal });
    } else {
      const description = await describeLocation(d.router, { name: j.name, type: j.locType, desc: j.desc }, signal);
      r = await renderBackground({ provider: d.provider, storage: d.storage, description, time: j.time, key: `bg/${row.id}`, signal });
    }
    await d.db
      .update(images)
      .set({ status: "ready", url: r.url, prompt: r.prompt, model: r.model, costUsd: r.costUsd.toFixed(6), error: null })
      .where(eq(images.id, row.id));
  } catch (e) {
    const failed = row.attempts >= MAX_ATTEMPTS;
    await d.db
      .update(images)
      .set({ status: failed ? "failed" : "queued", error: String((e as Error).message ?? e).slice(0, 500) })
      .where(eq(images.id, row.id));
  }
  return true;
}

/** Воркер в процессе сервера: несколько параллельных потоков; пустая очередь — опрос раз в секунду или пробуждение от enqueue. */
export function startWorker(d: VisualDeps, o: { concurrency?: number; idleMs?: number; signal?: AbortSignal } = {}) {
  const loop = async () => {
    while (!o.signal?.aborted) {
      let worked = false;
      try {
        worked = await processOne(d, o.signal);
      } catch (e) {
        console.error("[images] worker error", e);
      }
      if (!worked)
        await new Promise<void>((r) => {
          const t = setTimeout(r, o.idleMs ?? 1000);
          sleepers.add(() => (clearTimeout(t), r()));
        });
    }
  };
  return Promise.all(Array.from({ length: o.concurrency ?? 3 }, loop));
}
