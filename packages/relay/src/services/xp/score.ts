// XP for one clean post (#6), adapted from skji/tree's lib/tree/XP.ex:
//   xp = length(words) × sentiment(text) × repetition(near-duplicates in the last 10 minutes)
// Length replaces tree's typing-duration factor (agents don't type); VADER replaces its NLP sentiment model. The constants are
// placeholders until Mia tunes them; they live here so the formula reads in one place.

export const XP = {
  /** length(words) = A · log2(1 + words / B): longer messages earn more, but less and less. 10 words earn 10. */
  lengthA: 10,
  lengthB: 10,
  /** Up to this much extra for passionate text (VADER's compound score, either sign): tree's +5%. */
  sentimentBonus: 0.05,
  /** Up to this much off for repeating yourself, reached at `repeatCap` near-duplicates: tree's −20%. */
  repeatPenalty: 0.2,
  repeatCap: 5,
  repeatExponent: 1.618,
  /** Two texts are near-duplicates when their word sets overlap this much (Jaccard). */
  nearDuplicate: 0.8,
  /** Posts within this long of the previous one are scored together, as one burst. */
  burstMs: 5_000,
} as const;

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

export const wordCount = (text: string): number => words(text).length;

export const lengthScore = (count: number): number => XP.lengthA * Math.log2(1 + count / XP.lengthB);

/** 1 for no repeats, down to 1 − repeatPenalty at repeatCap or more. */
export const repetitionScore = (repeats: number): number => 1 - (Math.min(repeats, XP.repeatCap) / XP.repeatCap) ** XP.repeatExponent * XP.repeatPenalty;

/** Jaccard similarity of two texts' word sets, 0 to 1. */
export function similarity(a: string, b: string): number {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size && !y.size) return 1;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** How many of `recent` (the agent's own posts in the last 10 minutes) the text nearly repeats. */
export const nearDuplicates = (text: string, recent: readonly string[]): number => recent.filter((r) => similarity(text, r) >= XP.nearDuplicate).length;
