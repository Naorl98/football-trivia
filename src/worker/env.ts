import type { MatchmakerDurableObject } from "./durable/MatchmakerDurableObject";
import type { RoomDurableObject } from "./durable/RoomDurableObject";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** One object per live room, addressed by room code via idFromName. */
  ROOM: DurableObjectNamespace<RoomDurableObject>;
  /** A single global queue for random duels. */
  MATCHMAKER: DurableObjectNamespace<MatchmakerDurableObject>;
}
