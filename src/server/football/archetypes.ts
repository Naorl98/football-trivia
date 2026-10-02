// The archetype registry.
//
// An archetype is a question *shape*: what is being asked, and therefore what
// kind of thing the answer is. Everything about a question that can be decided
// without looking at the football lives here.
//
// WHY A REGISTRY RATHER THAN A CONVENTION
//
// The bug this prevents is the one that shipped: a transfer question whose
// options included Japan. Nothing in the old code was wrong in isolation — the
// generator asked for distractors, the distractor helper returned team names,
// and `teams` holds national teams. No single function was responsible for
// knowing that "לאיזו קבוצה עבר" can only be answered by a club.
//
// Now it is stated once, as data, and the distractor engine and the validation
// gate both read it. A generator cannot forget, because it has to name its
// archetype to get distractors at all.

import type { EntityType } from "./entities.ts";

export type Archetype =
  // ---- transfers and movement ----
  | "TRANSFER_TO"
  | "TRANSFER_FROM"
  | "NEXT_CLUB"
  | "PREVIOUS_CLUB"
  // ---- careers ----
  | "FIRST_SENIOR_CLUB"
  | "YOUTH_CLUB"
  | "CAREER_PATH"
  | "CAREER_SPAN"
  | "NOT_PLAYED_FOR"
  | "CLUB_CONNECTION_CLUB"
  | "CLUB_CONNECTION_PLAYER"
  | "WHO_AM_I"
  // ---- identity ----
  | "PLAYER_NATIONALITY"
  | "PLAYER_NATIONAL_TEAM"
  | "POSITION_PRECISE"
  | "POSITION_BROAD"
  // ---- clubs ----
  | "GUESS_THE_CLUB"
  | "CLUB_COUNTRY"
  | "CLUB_STADIUM"
  | "STADIUM_CLUB"
  | "CLUB_NICKNAME"
  | "CLUB_FOUNDED_YEAR"
  // ---- competitions ----
  | "COMPETITION_WINNER"
  | "COMPETITION_RUNNER_UP"
  | "LEAGUE_CHAMPION"
  | "COMPETITION_PARTICIPATION"
  | "CUP_FINAL_OPPONENT"
  | "CUP_FINAL_SCORE"
  | "KNOCKOUT_BEATEN_OPPONENT"
  | "WORLD_CUP_HOST"
  | "TITLE_COUNT"
  | "TOP_SCORER"
  | "PLAYER_TROPHY"
  // ---- coaches ----
  | "COACH_CLUB"
  | "COACH_NATIONAL_TEAM"
  | "CLUB_COACH";

export interface ArchetypeSpec {
  /**
   * What the answer is. "RESOLVED" means the archetype can answer with either a
   * club or a national team and the generator must say which, per question —
   * a competition winner is a club in the Champions League and a national team
   * in the World Cup, and there is no way to know from the shape alone.
   */
  answerType: EntityType | "RESOLVED_TEAM";
  /**
   * What the distractors are. Always equal to the answer type; the field exists
   * so that a future archetype needing something else has to say so out loud
   * rather than being quietly allowed by a default.
   */
  distractorType?: EntityType | "RESOLVED_TEAM";
  /**
   * Intrinsic hardness of the shape, for a subject everybody knows, in the
   * present day, with unrelated distractors. Calibrated by asking how often a
   * competent fan gets it right: ~always → 0, about half → ~2, rarely → 2.5+.
   */
  weight: number;
  /**
   * Extra cost for questions that need more than one recall step — reading a
   * sequence, intersecting two careers, ruling three options out.
   */
  reasoning?: number;
  /** Whether a club question: used by the audit to apply the club-only rules. */
  clubOnly?: boolean;
}

export const ARCHETYPES: Record<Archetype, ArchetypeSpec> = {
  // ---- transfers and movement. CLUB → CLUB, always. ----
  TRANSFER_TO: { answerType: "CLUB", weight: 1.8, clubOnly: true },
  TRANSFER_FROM: { answerType: "CLUB", weight: 1.8, clubOnly: true },
  NEXT_CLUB: { answerType: "CLUB", weight: 1.8, reasoning: 0.2, clubOnly: true },
  PREVIOUS_CLUB: { answerType: "CLUB", weight: 1.8, reasoning: 0.2, clubOnly: true },

  // ---- careers ----
  FIRST_SENIOR_CLUB: { answerType: "CLUB", weight: 1.5, clubOnly: true },
  YOUTH_CLUB: { answerType: "CLUB", weight: 1.9, clubOnly: false },
  CAREER_PATH: { answerType: "PLAYER", weight: 1.2, reasoning: 0.3 },
  CAREER_SPAN: { answerType: "COUNT", weight: 2.1 },
  NOT_PLAYED_FOR: { answerType: "CLUB", weight: 1.0, reasoning: 0.3, clubOnly: true },
  CLUB_CONNECTION_CLUB: { answerType: "CLUB", weight: 1.6, reasoning: 0.4, clubOnly: true },
  CLUB_CONNECTION_PLAYER: { answerType: "PLAYER", weight: 1.6, reasoning: 0.4 },
  WHO_AM_I: { answerType: "PLAYER", weight: 0.9, reasoning: 0.3 },

  // ---- identity ----
  PLAYER_NATIONALITY: { answerType: "COUNTRY", weight: 0.2 },
  PLAYER_NATIONAL_TEAM: { answerType: "NATIONAL_TEAM", weight: 0.3 },
  // A precise role. Only legal where a precise role is actually known — see
  // ./positions.ts. The weight is low because the recall is easy *once the fact
  // exists*; the guard against asking it from broad data is a validation rule,
  // not a difficulty one.
  POSITION_PRECISE: { answerType: "POSITION", weight: 0.9 },
  POSITION_BROAD: { answerType: "POSITION_GROUP", weight: 0.0 },

  // ---- clubs ----
  GUESS_THE_CLUB: { answerType: "CLUB", weight: 1.1, reasoning: 0.3, clubOnly: true },
  CLUB_COUNTRY: { answerType: "COUNTRY", weight: 0.0 },
  CLUB_STADIUM: { answerType: "STADIUM", weight: 1.1 },
  STADIUM_CLUB: { answerType: "CLUB", weight: 1.1, clubOnly: true },
  CLUB_NICKNAME: { answerType: "COUNT", weight: 1.0 },
  CLUB_FOUNDED_YEAR: { answerType: "COUNT", weight: 2.6 },

  // ---- competitions ----
  COMPETITION_WINNER: { answerType: "RESOLVED_TEAM", weight: 0.8 },
  COMPETITION_RUNNER_UP: { answerType: "RESOLVED_TEAM", weight: 1.5 },
  LEAGUE_CHAMPION: { answerType: "CLUB", weight: 1.0, clubOnly: true },
  COMPETITION_PARTICIPATION: { answerType: "RESOLVED_TEAM", weight: 1.0, reasoning: 0.2 },
  CUP_FINAL_OPPONENT: { answerType: "RESOLVED_TEAM", weight: 1.2 },
  CUP_FINAL_SCORE: { answerType: "SCORELINE", weight: 2.2 },
  KNOCKOUT_BEATEN_OPPONENT: { answerType: "RESOLVED_TEAM", weight: 1.6 },
  WORLD_CUP_HOST: { answerType: "COUNTRY", weight: 0.6 },
  TITLE_COUNT: { answerType: "COUNT", weight: 2.1 },
  TOP_SCORER: { answerType: "PLAYER", weight: 1.4 },
  PLAYER_TROPHY: { answerType: "COMPETITION", weight: 1.3 },

  // ---- coaches ----
  COACH_CLUB: { answerType: "CLUB", weight: 1.4, clubOnly: true },
  /**
   * Separate from COACH_CLUB rather than resolved per question.
   *
   * Managing a country is a different kind of job and a different kind of
   * question — "את איזו נבחרת אימן" — and the two were being merged into one
   * pool, which is how six active questions offered a national team beside three
   * clubs. Two archetypes means the wording and the option pool move together.
   */
  COACH_NATIONAL_TEAM: { answerType: "NATIONAL_TEAM", weight: 1.2 },
  CLUB_COACH: { answerType: "COACH", weight: 1.4 },
};

export const ARCHETYPE_KEYS = Object.keys(ARCHETYPES) as Archetype[];

/**
 * The answer type for one question of one archetype.
 *
 * `resolvedTeamType` is required exactly when the archetype says RESOLVED_TEAM,
 * and throwing rather than defaulting is the point: a silent default is how a
 * World Cup winner ends up typed as a club.
 */
export function answerTypeFor(
  archetype: Archetype,
  resolvedTeamType?: Extract<EntityType, "CLUB" | "NATIONAL_TEAM">
): EntityType {
  const spec = ARCHETYPES[archetype];
  if (spec.answerType !== "RESOLVED_TEAM") return spec.answerType;
  if (!resolvedTeamType) {
    throw new Error(
      `${archetype} answers with either a club or a national team; the generator must resolve which.`
    );
  }
  return resolvedTeamType;
}

/**
 * Which of the two a competition's champion is.
 *
 * Read off the competition rather than guessed from the name: an INTERNATIONAL
 * competition is contested by nations, everything else by clubs. The provider
 * stores that type, so there is nothing to infer.
 */
export function winnerTypeOfCompetition(input: {
  type?: string | null;
  localCode?: string | null;
}): Extract<EntityType, "CLUB" | "NATIONAL_TEAM"> {
  const code = (input.localCode ?? "").toUpperCase();
  if (code === "WORLD_CUP" || code === "EURO" || code === "COPA_AMERICA") return "NATIONAL_TEAM";
  if ((input.type ?? "").toUpperCase() === "INTERNATIONAL") return "NATIONAL_TEAM";
  return "CLUB";
}
