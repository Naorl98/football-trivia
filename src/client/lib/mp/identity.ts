// Who you are in a multiplayer room, without an account.
//
// Two separate things, stored differently on purpose:
//
//   token  a random secret that identifies you to the room. It is what makes
//          reconnect work: the server recognises the token, not the name, so a
//          refresh or a dropped tunnel puts you back in your own seat with your
//          own score rather than creating a second "נאור". It lives in
//          sessionStorage under the ESSENTIAL category — same reasoning as the
//          in-flight single-player quiz — and is gone when the tab closes.
//
//   name   what other players see. A preference, stored in localStorage only
//          when the visitor has allowed preferences, so nobody has to retype it
//          every game. Without consent it is remembered for the session only.
//
// The token is never a display name and the name is never an identity: the server
// treats the name as untrusted text and the token as the only thing that proves
// who is on the other end of the socket.

import { privacy } from "../privacy.ts";

const TOKEN_KEY = "fiq_mp_token";
const NAME_KEY = "fiq_mp_name";
const STATS_KEY = "fiq_mp_stats";

/** Local, best-effort counters. Never presented as a global record. */
export interface LocalStats {
  played: number;
  wins: number;
  losses: number;
  bestStreak: number;
}

const EMPTY_STATS: LocalStats = { played: 0, wins: 0, losses: 0, bestStreak: 0 };

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Private mode. The value stays in memory for this page, which is enough to
    // finish the game you are in.
  }
}

/**
 * The reconnect token for this tab, minted on first use.
 *
 * Kept in a module-level cache as well as sessionStorage so a browser that
 * refuses storage entirely still gets a stable identity for the life of the page
 * — which is the case that matters, because that is exactly when reconnect has to
 * work without help from disk.
 */
let cachedToken: string | null = null;

export function playerToken(): string {
  if (cachedToken) return cachedToken;

  const stored = readSession(TOKEN_KEY);
  if (stored && stored.length >= 8) {
    cachedToken = stored;
    return stored;
  }

  const fresh = crypto.randomUUID().replace(/-/g, "");
  cachedToken = fresh;
  writeSession(TOKEN_KEY, fresh);
  return fresh;
}

/** Forgets this tab's identity — used when a player deliberately leaves a room for good. */
export function resetPlayerToken(): void {
  cachedToken = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing stored, nothing to remove */
  }
}

let cachedName = "";

export function savedPlayerName(): string {
  if (cachedName) return cachedName;
  if (!privacy.allows("preferences")) return "";
  try {
    cachedName = localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    cachedName = "";
  }
  return cachedName;
}

export function rememberPlayerName(name: string): void {
  cachedName = name;
  if (!privacy.allows("preferences")) return;
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* session-only is fine */
  }
}

// --------------------------------------------------------------- local stats

export function readLocalStats(): LocalStats {
  if (!privacy.allows("history")) return { ...EMPTY_STATS };
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { ...EMPTY_STATS };
    const parsed = JSON.parse(raw) as Partial<LocalStats>;
    return {
      played: numberOr(parsed.played),
      wins: numberOr(parsed.wins),
      losses: numberOr(parsed.losses),
      bestStreak: numberOr(parsed.bestStreak),
    };
  } catch {
    return { ...EMPTY_STATS };
  }
}

/**
 * Records one finished game.
 *
 * Deliberately local and deliberately modest: there is no account behind it, so
 * it is a tally on this browser and the UI says so rather than implying a
 * permanent record.
 */
export function recordLocalGame(result: { won: boolean; bestStreak: number }): LocalStats {
  const current = readLocalStats();
  const next: LocalStats = {
    played: current.played + 1,
    wins: current.wins + (result.won ? 1 : 0),
    losses: current.losses + (result.won ? 0 : 1),
    bestStreak: Math.max(current.bestStreak, Math.max(0, result.bestStreak)),
  };
  if (!privacy.allows("history")) return next;
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(next));
  } catch {
    /* not worth surfacing */
  }
  return next;
}

function numberOr(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
