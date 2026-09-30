// Numeric answer options.
//
// THE BUG THIS FIXES
//
// Every numeric question in the first pass built its options as
// `[correct, correct + a, correct - b, correct + c]` with fixed offsets:
//
//   founding years → [n, n + 7, n - 5, n + 13]
//   title counts   → [n, n + 1, n - 1, n + 2]
//
// Options are shuffled before display, so the *position* was random — but the
// *rank* was not. In both patterns exactly one distractor is below the answer
// and two are above, which makes the correct answer the second-smallest of the
// four, every single time. A player who noticed that could score 100% on all 159
// founding-year questions and every title-count question without knowing any
// football at all. That is not a hard question; it is a broken one.
//
// The fix: decide from the seed how many distractors sit *below* the answer, so
// the answer's rank among the four options is uniform across the bank. The
// choice stays deterministic — the same question always produces the same
// options, which is what keeps generated ids, and therefore shared challenge
// links, stable.

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NumericOptionSpec {
  correct: number;
  /** Candidate distances from the answer, smallest (hardest) first. */
  offsets: number[];
  /** Values must stay at or above this — title counts cannot be zero. */
  min?: number;
  /** Values must stay at or below this, where a ceiling is meaningful. */
  max?: number;
  /** Anything stable and unique to the question. */
  seedKey: string;
}

/**
 * Three distractors around `correct`, with the answer's rank decided by the seed.
 *
 * Returns distractors only; the caller keeps the answer at index 0 as every
 * generator here does. Guaranteed: three values, all distinct, none equal to
 * `correct`, all inside [min, max].
 */
export function numericDistractors({ correct, offsets, min, max, seedKey }: NumericOptionSpec): number[] {
  const rand = mulberry32(hashString(`numeric:${seedKey}`));

  const inRange = (value: number) =>
    (min === undefined || value >= min) && (max === undefined || value <= max);

  const below = offsets.map((offset) => correct - offset).filter((v) => v !== correct && inRange(v));
  const above = offsets.map((offset) => correct + offset).filter((v) => v !== correct && inRange(v));

  // How many of the three sit below the answer. Clamped to what the range
  // actually allows: a club with 3 titles has only two usable values beneath it.
  let wanted = Math.floor(rand() * 4);
  wanted = Math.min(wanted, below.length);
  wanted = Math.max(wanted, 3 - above.length);

  // Nearest offsets first makes the tightest — and therefore hardest —
  // distractors the default, rather than leaving an implausible spread.
  const picked = [...below.slice(0, wanted), ...above.slice(0, 3 - wanted)];

  // Should be unreachable given the offset lists callers pass, but a silent
  // 3-option question would be dropped by the dedup pass and shift every id
  // after it, so top up explicitly rather than hope.
  let extra = Math.max(...offsets) + 1;
  while (picked.length < 3) {
    const candidate = correct + extra;
    if (inRange(candidate) && !picked.includes(candidate)) picked.push(candidate);
    extra++;
  }

  return [...new Set(picked)].slice(0, 3);
}

/**
 * Where the answer ranks among its options when sorted ascending (0 = smallest).
 * Used by the tests to prove the rank is no longer a giveaway.
 */
export function answerRank(correct: number, distractors: number[]): number {
  return [...distractors, correct].sort((a, b) => a - b).indexOf(correct);
}
