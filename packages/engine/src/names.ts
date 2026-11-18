/** Имена людей и мест: сравнение с учётом падежей и сокращений. Без зависимостей — работает и в браузере. */

export const normName = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е").replace(/[«»"'.,]/g, "").replace(/\s+/g, " ");

/**
 * Одно слово имени с учётом падежей: «Финнеган» = «Финнегана» = «Финнеганом», «Мария» = «Марии»;
 * но «Лорейн» ≠ «Лоренс». Короткие («Хоу», «Кит») — только целиком.
 */
export const sameWord = (a: string, b: string) => {
  if (a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  if (a.length <= 4 || b.length <= 4) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  // Основа короткого слова: без последней гласной (Мари-я → Мари-и); дальше у длинного — только окончание.
  const stem = /[аеёиоуыэюяйь]$/.test(s) ? s.slice(0, -1) : s;
  return stem.length >= 4 && l.startsWith(stem) && l.length - stem.length <= 3;
};

const words = (s: string) => normName(s).split(" ").filter((w) => w.length >= 3);

/**
 * Тот же ли это человек: мастер то пишет «Эзра Кроу», то «Эзра», то «доктор Уэйкфилд»
 * вместо «доктор Сайлас Уэйкфилд». Каждое слово короткого имени должно найтись в длинном.
 * Лишнее слово («Миссис Кроу» против «Эзра Кроу», «Старый Эзра») — уже другой человек:
 * лучше лишний портрет, чем чужое лицо.
 */
export function sameName(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = words(a).length <= words(b).length ? [words(a), words(b)] : [words(b), words(a)];
  return short.length > 0 && short.every((w) => long.some((x) => sameWord(w, x)));
}

/** Индекс того же человека среди известных: точное совпадение, иначе единственный похожий. −1 — новый. */
export function matchName(name: string, known: readonly string[]): number {
  const n = normName(name);
  const exact = known.findIndex((k) => normName(k) === n);
  if (exact >= 0) return exact;
  const hits = known.flatMap((k, i) => (sameName(name, k) ? [i] : []));
  return hits.length === 1 ? hits[0]! : -1;
}
