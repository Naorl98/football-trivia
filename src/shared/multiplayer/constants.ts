// Multiplayer constants: mode copy, room limits, and the phase timings the
// Durable Object schedules against.
//
// Every duration lives here rather than inside the room engine so the tests, the
// server and the client all agree on how long a beat lasts without any of them
// hardcoding a number.

import type { MultiplayerMode, RoomSettings, TeamId } from "./types.ts";
import { DEFAULT_TEAM_NAMES } from "./types.ts";

export interface ModeMeta {
  code: MultiplayerMode;
  labelHe: string;
  taglineHe: string;
  /** One line of "how this actually plays", shown under the tagline. */
  blurbHe: string;
  /**
   * The rules in plain words, for the ⓘ popover in the lobby.
   *
   * Deliberately not `blurbHe`: that is a playful line written to sell a mode,
   * and a player opening an info button wants to know how the thing is played,
   * not to be sold it again.
   */
  explainHe: string;
  minPlayers: number;
  maxPlayers: number;
  /** Rooms are made by hand for these; RANDOM_DUEL is made by the matchmaker. */
  hostSelectable: boolean;
}

export const MODES: ModeMeta[] = [
  {
    code: "CLASSIC_BATTLE",
    explainHe: "כולם עונים על אותה שאלה. צוברים נקודות על תשובה נכונה ועל מהירות.",
    labelHe: "קרב רגיל",
    taglineHe: "כולם נגד כולם",
    blurbHe: "אותה שאלה לכולם. מי שצודק מהר, וברצף, לוקח יותר.",
    minPlayers: 2,
    maxPlayers: 20,
    hostSelectable: true,
  },
  {
    code: "TURN_BASED",
    explainHe: "רק שחקן אחד עונה בכל תור. התור עובר בין המשתתפים.",
    labelHe: "תורות",
    taglineHe: "כל פעם שחקן אחר",
    blurbHe: "כל שאלה שייכת לשחקן אחד. השאר צופים ומתפללים שיפספס.",
    minPlayers: 2,
    maxPlayers: 20,
    hostSelectable: true,
  },
  {
    code: "EVERYONE_ANSWERS",
    explainHe: "כולם עונים בכל שאלה. התוצאה מתעדכנת אחרי כל סיבוב.",
    labelHe: "כולם עונים",
    taglineHe: "כל שאלה, כל השחקנים",
    blurbHe: "בלי בונוס רצף — רק מי שיודע, ומי שמהיר.",
    minPlayers: 2,
    maxPlayers: 20,
    hostSelectable: true,
  },
  {
    code: "DUEL",
    explainHe: "מצב אחד על אחד. שני השחקנים מקבלים את אותן שאלות.",
    labelHe: "דו קרב",
    taglineHe: "אחד על אחד",
    blurbHe: "שניים, אותן שאלות, אותו סדר. סיבוב אחרי סיבוב.",
    minPlayers: 2,
    maxPlayers: 2,
    hostSelectable: true,
  },
  {
    code: "TEAM_BATTLE",
    explainHe: "השחקנים מתחלקים לקבוצות. הניקוד של חברי הקבוצה מצטבר.",
    labelHe: "קרב קבוצות",
    taglineHe: "קבוצה נגד קבוצה",
    blurbHe: "שתי קבוצות, ניקוד מצטבר, ו-MVP אחד בסוף.",
    minPlayers: 2,
    maxPlayers: 20,
    hostSelectable: true,
  },
  {
    code: "RANDOM_DUEL",
    explainHe: "נכנסים לתור ומחכים ליריב אמיתי. ברגע שנמצא, מתחיל דו קרב אחד על אחד.",
    labelHe: "דו קרב אקראי",
    taglineHe: "מצא יריב עכשיו",
    blurbHe: "בלי קוד, בלי הזמנות. נכנסים לתור ומשחקים.",
    minPlayers: 2,
    maxPlayers: 2,
    hostSelectable: false,
  },
];

export const MODE_LABELS: Record<MultiplayerMode, string> = MODES.reduce(
  (acc, m) => ({ ...acc, [m.code]: m.labelHe }),
  {} as Record<MultiplayerMode, string>
);

export function modeMeta(mode: MultiplayerMode): ModeMeta {
  return MODES.find((m) => m.code === mode) ?? MODES[0];
}

/** Modes where every player answers every question. */
export function isSimultaneousMode(mode: MultiplayerMode): boolean {
  return mode !== "TURN_BASED";
}

export function isDuelMode(mode: MultiplayerMode): boolean {
  return mode === "DUEL" || mode === "RANDOM_DUEL";
}

// ------------------------------------------------------------------ limits

/**
 * The tested ceiling for a private room. The architecture does not depend on
 * this number — it is a guard against a room nobody can read, not a technical
 * wall.
 */
export const MAX_PLAYERS_PER_ROOM = 20;

export const MAX_NAME_LENGTH = 16;
export const MIN_NAME_LENGTH = 1;

export const QUESTION_COUNT_CHOICES = [5, 10, 20, 30] as const;
export const SECONDS_PER_QUESTION_CHOICES = [10, 15, 20, 30] as const;

// ------------------------------------------------------------------ timings

/** 3-2-1 before the first question. */
export const COUNTDOWN_MS = 3200;

/** The duel VS intro, on top of the countdown. Kept inside the brief the spec set. */
export const DUEL_INTRO_MS = 2200;

/** How long the correct answer stays up before the round result. */
export const REVEAL_MS = 3000;

/** How long the round result (who took it) stays up. */
export const ROUND_RESULTS_MS = 2400;

/** The hand-off beat between two questions. */
export const NEXT_QUESTION_MS = 700;

/** Standings shown once, after the final question, before the podium. */
export const LEADERBOARD_MS = 2600;

/**
 * How long a dropped player stays in the room, holding their score and their
 * host role, before the room moves on without them.
 */
export const RECONNECT_GRACE_MS = 25_000;

/** A room with nobody connected is torn down after this long. */
export const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

/** Absolute ceiling on an idle room, measured from the last activity. */
export const ROOM_IDLE_TTL_MS = 2 * 60 * 60 * 1000;

/** One reaction per player per this window. */
export const REACTION_COOLDOWN_MS = 3000;

/**
 * Trash-talk limits.
 *
 * Long enough for a jibe and short enough that it cannot become a conversation:
 * the bubble has to be readable at a glance on a phone while a question is on
 * screen, and anything longer would have to be truncated anyway.
 */
export const MESSAGE_MAX_LENGTH = 60;

/** One message per player per this window, whether preset or typed. */
export const MESSAGE_COOLDOWN_MS = 4000;

/**
 * A ceiling per question as well as a cooldown.
 *
 * The cooldown alone still allows a steady drip for as long as a question is open,
 * which on a 30-second question is plenty to be tiresome. Two is enough for a
 * jibe and a reply.
 */
export const MESSAGE_MAX_PER_QUESTION = 2;

/** Matchmaking gives up asking and offers the player a choice after this. */
export const MATCHMAKING_TIMEOUT_MS = 45_000;

/** A queue entry whose socket went away is swept after this. */
export const MATCHMAKING_STALE_MS = 10_000;

// ------------------------------------------------------------------ scoring

export const SCORE_BASE_CORRECT = 100;
export const SCORE_MAX_SPEED_BONUS = 50;
/** Added per consecutive correct answer beyond the first. */
export const SCORE_STREAK_STEP = 10;
export const SCORE_MAX_STREAK_BONUS = 50;
export const SCORE_HINT_PENALTY = 20;
/** A correct answer never scores less than this, however many hints were used. */
export const SCORE_CORRECT_FLOOR = 10;

// ------------------------------------------------------------------ defaults

export function defaultSettings(mode: MultiplayerMode): RoomSettings {
  return {
    mode,
    questionCount: 10,
    difficulty: "MIXED",
    categories: [],
    competitions: [],
    countries: [],
    region: null,
    answerMode: "MULTIPLE_CHOICE",
    gameMode: "CLASSIC",
    secondsPerQuestion: isDuelMode(mode) ? 15 : 20,
    hintsAllowed: true,
    teamNames: { ...DEFAULT_TEAM_NAMES } as Record<TeamId, string>,
  };
}

/**
 * The fixed settings every random duel uses.
 *
 * Deliberately not configurable: a queue that fragments across twenty filters
 * never matches anybody. Difficulty is MIXED rather than a Normal+Hard blend
 * because the bank's difficulty tags are spread across five levels and a
 * two-level filter leaves too few questions for some categories.
 */
export function randomDuelSettings(): RoomSettings {
  return {
    ...defaultSettings("RANDOM_DUEL"),
    questionCount: 10,
    difficulty: "MIXED",
    answerMode: "MULTIPLE_CHOICE",
    secondsPerQuestion: 15,
    hintsAllowed: false,
  };
}

/** Rotating copy for the matchmaking wait. Playful, never at the player's expense. */
export const SEARCHING_LINES_HE = [
  "מחפש יריב…",
  "בודק מי חושב שהוא מבין יותר ממך…",
  "מחפש מישהו מספיק אמיץ…",
  "סורק את היציע…",
  "מחמם את השופט…",
];
