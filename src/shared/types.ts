// Shared domain types used by both the Worker (API/engine) and the React client.
// Keep this file framework-free so it can be imported from either side.

export type Difficulty = "EASY" | "NORMAL" | "HARD" | "EXPERT" | "IMPOSSIBLE";

export const DIFFICULTIES: Difficulty[] = ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];

export type Region =
  | "WORLD"
  | "EUROPE"
  | "SOUTH_AMERICA"
  | "NORTH_AMERICA"
  | "AFRICA"
  | "ASIA"
  | "OCEANIA";

export type Category =
  | "PLAYERS"
  | "CLUBS"
  | "NATIONAL_TEAMS"
  | "CAREERS"
  | "TRANSFERS"
  | "TITLES"
  | "STATS"
  | "COACHES"
  | "STADIUMS"
  | "CHAMPIONS_LEAGUE"
  | "WORLD_CUP"
  | "WHO_AM_I"
  | "GUESS_THE_CLUB"
  | "CAREER_PATH";

// A "game mode" decides how a question is rendered/played.
// "category" is the topical tag; "mode" is the interaction pattern.
export type GameMode =
  | "CLASSIC"
  | "WHO_AM_I"
  | "CAREER_PATH"
  | "CLUB_CONNECTION"
  | "HIGHER_LOWER"
  | "GUESS_THE_CLUB";

export interface QuestionOption {
  id: number;
  text: string;
  isCorrect: boolean;
}

export interface QuestionClue {
  text: string;
  order: number;
}

// How the player gives their answer. Multiple choice is the original mode and
// works for every question; free text needs a question with a single
// unambiguous canonical answer plus accepted aliases.
export type AnswerMode = "MULTIPLE_CHOICE" | "FREE_TEXT";

// The shape returned to the client. isCorrect is stripped for options that are
// sent to the client BEFORE an answer is submitted; the full record (with
// correctness + explanation) is only sent once an answer is locked in, OR the
// entire quiz is pre-fetched with answers hidden and revealed client-side
// (this app uses the latter: the quiz payload embeds the correct answer id,
// but the UI never displays it until the player selects an option).
export interface Question {
  id: number;
  publicId: string;
  mode: GameMode;
  category: Category;
  difficulty: Difficulty;
  questionHe: string;
  explanationHe: string | null;
  options: QuestionOption[];
  clues: QuestionClue[];
  verified: boolean;
  sourceLabel: string | null;
  // Free-text support. `aliases` are every accepted spelling; the matcher
  // never infers extra ones.
  supportsFreeText: boolean;
  canonicalAnswer: string | null;
  aliases: string[];
  hints: string[];
}

/**
 * A preset game mode with its own difficulty rules.
 *
 * QUICK_START — the home page's one-tap path. EASY/NORMAL/HARD only, mixed, and
 *               the HARD questions have to clear a familiarity guard.
 * DAILY_CHALLENGE — mostly playable, with one or two questions above HARD at
 *               the end.
 *
 * The preset DECIDES the difficulty bands. A client sending
 * `{ preset: "QUICK_START", difficulty: "IMPOSSIBLE" }` gets the Quick Start
 * bands, because the rule is about which questions are served and the quiz
 * endpoint is public. See src/worker/engine/difficultyPolicy.ts.
 */
export type QuizPreset = "QUICK_START" | "DAILY_CHALLENGE";

export const QUIZ_PRESETS: QuizPreset[] = ["QUICK_START", "DAILY_CHALLENGE"];

export interface QuizConfiguration {
  region: Region | null;
  countries: string[]; // country codes
  competitions: string[]; // competition codes (may include group codes like TOP_5_EUROPE)
  categories: Category[];
  difficulty: Difficulty | "MIXED";
  questionCount: 5 | 10 | 15 | 20 | 30 | 50;
  gameMode: GameMode;
  answerMode: AnswerMode;
  /** When set, the preset's difficulty rules override `difficulty` entirely. */
  preset?: QuizPreset | null;
  // Question ids the player has seen recently. The engine de-prioritises them
  // so repeat sessions feel fresh; it never excludes them permanently.
  excludeQuestionIds?: number[];
}

export interface Quiz {
  configuration: QuizConfiguration;
  questions: Question[];
  requestedCount: number;
  availableCount: number;
}

export interface QuizChallenge {
  publicId: string;
  configuration: QuizConfiguration;
  questionIds: number[];
  gameMode: GameMode;
  createdAt: string;
  expiresAt: string | null;
}

export interface AnswerRecord {
  questionId: number;
  selectedOptionId: number | null;
  /** What the player typed, for free-text answers. */
  typedAnswer?: string;
  correct: boolean;
  /** Player gave up and asked to see the answer — scored as not correct. */
  revealed?: boolean;
  /** How many hints were opened before answering. */
  hintsUsed?: number;
  timeMs: number;
}

export interface ScoreBreakdown {
  correct: number;
  incorrect: number;
  revealed: number;
  total: number;
  accuracy: number; // 0-100
  points: number;
  /** Deterministic 0-100 rating shown as "Football IQ". */
  footballIq: number;
  rank: RankLabel;
  bestStreak: number;
}

export type RankLabel = "צופה מזדמן" | "אוהד" | "פרשן" | "מומחה" | "אגדה";

export interface CountryRef {
  code: string;
  nameHe: string;
  nameEn: string;
  continent: Region;
}

export interface CompetitionRef {
  code: string;
  nameHe: string;
  nameEn: string;
  type: "LEAGUE" | "CUP" | "CONTINENTAL" | "INTERNATIONAL" | "GROUP";
}
