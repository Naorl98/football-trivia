import { Hono } from "hono";
import type { Env } from "./env";
import { quizRoutes } from "./routes/quiz";
import { challengeRoutes } from "./routes/challenges";
import { dailyRoutes } from "./routes/daily";
import { attemptRoutes } from "./routes/attempts";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/quiz", quizRoutes);
app.route("/api/challenges", challengeRoutes);
app.route("/api/daily", dailyRoutes);
app.route("/api/attempts", attemptRoutes);

app.get("/api/health", (c) => c.json({ ok: true }));

// Anything that is not an API route is a client-side route: hand it to the
// static assets binding, which is configured for single-page-application
// fallback and will return the app shell for paths like /challenge/:id.
app.notFound((c) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
