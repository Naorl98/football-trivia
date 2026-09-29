import type { QuizChallenge, QuizConfiguration } from "../../shared/types";
import { generatePublicId } from "../lib/id";

export async function createChallenge(
  db: D1Database,
  config: QuizConfiguration,
  questionIds: number[]
): Promise<QuizChallenge> {
  const publicId = generatePublicId();
  const createdAt = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO quiz_challenges (public_id, configuration_json, question_ids_json, game_mode, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, NULL)`
    )
    .bind(publicId, JSON.stringify(config), JSON.stringify(questionIds), config.gameMode, createdAt)
    .run();

  return {
    publicId,
    configuration: config,
    questionIds,
    gameMode: config.gameMode,
    createdAt,
    expiresAt: null,
  };
}

export async function getChallengeByPublicId(db: D1Database, publicId: string): Promise<QuizChallenge | null> {
  const row = await db
    .prepare(`SELECT * FROM quiz_challenges WHERE public_id = ?`)
    .bind(publicId)
    .first<{
      public_id: string;
      configuration_json: string;
      question_ids_json: string;
      game_mode: string;
      created_at: string;
      expires_at: string | null;
    }>();

  if (!row) return null;

  return {
    publicId: row.public_id,
    configuration: JSON.parse(row.configuration_json),
    questionIds: JSON.parse(row.question_ids_json),
    gameMode: row.game_mode as QuizChallenge["gameMode"],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
