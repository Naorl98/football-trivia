import type { Quiz, QuizConfiguration } from "../../shared/types";
import { countAvailableQuestions, hydrateQuestions, pickQuestionIds, type QuestionFilter } from "../db/questions";
import { selectDailyChallenge, selectQuickStart, type PresetSelection } from "./difficultyPolicy";

function toFilter(config: QuizConfiguration): QuestionFilter {
  return {
    region: config.region,
    countries: config.countries ?? [],
    competitions: config.competitions ?? [],
    categories: config.categories ?? [],
    difficulty: config.difficulty,
    gameMode: config.gameMode,
    answerMode: config.answerMode,
  };
}

/**
 * The filter an availability count should use for a preset.
 *
 * A Quick Start count that includes EXPERT and IMPOSSIBLE questions is a lie:
 * the quiz cannot draw from them, so they are not available. The count therefore
 * applies the same band and familiarity restrictions the selection does —
 * MIXED across the three Quick Start bands, with the familiarity guard on.
 */
function presetCountFilter(config: QuizConfiguration): QuestionFilter {
  const filter = toFilter(config);
  if (config.preset === "QUICK_START") {
    return { ...filter, difficulty: "MIXED", quickStartSafe: true };
  }
  return { ...filter, difficulty: "MIXED" };
}

// Builds a stable, deduplicated quiz for the given configuration.
// If fewer active questions exist than requested, it returns everything
// available rather than silently duplicating questions — the caller
// (API layer) reports availableCount vs requestedCount to the client.
export async function buildQuiz(db: D1Database, config: QuizConfiguration): Promise<Quiz> {
  /*
    PRESETS TAKE A DIFFERENT PATH, AND THE CLIENT'S DIFFICULTY IS IGNORED.

    Quick Start and the Daily Challenge are not "a quiz with a difficulty
    chosen for you" — they are quizzes with a difficulty MIX, drawn from a
    restricted set of bands, which a single `difficulty = ?` predicate cannot
    express. Routing them here rather than in the caller is what makes the rule
    unbypassable: every path that builds a quiz comes through this function.
  */
  if (config.preset) {
    return buildPresetQuiz(db, config);
  }

  const filter = toFilter(config);

  // The count and the selection are independent — both are derived from the
  // same filter and neither reads the other's result — so they go out together.
  // They were sequential, which made quiz generation three round trips deep
  // instead of two for no reason. Under concurrency that third trip is the one
  // that queues.
  const [availableCount, ids] = await Promise.all([
    countAvailableQuestions(db, filter),
    pickQuestionIds(db, filter, config.questionCount, config.excludeQuestionIds ?? []),
  ]);

  const questions = await hydrateQuestions(db, ids);

  return {
    configuration: config,
    questions,
    requestedCount: config.questionCount,
    availableCount,
  };
}

async function buildPresetQuiz(db: D1Database, config: QuizConfiguration): Promise<Quiz> {
  const filter = toFilter(config);
  const [availableCount, selection] = await Promise.all([
    countAvailableQuestions(db, presetCountFilter(config)),
    config.preset === "DAILY_CHALLENGE"
      ? selectDailyChallenge(db, filter, config.questionCount, dailySeed())
      : selectQuickStart(db, filter, config.questionCount, config.excludeQuestionIds ?? []),
  ]);

  const questions = await hydrateQuestions(db, selection.ids);

  return {
    configuration: config,
    // hydrateQuestions returns rows in the order of the ids it was given, so the
    // Daily Challenge's deliberate ordering — building to a boss question —
    // survives all the way to the client.
    questions,
    requestedCount: config.questionCount,
    availableCount,
  };
}

/**
 * The seed for an ad-hoc Daily Challenge build.
 *
 * The persisted path (db/daily.ts) passes the challenge date, which is what
 * makes two people's challenges identical. This is only reached if a client
 * asks the quiz endpoint directly for a DAILY_CHALLENGE preset, so it uses
 * today's date for the same reason.
 */
function dailySeed(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function buildQuizFromQuestionIds(db: D1Database, config: QuizConfiguration, ids: number[]): Promise<Quiz> {
  const questions = await hydrateQuestions(db, ids);
  return {
    configuration: config,
    questions,
    requestedCount: config.questionCount,
    availableCount: questions.length,
  };
}

export type { PresetSelection };
