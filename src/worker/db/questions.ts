import type { Category, Difficulty, GameMode, Question, QuestionClue, QuestionOption } from "../../shared/types";
import { expandCompetitionCodes } from "../../shared/constants";

export interface QuestionFilter {
  region: string | null;
  countries: string[];
  competitions: string[];
  categories: Category[];
  difficulty: Difficulty | "MIXED";
  gameMode: GameMode;
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
}

// Builds the WHERE clause + bound params for the scope/category/difficulty
// filters. Scope matching is "match ANY requested scope" via EXISTS, and is
// skipped entirely when the caller did not narrow by region/country/competition
// (i.e. "all of football" requests never filter on question_scopes).
function buildWhere(filter: QuestionFilter): { where: string; params: unknown[] } {
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

// Selects up to `limit` matching, active question ids at random. Never
// duplicates: SQLite RANDOM() ordering over distinct rows guarantees uniqueness.
export async function pickQuestionIds(db: D1Database, filter: QuestionFilter, limit: number): Promise<number[]> {
  const { where, params } = buildWhere(filter);
  const stmt = db
    .prepare(`SELECT q.id FROM questions q WHERE ${where} ORDER BY RANDOM() LIMIT ?`)
    .bind(...params, limit);
  const { results } = await stmt.all<{ id: number }>();
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
  const [questionRows, optionRows, clueRows] = await Promise.all([
    db.prepare(`SELECT * FROM questions WHERE id IN (${placeholders})`).bind(...ids).all<QuestionRow>(),
    db
      .prepare(`SELECT * FROM question_options WHERE question_id IN (${placeholders}) ORDER BY sort_order ASC`)
      .bind(...ids)
      .all<{ id: number; question_id: number; answer_text: string; is_correct: number }>(),
    db
      .prepare(`SELECT * FROM question_clues WHERE question_id IN (${placeholders}) ORDER BY sort_order ASC`)
      .bind(...ids)
      .all<{ question_id: number; clue_he: string; sort_order: number }>(),
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
    });
  }
  return questions;
}
