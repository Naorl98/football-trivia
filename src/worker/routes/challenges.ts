import { Hono } from "hono";
import type { Env } from "../env";
import { buildQuiz, buildQuizFromQuestionIds } from "../engine/questionEngine";
import { createChallenge, getChallengeByPublicId } from "../db/challenges";
import { parseQuizConfiguration, ValidationError } from "../lib/validate";
import { gate } from "../lib/ratelimit";

export const challengeRoutes = new Hono<{ Bindings: Env }>();

/**
 * The shape `generatePublicId` emits: eight characters from an alphabet with the
 * ambiguous glyphs removed.
 *
 * Checked before the query rather than after, for two reasons. It turns a
 * guessed id into a 400 that costs nothing instead of a D1 lookup that costs a
 * read — which is what makes guessing challenge links unattractive — and it
 * bounds the string, which previously had no length limit at all on its way into
 * a bound parameter.
 */
const PUBLIC_ID_PATTERN = /^[2-9A-HJ-NP-Za-km-z]{6,16}$/;

// Creates a challenge: generate a fresh quiz, freeze its exact question set,
// and persist it so /challenge/:id always replays the same questions.
challengeRoutes.post("/", async (c) => {
  // Shares the write budget with attempt logging: both end in an INSERT, and a
  // loop over this route is the cheaper way to spend the daily row allowance.
  const limited = await gate(c, "RL_WRITE", "challenge");
  if (limited) return limited;

  try {
    const body = await c.req.json();
    const config = parseQuizConfiguration(body);
    const quiz = await buildQuiz(c.env.DB, config);
    const questionIds = quiz.questions.map((q) => q.id);
    const challenge = await createChallenge(c.env.DB, config, questionIds);
    return c.json({ challenge, quiz });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    if (err instanceof SyntaxError) return c.json({ error: "Invalid JSON body" }, 400);
    console.error("challenge create failed", { name: (err as Error)?.name, message: (err as Error)?.message });
    return c.json({ error: "Failed to create challenge", messageHe: "לא הצלחנו ליצור קישור, נסו שוב." }, 500);
  }
});

challengeRoutes.get("/:publicId", async (c) => {
  const publicId = c.req.param("publicId");
  if (!PUBLIC_ID_PATTERN.test(publicId)) {
    // The same answer a real-but-absent id gets, so the validator is not itself
    // an oracle for which ids are well-formed.
    return c.json({ error: "Challenge not found" }, 404);
  }

  try {
    const challenge = await getChallengeByPublicId(c.env.DB, publicId);
    if (!challenge) return c.json({ error: "Challenge not found" }, 404);

    const quiz = await buildQuizFromQuestionIds(c.env.DB, challenge.configuration, challenge.questionIds);
    return c.json({ challenge, quiz });
  } catch (err) {
    console.error("challenge load failed", { name: (err as Error)?.name, message: (err as Error)?.message });
    return c.json({ error: "Failed to load challenge" }, 500);
  }
});
