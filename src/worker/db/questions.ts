import type {
  AnswerMode,
  Category,
  Difficulty,
  GameMode,
  Question,
  QuestionClue,
  QuestionOption,
} from "../../shared/types.ts";
import { expandCompetitionCodes } from "../../shared/constants.ts";

export interface QuestionFilter {
  region: string | null;
  countries: string[];
  competitions: string[];
  categories: Category[];
  difficulty: Difficulty | "MIXED";
  /**
   * The `mode` column, or null for "any mode".
   *
   * Nullable because of "מעורב" question type: a mixed quiz spans Who Am I,
   * Career Path and the classic quiz, and its availability count has to span
   * them too. A count that silently applied `mode = 'CLASSIC'` to a mixed
   * selection would under-report by two thirds and the builder would disable
   * options it can perfectly well serve.
   */
  gameMode: GameMode | null;
  answerMode: AnswerMode;
  /**
   * Restricts to questions cleared for the home page's one-tap path.
   *
   * "Hard but recognisable" cannot be expressed as a difficulty band — a
   * question can be correctly labelled HARD and still be the wrong thing to put
   * in front of somebody who tapped one button. `quick_start_safe` carries that
   * judgement, set when the question was classified (migration 0008).
   */
  quickStartSafe?: boolean;
}

interface QuestionRow {
  id: number;
  public_id: string;
  mode: string;
  category: string;
  difficulty: string;
  question_he: string;
  explanation_he: string | null;
  verified: number;
  source_label: string | null;
  canonical_answer: string | null;
  supports_free_text: number;
}

// Builds the WHERE clause + bound params for the scope/category/difficulty
// filters. Scope matching is "match ANY requested scope" via EXISTS, and is
// skipped entirely when the caller did not narrow by region/country/competition
// (i.e. "all of football" requests never filter on question_scopes).
export function buildWhere(filter: QuestionFilter): { where: string; params: unknown[] } {
  const clauses = ["q.active = 1"];
  const params: unknown[] = [];

  if (filter.gameMode) {
    clauses.push("q.mode = ?");
    params.push(filter.gameMode);
  }

  if (filter.categories.length > 0) {
    clauses.push(`q.category IN (${filter.categories.map(() => "?").join(",")})`);
    params.push(...filter.categories);
  }

  if (filter.difficulty !== "MIXED") {
    clauses.push("q.difficulty = ?");
    params.push(filter.difficulty);
  }

  // Free-text quizzes can only use questions that carry a single canonical
  // answer plus aliases.
  if (filter.answerMode === "FREE_TEXT") {
    clauses.push("q.supports_free_text = 1");
  }

  if (filter.quickStartSafe) {
    clauses.push("q.quick_start_safe = 1");
  }

  // "ALL" (or no selection) means "no competition restriction" — it must
  // never be expanded into a positive filter, since plenty of questions
  // (WHO_AM_I, CAREER_PATH, general trivia) are scoped by region/country
  // only and carry no COMPETITION scope tag at all.
  const competitionsRequested = filter.competitions.filter((c) => c !== "ALL");

  /*
    SCOPE: OR WITHIN A DIMENSION, AND ACROSS DIMENSIONS.

    This used to be one flat OR over every requested scope tag, with a note
    saying it "only broadens results in the rarer case where a user narrows both
    a region AND a specific competition". That case is not rare — it is what the
    wizard's whole geography branch produces, because toConfiguration sends the
    continent, the country AND the league together. Measured against production:

      Europe                        1,106
      Europe + Spain                1,143
      Europe + Spain + La Liga      1,144
      Spain alone                     511
      La Liga alone                   490

    Every drill-down step made the pool BIGGER. A player who walked continent →
    country → league and asked for La Liga got all of Europe and then some, which
    is the one thing the builder must never do: silently serve questions nobody
    asked for. The funnel was decoration.

    The dimensions nest properly in the data — a La Liga question carries
    COMPETITION=LA_LIGA, COUNTRY=ESP and REGION=EUROPE, and 1,386 of the 1,493
    Spanish questions also carry REGION=EUROPE — so an AND across dimensions is
    both what the UI means and something the bank can answer. One EXISTS per
    dimension, each matching any value within it: "in Europe, AND Spanish, AND
    in La Liga".

    Two consequences worth stating. A dimension the caller did not narrow is not
    filtered at all, so "all of football" still reads no scope rows. And a
    competition with no scope rows of its own now correctly returns nothing
    instead of quietly falling back to its region — the Conference League used to
    return 1,106 Europe questions this way. The builder disables an option whose
    real count cannot fill the quiz, which is how that dead end is kept off the
    screen rather than papered over in the query.
  */
  const scopeGroups: { type: string; values: string[] }[] = [];
  if (filter.region && filter.region !== "WORLD") {
    scopeGroups.push({ type: "REGION", values: [filter.region] });
  }
  if (filter.countries.length > 0) {
    scopeGroups.push({ type: "COUNTRY", values: filter.countries });
  }
  if (competitionsRequested.length > 0) {
    scopeGroups.push({ type: "COMPETITION", values: expandCompetitionCodes(competitionsRequested) });
  }

  for (const group of scopeGroups) {
    const placeholders = group.values.map(() => "?").join(",");
    clauses.push(
      `EXISTS (SELECT 1 FROM question_scopes s WHERE s.question_id = q.id` +
        ` AND s.scope_type = ? AND s.scope_value IN (${placeholders}))`
    );
    params.push(group.type, ...group.values);
  }

  return { where: clauses.join(" AND "), params };
}

export async function countAvailableQuestions(db: D1Database, filter: QuestionFilter): Promise<number> {
  const { where, params } = buildWhere(filter);
  const stmt = db.prepare(`SELECT COUNT(*) as cnt FROM questions q WHERE ${where}`).bind(...params);
  const row = await stmt.first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/**
 * D1 rejects any statement with more than 100 bound parameters:
 *   D1_ERROR: too many SQL variables ... SQLITE_ERROR
 *
 * That ceiling is shared by the whole statement, so the filter's own parameters
 * and anything else bound alongside them compete for the same budget. It is why
 * the recently-seen list is no longer part of the query at all (see below).
 */
export const D1_MAX_BOUND_PARAMS = 100;

/** The range `shuffle_key` is drawn from, matching migration 0007. */
const SHUFFLE_SPACE = 1_000_000_000;

/**
 * How many candidates to pull per question wanted.
 *
 * The point of a window wider than the quiz: rows adjacent in `shuffle_key` are
 * adjacent in every selection that starts before them, so taking exactly
 * `limit` rows from the pivot would mean question A always arrives with the same
 * B and C after it. Eight times the quiz length, shuffled in memory, gives a
 * very large number of possible sets per pivot while still reading hundreds of
 * rows instead of fifteen thousand.
 */
const CANDIDATE_FACTOR = 8;

/** Never read more than this many candidate rows, whatever the quiz length. */
const MAX_CANDIDATES = 400;

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** A uniform pivot into the shuffle space, from the CSRNG the platform provides. */
function randomPivot(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % SHUFFLE_SPACE;
}

/** One window of candidate ids, walked in `shuffle_key` order. */
async function candidateWindow(
  db: D1Database,
  where: string,
  params: unknown[],
  comparison: ">=" | "<",
  pivot: number,
  limit: number
): Promise<number[]> {
  const { results } = await db
    .prepare(
      `SELECT q.id FROM questions q
       WHERE ${where} AND q.shuffle_key ${comparison} ?
       ORDER BY q.shuffle_key
       LIMIT ?`
    )
    .bind(...params, pivot, limit)
    .all<{ id: number }>();
  return results.map((r) => r.id);
}

/**
 * Selects up to `limit` matching, active question ids at random.
 *
 * WHAT THIS USED TO DO, AND WHY IT CHANGED. The query was
 * `… ORDER BY RANDOM() LIMIT ?`, which measured at 25,197 rows read to return
 * ten, with a `USE TEMP B-TREE FOR ORDER BY` in the plan — SQLite has to give
 * every matching row a random key and sort all of them to find the smallest ten.
 * No index can fix that; the sort is inherent to the ordering.
 *
 * HOW IT WORKS NOW. Every question carries a fixed random `shuffle_key`
 * (migration 0007), indexed behind the filter columns. Picking a random pivot in
 * that space and walking the index forwards from it reads only the rows it
 * returns, in index order, with no sort at all — and wraps to the start of the
 * space when the pivot lands near the end. The candidate window is deliberately
 * wider than the quiz and shuffled here, so the result is not a fixed run of
 * neighbours.
 *
 * `excludeIds` holds questions the player saw recently. They are still
 * de-prioritised rather than filtered out — fresh questions first, recently-seen
 * ones only to make up the numbers — but that now happens in memory over the
 * candidate window instead of as a CASE expression in the ORDER BY. Which also
 * means the recently-seen ids no longer reach the SQL text at all: there is now
 * no value anywhere in this module that is interpolated rather than bound.
 */
export async function pickQuestionIds(
  db: D1Database,
  filter: QuestionFilter,
  limit: number,
  excludeIds: number[] = []
): Promise<number[]> {
  if (limit <= 0) return [];

  const { where, params } = buildWhere(filter);
  const windowSize = Math.min(MAX_CANDIDATES, Math.max(limit, limit * CANDIDATE_FACTOR));
  const pivot = randomPivot();

  // Forwards from the pivot, then wrap to the beginning of the space for the
  // remainder. Two bounded index scans, each reading only what it returns.
  const forward = await candidateWindow(db, where, params, ">=", pivot, windowSize);
  let candidates = forward;

  /*
    WHEN TO WRAP, which is where the remaining cost lives.

    A pivot near the end of the key space leaves a short forward range, so the
    remainder has to come from the beginning. But measured against production,
    the wrap is also the expensive half, and usually an unnecessary one:

      filter                               forward scan
      mode only                            80 rows for a window of 80
      mode + 3 categories + a competition  7,031 rows, and the LIMIT is never
                                           reached at any window size from 40
                                           to 240

    The second row is the whole story. When a filter is selective enough, the
    scan runs out of matching rows before it runs out of window — so
    `forward.length < windowSize` is true not because the pivot was unlucky but
    because the bank does not hold that many matching questions. Wrapping then
    walks the rest of the index for candidates we do not need, and roughly
    doubles the cost of the most expensive query in the product.

    So the wrap is conditional on actually being short. Twice the quiz length is
    the bar: enough spare candidates for the shuffle below to mean something,
    without a second scan whenever a filter happens to be narrow.
  */
  if (forward.length < Math.min(windowSize, limit * 2)) {
    const wrapped = await candidateWindow(db, where, params, "<", pivot, windowSize - forward.length);
    // Deduplicated rather than merely concatenated. The two ranges are disjoint
    // in SQL — `>= pivot` and `< pivot` cannot both match a row — so this is
    // belt and braces, and it is here because "never duplicates" is part of
    // this function's contract and a contract should not depend on a reader
    // noticing that two predicates are complementary. A quiz with the same
    // question twice in it is a visible, embarrassing bug.
    candidates = [...new Set([...forward, ...wrapped])];
  }

  if (candidates.length === 0) return [];

  // Fresh first, seen only to make up the numbers — the same rule as before,
  // applied to the window rather than to the whole table.
  const seen = new Set(excludeIds);
  const fresh = shuffle(candidates.filter((id) => !seen.has(id)));
  const repeats = shuffle(candidates.filter((id) => seen.has(id)));

  return [...fresh, ...repeats].slice(0, limit);
}

// Fetches full Question objects (options + clues) for a fixed, ordered list
// of question ids — used both for fresh quizzes and for replaying a stored
// challenge/daily quiz exactly.
export async function hydrateQuestions(db: D1Database, ids: number[]): Promise<Question[]> {
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");

  /**
   * ONE ROUND TRIP, NOT FIVE.
   *
   * This was `Promise.all` over five separate `.all()` calls, which reads like
   * it parallelises them — and in JavaScript terms it does. But each one is its
   * own subrequest from the Worker to D1, so a quiz cost five network round
   * trips here plus two more upstream, and under load they queue.
   *
   * `batch()` sends all five statements in a single round trip and returns their
   * results in order. Measured against production at 50 concurrent quiz starts,
   * this and the parallel count in `buildQuiz` together took p95 from 1499ms to
   * the figure in the concurrency report.
   *
   * The statements are unchanged, and so is the order of the destructuring
   * below — `batch` guarantees results come back in the order the statements
   * were given.
   */
  const [questionRows, optionRows, clueRows, aliasRows, hintRows] = await db.batch<never>([
    db.prepare(`SELECT * FROM questions WHERE id IN (${placeholders})`).bind(...ids),
    db
      .prepare(`SELECT * FROM question_options WHERE question_id IN (${placeholders}) ORDER BY sort_order ASC`)
      .bind(...ids),
    db
      .prepare(`SELECT * FROM question_clues WHERE question_id IN (${placeholders}) ORDER BY sort_order ASC`)
      .bind(...ids),
    db
      .prepare(`SELECT question_id, alias FROM answer_aliases WHERE question_id IN (${placeholders})`)
      .bind(...ids),
    db
      .prepare(
        `SELECT question_id, text FROM question_hints WHERE question_id IN (${placeholders}) ORDER BY order_index ASC`
      )
      .bind(...ids),
  ]) as unknown as [
    { results: QuestionRow[] },
    { results: { id: number; question_id: number; answer_text: string; is_correct: number }[] },
    { results: { question_id: number; clue_he: string; sort_order: number }[] },
    { results: { question_id: number; alias: string }[] },
    { results: { question_id: number; text: string }[] },
  ];

  const optionsByQuestion = new Map<number, QuestionOption[]>();
  for (const row of optionRows.results) {
    const list = optionsByQuestion.get(row.question_id) ?? [];
    list.push({ id: row.id, text: row.answer_text, isCorrect: row.is_correct === 1 });
    optionsByQuestion.set(row.question_id, list);
  }

  const cluesByQuestion = new Map<number, QuestionClue[]>();
  for (const row of clueRows.results) {
    const list = cluesByQuestion.get(row.question_id) ?? [];
    list.push({ text: row.clue_he, order: row.sort_order });
    cluesByQuestion.set(row.question_id, list);
  }

  const aliasesByQuestion = new Map<number, string[]>();
  for (const row of aliasRows.results) {
    aliasesByQuestion.set(row.question_id, [...(aliasesByQuestion.get(row.question_id) ?? []), row.alias]);
  }

  const hintsByQuestion = new Map<number, string[]>();
  for (const row of hintRows.results) {
    hintsByQuestion.set(row.question_id, [...(hintsByQuestion.get(row.question_id) ?? []), row.text]);
  }

  const byId = new Map<number, QuestionRow>();
  for (const row of questionRows.results) byId.set(row.id, row);

  const questions: Question[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    questions.push({
      id: row.id,
      publicId: row.public_id,
      mode: row.mode as GameMode,
      category: row.category as Category,
      difficulty: row.difficulty as Difficulty,
      questionHe: row.question_he,
      explanationHe: row.explanation_he,
      options: shuffle(optionsByQuestion.get(row.id) ?? []),
      clues: cluesByQuestion.get(row.id) ?? [],
      verified: row.verified === 1,
      sourceLabel: row.source_label,
      supportsFreeText: row.supports_free_text === 1,
      canonicalAnswer: row.canonical_answer,
      aliases: aliasesByQuestion.get(row.id) ?? [],
      hints: hintsByQuestion.get(row.id) ?? [],
    });
  }
  return questions;
}
