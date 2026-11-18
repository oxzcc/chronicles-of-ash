import { and, eq, inArray, sql } from "drizzle-orm";
import { characters, images, npcs, type Db } from "@ash/db";
import { hashStr, locationById, matchName, neighbors, sameName, type Campaign, type CharacterDraft, type LocationType } from "@ash/engine";
import {
  baseHero, describeLocation, describeNpc, guessNpc, heroVariants, renderBackground, renderPortrait,
  type ImageProvider, type ImageStorage, type NpcCard, type TimeOfDay,
} from "@ash/images";
import type { ModelRouter, Speaker } from "@ash/llm";
import { DEFAULT_WORLD, getWorld, isWorldId, worldOf, type CastMember, type World } from "@ash/worlds";
import { GameError, type GameState, type TurnRecord } from "./types";

/**
 * Картинки рисуются в фоне и не задерживают ход. Очередь — строки таблицы images
 * (status queued → working → ready | failed), забираются через FOR UPDATE SKIP LOCKED.
 */

/**
 * world — id мира, в стиле которого рисовать; в задачах до миров его нет — это фэнтези.
 * rev — номер перерисовки (restyleImages): файл пишется под новым ключом, иначе браузер
 * покажет старую картинку из кэша (отдаются как immutable).
 */
type Job = { world?: string; rev?: number } & (
  | { type: "npc"; npcId: string; card: NpcCard }
  /** NPC без карточки: расу, пол и облик угадывает служебная модель по репликам. */
  | { type: "npc-guess"; npcId: string; name: string; lines: string[]; scene: string }
  | { type: "background"; locType: LocationType; name: string; desc: string; time: TimeOfDay }
  | { type: "hero"; description: string; label: string; seed: number }
  /** Готовое описание портрета (постоянные лица мира): без служебной модели. */
  | { type: "portrait"; description: string; seed: number }
);

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

/**
 * Заранее, «про запас»: портреты жителей дела и фоны мест, куда герой ещё не пришёл.
 * Такие задачи воркер берёт после срочных (тех, кто на экране прямо сейчас).
 */
export const PREFETCH_TAG = "prefetch";

async function enqueue(db: Db, v: { kind: string; job: Job; tags?: string[]; userId?: string; campaignId?: string; prefetch?: boolean }): Promise<string> {
  const tags = [...(v.tags ?? []), ...(v.prefetch ? [PREFETCH_TAG] : [])];
  const [row] = await db
    .insert(images)
    .values({ kind: v.kind, job: v.job as Record<string, unknown>, tags, userId: v.userId, campaignId: v.campaignId, prompt: "", model: "", status: "queued" })
    .returning({ id: images.id });
  wakeWorker();
  return row!.id;
}

/** Картинка про запас понадобилась прямо сейчас — в начало очереди. */
async function promote(db: Db, imageId: string) {
  await db
    .update(images)
    .set({ tags: sql`array_remove(${images.tags}, ${PREFETCH_TAG})` })
    .where(and(eq(images.id, imageId), eq(images.status, "queued"), sql`${images.tags} @> ARRAY[${PREFETCH_TAG}]::text[]`));
}

/** Время суток для фона — по типу места, без отдельной системы времени. Интерьеры — ночью. */
function timeFor(world: World, type: LocationType, seed: number): TimeOfDay {
  if (world.art.interiorTypes.includes(type)) return "night";
  return (["dusk", "night", "dusk", "day"] as const)[seed % 4]!;
}

/**
 * Версия библиотеки фонов. Поднимать, когда фоны рисуются заметно иначе (размер, стиль):
 * старые перестают выдаваться, новые рисуются сами при входе в место.
 * v2 (18 ноября): 1920×1088 вместо 1024×576 и LoRA Аркхэма.
 */
export const LIBRARY_VERSION = 2;

/**
 * Тег общей библиотеки фонов. У фэнтези — без id мира (так было до миров),
 * у остальных миров — свой тег, чтобы «город» Аркхэма не взял средневековую улицу.
 */
export const libraryTag = (world: World, type: LocationType) => {
  const v = `bg${LIBRARY_VERSION}`;
  return world.id === DEFAULT_WORLD ? `${v}:${type}` : `${v}:${world.id}:${type}`;
};

/**
 * Фон места (по умолчанию — текущего): ключевым местам — свой, остальным — из общей библиотеки по типу.
 * prefetch — заранее, для места, куда герой ещё не пришёл; при входе такой фон поднимается в начало очереди.
 */
export async function ensureBackground(db: Db, campaignId: string, world: World, w: Campaign, o: { locId?: string; prefetch?: boolean } = {}) {
  const loc = locationById(w, o.locId ?? w.current);
  if (!loc) return;
  if (loc.imageId) {
    if (!o.prefetch) await promote(db, loc.imageId);
    return;
  }
  const seed = hashStr(campaignId + loc.id);
  const key = loc.id === w.target || loc.id === "L0";
  if (!key) {
    const lib = await db
      .select({ id: images.id })
      .from(images)
      .where(and(eq(images.kind, "background"), sql`${images.tags} @> ARRAY[${libraryTag(world, loc.type)}]::text[]`, inArray(images.status, ["queued", "working", "ready"])))
      .orderBy(images.createdAt);
    if (lib.length >= LIBRARY_PER_TYPE) {
      loc.imageId = lib[seed % lib.length]!.id;
      return;
    }
  }
  loc.imageId = await enqueue(db, {
    kind: "background",
    tags: key ? [`loc:${campaignId}:${loc.id}`] : [libraryTag(world, loc.type)],
    campaignId: key ? campaignId : undefined,
    prefetch: o.prefetch,
    job: { world: world.id, type: "background", locType: loc.type, name: loc.name, desc: loc.desc, time: timeFor(world, loc.type, seed) },
  });
}

type NpcRow = { id: string; name: string; img: string | null };

async function npcRows(db: Db, campaignId: string): Promise<NpcRow[]> {
  return db.select({ id: npcs.id, name: npcs.name, img: npcs.portraitImageId }).from(npcs).where(eq(npcs.campaignId, campaignId));
}

/** Уже известный NPC под этим или похожим именем («Эзра» = «Эзра Кроу»). */
function knownNpc(rows: NpcRow[], name: string): NpcRow | undefined {
  const i = matchName(name, rows.map((r) => r.name));
  return i >= 0 ? rows[i] : undefined;
}

/** NPC для портрета: карточка мастера, житель дела или враг. creature — зверь или чудовище. */
export type NpcSpec = Speaker & { creature?: boolean };

/**
 * Новый NPC → карточка и портрет в очередь. Уже известный (в том числе под коротким именем) — ничего
 * не рисуем, а его портрет, если он ждал в очереди про запас, поднимаем: он нужен прямо сейчас.
 * Зовётся дважды: из потока хода, как только карточка дописана, и после хода (на случай,
 * если ранний вызов не случился); уникальный индекс не даёт задвоить.
 */
export async function ensureNpc(db: Db, campaignId: string, world: World, s: NpcSpec, o: { prefetch?: boolean; rows?: NpcRow[] } = {}) {
  const known = knownNpc(o.rows ?? (await npcRows(db, campaignId)), s.name);
  if (known) {
    if (!o.prefetch && known.img) await promote(db, known.img);
    return;
  }
  const [row] = await db
    .insert(npcs)
    .values({ campaignId, name: s.name, nameKey: npcKey(s.name), race: s.race, gender: s.gender, role: s.role, appearance: s.look ?? "" })
    .onConflictDoNothing()
    .returning({ id: npcs.id });
  if (!row) return;
  const imageId = await enqueue(db, {
    kind: "npc",
    campaignId,
    prefetch: o.prefetch,
    job: { world: world.id, type: "npc", npcId: row.id, card: { name: s.name, race: s.race, gender: s.gender, role: s.role, look: s.look, ...(s.creature ? { creature: true } : {}) } },
  });
  await db.update(npcs).set({ portraitImageId: imageId }).where(eq(npcs.id, row.id));
  o.rows?.push({ id: row.id, name: s.name, img: imageId });
}

/**
 * Каждому, кто говорит в репликах, — портрет. Карточку (раса, пол, облик) мастер даёт только
 * главному собеседнику; остальных говорящих раньше пропускали — и на экране висел силуэт.
 * Враги в бою — тоже: знакомый NPC остаётся со своим портретом, новому рисуется свой по look.
 */
async function ensureNpcs(db: Db, campaignId: string, world: World, records: TurnRecord[], heroName: string) {
  for (const r of records) if (r.response?.speaker) await ensureNpc(db, campaignId, world, r.response.speaker);
  const rows = await npcRows(db, campaignId);
  const human = Object.keys(world.rules.races)[0]!;
  for (const r of records)
    for (const e of r.response?.combat?.enemies ?? [])
      if (e.name && !sameName(e.name, heroName))
        await ensureNpc(db, campaignId, world, { name: e.name, race: human, gender: e.gender ?? "m", role: e.creature ? "чудовище" : "противник", look: e.look || undefined, creature: e.creature }, { rows });
  const lines = new Map<string, { name: string; lines: string[]; scene: string }>();
  for (const r of records) {
    const scene = r.beats.filter((b) => !b.speaker).map((b) => b.text).join(" ");
    for (const b of r.beats) {
      if (!b.speaker || sameName(b.speaker, heroName)) continue;
      const known = knownNpc(rows, b.speaker);
      if (known) {
        if (known.img) await promote(db, known.img);
        continue;
      }
      const k = npcKey(b.speaker);
      const e = lines.get(k) ?? { name: b.speaker, lines: [], scene };
      e.lines.push(b.text);
      lines.set(k, e);
    }
  }
  for (const [k, e] of lines) {
    const [row] = await db
      .insert(npcs)
      .values({ campaignId, name: e.name, nameKey: k, race: human, gender: "m", role: "", appearance: "" })
      .onConflictDoNothing()
      .returning({ id: npcs.id });
    if (!row) continue;
    const imageId = await enqueue(db, { kind: "npc", campaignId, job: { world: world.id, type: "npc-guess", npcId: row.id, name: e.name, lines: e.lines.slice(0, 4), scene: e.scene } });
    await db.update(npcs).set({ portraitImageId: imageId }).where(eq(npcs.id, row.id));
  }
}

/**
 * Тег портрета постоянного лица в общей библиотеке. В теге — отпечаток описания:
 * поменяли внешность в данных мира — портрет нарисуется заново, старый перестанет выдаваться.
 */
export const castTag = (world: World, m: CastMember) => `cast:${world.id}:${m.id}:${hashStr(m.portrait).toString(36)}`;

/**
 * Наставник и союзники — в каждой кампании мира, с одним общим портретом на мир (рисуется один раз).
 * Если в кампании уже есть свой NPC с таким именем (до постоянных портретов), его не трогаем.
 */
async function ensureCast(db: Db, campaignId: string, world: World, rows: NpcRow[]) {
  if (!world.cast) return;
  const race = Object.keys(world.rules.races)[0]!;
  for (const m of [world.cast.mentor, ...world.cast.allies]) {
    if (knownNpc(rows, m.name)) continue;
    const tag = castTag(world, m);
    const [lib] = await db
      .select({ id: images.id })
      .from(images)
      .where(and(eq(images.kind, "npc"), sql`${images.tags} @> ARRAY[${tag}]::text[]`, inArray(images.status, ["queued", "working", "ready"])))
      .orderBy(images.createdAt)
      .limit(1);
    const imageId = lib?.id ?? (await enqueue(db, { kind: "npc", tags: [tag], prefetch: true, job: { world: world.id, type: "portrait", description: m.portrait, seed: hashStr(m.id) % 1_000_000 } }));
    const [row] = await db
      .insert(npcs)
      .values({ campaignId, name: m.name, nameKey: npcKey(m.name), race, gender: m.gender, role: m.role, appearance: m.look, portraitImageId: imageId })
      .onConflictDoNothing()
      .returning({ id: npcs.id });
    if (row) rows.push({ id: row.id, name: m.name, img: imageId });
  }
}

/**
 * Про запас: фоны мест, куда герой может пойти сразу, постоянные лица мира и портреты жителей дела, которых там можно встретить.
 * Зовётся при создании кампании (пока рассказчик пишет завязку) и после каждого хода — для новых адресов.
 * Все задачи — с низким приоритетом: срочные портреты и фоны идут первыми.
 * Возвращает true, если в состояние кампании записаны новые фоны.
 */
export async function prefetchVisuals(db: Db, campaignId: string, world: World, w: Campaign): Promise<boolean> {
  const before = w.locations.filter((l) => l.imageId).length;
  const places = new Set<string>([w.current, ...(w.case ? w.case.known : neighbors(w, w.current).map((l) => l.id))]);
  for (const id of places) await ensureBackground(db, campaignId, world, w, { locId: id, prefetch: id !== w.current });
  const rows = await npcRows(db, campaignId);
  // Свои — раньше жителей дела: житель с тем же именем («Деннис Маллой») получит их общий портрет.
  await ensureCast(db, campaignId, world, rows);
  if (w.case) {
    // Сначала те, кто здесь, потом — по известным адресам; про неизвестные адреса рисовать рано.
    const people = w.case.people.filter((p) => p.gender && p.look && places.has(p.at)).sort((a, b) => Number(b.at === w.current) - Number(a.at === w.current));
    const race = Object.keys(world.rules.races)[0]!;
    for (const p of people) await ensureNpc(db, campaignId, world, { name: p.name, race, gender: p.gender!, role: p.role, look: p.look }, { prefetch: true, rows });
  }
  return w.locations.filter((l) => l.imageId).length > before;
}

/** Вызывается после хода, до сохранения: может записать фон в состояние кампании. */
export async function prepareVisuals(db: Db, campaignId: string, state: GameState, records: TurnRecord[]) {
  const world = worldOf(state.character);
  await ensureNpcs(db, campaignId, world, records, state.character.name);
  await ensureBackground(db, campaignId, world, state.campaign);
  await prefetchVisuals(db, campaignId, world, state.campaign);
}

/** Фон текущей локации для клиента — сразу при входе, ещё до рассказа мастера. */
export async function arrivalView(db: Db, w: Campaign): Promise<{ location: string; name: string; locType: LocationType; imageId: string | null; image: ImageView | null }> {
  const loc = locationById(w, w.current)!;
  if (!loc.imageId) return { location: loc.id, name: loc.name, locType: loc.type, imageId: null, image: null };
  const [row] = await db.select({ status: images.status, url: images.url }).from(images).where(eq(images.id, loc.imageId));
  return { location: loc.id, name: loc.name, locType: loc.type, imageId: loc.imageId, image: row ?? null };
}

/**
 * Статус фона, который ещё не сохранён в состоянии кампании (ход идёт).
 * Только фоны: свои ключевые или общие из библиотеки.
 */
export async function backgroundStatus(db: Db, campaignId: string, imageId: string): Promise<ImageView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(imageId)) return null;
  const [row] = await db
    .select({ status: images.status, url: images.url })
    .from(images)
    .where(and(eq(images.id, imageId), eq(images.kind, "background"), sql`(${images.campaignId} IS NULL OR ${images.campaignId} = ${campaignId})`));
  return row ?? null;
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
export async function createHeroOptions(db: Db, router: ModelRouter, userId: string, draft: Pick<CharacterDraft, "world" | "race" | "cls" | "gender">, notes: string, signal?: AbortSignal) {
  if (draft.world !== undefined && !isWorldId(draft.world)) throw new GameError("Неизвестный мир.");
  const world = worldOf(draft);
  if (!(draft.race in world.rules.races) || !(draft.cls in world.rules.classes)) throw new GameError("Сначала выбери расу и класс.");
  const variants = await heroVariants(router, world, draft, notes, signal);
  const extra = notes.trim() ? `, ${notes.trim().slice(0, 200)}` : "";
  return Promise.all(
    variants.map(async (v, i) => ({
      id: await enqueue(db, { kind: "hero", userId, job: { world: world.id, type: "hero", description: `${baseHero(world, draft, v.outfit)}, ${v.prompt}${extra}`, label: v.label, seed: 1000 + i } }),
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

/** Забрать одну задачу: сначала срочные, потом про запас. Зависшие больше 3 минут в работе возвращаются в очередь. */
async function claimNext(db: Db) {
  const res = await db.execute(sql`
    UPDATE images SET status = 'working', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM images
      WHERE status = 'queued' OR (status = 'working' AND updated_at < now() - interval '3 minutes')
      ORDER BY (tags @> ARRAY[${PREFETCH_TAG}]::text[]), created_at
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
    const world = getWorld(isWorldId(j.world) ? j.world : DEFAULT_WORLD);
    const rev = j.rev ? `-r${j.rev}` : "";
    let r;
    if (j.type === "npc") {
      const description = await describeNpc(d.router, world, j.card, signal);
      r = await renderPortrait({ world, provider: d.provider, storage: d.storage, description, key: `npc/${row.id}${rev}`, signal });
    } else if (j.type === "npc-guess") {
      const g = await guessNpc(d.router, world, j, signal);
      await d.db.update(npcs).set({ race: g.card.race, gender: g.card.gender, role: g.card.role }).where(eq(npcs.id, j.npcId));
      r = await renderPortrait({ world, provider: d.provider, storage: d.storage, description: g.description, key: `npc/${row.id}${rev}`, signal });
    } else if (j.type === "portrait") {
      r = await renderPortrait({ world, provider: d.provider, storage: d.storage, description: j.description, key: `npc/${row.id}${rev}`, seed: j.seed, signal });
    } else if (j.type === "hero") {
      r = await renderPortrait({ world, provider: d.provider, storage: d.storage, description: j.description, key: `hero/${row.id}${rev}`, seed: j.seed, signal });
    } else {
      const description = await describeLocation(d.router, world, { name: j.name, type: j.locType, desc: j.desc }, signal);
      r = await renderBackground({ world, provider: d.provider, storage: d.storage, description, time: j.time, key: `bg/${row.id}${rev}`, signal });
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

/**
 * Перерисовать готовые картинки мира в нынешнем стиле (новая LoRA, сила, промпты): строки возвращаются
 * в очередь на месте, поэтому кампании, которые на них ссылаются, получат новые картинки сами.
 * Идут «про запас» — после срочных; место, куда входит герой, поднимается вперёд как обычно.
 * NPC перерисовываются по карточке через служебную модель — облик может немного поменяться.
 * Портреты героев игроков — только с heroes: их выбирал сам игрок.
 */
export async function restyleImages(db: Db, worldId: string, o: { heroes?: boolean; dryRun?: boolean } = {}) {
  const kinds = o.heroes ? ["npc", "background", "hero"] : ["npc", "background"];
  const where = and(sql`${images.job}->>'world' = ${worldId}`, inArray(images.kind, kinds), inArray(images.status, ["ready", "failed"]));
  const counts = await db.select({ kind: images.kind, n: sql<number>`count(*)::int` }).from(images).where(where).groupBy(images.kind);
  const byKind = Object.fromEntries(counts.map((c) => [c.kind, c.n])) as Record<string, number>;
  if (!o.dryRun && counts.length) {
    // Постоянные лица: старые портреты (до правки внешности в данных мира) — по нынешнему описанию,
    // чтобы и в старых кампаниях у Рут был блокнот, а не книга.
    const world = isWorldId(worldId) ? getWorld(worldId) : undefined;
    for (const m of world?.cast ? [world.cast.mentor, ...world.cast.allies] : []) {
      const tag = castTag(world!, m);
      await db
        .update(images)
        .set({
          job: sql`jsonb_set(${images.job}, '{description}', to_jsonb(${m.portrait}::text))`,
          tags: sql`array_append(${images.tags}, ${tag})`,
        })
        .where(and(eq(images.kind, "npc"), sql`EXISTS (SELECT 1 FROM unnest(${images.tags}) t WHERE t LIKE ${`cast:${worldId}:${m.id}:%`})`, sql`NOT ${images.tags} @> ARRAY[${tag}]::text[]`));
    }
    await db
      .update(images)
      .set({
        status: "queued",
        attempts: 0,
        error: null,
        job: sql`jsonb_set(${images.job}, '{rev}', to_jsonb(coalesce((${images.job}->>'rev')::int, 0) + 1))`,
        tags: sql`CASE WHEN ${images.tags} @> ARRAY[${PREFETCH_TAG}]::text[] THEN ${images.tags} ELSE array_append(${images.tags}, ${PREFETCH_TAG}) END`,
      })
      .where(where);
    wakeWorker();
  }
  return byKind;
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
