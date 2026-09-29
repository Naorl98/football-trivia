import type { QuizConfiguration } from "../../shared/types";
import { pickQuestionIds } from "./questions";

export interface DailyChallengeRow {
  challengeDate: string;
  questionIds: number[];
}

export const DAILY_CONFIG: QuizConfiguration = {
  region: "WORLD",
  countries: [],
  competitions: ["ALL"],
  categories: [],
  difficulty: "MIXED",
  questionCount: 10,
  gameMode: "CLASSIC",
};

async function selectDaily(db: D1Database, date: string): Promise<DailyChallengeRow | null> {
  const row = await db
    .prepare(`SELECT challenge_date, question_ids_json FROM daily_challenges WHERE challenge_date = ?`)
    .bind(date)
    .first<{ challenge_date: string; question_ids_json: string }>();
  if (!row) return null;
  return { challengeDate: row.challenge_date, questionIds: JSON.parse(row.question_ids_json) };
}

// Counts how many of the stored ids still resolve to an active question.
// A stored set can go stale if questions are deactivated or removed from the
// bank between the day's first request and a later one.
async function countLiveQuestions(db: D1Database, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const row = await db
    .prepare(`SELECT COUNT(*) as cnt FROM questions WHERE active = 1 AND id IN (${placeholders})`)
    .bind(...ids)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

// Get-or-create, race-safe via the UNIQUE constraint on challenge_date:
// if two requests hit an unset date simultaneously, only one INSERT wins and
// both requests end up reading the same persisted question set.
export async function getOrCreateDailyChallenge(db: D1Database, date: string): Promise<DailyChallengeRow> {
  const existing = await selectDaily(db, date);
  if (existing) {
    const live = await countLiveQuestions(db, existing.questionIds);
    if (live === existing.questionIds.length) return existing;
    // Stored set went stale — rebuild it once and persist, so the day stays
    // consistent for everyone from here on.
    const repaired = await pickQuestionIds(
      db,
      {
        region: DAILY_CONFIG.region,
        countries: DAILY_CONFIG.countries,
        competitions: DAILY_CONFIG.competitions,
        categories: DAILY_CONFIG.categories,
        difficulty: DAILY_CONFIG.difficulty,
        gameMode: DAILY_CONFIG.gameMode,
      },
      DAILY_CONFIG.questionCount
    );
    await db
      .prepare(`UPDATE daily_challenges SET question_ids_json = ? WHERE challenge_date = ?`)
      .bind(JSON.stringify(repaired), date)
      .run();
    return { challengeDate: date, questionIds: repaired };
  }

  const ids = await pickQuestionIds(
    db,
    {
      region: DAILY_CONFIG.region,
      countries: DAILY_CONFIG.countries,
      competitions: DAILY_CONFIG.competitions,
      categories: DAILY_CONFIG.categories,
      difficulty: DAILY_CONFIG.difficulty,
      gameMode: DAILY_CONFIG.gameMode,
    },
    DAILY_CONFIG.questionCount
  );

  await db
    .prepare(`INSERT OR IGNORE INTO daily_challenges (challenge_date, question_ids_json) VALUES (?, ?)`)
    .bind(date, JSON.stringify(ids))
    .run();

  const finalRow = await selectDaily(db, date);
  return finalRow ?? { challengeDate: date, questionIds: ids };
}
