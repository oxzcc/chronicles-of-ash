import { clamp } from "./dice";
import { effect, type TurnEffect } from "./effects";
import { findPlace, layoutCampaign, locationById, travel, type Campaign, type MapLocation, type QuestSeed } from "./world";
import { matchName, normName, sameWord } from "./names";
import type { Rng } from "./rng";
import type { Ruleset } from "./rules";
import type { Gender } from "./character";

/**
 * Детективное дело (мир Аркхэма, по мотивам Mythos Tales и Call of Cthulhu).
 * Модель придумывает дело целиком при создании кампании: скрытую разгадку, улики по местам,
 * выводы, жителей, газету и вопросы. Код хранит его и решает всё, что считается:
 * какие места известны, где можно найти улику, сколько визитов сделано, сколько очков набрано.
 * Клиент получает только publicCampaign — без разгадки, ответов и ненайденных улик.
 */

export interface CaseClue {
  id: string;
  /** Что находит герой (видно игроку после находки). */
  text: string;
  /** Короткое название, 2–5 слов: «Осадок в чайной чашке». У старых дел — нет. */
  title?: string;
  /** Где лежит улика: id места. У вывода — "" (он складывается в голове). */
  at: string;
  /** Ключевая: без неё дело не раскрыть, находится без кубика. */
  key: boolean;
  /** Вывод (реконструкция): не лежит в месте, а следует из этих улик. */
  requires?: string[];
  found: boolean;
}

export interface CasePerson {
  name: string;
  role: string;
  /** Где его найти: id места. */
  at: string;
  /** Пол и внешность — чтобы нарисовать портрет заранее, ещё до встречи. */
  gender?: Gender;
  look?: string;
  /** Дальше — тайное, видит только мастер (publicCampaign вырезает). Чего хочет или боится. */
  motive?: string;
  /** Где был в ту ночь — по его словам. */
  alibi?: string;
  /** Что скрывает и почему (не обязательно преступление). */
  secret?: string;
  /** Ложь, которую можно опровергнуть уликой: breaks — id улики. broken — уже уличён. */
  lie?: { text: string; breaks?: string; broken?: boolean };
}

/** Житель дела без тайного — то, что видит клиент. */
export type PublicPerson = Pick<CasePerson, "name" | "role" | "at" | "gender" | "look">;

export interface CaseQuestion {
  id: string;
  text: string;
  /** Правильный ответ — только для оценки и для разбора после закрытия. */
  answer: string;
  points: number;
}

export interface NewspaperArticle {
  headline: string;
  text: string;
}

export type Verdict = "right" | "partial" | "wrong";

export interface CaseResult {
  answers: { id: string; answer: string; verdict: Verdict }[];
  points: number;
  max: number;
  /** Штраф за лишние визиты сверх пути наставника. */
  penalty: number;
  /** Штраф за рассудок, потерянный в этом деле (как в Mythos Tales: риск для рассудка стоит очков). */
  sanityPenalty: number;
  score: number;
  /** Счёт наставника: все ответы верны, визитов ровно par. */
  mentor: number;
  timeUp: boolean;
}

export interface CaseState {
  /** Что произошло на самом деле. Видит только мастер. */
  truth: string;
  questions: CaseQuestion[];
  clues: CaseClue[];
  people: CasePerson[];
  newspaper: { date: string; articles: NewspaperArticle[] };
  /** Места, о которых герой знает: туда можно пойти. */
  known: string[];
  /** Сколько раз герой ходил по адресам. */
  visits: number;
  /** Путь наставника: столько мест хранят ключевые улики. */
  par: number;
  /** После стольких визитов время выходит. */
  limit: number;
  /** Сколько рассудка герой потерял в этом деле (срывы тоже на счету). */
  sanityLost: number;
  result: CaseResult | null;
  /** Поворот в середине дела: наступает, когда найдена половина ключевых улик (не меньше двух). */
  twist?: string;
  /** Ход, на котором поворот наступил. */
  twistAt?: number;
}

/** Сырое дело от модели — до проверки. Места — как у квеста, ссылки — индексами мест и улик. */
export interface CaseSeed extends QuestSeed {
  truth?: unknown;
  people?: unknown;
  clues?: unknown;
  deductions?: unknown;
  questions?: unknown;
  newspaper?: unknown;
  known?: unknown;
  twist?: unknown;
}

export const CASE_LIMITS = {
  clues: [3, 10] as const,
  deductions: 2,
  people: 10,
  questions: [1, 4] as const,
  articles: 5,
  /** Сколько улик можно найти за один ход. */
  cluesPerTurn: 2,
  /** Очки: первый вопрос — главный. */
  mainPoints: 20,
  otherPoints: 10,
  /** Штраф за каждый визит сверх пути наставника. */
  visitPenalty: 3,
  /** Штраф за каждое очко потерянного рассудка. */
  sanityPenalty: 2,
  /** Срыв на дело: два визита потеряны в лечебнице. */
  breakdownVisits: 2,
  /** Запас визитов сверх пути наставника, после которого время выходит. */
  extraVisits: 6,
};

const str = (v: unknown, max: number, fallback = "") => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const idx = (v: unknown, n: number): number | null => {
  const i = Math.round(Number(v));
  return Number.isInteger(i) && i >= 0 && i < n ? i : null;
};

/** Приводит дело к допустимому виду и раскладывает карту. Бросает ошибку, если дело не собрать. */
export function layoutCase(r: Ruleset, seed: CaseSeed, layoutSeed: string): Campaign {
  const w = layoutCampaign(r, seed, layoutSeed);
  const n = w.locations.length;
  const loc = (i: number) => `L${i}`;

  const truth = str(seed.truth, 1500);
  if (!truth) throw new Error("Case needs a truth");

  const clues: CaseClue[] = [];
  for (const c of arr(seed.clues).slice(0, CASE_LIMITS.clues[1]) as any[]) {
    const at = idx(c?.at, n);
    const text = str(c?.text, 300);
    if (at === null || !text) continue;
    const title = str(c?.title, 60);
    clues.push({ id: `c${clues.length + 1}`, text, ...(title ? { title } : {}), at: loc(at), key: c?.key === true, found: false });
  }
  if (clues.length < CASE_LIMITS.clues[0]) throw new Error(`Case needs at least ${CASE_LIMITS.clues[0]} clues`);
  // Ключевые улики нужны всегда: если модель не отметила ни одной — ключевые первые три.
  if (!clues.some((c) => c.key)) for (const c of clues.slice(0, 3)) c.key = true;

  const placed = clues.length;
  for (const d of arr(seed.deductions).slice(0, CASE_LIMITS.deductions) as any[]) {
    const text = str(d?.text, 300);
    const title = str(d?.title, 60);
    const requires = [...new Set(arr(d?.requires).map((x) => idx(Number(x) - 1, placed)).filter((x): x is number => x !== null))].map((i) => clues[i]!.id);
    if (!text || requires.length < 2) continue;
    clues.push({ id: `c${clues.length + 1}`, text, ...(title ? { title } : {}), at: "", key: false, requires, found: false });
  }

  const people: CasePerson[] = [];
  for (const p of arr(seed.people).slice(0, CASE_LIMITS.people) as any[]) {
    const at = idx(p?.at, n);
    const name = str(p?.name, 40);
    if (at === null || !name) continue;
    const look = str(p?.look, 200);
    const gender = p?.gender === "f" || p?.gender === "m" ? (p.gender as Gender) : undefined;
    const person: CasePerson = { name, role: str(p?.role, 60), at: loc(at), ...(gender ? { gender } : {}), ...(look ? { look } : {}) };
    for (const k of ["motive", "alibi", "secret"] as const) {
      const v = str(p?.[k], 300);
      if (v) person[k] = v;
    }
    // Ложь — текстом; опровергает её улика по номеру (с 1, только улики с местом). 0 или мусор — опровергнуть нечем.
    const lieText = str(typeof p?.lie === "string" ? p.lie : p?.lie?.text, 200);
    if (lieText) {
      const b = idx(Number(p?.lie?.breaks) - 1, placed);
      person.lie = { text: lieText, ...(b !== null ? { breaks: clues[b]!.id } : {}) };
    }
    people.push(person);
  }

  const questions: CaseQuestion[] = [];
  for (const q of arr(seed.questions).slice(0, CASE_LIMITS.questions[1]) as any[]) {
    const text = str(q?.text, 200);
    const answer = str(q?.answer, 400);
    if (!text || !answer) continue;
    questions.push({ id: `a${questions.length + 1}`, text, answer, points: questions.length ? CASE_LIMITS.otherPoints : CASE_LIMITS.mainPoints });
  }
  if (questions.length < CASE_LIMITS.questions[0]) throw new Error("Case needs questions");

  const np = (seed.newspaper ?? {}) as { date?: unknown; articles?: unknown };
  const articles = arr(np.articles)
    .slice(0, CASE_LIMITS.articles)
    .map((a: any) => ({ headline: str(a?.headline, 120), text: str(a?.text, 700) }))
    .filter((a) => a.headline && a.text);

  // Известно с начала: стартовое место, все общественные места города и то, что модель отметила (из газеты, из завязки).
  const known = new Set<string>([w.current]);
  for (const l of w.locations) if (r.locationTypes[l.type]?.public) known.add(l.id);
  for (const i of arr(seed.known)) {
    const k = idx(i, n);
    if (k !== null) known.add(loc(k));
  }

  // Путь наставника: по одному визиту в каждое место с ключевой уликой (кроме того, где дело началось).
  const par = Math.max(1, new Set(clues.filter((c) => c.key && c.at && c.at !== w.current).map((c) => c.at)).size);

  w.case = {
    truth,
    questions,
    clues,
    people,
    newspaper: { date: str(np.date, 40, "октябрь 1926"), articles },
    known: [...known],
    visits: 0,
    par,
    limit: par + CASE_LIMITS.extraVisits,
    sanityLost: 0,
    result: null,
    ...(str(seed.twist, 600) ? { twist: str(seed.twist, 600) } : {}),
  };
  // В деле нет «финальной локации»: развязку открывает сам игрок, закрывая дело.
  w.target = "";
  return w;
}

export const isKnown = (w: Campaign, id: string) => !!w.case?.known.includes(id);
export const timeIsUp = (w: Campaign) => !!w.case && w.case.visits >= w.case.limit;

/** Шанс встречи на пути: в деле редко и только к опасным местам. */
export const caseEncounterChance = (r: Ruleset, type: string) => (r.locationTypes[type]?.safe ? 0 : 0.15);

/** Переход в деле: в любое известное место, каждый визит на счету. */
export function travelCase(r: Ruleset, w: Campaign, toId: string, rng: Rng) {
  const c = w.case;
  if (!c) throw new Error("Нет дела.");
  if (c.result) throw new Error("Дело уже закрыто.");
  if (w.combat) throw new Error("Нельзя уйти посреди боя.");
  if (timeIsUp(w)) throw new Error("Время вышло: пора закрывать дело.");
  const from = locationById(w, w.current)!;
  const to = locationById(w, toId);
  if (!to || !c.known.includes(to.id)) throw new Error("Этого адреса ты не знаешь.");
  if (to.id === w.current) throw new Error("Ты и так здесь.");
  const encounter = rng() < caseEncounterChance(r, to.type);
  w.current = to.id;
  to.visited = true;
  w.npc = null;
  c.visits++;
  return { from, to, encounter, timeUp: timeIsUp(w) };
}

export interface CaseChanges {
  /** Найденные улики (id). */
  clues?: string[];
  /** Места, о которых герой узнал (id). */
  reveal?: string[];
}

export interface AppliedCaseChanges {
  clues: string[];
  revealed: string[];
  rejected: string[];
  notes: string[];
  effects: TurnEffect[];
}

/**
 * Изменения дела от мастера. Улику можно найти только там, где она лежит, и не больше двух за ход;
 * вывод так не находится — только реконструкцией. Открыть можно только место из дела.
 */
export function applyCaseChanges(w: Campaign, p: CaseChanges): AppliedCaseChanges {
  const out: AppliedCaseChanges = { clues: [], revealed: [], rejected: [], notes: [], effects: [] };
  const c = w.case;
  if (!c) return out;
  for (const id of p.clues ?? []) {
    const clue = c.clues.find((x) => x.id === id);
    if (!clue) out.rejected.push(`clues: неизвестная улика ${id}`);
    else if (clue.found) continue;
    else if (clue.requires) out.rejected.push(`clues: ${id} — вывод, только через реконструкцию`);
    else if (clue.at !== w.current) out.rejected.push(`clues: ${id} лежит не здесь (${clue.at})`);
    else if (out.clues.length >= CASE_LIMITS.cluesPerTurn) out.rejected.push(`clues: больше ${CASE_LIMITS.cluesPerTurn} за ход (${id})`);
    else {
      clue.found = true;
      out.clues.push(id);
      out.notes.push(`улика: ${clue.text}`);
      out.effects.push(effect.clue(clue.id, clue.text, clue.title));
    }
  }
  for (const raw of p.reveal ?? []) {
    const l = findPlace(w, raw);
    if (!l) out.rejected.push(`reveal: нет места ${raw}`);
    else if (!c.known.includes(l.id)) {
      c.known.push(l.id);
      out.revealed.push(l.id);
      out.notes.push(`новый адрес: ${l.name}`);
      out.effects.push(effect.address(l.id, l.name));
    }
  }
  return out;
}

/**
 * Справочник Аркхэма: по имени жителя или названию места — адрес. Как в Mythos Tales:
 * услышал имя — нашёл в справочнике — можешь идти. Модель не нужна.
 * Люди — по имени или фамилии. Места — по полному названию или по собственному имени в нём
 * («Бакалея Финнегана» — по «Финнеган»), но не по общему слову: «подвал» не откроет «Подвал под мельницей».
 */
export function lookup(w: Campaign, query: string): { person?: CasePerson; place: string; revealed: boolean } | null {
  const c = w.case;
  const q = normName(query);
  if (!c || q.length < 3) return null;
  const qWords = q.split(" ");
  const person = c.people.find((p) => normName(p.name) === q || normName(p.name).split(" ").some((n) => qWords.some((x) => sameWord(n, x))));
  const properWords = (name: string) =>
    name
      .split(/\s+/)
      .slice(1)
      .filter((x) => /^[«"]?[А-ЯЁA-Z]/.test(x))
      .map(normName);
  const place = person
    ? locationById(w, person.at)
    : w.locations.find((l) => normName(l.name) === q || properWords(l.name).some((n) => qWords.some((x) => sameWord(n, x))));
  if (!place) return null;
  const revealed = !c.known.includes(place.id);
  if (revealed) c.known.push(place.id);
  return { person, place: place.id, revealed };
}

/** Выводы, к которым герой уже может прийти: все нужные улики найдены. */
export const deductionCandidates = (w: Campaign) =>
  (w.case?.clues ?? []).filter((d) => d.requires && !d.found && d.requires.every((id) => w.case!.clues.find((x) => x.id === id)?.found));

export function markDeduction(w: Campaign, id: string): CaseClue {
  const d = deductionCandidates(w).find((x) => x.id === id);
  if (!d) throw new Error(`Deduction ${id} is not available`);
  d.found = true;
  return d;
}

/** Закрытие дела: очки по вердиктам, штраф за лишние визиты, счёт наставника. Код, не модель. */
export function closeCase(w: Campaign, answers: { id: string; answer: string; verdict: Verdict }[]): CaseResult {
  const c = w.case;
  if (!c) throw new Error("Нет дела.");
  if (c.result) throw new Error("Дело уже закрыто.");
  const mult: Record<Verdict, number> = { right: 1, partial: 0.5, wrong: 0 };
  const byId = new Map(answers.map((a) => [a.id, a]));
  const graded = c.questions.map((q) => {
    const a = byId.get(q.id);
    return { id: q.id, answer: (a?.answer ?? "").slice(0, 400), verdict: a?.verdict ?? "wrong" };
  });
  const max = c.questions.reduce((s, q) => s + q.points, 0);
  const points = Math.round(c.questions.reduce((s, q, i) => s + q.points * mult[graded[i]!.verdict], 0));
  const penalty = CASE_LIMITS.visitPenalty * Math.max(0, c.visits - c.par);
  const sanityPenalty = CASE_LIMITS.sanityPenalty * (c.sanityLost ?? 0);
  const result: CaseResult = { answers: graded, points, max, penalty, sanityPenalty, score: Math.max(0, points - penalty - sanityPenalty), mentor: max, timeUp: timeIsUp(w) };
  c.result = result;
  w.complete = true;
  for (const o of w.objectives) o.done = true;
  return result;
}

/** Что дело показывает игроку: найденное, известное и вопросы без ответов. После закрытия — всё. */
export interface PublicCase {
  clues: Pick<CaseClue, "id" | "text" | "title" | "at" | "requires">[];
  people: PublicPerson[];
  newspaper: CaseState["newspaper"];
  known: string[];
  visits: number;
  limit: number;
  sanityLost: number;
  questions: Pick<CaseQuestion, "id" | "text" | "points">[];
  /** Сколько выводов можно сделать прямо сейчас (для кнопки реконструкции). */
  canDeduce: number;
  result: CaseResult | null;
  /** Только после закрытия. */
  reveal?: { truth: string; answers: Record<string, string>; par: number };
}

/**
 * Кампания для клиента. Клиенту не доверяем ничего, а в деле лежат ответы: разгадка, вопросы
 * с ответами, ненайденные улики и адреса, о которых герой не знает, — вырезаются.
 */
export type PublicCampaign = Omit<Campaign, "case"> & { case?: PublicCase };

export function publicCampaign(w: Campaign): PublicCampaign {
  const c = w.case;
  if (!c) return w as PublicCampaign;
  const known = new Set(c.known);
  const { case: _secret, ...rest } = w;
  const pub: PublicCase = {
    clues: c.clues.filter((x) => x.found).map(({ id, text, title, at, requires }) => ({ id, text, at, ...(title ? { title } : {}), ...(requires ? { requires } : {}) })),
    // Только то, что видно со стороны: мотивы, алиби, тайны и ложь — у мастера.
    people: c.people.filter((p) => known.has(p.at)).map(({ name, role, at, gender, look }) => ({ name, role, at, ...(gender ? { gender } : {}), ...(look ? { look } : {}) })),
    newspaper: c.newspaper,
    known: c.known,
    visits: c.visits,
    limit: c.limit,
    sanityLost: c.sanityLost ?? 0,
    questions: c.questions.map(({ id, text, points }) => ({ id, text, points })),
    canDeduce: deductionCandidates(w).length,
    result: c.result,
    ...(c.result ? { reveal: { truth: c.truth, answers: Object.fromEntries(c.questions.map((q) => [q.id, q.answer])), par: c.par } } : {}),
  };
  return {
    ...rest,
    locations: w.locations.filter((l) => known.has(l.id)),
    edges: w.edges.filter(([a, b]) => known.has(a) && known.has(b)),
    case: pub,
  };
}

/** Сколько визитов осталось — для подсказок мастеру и игроку. */
export const visitsLeft = (w: Campaign) => (w.case ? clamp(w.case.limit - w.case.visits, 0, 99) : 0);

/**
 * Переход по рассказу: мастер увёл героя в другое место прямо в ответе (move).
 * Правила те же, что у перехода по карте: в квесте — только к соседям по дороге,
 * в деле — только по известному адресу, визит на счету, время не вышло.
 * null — переходить некуда (то же место или пусто).
 */
export function storyMove(r: Ruleset, w: Campaign, ref: string | null | undefined, rng: Rng): { to: MapLocation; timeUp: boolean } | { error: string } | null {
  if (!ref?.trim()) return null;
  const to = findPlace(w, ref);
  if (!to) return { error: `move: нет места «${ref}»` };
  if (to.id === w.current) return null;
  try {
    const t = w.case ? travelCase(r, w, to.id, rng) : travel(r, w, to.id, rng);
    return { to: t.to, timeUp: "timeUp" in t && t.timeUp === true };
  } catch (e) {
    return { error: `move в «${to.name}»: ${(e as Error).message}` };
  }
}

/** Сколько ключевых улик нужно для поворота: половина, но не меньше двух. */
export const twistThreshold = (c: CaseState) => Math.max(2, Math.ceil(c.clues.filter((x) => x.key && !x.requires).length / 2));

/** Наступает ли поворот: найдено достаточно ключевых улик. Отмечает ход, на котором он наступил. true — наступил только что. */
export function checkTwist(w: Campaign): boolean {
  const c = w.case;
  if (!c?.twist || c.twistAt !== undefined || c.result) return false;
  const keys = c.clues.filter((x) => x.key && !x.requires && x.found).length;
  if (keys < twistThreshold(c)) return false;
  c.twistAt = w.turn;
  return true;
}

export interface PresentResult {
  clue: CaseClue;
  /** Житель дела, которому показали улику (если это житель). */
  person?: CasePerson;
  /** Улика опровергает его ложь — он уличён (решает код, а не модель). */
  caught: boolean;
}

/**
 * Предъявить найденную улику собеседнику. Уличает, только если у жителя есть ложь, которую
 * опровергает именно эта улика, и он ещё не был на ней пойман. Код решает — мастер описывает.
 */
export function presentClue(w: Campaign, clueId: string, to: string): PresentResult {
  const c = w.case;
  if (!c) throw new Error("В этом мире нет дел.");
  const clue = c.clues.find((x) => x.id === clueId);
  if (!clue || !clue.found) throw new Error("Эта улика ещё не найдена.");
  const i = matchName(to, c.people.map((p) => p.name));
  const person = i >= 0 ? c.people[i] : undefined;
  const caught = !!person?.lie && person.lie.breaks === clue.id && !person.lie.broken;
  if (caught) person!.lie!.broken = true;
  return { clue, ...(person ? { person } : {}), caught };
}
