import { rankFromAccuracy } from "./constants";
import type { AnswerRecord, ScoreBreakdown } from "./types";

// Centralized scoring — the single place quiz results are computed.
// Current rule: correct = 1 point, incorrect = 0. Kept intentionally simple,
// but isolated here so future rules (difficulty weight, speed bonus, streaks,
// per-game-mode multipliers) only need to change this function.
export function computeScore(answers: AnswerRecord[]): ScoreBreakdown {
  const total = answers.length;
  const correct = answers.filter((a) => a.correct).length;
  const incorrect = total - correct;
  const accuracy = total === 0 ? 0 : Math.round((correct / total) * 1000) / 10;
  const points = correct; // 1 point per correct answer

  return {
    correct,
    incorrect,
    total,
    accuracy,
    points,
    rank: rankFromAccuracy(accuracy),
  };
}
