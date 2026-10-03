import { COMPETITIONS, COUNTRIES, QUESTION_COUNTS } from "../../shared/constants.ts";
import { DIFFICULTIES, QUIZ_PRESETS } from "../../shared/types.ts";
import { MIXED_TYPE_KEY, QUESTION_TYPE_BY_KEY } from "../../shared/questionTypes.ts";
import type {
  AnswerMode,
  Category,
  Difficulty,
  GameMode,
  QuizConfiguration,
  QuizPreset,
  Region,
} from "../../shared/types.ts";

const VALID_COUNTRIES = new Set(COUNTRIES.map((c) => c.code));
const VALID_COMPETITIONS = new Set(COMPETITIONS.map((c) => c.code));

/**
 * Keeps only codes the product actually defines, and drops duplicates.
 *
 * This is not cosmetic. Every scope value becomes two bound parameters in the
 * question query, and D1 rejects any statement with more than 100 of them. An
 * unbounded list of caller-supplied strings is therefore a denial-of-service on
 * quiz creation, not just sloppy input. Dropping unknown codes is also
 * semantically free: a code the seed never emits cannot match a scope row.
 */
function allowlist(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && allowed.has(item)) seen.add(item);
  }
  return [...seen];
}

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

  const countries = allowlist(b.countries, VALID_COUNTRIES);
  const competitions = allowlist(b.competitions, VALID_COMPETITIONS);

  const categories = [
    ...new Set(
      Array.isArray(b.categories)
        ? (b.categories.filter((c) => VALID_CATEGORIES.includes(c as Category)) as Category[])
        : []
    ),
  ];

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

  // answerMode is optional so older clients and stored challenge
  // configurations keep working as multiple choice.
  const answerMode = b.answerMode ?? "MULTIPLE_CHOICE";
  if (answerMode !== "MULTIPLE_CHOICE" && answerMode !== "FREE_TEXT") {
    throw new ValidationError("Invalid answerMode");
  }

  /*
    THE PRESET, AND WHY IT IS NOT A HINT.

    A preset names a set of difficulty rules that the server enforces. It does
    not travel alongside the client's `difficulty` as a suggestion — it replaces
    it, in the engine, which is the only place the replacement cannot be
    bypassed. An unknown preset is rejected rather than ignored: silently
    dropping it would turn a Quick Start request into an unfiltered one, which
    is exactly the leak this field exists to close.
  */
  const presetRaw = b.preset ?? null;
  if (presetRaw !== null && !QUIZ_PRESETS.includes(presetRaw as QuizPreset)) {
    throw new ValidationError("Invalid preset");
  }

  /*
    THE QUESTION TYPE, rejected rather than ignored when unknown — the same
    reasoning as the preset above.

    "MIXED" changes which code path draws the quiz, so a typo that got silently
    dropped would turn a mixed quiz into a classic one and look like it worked.
    Absent is a legitimate value: older clients and every stored challenge
    configuration predate the field, and they mean "use gameMode and categories
    as given".
  */
  const questionTypeRaw = b.questionType ?? null;
  if (
    questionTypeRaw !== null &&
    questionTypeRaw !== MIXED_TYPE_KEY &&
    !QUESTION_TYPE_BY_KEY.has(questionTypeRaw as string)
  ) {
    throw new ValidationError("Invalid questionType");
  }

  // These are rendered as SQL integer literals rather than bound parameters
  // (see db/questions.ts), so they no longer compete for D1's parameter budget.
  // The cap is now only about request size, and duplicates are pointless work.
  const excludeQuestionIds = Array.isArray(b.excludeQuestionIds)
    ? [...new Set(b.excludeQuestionIds.filter((id): id is number => Number.isInteger(id)))].slice(0, 500)
    : [];

  return {
    region: region as Region | null,
    countries: countries as string[],
    competitions: competitions as string[],
    categories,
    difficulty: difficulty as Difficulty | "MIXED",
    questionCount: questionCount as QuizConfiguration["questionCount"],
    gameMode: gameMode as GameMode,
    answerMode: answerMode as AnswerMode,
    preset: presetRaw as QuizPreset | null,
    questionType: questionTypeRaw as string | null,
    excludeQuestionIds: excludeQuestionIds as number[],
  };
}
