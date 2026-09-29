import type { NavigateFunction } from "react-router-dom";
import type { QuizConfiguration } from "../../shared/types";
import { fetchQuiz } from "./api";
import { saveActiveQuiz } from "./quizSession";

export async function startQuiz(navigate: NavigateFunction, config: QuizConfiguration): Promise<void> {
  const quiz = await fetchQuiz(config);
  if (quiz.questions.length === 0) {
    throw new Error("לא נמצאו שאלות מתאימות לבחירה הזו. נסו להרחיב את הסינון.");
  }
  saveActiveQuiz({ quiz, startedAt: Date.now() });
  navigate("/play");
}
