// Multiplayer scoring.
//
// Computed on the server and nowhere else. The client is sent the points it was
// awarded, never the inputs needed to compute them, so there is nothing for a
// client to recompute and disagree about.
//
// The formula is deliberately small enough to explain in one breath at a party:
//
//   correct answer            100
//   + speed                   0-50, linear in the time you had left
//   + streak                  10 per consecutive correct beyond the first, max 50
//   - hints                   20 each
//   wrong / out of time       0
//   gave up and revealed      0
//
// A correct answer never drops below 10 however many hints were burned — using
// every hint should cost you the round, not turn knowing the answer into
// nothing.
//
// EVERYONE_ANSWERS turns the streak bonus off. That is the entire difference
// between it and CLASSIC_BATTLE, and it is a real one: without the streak
// multiplier a player who missed the first three questions is still in the game.

import {
  SCORE_BASE_CORRECT,
  SCORE_CORRECT_FLOOR,
  SCORE_HINT_PENALTY,
  SCORE_MAX_SPEED_BONUS,
  SCORE_MAX_STREAK_BONUS,
  SCORE_STREAK_STEP,
} from "./constants.ts";
import type { MultiplayerMode } from "./types.ts";

export interface ScoreInput {
  correct: boolean;
  revealed: boolean;
  /** How long the answer took, in ms. null when the player never answered. */
  timeMs: number | null;
  /** The answer window for this question, in ms. */
  limitMs: number;
  /** Consecutive correct answers immediately before this one. */
  streakBefore: number;
  hintsUsed: number;
  streakBonusEnabled: boolean;
}

export interface MultiplayerScore {
  base: number;
  speed: number;
  streak: number;
  hintPenalty: number;
  total: number;
}

const ZERO: MultiplayerScore = { base: 0, speed: 0, streak: 0, hintPenalty: 0, total: 0 };

export function scoreAnswer(input: ScoreInput): MultiplayerScore {
  if (!input.correct || input.revealed || input.timeMs === null) return { ...ZERO };

  const limit = Math.max(1, input.limitMs);
  // An answer cannot legitimately arrive before the question or after the
  // deadline, but clamping here means a clock oddity can never mint points.
  const used = Math.min(limit, Math.max(0, input.timeMs));
  const remaining = (limit - used) / limit;

  const base = SCORE_BASE_CORRECT;
  const speed = Math.round(SCORE_MAX_SPEED_BONUS * remaining);
  const streak = input.streakBonusEnabled
    ? Math.min(SCORE_MAX_STREAK_BONUS, Math.max(0, input.streakBefore) * SCORE_STREAK_STEP)
    : 0;
  const hintPenalty = Math.max(0, input.hintsUsed) * SCORE_HINT_PENALTY;

  const total = Math.max(SCORE_CORRECT_FLOOR, base + speed + streak - hintPenalty);
  return { base, speed, streak, hintPenalty, total };
}

/** Whether a mode grants the streak bonus. */
export function streakBonusEnabled(mode: MultiplayerMode): boolean {
  return mode !== "EVERYONE_ANSWERS";
}

/**
 * A one-line, plain-Hebrew description of the scoring in force, shown in the
 * lobby so nobody discovers the rules by losing to them.
 */
export function scoringSummaryHe(mode: MultiplayerMode, hintsAllowed: boolean): string {
  const parts = [`${SCORE_BASE_CORRECT} על תשובה נכונה`, `עד ${SCORE_MAX_SPEED_BONUS} על מהירות`];
  if (streakBonusEnabled(mode)) parts.push(`${SCORE_STREAK_STEP} לכל רצף`);
  if (hintsAllowed) parts.push(`${SCORE_HINT_PENALTY} פחות לכל רמז`);
  return parts.join(" · ");
}
