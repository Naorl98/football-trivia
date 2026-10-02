// Recovering a stored question's archetype from its semantic key.
//
// WHY THIS IS NEEDED AT ALL
//
// Migration 0008 adds `questions.archetype`, and every question generated from
// now on carries it. The 15,186 questions already in production do not — they
// predate the column. The audit still has to judge them, and judging a question
// means knowing what it was asking, so the archetype has to be recovered.
//
// The semantic key is the only reliable record of it. Keys were always built as
// "<what this question is>:<what it is about>", by both banks, for exactly the
// de-duplication reason — which makes the prefix a faithful statement of the
// archetype even though nobody designed it as one.
//
// This map is therefore a migration aid with a long tail: it stays until the
// last pre-0008 question has been regenerated, and the audit reports how many
// keys it could not place so that the tail is visible rather than silent.

import type { Archetype } from "./archetypes.ts";

/**
 * Semantic-key prefix to archetype.
 *
 * The uppercase KB_ keys come from the provider-backed generators; the lowercase
 * ones from the curated bank. Both are listed because both are in production and
 * both need auditing.
 */
export const ARCHETYPE_BY_KEY_PREFIX: Record<string, Archetype> = {
  // ---- provider-backed bank ----
  KB_TRANSFER_TO: "TRANSFER_TO",
  KB_TRANSFER_FROM: "TRANSFER_FROM",
  KB_CAREER_PATH: "CAREER_PATH",
  KB_CLUB_CONNECTION: "CLUB_CONNECTION_CLUB",
  KB_WHO_AM_I: "WHO_AM_I",
  KB_NEVER_PLAYED: "NOT_PLAYED_FOR",
  KB_COACH_CLUB: "COACH_CLUB",
  KB_CLUB_COACH: "CLUB_COACH",
  KB_TEAM_VENUE: "CLUB_STADIUM",
  KB_GUESS_CLUB: "GUESS_THE_CLUB",
  KB_COMPETITION_PARTICIPATION: "COMPETITION_PARTICIPATION",
  KB_COMPETITION_WINNER: "COMPETITION_WINNER",
  KB_KNOCKOUT_BEAT: "KNOCKOUT_BEATEN_OPPONENT",
  KB_CUP_FINAL_OPPONENT: "CUP_FINAL_OPPONENT",
  KB_CUP_FINAL_SCORE: "CUP_FINAL_SCORE",
  KB_TOP_SCORER: "TOP_SCORER",
  KB_TROPHY_PLAYER: "PLAYER_TROPHY",

  // ---- curated bank ----
  // "connection" asks which PLAYER links two clubs; the KB's club connection
  // asks which CLUB links two players. Same name, opposite answer type, and
  // conflating them is exactly the mistake the archetype registry prevents.
  connection: "CLUB_CONNECTION_PLAYER",
  career_path: "CAREER_PATH",
  career_sub: "CAREER_PATH",
  guess_club: "GUESS_THE_CLUB",
  who_am_i: "WHO_AM_I",
  league_champ: "LEAGUE_CHAMPION",
  founded: "CLUB_FOUNDED_YEAR",
  club_country: "CLUB_COUNTRY",
  club_league: "CLUB_COUNTRY",
  // Pre-0008 these asked for a precise role from broad data, which is the bug.
  // They are repaired into broad-unit questions and keep the key, so the
  // archetype they map to is the one they will have after repair.
  position: "POSITION_BROAD",
  position_role: "POSITION_PRECISE",
  next_club: "NEXT_CLUB",
  prev_club: "PREVIOUS_CLUB",
  nationality: "PLAYER_NATIONALITY",
  not_played: "NOT_PLAYED_FOR",
  first_club: "FIRST_SENIOR_CLUB",
  ucl_winner: "COMPETITION_WINNER",
  uel_winner: "COMPETITION_WINNER",
  wc_winner: "COMPETITION_WINNER",
  euro_winner: "COMPETITION_WINNER",
  ucl_runnerup: "COMPETITION_RUNNER_UP",
  uel_runnerup: "COMPETITION_RUNNER_UP",
  wc_runnerup: "COMPETITION_RUNNER_UP",
  euro_runnerup: "COMPETITION_RUNNER_UP",
  wc_host: "WORLD_CUP_HOST",
  career_countries: "CAREER_SPAN",
  stadium: "CLUB_STADIUM",
  nickname: "CLUB_NICKNAME",
  league_count: "TITLE_COUNT",
  ucl_count: "TITLE_COUNT",
  uel_count: "TITLE_COUNT",
};

export function keyPrefix(semanticKey: string | null | undefined): string | null {
  if (!semanticKey) return null;
  const at = semanticKey.indexOf(":");
  return at === -1 ? semanticKey : semanticKey.slice(0, at);
}

export function archetypeForStoredKey(semanticKey: string | null | undefined): Archetype | null {
  const prefix = keyPrefix(semanticKey);
  return prefix ? ARCHETYPE_BY_KEY_PREFIX[prefix] ?? null : null;
}

/**
 * Archetypes whose every option must be a club.
 *
 * Named separately from `ARCHETYPES[...].clubOnly` because the audit needs it as
 * a set it can test a stored question against, and because this is the list the
 * hard invariant is stated over: zero club questions may contain a national
 * team.
 */
export const CLUB_ONLY_ARCHETYPES: Archetype[] = [
  "TRANSFER_TO",
  "TRANSFER_FROM",
  "NEXT_CLUB",
  "PREVIOUS_CLUB",
  "FIRST_SENIOR_CLUB",
  "NOT_PLAYED_FOR",
  "CLUB_CONNECTION_CLUB",
  "GUESS_THE_CLUB",
  "STADIUM_CLUB",
  "LEAGUE_CHAMPION",
  "COACH_CLUB",
];
