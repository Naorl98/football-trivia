import { Hono } from "hono";
import type { Env } from "../env";
import { computeScore } from "../../shared/scoring";
import type { AnswerRecord } from "../../shared/types";
import { getChallengeRowIdByPublicId, insertAttempt } from "../db/attempts";

export const attemptRoutes = new Hono<{ Bindings: Env }>();

interface AttemptBody {
  answers: AnswerRecord[];
  durationSeconds: number;
  challengePublicId?: string;
}

attemptRoutes.post("/", async (c) => {
  const body = await c.req.json<AttemptBody>();
  if (!Array.isArray(body.answers) || body.answers.length === 0) {
    return c.json({ error: "answers required" }, 400);
  }

  const score = computeScore(body.answers);

  let challengeId: number | null = null;
  if (body.challengePublicId) {
    challengeId = await getChallengeRowIdByPublicId(c.env.DB, body.challengePublicId);
  }

  const attemptId = await insertAttempt(c.env.DB, {
    challengeId,
    score: score.points,
    questionCount: score.total,
    durationSeconds: Math.round(body.durationSeconds ?? 0),
  });

  return c.json({ attemptId, score });
});
