import { clamp } from "./dice";
import { hashStr, mulberry32, type Rng } from "./rng";
import { locationTypeKeys, startLocationTypes, type LocationType, type Ruleset } from "./rules";
import type { CombatState } from "./combat";
import type { Gender } from "./character";
import type { CaseState } from "./case";

export interface Objective {
  id: string;
  text: string;
  done: boolean;
}

export interface MapLocation {
  id: string;
  name: string;
  type: LocationType;
  desc: string;
  /** Координаты на карте, 0..1. */
  x: number;
  y: number;
  visited: boolean;
  /** Фон локации (id картинки) — выбирается при первом входе. */
  imageId?: string;
}

export interface Speaker {
  name: string;
  race: string;
  gender: Gender;
  role: string;
}

export interface Campaign {
  questTitle: string;
  hook: string;
  objectives: Objective[];
  locations: MapLocation[];
  edges: [string, string][];
  current: string;
  target: string;
  /** Летопись: сжатое прошлое. */
  summary: string;
  complete: boolean;
  turn: number;
  npc: Speaker | null;
  combat: CombatState | null;
  /** Детективное дело — в мирах, где оно есть (Аркхэм). Секреты: см. publicCampaign. */
  case?: CaseState;
}

/** Сырой квест от модели — до проверки. */
export interface QuestSeed {
  questTitle?: unknown;
  hook?: unknown;
  objectives?: unknown;
  locations?: unknown;
  target?: unknown;
}

export const MIN_LOCATIONS = 5;
export const MAX_LOCATIONS = 12;
export const MAX_OBJECTIVES = 4;

const str = (v: unknown, max: number, fallback = "") => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback);

/** Приводит ответ модели к допустимому квесту. Бросает ошибку, если локаций слишком мало. */
export function normalizeQuest(r: Ruleset, seed: QuestSeed) {
  const rawLocs = Array.isArray(seed.locations) ? seed.locations : [];
  if (rawLocs.length < MIN_LOCATIONS) throw new Error(`Quest needs at least ${MIN_LOCATIONS} locations`);
  const locations = rawLocs.slice(0, MAX_LOCATIONS).map((l: any) => ({
    name: str(l?.name, 40, "Безымянное место"),
    type: (locationTypeKeys(r).includes(l?.type) ? l.type : r.defaultLocationType) as LocationType,
    desc: str(l?.desc, 200),
  }));
  if (!startLocationTypes(r).includes(locations[0]!.type)) locations[0]!.type = r.defaultStartType;
  const objectives = (Array.isArray(seed.objectives) ? seed.objectives : [])
    .map((o) => str(o, 160))
    .filter(Boolean)
    .slice(0, MAX_OBJECTIVES);
  return {
    questTitle: str(seed.questTitle, 60, "Безымянный квест"),
    hook: str(seed.hook, 600),
    objectives: objectives.length ? objectives : ["Выяснить, что происходит", "Довести дело до конца"],
    locations,
    target: clamp(Math.round(Number(seed.target)) || locations.length - 1, 1, locations.length - 1),
  };
}

/**
 * Раскладка карты: старт слева, финал справа, остальные точки разнесены;
 * дороги — минимальное остовное дерево + 2 коротких дополнительных ребра.
 * Старт и финал никогда не соединены напрямую.
 */
export function layoutCampaign(r: Ruleset, seed: QuestSeed, layoutSeed: string): Campaign {
  const q = normalizeQuest(r, seed);
  const R = mulberry32(hashStr(layoutSeed));
  const n = q.locations.length;
  const pos: [number, number][] = new Array(n);
  pos[0] = [0.1, 0.3 + R() * 0.4];
  pos[q.target] = [0.9, 0.25 + R() * 0.5];
  for (let i = 1; i < n; i++) {
    if (i === q.target) continue;
    let best: { p: [number, number]; d: number } | null = null;
    for (let t = 0; t < 60; t++) {
      const p: [number, number] = [0.2 + R() * 0.6, 0.12 + R() * 0.76];
      const d = Math.min(...pos.filter(Boolean).map((o) => Math.hypot(o[0] - p[0], (o[1] - p[1]) * 0.8)));
      if (!best || d > best.d) best = { p, d };
      if (d > 0.24) break;
    }
    pos[i] = best!.p;
  }
  const dist = (a: number, b: number) => Math.hypot(pos[a]![0] - pos[b]![0], pos[a]![1] - pos[b]![1]);
  const isStartTarget = (a: number, b: number) => (a === 0 && b === q.target) || (b === 0 && a === q.target);

  // Prim: соединяем всё, избегая прямой дороги старт—финал, если есть альтернатива.
  const inTree = new Set([0]);
  const edges: [number, number][] = [];
  while (inTree.size < n) {
    let best: [number, number, number] | null = null;
    for (const a of inTree)
      for (let b = 0; b < n; b++) {
        if (inTree.has(b)) continue;
        const d = dist(a, b) + (isStartTarget(a, b) ? 10 : 0);
        if (!best || d < best[2]) best = [a, b, d];
      }
    inTree.add(best![1]);
    edges.push([best![0], best![1]]);
  }
  const has = (a: number, b: number) => edges.some((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a));
  const extra: [number, number, number][] = [];
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) if (!has(a, b) && !isStartTarget(a, b)) extra.push([a, b, dist(a, b)]);
  extra.sort((x, y) => x[2] - y[2]);
  for (const e of extra.slice(0, 2)) edges.push([e[0], e[1]]);

  return {
    questTitle: q.questTitle,
    hook: q.hook,
    objectives: q.objectives.map((text, i) => ({ id: `q${i + 1}`, text, done: false })),
    locations: q.locations.map((l, i) => ({ ...l, id: `L${i}`, x: pos[i]![0], y: pos[i]![1], visited: i === 0 })),
    edges: edges.map(([a, b]) => [`L${a}`, `L${b}`]),
    current: "L0",
    target: `L${q.target}`,
    summary: "",
    complete: false,
    turn: 0,
    npc: null,
    combat: null,
  };
}

export function locationById(w: Pick<Campaign, "locations">, id: string): MapLocation | undefined {
  return w.locations.find((l) => l.id === id);
}

export function neighbors(w: Pick<Campaign, "locations" | "edges">, id: string): MapLocation[] {
  return w.edges
    .filter((e) => e[0] === id || e[1] === id)
    .map((e) => (e[0] === id ? e[1] : e[0]))
    .map((x) => locationById(w, x))
    .filter((l): l is MapLocation => !!l);
}

/** Шанс встречи задаёт код, а не модель. На дороге к безопасным местам встречи редки. */
export function encounterChance(r: Ruleset, to: MapLocation): number {
  return r.locationTypes[to.type]?.safe ? 0.1 : 0.3;
}

export interface TravelResult {
  from: MapLocation;
  to: MapLocation;
  encounter: boolean;
}

/** Перемещение только в соседнюю локацию и не во время боя. Меняет кампанию. */
export function travel(r: Ruleset, w: Campaign, toId: string, rng: Rng): TravelResult {
  if (w.combat) throw new Error("Нельзя уйти посреди боя.");
  const from = locationById(w, w.current)!;
  const to = locationById(w, toId);
  if (!to) throw new Error("Такого места нет на карте.");
  if (!neighbors(w, w.current).some((l) => l.id === toId)) throw new Error("Туда нет прямой дороги.");
  const encounter = rng() < encounterChance(r, to);
  w.current = to.id;
  to.visited = true;
  w.npc = null;
  return { from, to, encounter };
}

export const locationTypeName = (r: Ruleset, t: LocationType) => r.locationTypes[t]?.name ?? t;
