// Football answer matching.
//
// Free-text answers are typed by humans on phones, in two scripts, for names
// that carry diacritics most people do not type. The matcher therefore has to
// accept "vinicius", "Vinícius", "Vini Jr" and "ויניסיוס" for the same player
// while still rejecting a different player's name.
//
// The rules, in order of strictness:
//   1. normalize   — case, Unicode, diacritics, Hebrew niqqud, punctuation
//   2. exact       — normalized input equals the canonical answer or an alias
//   3. token       — input matches a *declared* alias after token reordering
//   4. fuzzy       — Damerau-Levenshtein within a length-scaled budget
//
// Deliberately NOT supported: arbitrary substring matching. "Ronaldo" only
// matches Cristiano Ronaldo because that alias is declared on the question,
// never because it happens to be a substring of the canonical answer.

export type MatchKind = "exact" | "alias" | "token" | "fuzzy";

export interface MatchResult {
  correct: boolean;
  kind: MatchKind | null;
  matchedAgainst: string | null;
  distance: number | null;
}

export interface AnswerSpec {
  canonical: string;
  aliases: string[];
}

const HEBREW_NIQQUD = /[֑-ׇ]/g;
// Arabic-Indic and other decorative marks are out of scope; Latin combining
// marks are removed by NFD + this range.
const COMBINING_MARKS = /[̀-ͯ]/g;

// Characters people type interchangeably in football names.
const PUNCTUATION = /[\-–—'’`´."״׳,()[\]{}/\\|:;!?*+=_~^<>@#$%&]/g;

/**
 * Canonical normalized form used for every comparison.
 * "Paris Saint-Germain" -> "paris saint germain"
 * "Vinícius Júnior"     -> "vinicius junior"
 * "ויניסיוס ג׳וניור"     -> "ויניסיוס גוניור"
 */
export function normalizeAnswer(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(HEBREW_NIQQUD, "")
    .toLowerCase()
    .replace(PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(normalized: string): string[] {
  return normalized.split(" ").filter(Boolean);
}

/**
 * Damerau-Levenshtein (optimal string alignment) distance.
 * Counts insertions, deletions, substitutions and adjacent transpositions,
 * so "Vinicuis" is 1 away from "Vinicius" rather than 2.
 * Bails out early once the distance cannot come in under `max`.
 */
export function damerauLevenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevPrev: number[] = [];
  let prev: number[] = new Array(b.length + 1);
  let curr: number[] = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowBest = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + 1); // transposition
      }
      curr[j] = value;
      if (value < rowBest) rowBest = value;
    }
    if (rowBest > max) return max + 1;
    prevPrev = prev;
    prev = curr;
    curr = new Array(b.length + 1);
  }
  return prev[b.length];
}

/**
 * Typo budget scaled to answer length. Short answers must be typed correctly —
 * at 4 characters a single edit already reaches a different player ("Kane" vs
 * "Kang") — while longer names absorb the usual phone-keyboard slips.
 */
export function typoBudget(normalizedTarget: string): number {
  const len = normalizedTarget.replace(/\s/g, "").length;
  if (len <= 4) return 0;
  if (len <= 7) return 1;
  if (len <= 12) return 2;
  return 3;
}

function tokenSetEquals(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((token, i) => token === sortedB[i]);
}

/**
 * Checks a typed answer against a canonical answer and its declared aliases.
 * `aliases` should already contain every accepted short form (surname, nickname,
 * Hebrew transliteration); this function never invents them.
 */
export function matchAnswer(input: string, spec: AnswerSpec): MatchResult {
  const normalizedInput = normalizeAnswer(input);
  const miss: MatchResult = { correct: false, kind: null, matchedAgainst: null, distance: null };
  if (!normalizedInput) return miss;

  const candidates = [spec.canonical, ...spec.aliases]
    .filter((c) => typeof c === "string" && c.trim().length > 0)
    .map((c) => ({ raw: c, normalized: normalizeAnswer(c) }))
    .filter((c) => c.normalized.length > 0);

  if (candidates.length === 0) return miss;

  // 1 + 2. Exact match on the canonical answer or any alias.
  for (const candidate of candidates) {
    if (candidate.normalized === normalizedInput) {
      return {
        correct: true,
        kind: candidate.raw === spec.canonical ? "exact" : "alias",
        matchedAgainst: candidate.raw,
        distance: 0,
      };
    }
  }

  // 3. Same words in a different order ("Junior Vinicius").
  const inputTokens = tokens(normalizedInput);
  for (const candidate of candidates) {
    if (tokenSetEquals(inputTokens, tokens(candidate.normalized))) {
      return { correct: true, kind: "token", matchedAgainst: candidate.raw, distance: 0 };
    }
  }

  // 4. Controlled fuzzy match against every declared form.
  let best: { candidate: string; distance: number } | null = null;
  for (const candidate of candidates) {
    const budget = typoBudget(candidate.normalized);
    if (budget === 0) continue;
    // A length gap larger than the budget can never be closed.
    if (Math.abs(candidate.normalized.length - normalizedInput.length) > budget) continue;
    const distance = damerauLevenshtein(normalizedInput, candidate.normalized, budget);
    if (distance <= budget && (best === null || distance < best.distance)) {
      best = { candidate: candidate.raw, distance };
    }
  }

  if (best) {
    return { correct: true, kind: "fuzzy", matchedAgainst: best.candidate, distance: best.distance };
  }

  return miss;
}

/** Convenience wrapper for callers that only need a boolean. */
export function isAnswerCorrect(input: string, spec: AnswerSpec): boolean {
  return matchAnswer(input, spec).correct;
}
