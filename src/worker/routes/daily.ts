import { Hono } from "hono";
import type { Env } from "../env";
import { DAILY_CONFIG, getOrCreateDailyChallenge } from "../db/daily";
import { buildQuizFromQuestionIds } from "../engine/questionEngine";
import { israelDateString } from "../lib/date";

export const dailyRoutes = new Hono<{ Bindings: Env }>();

/**
 * Today's challenge.
 *
 * Wrapped because it was not: a D1 hiccup here threw out of the handler, and the
 * client's only clue was a 500 with whatever the database said in it. The daily
 * page already knows how to show "לא הצלחנו לטעון את אתגר היום", so give it
 * something it can act on.
 *
 * Not cached at the edge even though the content is stable for a day: the
 * rollover is at midnight Israel time and a cached response that outlives it
 * would serve yesterday's quiz to whoever is behind that cache. The read is one
 * indexed row lookup plus a hydrate of a fixed id list, which is cheap enough
 * not to need it.
 */
dailyRoutes.get("/", async (c) => {
  try {
    const date = israelDateString();
    const daily = await getOrCreateDailyChallenge(c.env.DB, date);
    const quiz = await buildQuizFromQuestionIds(c.env.DB, DAILY_CONFIG, daily.questionIds);
    return c.json({ date: daily.challengeDate, quiz });
  } catch (err) {
    console.error("daily failed", { name: (err as Error)?.name, message: (err as Error)?.message });
    return c.json(
      { error: "Failed to load daily challenge", messageHe: "לא הצלחנו לטעון את אתגר היום. נסו שוב מאוחר יותר." },
      500
    );
  }
});
