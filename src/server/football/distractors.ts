// The distractor engine.
//
// WHY ONE ENGINE RATHER THAN FIFTEEN CALL SITES
//
// Before this module, every generator built its own wrong answers. Each one was
// a reasonable three lines — filter the pool, shuffle, take three — and between
// them they produced 2,291 club-transfer questions with a national team among
// the options, 52 "which club am I?" questions answered "Qatar", and 213
// questions offering a reserve side as a plausible club.
//
// No generator was careless. The problem is structural: "filter the pool" puts
// the type rule at the call site, where it has to be remembered fifteen times
// and will be forgotten at least once. So the rule moves into the engine, the
// engine is handed the archetype's declared answer type, and A MISMATCH IS AN
// ERROR RATHER THAN A SILENTLY ODD OPTION.
//
// The second job is plausibility, and it is not cosmetic either. A HARD question
// whose three wrong answers are from other continents is not hard — the player
// recognises the one club that belongs and answers by elimination. Distractors
// are therefore ranked by how close they sit to the answer, and how close they
// ended up is reported back so the difficulty model can price it.

import {
  isAskableClub,
  isAskableNationalTeam,
  type Candidate,
  type EntityType,
} from "./entities.ts";
import type { DistractorCloseness } from "./difficulty.ts";

// ---------------------------------------------------------------------------
// Deterministic shuffling — the same inputs must always produce the same
// question, or regeneration churns ids and breaks shared challenges.
// ---------------------------------------------------------------------------
function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seedKey: string): T[] {
  const rand = mulberry32(hashString(seedKey));
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Text key for identity and de-duplication. Shape only — never spelling rules. */
const key = (text: string) =>
  (text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Type eligibility
// ---------------------------------------------------------------------------

/**
 * Whether one candidate may stand in a question of this answer type.
 *
 * The team cases carry the extra condition that is the whole reason this module
 * exists: CLUB excludes national teams AND reserve and youth sides, and
 * NATIONAL_TEAM excludes clubs AND youth internationals. A `teamKind` of
 * undefined on a team candidate is treated as ineligible rather than assumed
 * benign — an unclassified team is exactly the case that produced the bug.
 */
export function isEligibleCandidate(candidate: Candidate, expected: EntityType): boolean {
  if (candidate.type !== expected) return false;
  if (expected === "CLUB") return candidate.teamKind !== undefined && isAskableClub(candidate.teamKind);
  if (expected === "NATIONAL_TEAM") {
    return candidate.teamKind !== undefined && isAskableNationalTeam(candidate.teamKind);
  }
  return true;
}

export class DistractorTypeError extends Error {
  readonly expected: EntityType;
  readonly got: EntityType;

  constructor(expected: EntityType, got: EntityType, context: string) {
    super(`${context}: expected a ${expected} answer, got ${got}`);
    this.expected = expected;
    this.got = got;
    this.name = "DistractorTypeError";
  }
}

// ---------------------------------------------------------------------------
// Plausibility
// ---------------------------------------------------------------------------

export interface SimilarityAxes {
  /** Same country as the answer. For clubs: the same league pyramid. */
  country?: boolean;
  /** Same competition as the answer. */
  competition?: boolean;
  /** Comparable prominence — the axis that stops the famous option standing out. */
  prominence?: boolean;
  /** Comparable era, for facts and players separated in time. */
  era?: boolean;
}

const DEFAULT_AXES: SimilarityAxes = { country: true, competition: true, prominence: true, era: true };

/**
 * How believable one candidate is as a wrong answer, higher being better.
 *
 * Prominence is weighted hardest, and deliberately so. Sharing a country makes
 * an option *look* right; sharing a prominence band is what stops the player
 * answering by recognition alone, which is the failure mode that quietly makes a
 * hard question easy.
 */
export function plausibility(candidate: Candidate, answer: Candidate, axes: SimilarityAxes = DEFAULT_AXES): number {
  let score = 0;

  if (axes.prominence) {
    const a = answer.prominence;
    const c = candidate.prominence;
    if (a !== undefined && c !== undefined) {
      const gap = Math.abs(a - c);
      score += gap <= 0.4 ? 3 : gap <= 0.9 ? 2 : gap <= 1.5 ? 0.5 : -1.5;
    }
  }

  if (axes.country && answer.country && candidate.country) {
    score += answer.country === candidate.country ? 2.5 : 0;
  }

  if (axes.competition && answer.competitionCode && candidate.competitionCode) {
    score += answer.competitionCode === candidate.competitionCode ? 2 : 0;
  }

  if (axes.era && answer.era && candidate.era) {
    const gap = Math.abs(answer.era - candidate.era);
    score += gap <= 3 ? 1.5 : gap <= 8 ? 0.75 : 0;
  }

  return score;
}

/**
 * How close a chosen set ended up, for the difficulty model.
 *
 * Measured rather than requested: a generator can ask for near distractors and
 * get far ones because the pool held nothing closer, and the difficulty has to
 * reflect what the player will actually see.
 */
export function closenessOf(distractors: Candidate[], answer: Candidate): DistractorCloseness {
  if (distractors.length === 0) return "mixed";
  const scores = distractors.map((d) => plausibility(d, answer));
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  if (mean >= 4) return "near";
  if (mean <= 1) return "far";
  return "mixed";
}

/**
 * Whether the answer gives itself away by being the only recognisable option.
 *
 * "Correct: Real Madrid. Wrong: Japan, Messi, Champions League" is the extreme
 * the spec names, and the type rules now make that impossible. This catches the
 * subtler version that survives them: Real Madrid against three clubs nobody has
 * heard of. The question still looks well-formed and is still free.
 */
export function prominenceGiveaway(distractors: Candidate[], answer: Candidate): boolean {
  const a = answer.prominence;
  if (a === undefined || distractors.length === 0) return false;
  const known = distractors.map((d) => d.prominence).filter((p): p is number => p !== undefined);
  if (known.length < distractors.length) return false;
  // Every wrong option markedly less prominent than the right one.
  return known.every((p) => p - a >= 1.4);
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export interface DistractorRequest {
  /** The archetype's declared answer type. Non-negotiable. */
  expectedEntityType: EntityType;
  answer: Candidate;
  pool: Candidate[];
  count?: number;
  /** Must be stable across runs — it is what makes the question reproducible. */
  seedKey: string;
  /**
   * Values that must never be offered even though they are the right type: a
   * club the player also played for, a second valid champion, the club named in
   * the question itself.
   */
  exclude?: Iterable<string>;
  similarity?: SimilarityAxes;
  /**
   * How wide a band to sample from, as a multiple of `count`. A narrow band
   * gives the most plausible options every time; a wider one trades a little
   * plausibility for variety across questions about the same answer.
   */
  bandFactor?: number;
  /** Named in errors, so a type mismatch says which generator produced it. */
  context?: string;
}

export interface DistractorResult {
  distractors: Candidate[];
  closeness: DistractorCloseness;
  /** True when the answer stands out by prominence alone. */
  giveaway: boolean;
  dropped: {
    typeMismatch: number;
    excluded: number;
    duplicate: number;
  };
}

/**
 * Picks wrong answers of exactly the right kind.
 *
 * Returns null — rather than a short list — when the pool cannot supply enough
 * eligible candidates. Every caller treats that as "do not generate this
 * question", which is the correct outcome: a three-option question is a
 * malformed one, and padding it with something of the wrong type is the bug.
 *
 * Throws only for a programming error: an answer whose own type does not match
 * the archetype's. That is not a data problem and must not be recoverable.
 */
export function generateDistractors(request: DistractorRequest): DistractorResult | null {
  const { expectedEntityType, answer, pool, seedKey } = request;
  const count = request.count ?? 3;
  const context = request.context ?? "distractors";

  if (answer.type !== expectedEntityType) {
    throw new DistractorTypeError(expectedEntityType, answer.type, context);
  }
  // A club answer that is itself a reserve side or a national team is the same
  // class of error and is just as unrecoverable.
  if (!isEligibleCandidate(answer, expectedEntityType)) {
    throw new DistractorTypeError(
      expectedEntityType,
      answer.type,
      `${context}: answer "${answer.text}" is a ${answer.teamKind ?? "unclassified"} and cannot answer a ${expectedEntityType} question`
    );
  }

  const excluded = new Set([key(answer.text), ...[...(request.exclude ?? [])].map(key)]);
  const dropped = { typeMismatch: 0, excluded: 0, duplicate: 0 };

  const seen = new Set<string>();
  const eligible: Candidate[] = [];
  for (const candidate of pool) {
    if (!isEligibleCandidate(candidate, expectedEntityType)) {
      dropped.typeMismatch++;
      continue;
    }
    const k = key(candidate.text);
    if (!k) continue;
    if (excluded.has(k)) {
      dropped.excluded++;
      continue;
    }
    if (seen.has(k)) {
      dropped.duplicate++;
      continue;
    }
    if (answer.id !== null && answer.id !== undefined && candidate.id === answer.id) {
      dropped.excluded++;
      continue;
    }
    seen.add(k);
    eligible.push(candidate);
  }

  if (eligible.length < count) return null;

  // Rank by plausibility, then sample deterministically from the top band. The
  // tie-break on text keeps the ranking stable when scores are equal, which is
  // common — most of the pool shares no axis with the answer at all.
  const ranked = [...eligible].sort(
    (a, b) =>
      plausibility(b, answer, request.similarity) - plausibility(a, answer, request.similarity) ||
      key(a.text).localeCompare(key(b.text))
  );
  const bandSize = Math.min(ranked.length, Math.max(count, count * (request.bandFactor ?? 4)));
  const distractors = seededShuffle(ranked.slice(0, bandSize), seedKey).slice(0, count);

  return {
    distractors,
    closeness: closenessOf(distractors, answer),
    giveaway: prominenceGiveaway(distractors, answer),
    dropped,
  };
}

/** The four option texts in generator order, answer first. */
export function optionsFrom(answer: Candidate, distractors: Candidate[]): string[] {
  return [answer.text, ...distractors.map((d) => d.text)];
}
