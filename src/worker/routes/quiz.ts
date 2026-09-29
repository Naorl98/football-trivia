import { Hono } from "hono";
import type { Env } from "../env";
import { buildQuiz } from "../engine/questionEngine";
import { countAvailableQuestions } from "../db/questions";
import { parseQuizConfiguration, ValidationError } from "../lib/validate";

export const quizRoutes = new Hono<{ Bindings: Env }>();

quizRoutes.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const config = parseQuizConfiguration(body);
    const quiz = await buildQuiz(c.env.DB, config);
    return c.json(quiz);
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: "Failed to build quiz" }, 500);
  }
});

quizRoutes.post("/count", async (c) => {
  try {
    const body = await c.req.json();
    const config = parseQuizConfiguration(body);
    const count = await countAvailableQuestions(c.env.DB, {
      region: config.region,
      countries: config.countries,
      competitions: config.competitions,
      categories: config.categories,
      difficulty: config.difficulty,
      gameMode: config.gameMode,
    });
    return c.json({ availableCount: count });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: "Failed to count questions" }, 500);
  }
});
