import type { NavigateFunction } from "react-router-dom";
import type { QuizConfiguration } from "../../shared/types";
import { fetchQuiz, UserMessageError } from "./api";
import { saveActiveQuiz } from "./quizSession";
import { getRecentQuestionIds } from "./recentQuestions";

export async function startQuiz(navigate: NavigateFunction, config: QuizConfiguration): Promise<void> {
  // Recently-seen questions are sent along so the engine can prefer fresh ones.
  const quiz = await fetchQuiz({ ...config, excludeQuestionIds: getRecentQuestionIds() });
  if (quiz.questions.length === 0) {
    // UserMessageError rather than Error: this text is written for a player, and
    // tagging it as such is what lets the pages show it without having to decide
    // whether an arbitrary `.message` is safe to put on screen.
    throw new UserMessageError("לא נמצאו שאלות מתאימות לבחירה הזו. נסו להרחיב את הסינון.");
  }
  saveActiveQuiz({ quiz, startedAt: Date.now() });
  navigate("/play");
}
