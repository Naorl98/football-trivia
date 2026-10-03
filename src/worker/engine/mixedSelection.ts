// "מעורב" — the real thing, for the full builder.
//
// WHAT WAS WRONG
//
// MIXED meant "add no clause". For difficulty that is not a mix, it is an
// inheritance: with no difficulty predicate the quiz takes the shape of the
// bank, and this bank is 54% IMPOSSIBLE and 21% EXPERT because most of the
// football it knows about is genuinely obscure. Three twenty-question MIXED
// quizzes from production came back 18, 17 and 19 questions above HARD, with
// NORMAL missing from two of them. For question type there was no mixed option
// at all, and there could not be: `q.mode = ?` is a single-value filter, so a
// quiz spanning Who Am I, Career Path and the classic quiz cannot be one query.
//
// WHAT THIS DOES
//
// Declares the shape and draws to it, one query per cell of a small grid.
//
//   difficulty mixed  -> the five bands, weighted BUILDER_MIXED_MIX
//   type mixed        -> the eleven mixed-eligible types, each capped at 35%
//   both mixed        -> a (type, band) grid, built so that BOTH marginals hold
//
// THE GRID IS THE POINT. Apportioning across types alone and then letting each
// type's query pick any difficulty reproduces the original bug inside every
// cell. Apportioning across bands alone and letting each band pick any type
// hands the quiz to transfers, which are 7,553 of 14,946 active questions. Only
// assigning both at once gives a quiz that is mixed along both axes, and that is
// what the spec means by "mixed must feel mixed".
//
// COST. The grid has one cell per question wanted, not one per (type x band)
// pair: a ten-question quiz is about ten cells, not fifty-five, because a cell
// is created only where the two quotas actually meet. Each cell reads a bounded
// window, so a mixed quiz costs a few hundred rows read — the same order as an
// ordinary one.

import type { Category, Difficulty, GameMode } from "../../shared/types.ts";
import { ALL_BANDS, apportion, BUILDER_MIXED_MIX } from "../../server/football/difficulty.ts";
import {
  MIXED_TYPE_KEYS,
  MIXED_TYPE_MAX_SHARE,
  QUESTION_TYPE_BY_KEY,
} from "../../shared/questionTypes.ts";
import { buildWhere, type QuestionFilter } from "../db/questions.ts";

/** The range `shuffle_key` is drawn from, matching migration 0007. */
const SHUFFLE_SPACE = 1_000_000_000;

/** Candidates read per question wanted in a cell, and the ceiling per cell. */
const CELL_OVERSAMPLE = 6;
const MAX_PER_CELL = 48;

function randomPivot(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % SHUFFLE_SPACE;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** One cell of the grid: how many questions of this type, in this band. */
interface Cell {
  typeKey: string | null;
  band: Difficulty | null;
  want: number;
}

interface CandidateRow {
  id: number;
  difficulty: string;
}

/**
 * Pairs the two quotas into cells whose marginals are both the quotas.
 *
 * A transportation problem, solved greedily, which is exact here because no
 * cell has a capacity of its own: walk the types in order and hand each one
 * bands until its quota is filled, moving to the next band when that band runs
 * out. The result sums to `total` along both axes by construction.
 */
function gridOf(
  typeQuota: Record<string, number>,
  bandQuota: Record<string, number>
): Cell[] {
  const types = Object.entries(typeQuota).filter(([, n]) => n > 0);
  const bands = Object.entries(bandQuota).filter(([, n]) => n > 0);
  if (types.length === 0) {
    return bands.map(([band, want]) => ({ typeKey: null, band: band as Difficulty, want }));
  }
  if (bands.length === 0) {
    return types.map(([typeKey, want]) => ({ typeKey, band: null, want }));
  }

  const cells: Cell[] = [];
  const bandLeft = new Map(bands);
  // Largest band first, so the single-question types spread over the common
  // bands rather than all landing on whichever band happens to be listed first.
  const bandOrder = bands
    .map(([band]) => band)
    .sort((a, b) => (bandLeft.get(b) ?? 0) - (bandLeft.get(a) ?? 0));

  for (const [typeKey, typeWant] of types) {
    let remaining = typeWant;
    for (const band of bandOrder) {
      if (remaining <= 0) break;
      const available = bandLeft.get(band) ?? 0;
      if (available <= 0) continue;
      const take = Math.min(remaining, available);
      cells.push({ typeKey, band: band as Difficulty, want: take });
      bandLeft.set(band, available - take);
      remaining -= take;
    }
    // A type left over once every band quota is spent takes any band. This only
    // happens when rounding leaves the two quotas disagreeing by a question.
    if (remaining > 0) cells.push({ typeKey, band: null, want: remaining });
  }
  return cells;
}

/** The filter for one cell: the caller's scope, narrowed by the cell's type and band. */
function cellFilter(base: QuestionFilter, cell: Cell): QuestionFilter {
  const spec = cell.typeKey ? QUESTION_TYPE_BY_KEY.get(cell.typeKey) : undefined;
  return {
    ...base,
    gameMode: (spec?.mode ?? base.gameMode) as GameMode,
    categories: (spec && spec.categories.length > 0 ? spec.categories : base.categories) as Category[],
    difficulty: cell.band ?? "MIXED",
  };
}

export interface MixedSelection {
  ids: number[];
  /** What was actually drawn, per band and per type — the numbers QA asserts on. */
  byBand: Record<string, number>;
  byType: Record<string, number>;
  short: boolean;
}

/**
 * Draws a quiz that is mixed along whichever axes the caller left as MIXED.
 *
 * `mixedType` is a separate flag rather than a magic value in the filter because
 * a question type is two filter fields (mode and categories) and "both unset"
 * does not mean "mixed" — it means the classic quiz.
 */
export async function selectMixed(
  db: D1Database,
  base: QuestionFilter,
  total: number,
  options: { mixedType: boolean; excludeIds?: number[] }
): Promise<MixedSelection> {
  const mixedDifficulty = base.difficulty === "MIXED";
  const exclude = new Set(options.excludeIds ?? []);

  /*
    THE TYPE CAP, applied as a capacity rather than trimmed afterwards.

    `apportion` hands out by weight and availability, and "availability" in the
    sense of how many questions a type HAS is exactly the signal that must not
    decide the mix — transfers would win every time. So every eligible type gets
    equal weight and the same ceiling, and the ceiling is the spec's 35%: at most
    four of any one type in a ten-question quiz, never seven transfer questions.
  */
  const typeCap = Math.max(1, Math.floor(total * MIXED_TYPE_MAX_SHARE));
  const typeQuota = options.mixedType
    ? apportion(
        total,
        Object.fromEntries(MIXED_TYPE_KEYS.map((key) => [key, 1])),
        Object.fromEntries(MIXED_TYPE_KEYS.map((key) => [key, typeCap]))
      )
    : {};

  const bandQuota = mixedDifficulty
    ? apportion(total, BUILDER_MIXED_MIX, Object.fromEntries(ALL_BANDS.map((band) => [band, total])))
    : {};

  const cells = gridOf(typeQuota, bandQuota);
  if (cells.length === 0) return { ids: [], byBand: {}, byType: {}, short: true };

  const statements = cells.map((cell) => {
    const { where, params } = buildWhere(cellFilter(base, cell));
    const limit = Math.min(MAX_PER_CELL, Math.max(4, cell.want * CELL_OVERSAMPLE));
    return db
      .prepare(
        `SELECT q.id, q.difficulty FROM questions q
          WHERE ${where} AND q.shuffle_key >= ?
          ORDER BY q.shuffle_key
          LIMIT ?`
      )
      .bind(...params, randomPivot(), limit);
  });

  const batched = (await db.batch(statements)) as unknown as { results: CandidateRow[] }[];

  const chosen: number[] = [];
  const taken = new Set<number>();
  const byBand: Record<string, number> = {};
  const byType: Record<string, number> = {};
  /** Cells that came back short, with what they still owe. */
  const shortfall: { cell: Cell; owed: number }[] = [];

  const credit = (cell: Cell, row: CandidateRow) => {
    taken.add(row.id);
    chosen.push(row.id);
    byBand[row.difficulty] = (byBand[row.difficulty] ?? 0) + 1;
    if (cell.typeKey) byType[cell.typeKey] = (byType[cell.typeKey] ?? 0) + 1;
  };

  cells.forEach((cell, index) => {
    const rows = batched[index]?.results ?? [];
    // Fresh questions first; recently-seen ones only to make up the numbers —
    // the same rule pickQuestionIds applies, for the same reason.
    const fresh = shuffle(rows.filter((r) => !exclude.has(r.id) && !taken.has(r.id)));
    const repeats = shuffle(rows.filter((r) => exclude.has(r.id) && !taken.has(r.id)));
    const take = [...fresh, ...repeats].slice(0, cell.want);
    for (const row of take) credit(cell, row);
    if (take.length < cell.want) shortfall.push({ cell, owed: cell.want - take.length });
  });

  /*
    THE RELAXATION PASS, and what it is allowed to relax.

    A cell comes back short when the scope holds nothing of that type in that
    band — "Israeli coaches, impossible" is a real selection with no questions
    behind it. Coming back short is reported rather than papered over, but a quiz
    one question light because a single cell was empty deserves a second look, so
    each short cell is retried with its BAND dropped and its TYPE kept.

    Type, not band, because the type is what the player chose on a card and the
    band is what "מעורב" left to us. Relaxing the type would quietly serve a
    question shape nobody asked for; relaxing the band only moves within a mix
    the player already accepted as mixed. Quick Start never reaches this code —
    its bands are a hard allow-list in difficultyPolicy.ts, and that rule does
    not bend for a short quiz.
  */
  if (shortfall.length > 0 && chosen.length < total) {
    const retries = shortfall.map(({ cell, owed }) => {
      const { where, params } = buildWhere(cellFilter(base, { ...cell, band: null }));
      return db
        .prepare(
          `SELECT q.id, q.difficulty FROM questions q
            WHERE ${where} AND q.shuffle_key >= ?
            ORDER BY q.shuffle_key
            LIMIT ?`
        )
        .bind(...params, randomPivot(), Math.min(MAX_PER_CELL, Math.max(4, owed * CELL_OVERSAMPLE)));
    });
    const extra = (await db.batch(retries)) as unknown as { results: CandidateRow[] }[];
    shortfall.forEach(({ cell, owed }, index) => {
      const rows = (extra[index]?.results ?? []).filter((r) => !taken.has(r.id));
      for (const row of shuffle(rows).slice(0, owed)) {
        if (chosen.length >= total) break;
        credit(cell, row);
      }
    });
  }

  return {
    ids: shuffle(chosen).slice(0, total),
    byBand,
    byType,
    short: chosen.length < total,
  };
}
