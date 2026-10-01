import type { Quiz, QuizConfiguration } from "../../shared/types";
import { countAvailableQuestions, hydrateQuestions, pickQuestionIds, type QuestionFilter } from "../db/questions";

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

// Builds a stable, deduplicated quiz for the given configuration.
// If fewer active questions exist than requested, it returns everything
// available rather than silently duplicating questions — the caller
// (API layer) reports availableCount vs requestedCount to the client.
export async function buildQuiz(db: D1Database, config: QuizConfiguration): Promise<Quiz> {
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

export async function buildQuizFromQuestionIds(db: D1Database, config: QuizConfiguration, ids: number[]): Promise<Quiz> {
  const questions = await hydrateQuestions(db, ids);
  return {
    configuration: config,
    questions,
    requestedCount: config.questionCount,
    availableCount: questions.length,
  };
}
