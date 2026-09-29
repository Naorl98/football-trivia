import { Hono } from "hono";
import type { Env } from "../env";
import { buildQuiz, buildQuizFromQuestionIds } from "../engine/questionEngine";
import { createChallenge, getChallengeByPublicId } from "../db/challenges";
import { parseQuizConfiguration, ValidationError } from "../lib/validate";

export const challengeRoutes = new Hono<{ Bindings: Env }>();

// Creates a challenge: generate a fresh quiz, freeze its exact question set,
// and persist it so /challenge/:id always replays the same questions.
challengeRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const config = parseQuizConfiguration(body);
    const quiz = await buildQuiz(c.env.DB, config);
    const questionIds = quiz.questions.map((q) => q.id);
    const challenge = await createChallenge(c.env.DB, config, questionIds);
    return c.json({ challenge, quiz });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: "Failed to create challenge" }, 500);
  }
});

challengeRoutes.get("/:publicId", async (c) => {
  const publicId = c.req.param("publicId");
  const challenge = await getChallengeByPublicId(c.env.DB, publicId);
  if (!challenge) return c.json({ error: "Challenge not found" }, 404);

  const quiz = await buildQuizFromQuestionIds(c.env.DB, challenge.configuration, challenge.questionIds);
  return c.json({ challenge, quiz });
});
