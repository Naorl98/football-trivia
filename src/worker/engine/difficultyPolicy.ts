// Difficulty policy for the preset game modes.
//
// WHY THIS IS SERVER-SIDE
//
// Quick Start is the home page's one-tap path and must not serve EXPERT or
// IMPOSSIBLE questions. The Daily Challenge must feel harder, with one or two
// questions above HARD and the rest playable.
//
// Both are rules about WHICH QUESTIONS ARE SERVED, so they have to live where
// the questions are chosen. A client that sends `difficulty: "IMPOSSIBLE"` with
// `preset: "QUICK_START"` gets the Quick Start bands regardless — the preset
// decides the bands and the client's own difficulty is ignored for presets. That
// is not defensive programming for its own sake: the quiz endpoint is public and
// unauthenticated, and "the UI does not offer it" is not a constraint.
//
// ONE ROUND TRIP, NOT FIVE. A mixed quiz needs candidates from several bands,
// and the obvious implementation issues one query per band. `batch()` sends them
// together and returns their results in order, so a five-band Daily Challenge
// costs the same number of round trips as a one-band quiz. The same reasoning as
// hydrateQuestions in ../db/questions.ts.

import type { Difficulty } from "../../shared/types.ts";
import {
  ABOVE_HARD_BANDS,
  apportion,
  DAILY_ABOVE_HARD_MAX,
  DAILY_ABOVE_HARD_MIN,
  DAILY_CHALLENGE_MIX,
  QUICK_START_BANDS,
  QUICK_START_MIX,
} from "../../server/football/difficulty.ts";
import { buildWhere, type QuestionFilter } from "../db/questions.ts";

export type QuizPreset = "QUICK_START" | "DAILY_CHALLENGE";

export const QUIZ_PRESETS: QuizPreset[] = ["QUICK_START", "DAILY_CHALLENGE"];

/** The range `shuffle_key` is drawn from, matching migration 0007. */
const SHUFFLE_SPACE = 1_000_000_000;

/**
 * How many candidates to read per question wanted, per band.
 *
 * Wider than the quota so the in-memory shuffle has something to work with, and
 * capped so a 50-question quiz does not read the whole band.
 */
const OVERSAMPLE = 4;
const MAX_PER_BAND = 120;

function randomPivot(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % SHUFFLE_SPACE;
}

/** A deterministic PRNG, so a given Daily Challenge always reads the same way. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle<T>(items: T[], rand: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Reads a candidate window for each band, in one round trip.
 *
 * The scan is the same bounded walk over `shuffle_key` that pickQuestionIds
 * uses, per band, so it reads only the rows it returns. `quickStartSafe` adds
 * the familiarity guard; it is a column on `questions` rather than something
 * derived here, because "hard but recognisable" is a property of the question
 * and was decided when it was classified.
 */
async function candidatesByBand(
  db: D1Database,
  filter: QuestionFilter,
  bands: Difficulty[],
  wantPerBand: Map<Difficulty, number>,
  quickStartSafe: boolean
): Promise<Map<Difficulty, number[]>> {
  if (bands.length === 0) return new Map();

  const statements = bands.map((band) => {
    const { where, params } = buildWhere({ ...filter, difficulty: band, quickStartSafe });
    const want = Math.min(MAX_PER_BAND, Math.max(4, (wantPerBand.get(band) ?? 1) * OVERSAMPLE));
    const pivot = randomPivot();
    return db
      .prepare(
        `SELECT q.id, q.difficulty FROM questions q
          WHERE ${where} AND q.shuffle_key >= ?
          ORDER BY q.shuffle_key
          LIMIT ?`
      )
      .bind(...params, pivot, want);
  });

  const results = (await db.batch<{ id: number; difficulty: string }>(statements)) as unknown as {
    results: { id: number; difficulty: string }[];
  }[];

  const byBand = new Map<Difficulty, number[]>();
  bands.forEach((band, index) => {
    byBand.set(band, (results[index]?.results ?? []).map((row) => row.id));
  });
  return byBand;
}

/**
 * A second pass for bands whose first window came back short.
 *
 * A pivot near the end of the key space leaves a short forward range, and for a
 * narrow band — EASY holds 396 questions in production — that is the common
 * case rather than bad luck. Wrapping to the start of the space is what turns
 * "the pivot was unlucky" into "the band really is that small", and the
 * difference matters: one is worth a second query, the other means the quiz has
 * to rebalance.
 */
async function wrapShortBands(
  db: D1Database,
  filter: QuestionFilter,
  byBand: Map<Difficulty, number[]>,
  wantPerBand: Map<Difficulty, number>,
  quickStartSafe: boolean
): Promise<void> {
  const short = [...byBand.entries()].filter(
    ([band, ids]) => ids.length < (wantPerBand.get(band) ?? 1)
  );
  if (short.length === 0) return;

  const statements = short.map(([band, ids]) => {
    const { where, params } = buildWhere({ ...filter, difficulty: band, quickStartSafe });
    const want = Math.min(MAX_PER_BAND, Math.max(4, (wantPerBand.get(band) ?? 1) * OVERSAMPLE) - ids.length);
    return db
      .prepare(
        `SELECT q.id FROM questions q
          WHERE ${where}
          ORDER BY q.shuffle_key
          LIMIT ?`
      )
      .bind(...params, want);
  });

  const results = (await db.batch<{ id: number }>(statements)) as unknown as {
    results: { id: number }[];
  }[];

  short.forEach(([band, ids], index) => {
    const merged = new Set([...ids, ...(results[index]?.results ?? []).map((row) => row.id)]);
    byBand.set(band, [...merged]);
  });
}

export interface PresetSelection {
  ids: number[];
  /** What was actually drawn, by band — the number the QA report needs. */
  byBand: Record<string, number>;
  /** True when the pool could not fill the requested count. */
  short: boolean;
  /** Which bands were allowed to be drawn from at all. */
  allowedBands: Difficulty[];
}

/**
 * Fills per-band quotas from the windows, redistributing within the allowed set.
 *
 * THE RULE THAT MUST NOT BEND: a band outside `allowed` is never drawn from, for
 * any reason, including "the quiz would otherwise be short". A Quick Start quiz
 * of seven accessible questions is correct; one of ten with three Expert
 * questions in it is not. Falling short is reported, not papered over.
 */
function fillQuotas(
  total: number,
  weights: Record<string, number>,
  byBand: Map<Difficulty, number[]>,
  excludeIds: Set<number>,
  rand: () => number
): { picked: Map<Difficulty, number[]>; count: number } {
  const available: Record<string, number> = {};
  const pools = new Map<Difficulty, number[]>();
  for (const [band, ids] of byBand) {
    // Fresh questions first, recently-seen ones only to make up the numbers.
    const fresh = shuffle(ids.filter((id) => !excludeIds.has(id)), rand);
    const repeats = shuffle(ids.filter((id) => excludeIds.has(id)), rand);
    const pool = [...fresh, ...repeats];
    pools.set(band, pool);
    available[band] = pool.length;
  }

  const quota = apportion(total, weights, available);
  const picked = new Map<Difficulty, number[]>();
  let count = 0;
  for (const [band, want] of Object.entries(quota)) {
    const take = (pools.get(band as Difficulty) ?? []).slice(0, want);
    picked.set(band as Difficulty, take);
    count += take.length;
  }

  // Any shortfall is redistributed across the SAME allowed bands.
  if (count < total) {
    for (const [band, pool] of pools) {
      if (count >= total) break;
      const already = picked.get(band) ?? [];
      const extra = pool.slice(already.length, already.length + (total - count));
      picked.set(band, [...already, ...extra]);
      count += extra.length;
    }
  }

  return { picked, count };
}

/**
 * Quick Start: EASY, NORMAL and HARD only, mixed, familiarity-guarded.
 *
 * The familiarity guard is the part that is easy to miss. A question can be
 * correctly classified HARD and still be the wrong thing to hand somebody who
 * tapped one button — "לאיזו קבוצה עבר C. Dagba מ-Auxerre" is answerable and
 * verifiable and nobody tapping "כל העולם" wants to meet it. `quick_start_safe`
 * carries that judgement, set when the question was classified.
 */
export async function selectQuickStart(
  db: D1Database,
  filter: QuestionFilter,
  total: number,
  excludeIds: number[] = []
): Promise<PresetSelection> {
  const bands = QUICK_START_BANDS as Difficulty[];
  const want = new Map<Difficulty, number>(
    bands.map((band) => [band, Math.max(1, Math.round((total * QUICK_START_MIX[band]) / 10))])
  );

  const byBand = await candidatesByBand(db, filter, bands, want, true);
  await wrapShortBands(db, filter, byBand, want, true);

  const { picked, count } = fillQuotas(
    total,
    QUICK_START_MIX,
    byBand,
    new Set(excludeIds),
    Math.random
  );

  // Order is shuffled rather than banded: Quick Start is not a difficulty ramp,
  // it is a quick game, and a visible ramp makes the first three questions feel
  // like a warm-up to skip.
  const ids = shuffle([...picked.values()].flat());
  return {
    ids,
    byBand: Object.fromEntries([...picked].map(([band, list]) => [band, list.length])),
    short: count < total,
    allowedBands: bands,
  };
}

/**
 * The Daily Challenge: mostly playable, with one or two above HARD at the end.
 *
 * `seed` makes the whole thing deterministic for a given day, which matters
 * because the challenge is persisted and shared — two people comparing scores
 * must have answered the same questions in the same order.
 *
 * FALLBACK, stated because it is a quality rule and not an edge case: if no
 * EXPERT or IMPOSSIBLE question matches, the challenge is filled with another
 * HARD rather than with a bad Expert. A rigid ratio is worth less than a fair
 * question.
 */
export async function selectDailyChallenge(
  db: D1Database,
  filter: QuestionFilter,
  total: number,
  seed: string
): Promise<PresetSelection & { aboveHard: number }> {
  const rand = mulberry32(hashString(seed));
  const aboveHardTarget = Math.min(
    DAILY_ABOVE_HARD_MAX,
    Math.max(DAILY_ABOVE_HARD_MIN, Math.round(total / 8))
  );
  const baseTotal = Math.max(0, total - aboveHardTarget);

  const baseBands = ["EASY", "NORMAL", "HARD"] as Difficulty[];
  const bossBands = ABOVE_HARD_BANDS as Difficulty[];
  const want = new Map<Difficulty, number>([
    ...baseBands.map((band) => [band, Math.max(1, Math.round((baseTotal * DAILY_CHALLENGE_MIX[band]) / 8))] as [Difficulty, number]),
    ...bossBands.map((band) => [band, aboveHardTarget] as [Difficulty, number]),
  ]);

  // No familiarity guard here. The Daily Challenge is allowed to be obscure —
  // that is what makes it feel special — so long as it is fair and verifiable.
  const byBand = await candidatesByBand(db, filter, [...baseBands, ...bossBands], want, false);
  await wrapShortBands(db, filter, byBand, want, false);

  const baseWindows = new Map(baseBands.map((band) => [band, byBand.get(band) ?? []]));
  const base = fillQuotas(baseTotal, DAILY_CHALLENGE_MIX, baseWindows, new Set(), rand);

  // EXPERT before IMPOSSIBLE: an Expert question is difficult because of deeper
  // football knowledge, which is the kind of hard the final questions should be.
  const boss: number[] = [];
  for (const band of bossBands) {
    if (boss.length >= aboveHardTarget) break;
    const pool = shuffle(byBand.get(band) ?? [], rand);
    boss.push(...pool.slice(0, aboveHardTarget - boss.length));
  }

  // Fall back to extra HARD questions when the boss bands are empty.
  const bossShort = aboveHardTarget - boss.length;
  const picked = new Map(base.picked);
  if (bossShort > 0) {
    const hardPool = (byBand.get("HARD") ?? []).filter((id) => !(picked.get("HARD") ?? []).includes(id));
    picked.set("HARD", [...(picked.get("HARD") ?? []), ...shuffle(hardPool, rand).slice(0, bossShort)]);
  }

  /*
    ORDERING.

    Weakly increasing in difficulty, so the challenge builds, with one controlled
    bit of local disorder so it does not read as a mechanical ramp — the spec's
    own example ordering has a NORMAL at question four, after a HARD. The
    above-hard questions are kept strictly last: the final question is the boss
    question, and that only works if it is actually last.
  */
  const BAND_RANK: Record<string, number> = { EASY: 0, NORMAL: 1, HARD: 2, EXPERT: 3, IMPOSSIBLE: 4 };
  const ordered = [...picked.entries()]
    .flatMap(([band, ids]) => ids.map((id) => ({ id, rank: BAND_RANK[band] ?? 2 })))
    .sort((a, b) => a.rank - b.rank || rand() - 0.5);

  for (let i = 0; i < ordered.length - 1; i++) {
    // Swap adjacent neighbours a third of the time, which breaks the ramp
    // without ever moving a question more than one place.
    if (rand() < 0.33) [ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]];
  }

  const ids = [...ordered.map((entry) => entry.id), ...boss];
  const byBandCounts = Object.fromEntries([...picked].map(([band, list]) => [band, list.length]));
  for (const band of bossBands) byBandCounts[band] = 0;
  // The boss questions' bands are counted from what was actually drawn.
  let remaining = boss.length;
  for (const band of bossBands) {
    const drawn = Math.min(remaining, (byBand.get(band) ?? []).length);
    byBandCounts[band] = drawn;
    remaining -= drawn;
    if (remaining <= 0) break;
  }

  return {
    ids: ids.slice(0, total),
    byBand: byBandCounts,
    short: ids.length < total,
    allowedBands: [...baseBands, ...bossBands],
    aboveHard: boss.length,
  };
}
