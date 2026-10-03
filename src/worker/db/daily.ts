import type { QuizConfiguration } from "../../shared/types.ts";
import type { QuestionFilter } from "./questions.ts";
import { selectDailyChallenge } from "../engine/difficultyPolicy.ts";
import { ABOVE_HARD_BANDS, DAILY_ABOVE_HARD_MAX } from "../../server/football/difficulty.ts";

export interface DailyChallengeRow {
  challengeDate: string;
  questionIds: number[];
}

export const DAILY_CONFIG: QuizConfiguration = {
  region: "WORLD",
  countries: [],
  competitions: ["ALL"],
  categories: [],
  // MIXED is the honest value for the stored configuration, but it is not what
  // decides the questions: `preset` does. The Daily Challenge draws a curve —
  // mostly EASY/NORMAL/HARD with one or two above HARD at the end — which a
  // single difficulty value cannot express.
  difficulty: "MIXED",
  questionCount: 10,
  gameMode: "CLASSIC",
  answerMode: "MULTIPLE_CHOICE",
  preset: "DAILY_CHALLENGE",
};

const DAILY_FILTER: QuestionFilter = {
  region: DAILY_CONFIG.region,
  countries: DAILY_CONFIG.countries,
  competitions: DAILY_CONFIG.competitions,
  categories: DAILY_CONFIG.categories,
  difficulty: DAILY_CONFIG.difficulty,
  gameMode: DAILY_CONFIG.gameMode,
  answerMode: DAILY_CONFIG.answerMode,
};

/**
 * Builds the day's question set.
 *
 * Seeded by the challenge date, so the selection and its ordering are
 * deterministic: two people comparing scores must have answered the same
 * questions in the same order, and a rebuild after a question is deactivated
 * must produce as close to the same challenge as the bank still allows.
 */
async function buildDailyIds(db: D1Database, date: string): Promise<number[]> {
  const selection = await selectDailyChallenge(db, DAILY_FILTER, DAILY_CONFIG.questionCount, date);
  return selection.ids;
}

async function selectDaily(db: D1Database, date: string): Promise<DailyChallengeRow | null> {
  const row = await db
    .prepare(`SELECT challenge_date, question_ids_json FROM daily_challenges WHERE challenge_date = ?`)
    .bind(date)
    .first<{ challenge_date: string; question_ids_json: string }>();
  if (!row) return null;
  return { challengeDate: row.challenge_date, questionIds: JSON.parse(row.question_ids_json) };
}

/*
 * How much of a stored challenge still holds: how many of its questions are
 * live, and how many of them are now above HARD.
 *
 * DEACTIVATION IS NOT THE ONLY WAY A STORED SET GOES STALE. The original check
 * asked whether every id still resolved to an active question, which catches a
 * question being withdrawn and nothing else. A difficulty RECLASSIFICATION
 * leaves every id perfectly valid and silently breaks the thing the Daily
 * Challenge is built around.
 *
 * That is not hypothetical. The semantic layer's recalibration moved 3,169
 * questions from HARD to IMPOSSIBLE and 1,282 from HARD to EXPERT. The
 * challenge stored for 2026-10-03 was written minutes before it, chose nine
 * playable questions and one boss question under the old labels, and afterwards
 * held FOUR above HARD out of ten — a challenge the policy would never build,
 * served from a row that looked entirely healthy.
 *
 * So the invariant is checked against the bank as it is now, not as it was when
 * the row was written. Both counts come back in one query: this runs on the
 * read path for every Daily Challenge request, and the second round trip would
 * be pure cost.
 */
async function storedSetHealth(
  db: D1Database,
  ids: number[]
): Promise<{ live: number; aboveHard: number }> {
  if (ids.length === 0) return { live: 0, aboveHard: 0 };
  const placeholders = ids.map(() => "?").join(",");
  const aboveHard = ABOVE_HARD_BANDS.map(() => "?").join(",");
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS live,
              SUM(CASE WHEN difficulty IN (${aboveHard}) THEN 1 ELSE 0 END) AS above_hard
         FROM questions
        WHERE active = 1 AND id IN (${placeholders})`
    )
    .bind(...ABOVE_HARD_BANDS, ...ids)
    .first<{ live: number; above_hard: number | null }>();
  return { live: row?.live ?? 0, aboveHard: row?.above_hard ?? 0 };
}

// Get-or-create, race-safe via the UNIQUE constraint on challenge_date:
// if two requests hit an unset date simultaneously, only one INSERT wins and
// both requests end up reading the same persisted question set.
export async function getOrCreateDailyChallenge(db: D1Database, date: string): Promise<DailyChallengeRow> {
  const existing = await selectDaily(db, date);
  if (existing) {
    const { live, aboveHard } = await storedSetHealth(db, existing.questionIds);
    const allLive = live === existing.questionIds.length;
    // A rebuild always draws its base from EASY/NORMAL/HARD alone and exactly
    // `aboveHardTarget` boss questions, so the repaired set satisfies the cap
    // and this converges rather than rewriting the row on every request.
    const curveHolds = aboveHard <= DAILY_ABOVE_HARD_MAX;
    if (allLive && curveHolds) return existing;
    // Stored set went stale — rebuild it once and persist, so the day stays
    // consistent for everyone from here on.
    const repaired = await buildDailyIds(db, date);
    await db
      .prepare(`UPDATE daily_challenges SET question_ids_json = ? WHERE challenge_date = ?`)
      .bind(JSON.stringify(repaired), date)
      .run();
    return { challengeDate: date, questionIds: repaired };
  }

  const ids = await buildDailyIds(db, date);

  await db
    .prepare(`INSERT OR IGNORE INTO daily_challenges (challenge_date, question_ids_json) VALUES (?, ?)`)
    .bind(date, JSON.stringify(ids))
    .run();

  const finalRow = await selectDaily(db, date);
  return finalRow ?? { challengeDate: date, questionIds: ids };
}
