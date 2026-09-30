// Allow-lists for untrusted multiplayer input.
//
// These are built from the product's own constants rather than retyped, so a new
// competition or category is accepted the moment it is defined and a removed one
// stops being accepted without anybody remembering to edit this file.
//
// This lives apart from protocol.ts to keep that module's import graph small:
// the parser is the hottest code path in the Durable Object and is imported by
// the Node test runner, which type-strips rather than type-checks.

import { COMPETITIONS, COUNTRIES, ENABLED_GAME_MODES } from "../constants.ts";
import { DIFFICULTIES } from "../types.ts";
import { MULTIPLAYER_MODES, QUICK_MESSAGES, REACTIONS } from "./types.ts";

const CATEGORY_CODES = [
  "PLAYERS",
  "CLUBS",
  "NATIONAL_TEAMS",
  "CAREERS",
  "TRANSFERS",
  "TITLES",
  "STATS",
  "COACHES",
  "STADIUMS",
  "CHAMPIONS_LEAGUE",
  "WORLD_CUP",
  "WHO_AM_I",
  "GUESS_THE_CLUB",
  "CAREER_PATH",
];

const REGION_CODES = [
  "WORLD",
  "EUROPE",
  "SOUTH_AMERICA",
  "NORTH_AMERICA",
  "AFRICA",
  "ASIA",
  "OCEANIA",
];

export const MULTIPLAYER_MODES_GUARD = {
  modes: new Set<string>(MULTIPLAYER_MODES),
  difficulties: new Set<string>([...DIFFICULTIES, "MIXED"]),
  categories: new Set<string>(CATEGORY_CODES),
  competitions: new Set<string>(COMPETITIONS.map((c) => c.code)),
  countries: new Set<string>(COUNTRIES.map((c) => c.code)),
  regions: new Set<string>(REGION_CODES),
  // Only the question shapes the product actually ships: HIGHER_LOWER is defined
  // in the type but disabled until a trustworthy stats source exists, and a
  // multiplayer room must not be the back door that enables it.
  gameModes: new Set<string>(ENABLED_GAME_MODES),
  reactions: new Set<string>(REACTIONS.map((r) => r.emoji)),
  quickMessages: new Set<string>(QUICK_MESSAGES.map((m) => m.id)),
} as const;

export {
  MAX_NAME_LENGTH,
  MESSAGE_MAX_LENGTH,
  QUESTION_COUNT_CHOICES,
  SECONDS_PER_QUESTION_CHOICES,
} from "./constants.ts";
