import { rankFromAccuracy } from "./constants";
import type { AnswerRecord, ScoreBreakdown } from "./types";

// Centralized scoring — the single place quiz results are computed, used by
// both the client (live score) and the Worker (authoritative attempt logging).
// Never recompute any of this inside a presentation component.
//
// Current rules:
//   * correct answer = 1 point
//   * a revealed answer counts as not correct, and is reported separately so
//     the results screen can show "17 correct / 2 wrong / 1 revealed"
//   * accuracy is over all questions, so revealing costs you accuracy
//
// Difficulty weighting, speed bonuses and per-mode multipliers all belong in
// this function when they arrive.
export function computeScore(answers: AnswerRecord[]): ScoreBreakdown {
  const total = answers.length;
  const correct = answers.filter((a) => a.correct).length;
  const revealed = answers.filter((a) => a.revealed).length;
  const incorrect = total - correct - revealed;
  const accuracy = total === 0 ? 0 : Math.round((correct / total) * 1000) / 10;
  const points = correct;

  let streak = 0;
  let bestStreak = 0;
  for (const answer of answers) {
    streak = answer.correct ? streak + 1 : 0;
    if (streak > bestStreak) bestStreak = streak;
  }

  return {
    correct,
    incorrect,
    revealed,
    total,
    accuracy,
    points,
    footballIq: footballIqFromAnswers(answers),
    rank: rankFromAccuracy(accuracy),
    bestStreak,
  };
}

// A deterministic 0-100 "Football IQ" rating. Accuracy is the backbone; a
// consistent run and a light hint touch nudge it up, so two players on the same
// raw score are separated by how they got there. Always the same inputs -> the
// same number.
export function footballIqFromAnswers(answers: AnswerRecord[]): number {
  if (answers.length === 0) return 0;
  const total = answers.length;
  const correct = answers.filter((a) => a.correct).length;
  const accuracy = correct / total;

  let streak = 0;
  let bestStreak = 0;
  for (const a of answers) {
    streak = a.correct ? streak + 1 : 0;
    if (streak > bestStreak) bestStreak = streak;
  }

  const hintsUsed = answers.reduce((sum, a) => sum + (a.hintsUsed ?? 0), 0);

  const base = accuracy * 88; // 0-88
  const streakBonus = Math.min(12, (bestStreak / total) * 12); // up to 12
  const hintPenalty = Math.min(8, (hintsUsed / total) * 8); // up to -8

  return Math.max(0, Math.min(100, Math.round(base + streakBonus - hintPenalty)));
}
