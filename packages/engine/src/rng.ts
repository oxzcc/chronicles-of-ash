/** Источник случайности: возвращает число в [0, 1). Всё случайное в движке идёт через него. */
export type Rng = () => number;

/** Детерминированный генератор для тестов, раскладки карты и портретов. */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Криптостойкий генератор для настоящих бросков на сервере. */
export const secureRng: Rng = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

export function pick<T>(arr: readonly T[], rng: Rng): T {
  if (arr.length === 0) throw new Error("pick from empty array");
  return arr[Math.floor(rng() * arr.length)]!;
}

/** Последовательность заранее заданных значений d-броска — для тестов. */
export function scriptedRng(values: number[], sides = 20): Rng {
  let i = 0;
  return () => {
    const v = values[i++ % values.length]!;
    return (v - 1 + 0.5) / sides;
  };
}
