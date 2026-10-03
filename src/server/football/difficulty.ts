// The difficulty model.
//
// WHY THIS REPLACED WHAT WAS HERE BEFORE
//
// Two models existed. The curated bank scored four signals (archetype, fame,
// era, distractor closeness); the provider-backed bank used a five-step ladder
// driven mostly by the question's resource type. Neither knew anything about
// *where* a fact came from, and only one of them knew anything about who it was
// about — and even there, almost every call site left the subject unset.
//
// The result, measured in production over 15,186 active questions:
//
//   HARD        8,106   53%
//   EXPERT      3,448   23%
//   IMPOSSIBLE  2,044   13%
//   NORMAL      1,192    8%
//   EASY          396    3%
//
// HARD was not a difficulty, it was a default. And it was full of questions like
// "לאיזו קבוצה עבר C. Dagba מ-Auxerre בשנת 2024?", which no amount of thinking
// gets you to if you have never heard of Colin Dagba.
//
// WHAT DIFFICULTY MEANS HERE
//
//   EASY        most casual fans know this
//   NORMAL      a regular follower should know this
//   HARD        I know the player/team/competition, but I need to think
//   EXPERT      I follow football closely and this is difficult
//   IMPOSSIBLE  only very deep football knowledge is likely to get this
//
// Read those again, because the whole model follows from one observation about
// them: EASY through HARD all presuppose that the player RECOGNISES THE SUBJECT.
// "I need to think" is not a thing you can do about a name you have never seen.
// So recognition is not one signal among eight — it is a gate, and it is applied
// after scoring, in `applyGuards`.
//
// Nothing here tunes for a pretty distribution. The spec is explicit about that
// and it is right: a HARD band that is 53% of the bank tells a player nothing,
// and the fix is not to move thresholds until the histogram looks nice.

import { ARCHETYPES, type Archetype } from "./archetypes.ts";
import {
  DOMAIN_TIER_WEIGHT,
  FACT_PROMINENCE_WEIGHT,
  OBSCURE_FAME_THRESHOLD,
  VERY_OBSCURE_FAME_THRESHOLD,
  type DomainTier,
  type FactProminence,
} from "./prominence.ts";

export type Band = "EASY" | "NORMAL" | "HARD" | "EXPERT" | "IMPOSSIBLE";

export const BAND_ORDER: Band[] = ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];

export const bandIndex = (band: Band): number => BAND_ORDER.indexOf(band);

/** How close the wrong options sit to the right one. */
export type DistractorCloseness = "far" | "mixed" | "near";

export interface DifficultySignals {
  archetype: Archetype;

  /**
   * Fame of the person the question is about, 0 (Messi) to 3 (a fringe squad
   * member). See prominence.playerFame. Omit for questions with no human
   * subject — a club's founding year has none.
   */
  subjectFame?: number;

  /**
   * Prominence of the LEAST well-known entity the player has to recognise, 0 to
   * 3. The least, not the average: a question about a move between Real Madrid
   * and Lorient is as hard as Lorient, because that is the end you have to know.
   */
  entityProminence?: number;

  /** Which football world the fact comes from. */
  tier?: DomainTier;

  /** How well known this particular fact is, independent of its subject. */
  factProminence?: FactProminence;

  /** The year the fact belongs to, for dated facts only. */
  year?: number;

  /** How close the wrong options sit to the right one. */
  distractors?: DistractorCloseness;
}

/** Fame is the heaviest single signal: three steps cross nearly three bands. */
const FAME_WEIGHT = 0.95;

/** Entity prominence matters, but less than the subject's own fame. */
const ENTITY_WEIGHT = 0.45;

const DISTRACTOR_WEIGHT: Record<DistractorCloseness, number> = {
  far: -0.55,
  mixed: 0,
  near: 0.85,
};

/**
 * How much harder a fact is for sitting further in the past.
 *
 * The steps track how football is actually remembered rather than even decades:
 * the current era is live memory, 2010+ is "recent", the Champions League
 * rebrand (1992) and the pre-colour-television era are real cliffs in what a
 * Hebrew-speaking audience has watched.
 */
export function eraWeight(year: number): number {
  if (year >= 2018) return 0;
  if (year >= 2010) return 0.35;
  if (year >= 2000) return 0.8;
  if (year >= 1992) return 1.3;
  if (year >= 1975) return 2.0;
  return 2.7;
}

/** The continuous score, before the recognition guards. Exported for tests. */
export function difficultyScore(signals: DifficultySignals): number {
  const spec = ARCHETYPES[signals.archetype];
  if (!spec) throw new Error(`unknown archetype: ${signals.archetype}`);

  return (
    spec.weight +
    (spec.reasoning ?? 0) +
    (signals.subjectFame ?? 0) * FAME_WEIGHT +
    (signals.entityProminence ?? 0) * ENTITY_WEIGHT +
    DOMAIN_TIER_WEIGHT[signals.tier ?? "CORE"] +
    FACT_PROMINENCE_WEIGHT[signals.factProminence ?? "KNOWN"] +
    (signals.year === undefined ? 0 : eraWeight(signals.year)) +
    DISTRACTOR_WEIGHT[signals.distractors ?? "mixed"]
  );
}

/**
 * Band thresholds.
 *
 * Calibrated against named questions rather than against a target histogram.
 * The anchors, all asserted in tests/footballDifficulty.test.ts:
 *
 *   Messi's nationality, far distractors            -0.35  EASY
 *   Mbappé → Real Madrid, 2024                       0.40  EASY
 *   Ronaldo → Real Madrid, 2009                      2.60  NORMAL
 *   Torres' club before Chelsea, near distractors    3.18  HARD
 *   Barcelona's founding year, near distractors      3.45  HARD
 *   C. Dagba, Auxerre → PSG, 2024                    5.19  EXPERT (by the guard)
 *   a 1995 Danish Superliga squad player's transfer  9.33  IMPOSSIBLE
 */
const BANDS: { max: number; band: Band }[] = [
  { max: 1.2, band: "EASY" },
  { max: 2.5, band: "NORMAL" },
  { max: 3.7, band: "HARD" },
  { max: 5.3, band: "EXPERT" },
  { max: Infinity, band: "IMPOSSIBLE" },
];

function bandForScore(score: number): Band {
  for (const { max, band } of BANDS) {
    if (score < max) return band;
  }
  return "IMPOSSIBLE";
}

export interface DifficultyResult {
  band: Band;
  score: number;
  /** The band the raw score produced, before the guards moved it. */
  rawBand: Band;
  /** Which guards fired, for the audit report. */
  guards: string[];
}

const atLeast = (band: Band, floor: Band): Band =>
  bandIndex(band) >= bandIndex(floor) ? band : floor;

const atMost = (band: Band, ceiling: Band): Band =>
  bandIndex(band) <= bandIndex(ceiling) ? band : ceiling;

/**
 * The recognition guards.
 *
 * THE HARD RECOGNITION RULE, which is the one that fixes the Dagba class of
 * question: HARD means "I recognise the player, but I need to think". If the
 * player's honest reaction is "who is this?", the question is not HARD however
 * mild its other signals are. So an obscure subject cannot sit below HARD, and a
 * very obscure one cannot sit below EXPERT.
 *
 * THE HEADLINE OVERRIDE, which the spec asks for by name: Cristiano Ronaldo at
 * Al-Nassr is a non-core-league fact that everybody knows, and Messi at Inter
 * Miami likewise. A fact classified HEADLINE is capped at HARD, so the non-core
 * penalty cannot bury a globally famous move.
 *
 * THE NON-CORE FLOORS, in the spec's own terms: a recognisable non-core fact is
 * HARD or above, an obscure one EXPERT or above, and obscure-on-obscure is
 * IMPOSSIBLE.
 *
 * Order matters: the headline cap is applied LAST, so it genuinely overrides the
 * floors rather than being overridden by them.
 */
export function applyGuards(rawBand: Band, signals: DifficultySignals): { band: Band; guards: string[] } {
  const guards: string[] = [];
  let band = rawBand;
  const fame = signals.subjectFame;
  const tier = signals.tier ?? "CORE";
  const fact = signals.factProminence ?? "KNOWN";
  const headline = fact === "HEADLINE";

  if (fame !== undefined && !headline) {
    if (fame >= VERY_OBSCURE_FAME_THRESHOLD) {
      const next = atLeast(band, "EXPERT");
      if (next !== band) guards.push("very-obscure-subject-floor-expert");
      band = next;
    } else if (fame >= OBSCURE_FAME_THRESHOLD) {
      const next = atLeast(band, "HARD");
      if (next !== band) guards.push("obscure-subject-floor-hard");
      band = next;
    }
  }

  if (tier === "NON_CORE" && !headline) {
    const obscureSubject = fame !== undefined && fame >= OBSCURE_FAME_THRESHOLD;
    const obscureFact = fact === "OBSCURE";
    if (obscureSubject && obscureFact) {
      const next = atLeast(band, "IMPOSSIBLE");
      if (next !== band) guards.push("non-core-obscure-on-obscure-floor-impossible");
      band = next;
    } else if (obscureSubject || obscureFact) {
      const next = atLeast(band, "EXPERT");
      if (next !== band) guards.push("non-core-obscure-floor-expert");
      band = next;
    } else {
      const next = atLeast(band, "HARD");
      if (next !== band) guards.push("non-core-floor-hard");
      band = next;
    }
  }

  if (headline) {
    const next = atMost(band, "HARD");
    if (next !== band) guards.push("headline-fact-ceiling-hard");
    band = next;
  }

  return { band, guards };
}

export function classifyDifficulty(signals: DifficultySignals): DifficultyResult {
  const score = difficultyScore(signals);
  const rawBand = bandForScore(score);
  const { band, guards } = applyGuards(rawBand, signals);
  return { band, score, rawBand, guards };
}

/** The band alone, for callers that do not need the working. */
export function difficultyFor(signals: DifficultySignals): Band {
  return classifyDifficulty(signals).band;
}

// ---------------------------------------------------------------------------
// Quick Start and the Daily Challenge
// ---------------------------------------------------------------------------

/**
 * Difficulties Quick Start may draw from.
 *
 * Quick Start is the home page's one-tap path: a first-time visitor, a casual
 * session, a repeat visit. Serving it EXPERT or IMPOSSIBLE questions is a
 * product bug regardless of how correctly they are labelled.
 */
export const QUICK_START_BANDS: Band[] = ["EASY", "NORMAL", "HARD"];

/**
 * The target mix for a Quick Start quiz, as weights.
 *
 * A quiz drawn uniformly from EASY/NORMAL/HARD is dominated by whichever band
 * the current filter happens to hold most of, which in this bank means HARD.
 * Weights make the intended shape explicit: for ten questions, 2 easy, 4 normal,
 * 4 hard.
 */
export const QUICK_START_MIX: Record<string, number> = { EASY: 2, NORMAL: 4, HARD: 4 };

/**
 * The builder's "מעורב" difficulty, as weights.
 *
 * WHY THIS HAS TO EXIST AT ALL. "MIXED" used to mean "add no difficulty clause",
 * which sounds like a mix and is not one: with no clause the quiz inherits the
 * bank's own shape, and this bank is 54% IMPOSSIBLE and 21% EXPERT because most
 * of the football it knows about is genuinely obscure. Measured on production,
 * three twenty-question MIXED quizzes came back:
 *
 *   EXPERT 5, IMPOSSIBLE 13, EASY 2
 *   IMPOSSIBLE 14, EASY 2, EXPERT 3, HARD 1
 *   IMPOSSIBLE 15, EXPERT 4, EASY 1
 *
 * 85-90% above HARD, with NORMAL absent from two of the three. A player
 * choosing "מעורב" was asking for variety and getting a wall.
 *
 * So the mix is declared rather than inherited: mostly playable, with a real
 * taste of the top bands. `apportion` drops any band the current filter has
 * nothing in and redistributes its share, so a narrow scope degrades into
 * "whatever it has" instead of coming back short.
 *
 * This is the FULL-BUILDER mix. Quick Start keeps QUICK_START_MIX and its three
 * bands; the Daily Challenge keeps its own curve. "Mixed" means something
 * different in each, and each says so in its own constant.
 */
export const BUILDER_MIXED_MIX: Record<string, number> = {
  EASY: 15,
  NORMAL: 30,
  HARD: 30,
  EXPERT: 15,
  IMPOSSIBLE: 10,
};

/** Every band, in order, for a full-builder mixed draw. */
export const ALL_BANDS: Band[] = ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];

/**
 * Whether a HARD question is familiar enough for Quick Start.
 *
 * The extra guard the spec asks for. A question can be correctly classified HARD
 * and still be the wrong thing to put in front of a casual player — "hard but
 * recognisable" is the bar, and the signal that decides it is the subject's fame
 * and the tier of the competition, not the band.
 */
export function isQuickStartFriendly(signals: {
  band: Band;
  subjectFame?: number | null;
  entityProminence?: number | null;
  tier?: DomainTier | null;
}): boolean {
  if (!QUICK_START_BANDS.includes(signals.band)) return false;
  if (signals.band !== "HARD") return true;

  const fame = signals.subjectFame;
  const entity = signals.entityProminence;
  if (fame !== null && fame !== undefined && fame >= OBSCURE_FAME_THRESHOLD) return false;
  // A HARD question whose least-known entity is itself obscure is an Expert
  // question that happened to score low on its other signals.
  if (entity !== null && entity !== undefined && entity >= 2.3) return false;
  if (signals.tier === "NON_CORE") return false;
  return true;
}

/**
 * The Daily Challenge shape.
 *
 * Mostly playable, with a sting in the tail: one or two questions above HARD,
 * placed at the end so the challenge builds. Not an Expert gauntlet — the point
 * is that finishing it feels like an achievement, and that requires most of it
 * to be finishable.
 */
export const DAILY_CHALLENGE_MIX: Record<string, number> = { EASY: 1, NORMAL: 3, HARD: 4 };
export const DAILY_ABOVE_HARD_MIN = 1;
export const DAILY_ABOVE_HARD_MAX = 2;
export const ABOVE_HARD_BANDS: Band[] = ["EXPERT", "IMPOSSIBLE"];

/**
 * How many of a quiz's questions each band should supply.
 *
 * Largest-remainder apportionment over the weights, so a ten-question quiz with
 * the Quick Start mix comes out 2/4/4 exactly rather than 2/4/4 by luck. Bands
 * absent from `available` are dropped and their share redistributed, which is
 * what makes a narrow filter degrade into "whatever it has" instead of coming
 * back short.
 */
export function apportion(
  total: number,
  weights: Record<string, number>,
  available: Record<string, number>
): Record<string, number> {
  const bands = Object.keys(weights).filter((band) => (available[band] ?? 0) > 0);
  const quota: Record<string, number> = {};
  if (total <= 0 || bands.length === 0) return quota;

  const weightTotal = bands.reduce((sum, band) => sum + weights[band], 0);
  const exact = bands.map((band) => ({ band, want: (total * weights[band]) / weightTotal }));

  let assigned = 0;
  for (const { band, want } of exact) {
    const floor = Math.min(Math.floor(want), available[band] ?? 0);
    quota[band] = floor;
    assigned += floor;
  }

  // Hand out the remainder by largest fractional part, skipping bands that have
  // run out of questions.
  const byRemainder = [...exact].sort(
    (a, b) => (b.want - Math.floor(b.want)) - (a.want - Math.floor(a.want)) || a.band.localeCompare(b.band)
  );
  let guard = 0;
  while (assigned < total && guard++ < total * (bands.length + 1)) {
    let progressed = false;
    for (const { band } of byRemainder) {
      if (assigned >= total) break;
      if (quota[band] >= (available[band] ?? 0)) continue;
      quota[band]++;
      assigned++;
      progressed = true;
    }
    if (!progressed) break;
  }

  return quota;
}
