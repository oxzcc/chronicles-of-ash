/**
 * Полоса загрузки при создании кампании. Рассказчик сначала пишет скрытые рассуждения,
 * потом — сам JSON квеста или дела. Обе фазы приходят потоком, поэтому прогресс настоящий:
 * в первой — по объёму рассуждений, во второй — по тому, какие разделы JSON уже написаны.
 *
 * Калибровка (DeepSeek V4.1 Flash, effort low, 18 ноября 2026, 4 замера):
 * дело — 17–25 тыс. символов рассуждений за 45–56 с, потом 5,1–5,3 тыс. символов JSON за 8–12 с;
 * квест фэнтези — около 4 тыс. символов рассуждений за 12 с и 1,7 тыс. символов JSON за 3 с.
 * Если поменяется модель — поправить числа в EXPECT.
 */

export type GenKind = "case" | "quest";

export interface GenProgress {
  /** 0…1; в пределах попытки только растёт, новая попытка начинает с нуля. */
  value: number;
  phase: "thinking" | "writing" | "retry";
  /** Что сейчас делает мастер — для подписи под полосой. */
  label: string;
  /** Сколько примерно осталось, секунд (округлено до 5); null — не знаем. */
  etaSec: number | null;
}

export interface GenSnapshot {
  kind: GenKind;
  elapsedMs: number;
  /** Сколько символов скрытых рассуждений уже пришло (0 — провайдер их не присылает). */
  reasoningChars: number;
  /** Текст ответа, пришедший к этому моменту. */
  text: string;
  /** Номер попытки с 0: вторая начинается, если первая вернула негодный JSON. */
  attempt: number;
  /** Подпись для фазы рассуждений — из мира («Доктор Уэйкфилд ищет папку…»). */
  thinkingLabel: string;
}

const EXPECT: Record<GenKind, { reasoningChars: number; thinkMs: number; textChars: number; writeMs: number }> = {
  case: { reasoningChars: 20_000, thinkMs: 48_000, textChars: 6_200, writeMs: 11_000 },
  quest: { reasoningChars: 4_000, thinkMs: 12_000, textChars: 1_700, writeMs: 3_000 },
};

/** Разделы JSON в том порядке, в каком модель их пишет, и подписи для игрока. */
const STAGES: Record<GenKind, [key: string, label: string][]> = {
  case: [
    ["objectives", "Мастер записывает дело"],
    ["locations", "Места"],
    ["people", "Жители"],
    ["clues", "Улики"],
    ["deductions", "Выводы"],
    ["questions", "Вопросы"],
    ["newspaper", "Утренняя газета"],
    ["known", "Последние штрихи"],
  ],
  quest: [
    ["objectives", "Мастер записывает приключение"],
    ["locations", "Карта"],
    ["target", "Последние штрихи"],
  ],
};

/** Рассуждения занимают до 85% полосы, запись JSON — остальное. */
const THINK_SHARE = 0.85;

/** Растёт почти линейно до ожидаемого объёма и дальше медленно ползёт к 85%, но не упирается. */
const thinkCurve = (x: number) => THINK_SHARE * (1 - Math.exp(-1.6 * Math.max(0, x)));

const roundEta = (s: number) => Math.max(5, Math.round(s / 5) * 5);

/** Раздел JSON считается начатым, когда в тексте появился его ключ со значением («"people":[»). */
export function startedStages(kind: GenKind, text: string): string[] {
  return STAGES[kind].filter(([k]) => new RegExp(`"${k}"\\s*:\\s*[\\[{\\d]`).test(text)).map(([k]) => k);
}

export function genProgress(s: GenSnapshot): GenProgress {
  const e = EXPECT[s.kind];
  if (s.text.trim().length === 0) {
    // Рассуждения: по объёму, если провайдер их присылает, иначе по времени.
    const x = s.reasoningChars > 0 ? s.reasoningChars / e.reasoningChars : s.elapsedMs / e.thinkMs;
    const value = thinkCurve(x);
    // Скорость — сглаженная с ожидаемой: первые секунды рассуждения идут рывком и врут.
    // Если рассуждений больше обычного, считаем, что впереди ещё около 15% от написанного.
    const prior = e.thinkMs * 0.25;
    const chars = s.reasoningChars > 0 ? s.reasoningChars : (s.elapsedMs * e.reasoningChars) / e.thinkMs;
    const rate = (chars + (prior * e.reasoningChars) / e.thinkMs) / (s.elapsedMs + prior);
    const left = Math.max(e.reasoningChars - chars, chars * 0.15);
    const eta = roundEta(left / rate / 1000 + e.writeMs / 1000);
    return {
      value,
      phase: s.attempt > 0 ? "retry" : "thinking",
      label: s.attempt > 0 ? "Первый вариант не сложился — мастер пробует ещё раз" : s.thinkingLabel,
      etaSec: eta,
    };
  }
  const stages = startedStages(s.kind, s.text);
  const last = STAGES[s.kind].find(([k]) => k === stages[stages.length - 1]);
  const done = Math.min(1, s.text.length / e.textChars);
  return {
    value: THINK_SHARE + (0.99 - THINK_SHARE) * done,
    phase: s.attempt > 0 ? "retry" : "writing",
    label: last?.[1] ?? STAGES[s.kind][0]![1],
    etaSec: done < 0.9 ? roundEta(((1 - done) * e.writeMs) / 1000) : null,
  };
}

/**
 * Следит за генерацией и зовёт onProgress не чаще раза в interval мс. В пределах попытки значение
 * только растёт; новая попытка честно начинает полосу заново — с подписью «пробует ещё раз».
 */
export function progressTracker(o: { kind: GenKind; thinkingLabel: string; onProgress: (p: GenProgress) => void; now?: () => number; intervalMs?: number }) {
  const now = o.now ?? Date.now;
  let t0 = now();
  let attempt = 0;
  let reasoningChars = 0;
  let text = "";
  let shown = 0;
  let lastAt = -Infinity;
  const emit = (force = false) => {
    const t = now();
    if (!force && t - lastAt < (o.intervalMs ?? 250)) return;
    lastAt = t;
    const p = genProgress({ kind: o.kind, elapsedMs: t - t0, reasoningChars, text, attempt, thinkingLabel: o.thinkingLabel });
    shown = Math.max(shown, p.value);
    o.onProgress({ ...p, value: shown });
  };
  return {
    reasoning(totalChars: number) {
      reasoningChars = totalChars;
      emit();
    },
    text(full: string) {
      text = full;
      emit();
    },
    /** Новая попытка: рассуждения и текст — с нуля. */
    retry() {
      attempt++;
      t0 = now();
      reasoningChars = 0;
      text = "";
      shown = 0;
      emit(true);
    },
    tick: () => emit(),
    start: () => emit(true),
  };
}
