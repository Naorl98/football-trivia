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
}

export interface QuizConfiguration {
  region: Region | null;
  countries: string[]; // country codes
  competitions: string[]; // competition codes (may include group codes like TOP_5_EUROPE)
  categories: Category[];
  difficulty: Difficulty | "MIXED";
  questionCount: 5 | 10 | 20 | 30 | 50;
  gameMode: GameMode;
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
  correct: boolean;
  timeMs: number;
}

export interface ScoreBreakdown {
  correct: number;
  incorrect: number;
  total: number;
  accuracy: number; // 0-100
  points: number;
  rank: RankLabel;
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
