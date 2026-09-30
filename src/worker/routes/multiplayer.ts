import { Hono } from "hono";
import { isValidRoomCode } from "../../shared/multiplayer/roomCode";
import { MODES } from "../../shared/multiplayer/constants";
import type { MultiplayerMode } from "../../shared/multiplayer/types";
import { allocateRoom, roomStub } from "../multiplayer/allocate";
import type { Env } from "../env";

export const multiplayerRoutes = new Hono<{ Bindings: Env }>();

/**
 * The single matchmaking queue.
 *
 * One object, one name. Sharding it would split the pool and make matching
 * slower, not faster — and at this scale a queue that serialises a few dozen
 * arrivals per second is nowhere near a bottleneck. If it ever becomes one, the
 * shard key goes here and nothing else changes.
 */
const MATCHMAKER_NAME = "global-v1";

const HOST_SELECTABLE = new Set(MODES.filter((m) => m.hostSelectable).map((m) => m.code));

/**
 * Creates a private room.
 *
 * The response is just a code. Nothing about the Durable Object is exposed — no
 * id, no colo, no internal name — so a client has no handle on the room other
 * than the six digits it is expected to share.
 */
multiplayerRoutes.post("/rooms", async (c) => {
  let mode: MultiplayerMode = "CLASSIC_BATTLE";
  try {
    const body = (await c.req.json()) as { mode?: unknown };
    if (typeof body.mode === "string" && HOST_SELECTABLE.has(body.mode as MultiplayerMode)) {
      mode = body.mode as MultiplayerMode;
    }
  } catch {
    // An empty or malformed body is fine: the default mode is a real choice the
    // host can change in the lobby anyway.
  }

  const code = await allocateRoom(c.env, mode);
  if (!code) return c.json({ error: "Could not allocate a room code" }, 503);
  return c.json({ code, mode });
});

/** "Does this room exist and can I still get in?" — used before showing the name prompt. */
multiplayerRoutes.get("/rooms/:code", async (c) => {
  const code = c.req.param("code");
  if (!isValidRoomCode(code)) return c.json({ error: "Invalid room code" }, 400);

  const summary = await roomStub(c.env, code).summary();
  if (!summary) return c.json({ error: "Room not found" }, 404);
  return c.json(summary);
});

/**
 * The room socket. Everything real happens over this.
 *
 * The request is handed to the Durable Object untouched, so the object sees the
 * player's token and the display flag exactly as sent and this layer never has to
 * understand them.
 */
multiplayerRoutes.get("/rooms/:code/ws", async (c) => {
  const code = c.req.param("code");
  if (!isValidRoomCode(code)) return c.json({ error: "Invalid room code" }, 400);
  if (c.req.header("Upgrade") !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 426);
  }
  return roomStub(c.env, code).fetch(c.req.raw);
});

multiplayerRoutes.get("/matchmaking/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.json({ error: "Expected WebSocket upgrade" }, 426);
  }
  const stub = c.env.MATCHMAKER.get(c.env.MATCHMAKER.idFromName(MATCHMAKER_NAME));
  return stub.fetch(c.req.raw);
});
