import { Hono } from "hono";
import type { Env } from "../env";
import { buildQuiz } from "../engine/questionEngine";
import { countAvailableQuestions, type QuestionFilter } from "../db/questions";
import { parseQuizConfiguration, ValidationError } from "../lib/validate";
import { gate } from "../lib/ratelimit";
import { cachedJson, putJson } from "../lib/edgeCache";

export const quizRoutes = new Hono<{ Bindings: Env }>();

quizRoutes.post("/", async (c) => {
  const limited = await gate(c, "RL_QUIZ", "build");
  if (limited) return limited;

  try {
    const body = await c.req.json();
    const config = parseQuizConfiguration(body);
    const quiz = await buildQuiz(c.env.DB, config);
    return c.json(quiz);
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    if (err instanceof SyntaxError) return c.json({ error: "Invalid JSON body" }, 400);
    console.error("quiz build failed", { name: (err as Error)?.name, message: (err as Error)?.message });
    return c.json({ error: "Failed to build quiz", messageHe: "לא הצלחנו לבנות חידון. נסו שוב." }, 500);
  }
});

/**
 * The cache key for an availability count.
 *
 * Built from the filter in a canonical order with the lists sorted, so the same
 * selection arrived at by two different routes through the builder is one cache
 * entry rather than two. It is an opaque key on a synthetic URL and never
 * reaches a client.
 */
function countCacheKey(origin: string, filter: QuestionFilter): Request {
  const parts = [
    filter.gameMode,
    filter.answerMode,
    filter.difficulty,
    filter.region ?? "-",
    [...filter.countries].sort().join("."),
    [...filter.competitions].sort().join("."),
    [...filter.categories].sort().join("."),
  ].join("|");
  return new Request(`${origin}/__count/${encodeURIComponent(parts)}`, { method: "GET" });
}

/** Five minutes. The bank changes when a seed is applied, not while someone is choosing filters. */
const COUNT_TTL_SECONDS = 300;

/**
 * "How many questions match this?" — the builder's live availability figure.
 *
 * MEASURED COST, before this cache existed: 15,186 rows read for the simple
 * case and up to 25,197 for a mode filter, per call. The builder calls it every
 * time a chip is tapped. That made the cheapest-looking endpoint in the product
 * the most expensive one, and it is reachable by anyone without so much as a
 * session.
 *
 * The answer is a pure function of the filter and the question bank, and the
 * bank only moves when a seed is applied — so it caches cleanly. The Cache API
 * is per colo, which is the right granularity here: the first person in a region
 * to pick "Premier League, transfers, hard" pays for it and nobody else does.
 */
quizRoutes.post("/count", async (c) => {
  const limited = await gate(c, "RL_QUIZ", "count");
  if (limited) return limited;

  try {
    const body = await c.req.json();
    const config = parseQuizConfiguration(body);
    const filter: QuestionFilter = {
      region: config.region,
      countries: config.countries,
      competitions: config.competitions,
      categories: config.categories,
      difficulty: config.difficulty,
      gameMode: config.gameMode,
      answerMode: config.answerMode,
    };

    const key = countCacheKey(new URL(c.req.url).origin, filter);

    const hit = await cachedJson<{ availableCount: number }>(key);
    if (hit) return c.json(hit);

    const count = await countAvailableQuestions(c.env.DB, filter);
    const payload = { availableCount: count };
    await putJson(key, payload, COUNT_TTL_SECONDS);

    return c.json(payload);
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    if (err instanceof SyntaxError) return c.json({ error: "Invalid JSON body" }, 400);
    console.error("quiz count failed", { name: (err as Error)?.name, message: (err as Error)?.message });
    return c.json({ error: "Failed to count questions" }, 500);
  }
});
