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
  };
}

// Builds a stable, deduplicated quiz for the given configuration.
// If fewer active questions exist than requested, it returns everything
// available rather than silently duplicating questions — the caller
// (API layer) reports availableCount vs requestedCount to the client.
export async function buildQuiz(db: D1Database, config: QuizConfiguration): Promise<Quiz> {
  const filter = toFilter(config);
  const availableCount = await countAvailableQuestions(db, filter);
  const ids = await pickQuestionIds(db, filter, config.questionCount);
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
