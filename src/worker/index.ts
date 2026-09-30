import { Hono } from "hono";
import type { Env } from "./env";
import { quizRoutes } from "./routes/quiz";
import { challengeRoutes } from "./routes/challenges";
import { dailyRoutes } from "./routes/daily";
import { attemptRoutes } from "./routes/attempts";
import { multiplayerRoutes } from "./routes/multiplayer";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/quiz", quizRoutes);
app.route("/api/challenges", challengeRoutes);
app.route("/api/daily", dailyRoutes);
app.route("/api/attempts", attemptRoutes);
app.route("/api/mp", multiplayerRoutes);

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

// Durable Object classes have to be exported from the Worker's entry module for
// the runtime to be able to construct them; the bindings in wrangler.jsonc refer
// to these class names.
export { RoomDurableObject } from "./durable/RoomDurableObject";
export { MatchmakerDurableObject } from "./durable/MatchmakerDurableObject";
