// The health endpoint.
//
// Two shapes, because "is it up" and "is it healthy" are different questions
// with different costs:
//
//   GET /api/health        liveness. Answers from the Worker alone, touches
//                          nothing, and is what an uptime check should poll.
//   GET /api/health?deep=1 readiness. Also proves D1 answers and the Durable
//                          Object bindings exist, which is the difference
//                          between "the Worker is running" and "the game works".
//
// WHAT IT DOES NOT SAY. No colo, no database id, no binding internals, no
// version of anything, no error text. A health endpoint is unauthenticated by
// definition, so every field here is one an attacker is welcome to. A failing
// dependency is reported as the string "error" and nothing else; the reason goes
// to the Worker log.

import { Hono } from "hono";
import type { Env } from "../env";

export const healthRoutes = new Hono<{ Bindings: Env }>();

type Check = "ok" | "error" | "missing";

healthRoutes.get("/", async (c) => {
  if (c.req.query("deep") !== "1") {
    // `ok` is kept alongside `status` because it was the entire response before
    // this file existed, and an uptime check configured against the old shape
    // should not start failing because the shape got better.
    return c.json({ status: "ok", ok: true });
  }

  let database: Check = "missing";
  if (c.env.DB) {
    try {
      // The cheapest statement that proves a round trip: no table, no rows, no
      // index, nothing that grows with the size of the question bank.
      await c.env.DB.prepare("SELECT 1").first();
      database = "ok";
    } catch (err) {
      console.error("health: d1 unreachable", { name: (err as Error)?.name });
      database = "error";
    }
  }

  // Binding presence only. Constructing a stub is free, but actually calling
  // into one would spin up a Durable Object on every poll.
  const room: Check = c.env.ROOM ? "ok" : "missing";
  const matchmaker: Check = c.env.MATCHMAKER ? "ok" : "missing";

  const healthy = database === "ok" && room === "ok" && matchmaker === "ok";

  return c.json({ status: healthy ? "ok" : "degraded", database, room, matchmaker }, healthy ? 200 : 503);
});
