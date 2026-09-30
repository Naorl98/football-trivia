// Room allocation.
//
// A room code is not looked up in a table — it IS the Durable Object's name, so
// `idFromName("482731")` always reaches the same object from any colo. Allocation
// is therefore: pick a random code, ask that object to claim itself, and try
// again if it says no.
//
// The retry is what makes it correct rather than merely likely. A Durable Object
// serialises its requests, so `claim()` is a compare-and-set that two
// simultaneous creations cannot both win; the loser simply gets the next code.
// With six digits and a handful of live rooms, a single collision is already rare
// and eight attempts makes running out of codes a non-event.

import { generateRoomCode } from "../../shared/multiplayer/roomCode";
import type { MultiplayerMode, RoomSettings } from "../../shared/multiplayer/types";
import type { Env } from "../env";

const MAX_ATTEMPTS = 8;

export function roomStub(env: Env, code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

/** Creates a fresh room and returns its code, or null if no free code was found. */
export async function allocateRoom(
  env: Env,
  mode: MultiplayerMode,
  settings?: Partial<RoomSettings>
): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const claimed = await roomStub(env, code).claim(mode, settings);
    if (claimed) return code;
  }
  return null;
}
