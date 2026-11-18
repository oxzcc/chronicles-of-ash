import type { CharacterDraft } from "@ash/engine";
import type { Tier } from "@ash/llm";
import type { NewGameResult } from "./new-game";
import type { GenProgress } from "./progress";

/**
 * Ранний старт: дело (или квест) начинает придумываться, пока игрок выбирает портрет.
 * К нажатию «Начать» оно часто уже готово или почти готово.
 *
 * Ключ — всё, что попадает в промпт рассказчика (мир, имя, раса, класс, характеристики, навыки,
 * предыстория, фобия) и тариф. Изменил игрок что-то из этого — ключ другой, заготовка выбрасывается
 * и при старте дело придумывается заново: иначе оно было бы не про этого героя.
 * Одна заготовка на игрока; невостребованная живёт ttlMs и отменяется.
 *
 * Хранится в памяти процесса — для одного сервера. В фазе 4 (несколько серверов) — Redis или таблица.
 */

export function draftKey(d: CharacterDraft, tier: Tier): string {
  const k = {
    tier,
    world: d.world ?? "fantasy",
    name: d.name.trim(),
    gender: d.gender,
    race: d.race,
    cls: d.cls,
    base: Object.fromEntries(Object.entries(d.base).sort(([a], [b]) => a.localeCompare(b))),
    skills: [...d.skills].sort(),
    backstory: (d.backstory ?? "").trim(),
    phobia: d.phobia ?? "",
  };
  return JSON.stringify(k);
}

/** Заготовка, которую забрал старт: результат и прогресс, который ещё идёт. */
export interface PendingGame {
  result: Promise<NewGameResult>;
  /** Последний известный прогресс — чтобы полоса начала не с нуля. */
  progress: GenProgress | null;
  /** Подписка на дальнейший прогресс; возвращает отписку. */
  subscribe(fn: (p: GenProgress) => void): () => void;
}

interface Entry extends PendingGame {
  key: string;
  ctrl: AbortController;
  failed: boolean;
  timer: ReturnType<typeof setTimeout>;
}

export type StartGame = (o: { draft: CharacterDraft; tier: Tier; signal: AbortSignal; onProgress: (p: GenProgress) => void }) => Promise<NewGameResult>;

export class PregenStore {
  private readonly byUser = new Map<string, Entry>();

  constructor(
    private readonly start: StartGame,
    private readonly ttlMs = 15 * 60_000,
  ) {}

  /** Начать заготовку. Та же — уже идёт или готова — ничего не делаем; другая — старую отменяем. */
  begin(userId: string, draft: CharacterDraft, tier: Tier): "started" | "same" {
    const key = draftKey(draft, tier);
    const cur = this.byUser.get(userId);
    if (cur && cur.key === key && !cur.failed) return "same";
    this.drop(userId);
    const ctrl = new AbortController();
    const listeners = new Set<(p: GenProgress) => void>();
    const entry: Entry = {
      key,
      ctrl,
      failed: false,
      progress: null,
      timer: setTimeout(() => this.drop(userId, entry), this.ttlMs),
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      result: undefined as unknown as Promise<NewGameResult>,
    };
    entry.result = this.start({
      draft,
      tier,
      signal: ctrl.signal,
      onProgress: (p) => {
        entry.progress = p;
        for (const fn of listeners) fn(p);
      },
    });
    // Ошибка заготовки — не ошибка игрока: старт просто придумает дело заново.
    entry.result.catch(() => {
      entry.failed = true;
    });
    this.byUser.set(userId, entry);
    return "started";
  }

  /**
   * Забрать заготовку для старта. Подходит только та, что сделана для этого же героя и не упала;
   * неподходящая отменяется, чтобы не тратить токены.
   */
  take(userId: string, draft: CharacterDraft, tier: Tier): PendingGame | null {
    const cur = this.byUser.get(userId);
    if (!cur) return null;
    if (cur.key !== draftKey(draft, tier) || cur.failed) {
      this.drop(userId);
      return null;
    }
    clearTimeout(cur.timer);
    this.byUser.delete(userId);
    return cur;
  }

  /** Сколько заготовок сейчас в памяти — для тестов и отладки. */
  get size() {
    return this.byUser.size;
  }

  private drop(userId: string, only?: Entry) {
    const cur = this.byUser.get(userId);
    if (!cur || (only && cur !== only)) return;
    clearTimeout(cur.timer);
    cur.ctrl.abort();
    this.byUser.delete(userId);
  }
}
