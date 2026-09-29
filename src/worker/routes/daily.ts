import { Hono } from "hono";
import type { Env } from "../env";
import { DAILY_CONFIG, getOrCreateDailyChallenge } from "../db/daily";
import { buildQuizFromQuestionIds } from "../engine/questionEngine";
import { israelDateString } from "../lib/date";

export const dailyRoutes = new Hono<{ Bindings: Env }>();

dailyRoutes.get("/", async (c) => {
  const date = israelDateString();
  const daily = await getOrCreateDailyChallenge(c.env.DB, date);
  const quiz = await buildQuizFromQuestionIds(c.env.DB, DAILY_CONFIG, daily.questionIds);
  return c.json({ date: daily.challengeDate, quiz });
});
