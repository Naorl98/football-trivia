// The question-type catalogue: what shapes of question the builder can ask for.
//
// WHY THIS IS SHARED AND DECLARATIVE
//
// A question type is three things at once — a card in the wizard, a pair of
// filters on the query, and a bucket in the mixed draw — and the only way those
// three stay in agreement is for them to read the same table. The old builder
// had the game modes in one list, the categories in another, and the quick-pick
// chips in a third, which is how "מי אני?" ended up in the same chip row as
// "ליגת האלופות": one is a question SHAPE and the other is a SCOPE, and nothing
// in the data model said so.
//
// EVERY ENTRY HERE IS BACKED BY QUESTIONS THAT EXIST. The counts in the comments
// are active questions on production at the time of writing, and they are what
// decided which types are listed at all:
//
//   by mode        CLASSIC 9,850 · CAREER_PATH 2,583 · CLUB_CONNECTION 1,444
//                  WHO_AM_I 705 · GUESS_THE_CLUB 364
//   by category    TRANSFERS 7,553 · CAREERS 1,822 · COACHES 348 · CLUBS 337
//                  PLAYERS 334 · TITLES 280 · CHAMPIONS_LEAGUE 280
//                  STADIUMS 160 · WORLD_CUP 112 · NATIONAL_TEAMS 63 · STATS 5
//
// STATS is deliberately absent: five questions is not a game type. Nothing here
// is aspirational — the wizard reads live counts and disables what cannot fill
// the requested quiz, so a type that thins out degrades visibly instead of
// producing a short or empty quiz.

import type { Category, GameMode } from "./types.ts";

export interface QuestionTypeSpec {
  key: string;
  labelHe: string;
  /** One line, and it has to stay one line — these render inside a card. */
  noteHe: string;
  icon: string;
  /** The `mode` column. Always exactly one: `q.mode = ?` is a single-value filter. */
  mode: GameMode;
  /** Empty means "any category within that mode". */
  categories: Category[];
  /**
   * Whether "מעורב" draws from this type.
   *
   * CLASSIC is excluded on purpose. It is not a type alongside the others, it is
   * the mode the category-based types live inside, so including it would let
   * TRANSFERS in twice — once as itself and once as five-sevenths of CLASSIC —
   * and transfers are 77% of that mode. The mixed draw uses the specific types
   * so that "mixed" is a mix of recognisable shapes rather than a mix weighted
   * by whatever the bank holds most of.
   */
  inMixed: boolean;
}

export const MIXED_TYPE_KEY = "MIXED";

export const QUESTION_TYPES: QuestionTypeSpec[] = [
  // ---- whole game modes: the question looks different, not just its subject ----
  { key: "CLASSIC", labelHe: "חידון קלאסי", noteHe: "שאלות טריוויה מכל הסוגים", icon: "ball", mode: "CLASSIC", categories: [], inMixed: false },
  { key: "WHO_AM_I", labelHe: "מי אני?", noteHe: "רמזים על שחקן — תנחשו מי", icon: "eye", mode: "WHO_AM_I", categories: [], inMixed: true },
  { key: "CAREER_PATH", labelHe: "מסלול קריירה", noteHe: "קבוצות בדרך — מי השחקן?", icon: "route", mode: "CAREER_PATH", categories: [], inMixed: true },
  { key: "GUESS_THE_CLUB", labelHe: "נחש את הקבוצה", noteHe: "רמזים על מועדון", icon: "shield", mode: "GUESS_THE_CLUB", categories: [], inMixed: true },
  { key: "CLUB_CONNECTION", labelHe: "חיבור קבוצות", noteHe: "מה מקשר בין שני שחקנים", icon: "share", mode: "CLUB_CONNECTION", categories: [], inMixed: true },

  // ---- subjects inside the classic quiz ----
  { key: "TRANSFERS", labelHe: "העברות", noteHe: "מי עבר לאן, ומתי", icon: "shirt", mode: "CLASSIC", categories: ["TRANSFERS"], inMixed: true },
  { key: "PLAYERS", labelHe: "שחקנים", noteHe: "עמדות, נבחרות וקריירות", icon: "boot", mode: "CLASSIC", categories: ["PLAYERS", "CAREERS"], inMixed: true },
  { key: "COACHES", labelHe: "מאמנים", noteHe: "מי אימן את מי", icon: "whistle", mode: "CLASSIC", categories: ["COACHES"], inMixed: true },
  { key: "TITLES", labelHe: "תארים", noteHe: "אליפויות וגביעים", icon: "trophy", mode: "CLASSIC", categories: ["TITLES"], inMixed: true },
  { key: "UCL", labelHe: "ליגת האלופות", noteHe: "הגדולה באירופה", icon: "flame", mode: "CLASSIC", categories: ["CHAMPIONS_LEAGUE"], inMixed: true },
  { key: "NATIONAL", labelHe: "נבחרות ומונדיאל", noteHe: "כבוד לאומי", icon: "globe", mode: "CLASSIC", categories: ["NATIONAL_TEAMS", "WORLD_CUP"], inMixed: true },
  { key: "CLUBS", labelHe: "מועדונים", noteHe: "אצטדיונים, כינויים והיסטוריה", icon: "stadium", mode: "CLASSIC", categories: ["CLUBS", "STADIUMS"], inMixed: true },
];

export const QUESTION_TYPE_BY_KEY = new Map(QUESTION_TYPES.map((t) => [t.key, t]));

/** The types "מעורב" draws from. */
export const MIXED_TYPE_KEYS = QUESTION_TYPES.filter((t) => t.inMixed).map((t) => t.key);

/**
 * The share of one mixed quiz any single type may supply.
 *
 * The spec's rule, and the reason it is needed: apportioning a mixed quiz by
 * availability alone hands it to whatever is biggest, and transfers are 7,553 of
 * the 14,946 active questions. A ten-question "mixed" quiz would be seven
 * transfer questions, which is not a mix — it is the transfers quiz with a
 * different label. 35% caps a ten-question quiz at four of any one type.
 */
export const MIXED_TYPE_MAX_SHARE = 0.35;
