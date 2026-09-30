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
  gameMode: GameMode;
  answerMode: AnswerMode;
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
  const clauses = ["q.active = 1", "q.mode = ?"];
  const params: unknown[] = [filter.gameMode];

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

  // "ALL" (or no selection) means "no competition restriction" — it must
  // never be expanded into a positive filter, since plenty of questions
  // (WHO_AM_I, CAREER_PATH, general trivia) are scoped by region/country
  // only and carry no COMPETITION scope tag at all.
  const competitionsRequested = filter.competitions.filter((c) => c !== "ALL");

  const scopeValues: { type: string; value: string }[] = [];
  if (filter.region && filter.region !== "WORLD") {
    scopeValues.push({ type: "REGION", value: filter.region });
  }
  for (const c of filter.countries) scopeValues.push({ type: "COUNTRY", value: c });
  if (competitionsRequested.length > 0) {
    const expandedCompetitions = expandCompetitionCodes(competitionsRequested);
    for (const c of expandedCompetitions) scopeValues.push({ type: "COMPETITION", value: c });
  }

  // Note: scope matching is "question has ANY of the requested scope tags"
  // (region OR country OR competition), not a strict AND across dimensions.
  // In practice the builder UI leaves region at WORLD (skipped) once a
  // country/competition is chosen, so this only broadens results in the
  // rarer case where a user narrows both a region AND a specific competition.
  if (scopeValues.length > 0) {
    const scopeConditions = scopeValues.map(() => "(scope_type = ? AND scope_value = ?)").join(" OR ");
    clauses.push(
      `EXISTS (SELECT 1 FROM question_scopes s WHERE s.question_id = q.id AND (${scopeConditions}))`
    );
    for (const s of scopeValues) params.push(s.type, s.value);
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
 * and anything else bound alongside them compete for the same budget.
 */
export const D1_MAX_BOUND_PARAMS = 100;

/**
 * Renders question ids as SQL integer literals.
 *
 * These ids are the ONLY values in this module that are inlined rather than
 * bound, because binding them is what broke quiz creation: the recently-seen
 * list grows to hundreds of ids and blew the 100-parameter ceiling. Inlining is
 * safe here and nowhere else — every element is proven to be a finite integer
 * first, and anything else is dropped rather than coerced, so no caller-supplied
 * string can reach the SQL text.
 */
function toIdList(ids: number[]): string {
  return ids
    .filter((id) => Number.isInteger(id) && Number.isFinite(id))
    .map((id) => String(Math.trunc(id)))
    .join(",");
}

// Selects up to `limit` matching, active question ids at random. Never
// duplicates: SQLite RANDOM() ordering over distinct rows guarantees uniqueness.
//
// `excludeIds` holds questions the player saw recently. They are pushed to the
// back of the ordering rather than filtered out, so a player with a long
// history still gets a full quiz instead of an empty one — fresh questions
// first, recently-seen ones only to make up the numbers.
export async function pickQuestionIds(
  db: D1Database,
  filter: QuestionFilter,
  limit: number,
  excludeIds: number[] = []
): Promise<number[]> {
  const { where, params } = buildWhere(filter);

  const idList = toIdList(excludeIds);
  // `limit` is bound; the filter's params are bound; the exclude ids are not.
  const ordering = idList
    ? `(CASE WHEN q.id IN (${idList}) THEN 1 ELSE 0 END), RANDOM()`
    : `RANDOM()`;

  const { results } = await db
    .prepare(`SELECT q.id FROM questions q WHERE ${where} ORDER BY ${ordering} LIMIT ?`)
    .bind(...params, limit)
    .all<{ id: number }>();

  return results.map((r) => r.id);
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Fetches full Question objects (options + clues) for a fixed, ordered list
// of question ids — used both for fresh quizzes and for replaying a stored
// challenge/daily quiz exactly.
export async function hydrateQuestions(db: D1Database, ids: number[]): Promise<Question[]> {
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");
  const [questionRows, optionRows, clueRows, aliasRows, hintRows] = await Promise.all([
    db.prepare(`SELECT * FROM questions WHERE id IN (${placeholders})`).bind(...ids).all<QuestionRow>(),
    db
      .prepare(`SELECT * FROM question_options WHERE question_id IN (${placeholders}) ORDER BY sort_order ASC`)
      .bind(...ids)
      .all<{ id: number; question_id: number; answer_text: string; is_correct: number }>(),
    db
      .prepare(`SELECT * FROM question_clues WHERE question_id IN (${placeholders}) ORDER BY sort_order ASC`)
      .bind(...ids)
      .all<{ question_id: number; clue_he: string; sort_order: number }>(),
    db
      .prepare(`SELECT question_id, alias FROM answer_aliases WHERE question_id IN (${placeholders})`)
      .bind(...ids)
      .all<{ question_id: number; alias: string }>(),
    db
      .prepare(
        `SELECT question_id, text FROM question_hints WHERE question_id IN (${placeholders}) ORDER BY order_index ASC`
      )
      .bind(...ids)
      .all<{ question_id: number; text: string }>(),
  ]);

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
