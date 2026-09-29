import { QUESTION_COUNTS } from "../../shared/constants";
import { DIFFICULTIES } from "../../shared/types";
import type { Category, Difficulty, GameMode, QuizConfiguration, Region } from "../../shared/types";

const VALID_REGIONS: Region[] = ["WORLD", "EUROPE", "SOUTH_AMERICA", "NORTH_AMERICA", "AFRICA", "ASIA", "OCEANIA"];
const VALID_MODES: GameMode[] = ["CLASSIC", "WHO_AM_I", "CAREER_PATH", "CLUB_CONNECTION", "HIGHER_LOWER", "GUESS_THE_CLUB"];
const VALID_CATEGORIES: Category[] = [
  "PLAYERS", "CLUBS", "NATIONAL_TEAMS", "CAREERS", "TRANSFERS", "TITLES", "STATS",
  "COACHES", "STADIUMS", "CHAMPIONS_LEAGUE", "WORLD_CUP", "WHO_AM_I", "GUESS_THE_CLUB", "CAREER_PATH",
];

export class ValidationError extends Error {}

export function parseQuizConfiguration(body: unknown): QuizConfiguration {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Invalid request body");
  }
  const b = body as Record<string, unknown>;

  const region = b.region === null || b.region === undefined ? null : b.region;
  if (region !== null && !VALID_REGIONS.includes(region as Region)) {
    throw new ValidationError("Invalid region");
  }

  const countries = Array.isArray(b.countries) ? b.countries.filter((c) => typeof c === "string") : [];
  const competitions = Array.isArray(b.competitions) ? b.competitions.filter((c) => typeof c === "string") : [];

  const categories = Array.isArray(b.categories)
    ? (b.categories.filter((c) => VALID_CATEGORIES.includes(c as Category)) as Category[])
    : [];

  const difficulty = b.difficulty;
  if (difficulty !== "MIXED" && !DIFFICULTIES.includes(difficulty as Difficulty)) {
    throw new ValidationError("Invalid difficulty");
  }

  const questionCount = b.questionCount;
  if (!QUESTION_COUNTS.includes(questionCount as (typeof QUESTION_COUNTS)[number])) {
    throw new ValidationError("Invalid questionCount");
  }

  const gameMode = b.gameMode;
  if (!VALID_MODES.includes(gameMode as GameMode)) {
    throw new ValidationError("Invalid gameMode");
  }

  return {
    region: region as Region | null,
    countries: countries as string[],
    competitions: competitions as string[],
    categories,
    difficulty: difficulty as Difficulty | "MIXED",
    questionCount: questionCount as QuizConfiguration["questionCount"],
    gameMode: gameMode as GameMode,
  };
}
