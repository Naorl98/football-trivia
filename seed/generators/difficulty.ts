// Difficulty for the curated seed bank.
//
// WHY THIS IS NOW AN ADAPTER
//
// There used to be two difficulty models: this one for the curated bank and a
// five-step ladder for the provider-backed bank. Two models meant HARD meant two
// different things depending on which generator produced the question, which is
// indefensible for a band the player chooses by name. Worse, neither knew where
// a fact came from, so an obscure Ligue 1 full-back's 2024 transfer scored the
// same as a famous one.
//
// There is now one model, in src/server/football/difficulty.ts. This file keeps
// the vocabulary the curated generators were written against — short archetype
// names, a three-step fame scale, a distractor-closeness enum — and translates.
// The translation is the only thing here; the arithmetic all happens there.
//
// DELIBERATELY NOT A SIGNAL: answer mode. Typing a name from nothing is harder
// than picking one of four, but the band is stored per question while the answer
// mode is chosen per quiz — so "HARD" has to mean the same thing either way.

import {
  classifyDifficulty,
  difficultyScore as scoreSignals,
  eraWeight as sharedEraWeight,
  type Band as SharedBand,
  type DistractorCloseness,
} from "../../src/server/football/difficulty.ts";
import { ARCHETYPES, type Archetype as SharedArchetype } from "../../src/server/football/archetypes.ts";
import type { DomainTier, FactProminence } from "../../src/server/football/prominence.ts";

export type Band = SharedBand;

/**
 * How far the subject is from being a household name.
 *   0 — anyone who watches football knows them (Messi, Real Madrid)
 *   1 — a regular viewer knows them (Rodri, Atalanta)
 *   2 — keen fans know them (a 1990s squad player, a second-tier club)
 *
 * Mapped onto the shared 0–3 scale below. The curated registry never produces a
 * 3: every player in it was chosen because a Hebrew-speaking fan would know the
 * name, so the bottom of the shared scale is reserved for the provider-backed
 * bank, where genuinely unknown players do turn up.
 */
export type Fame = 0 | 1 | 2;

/** How close the wrong options sit to the right one. */
export type Distractors = DistractorCloseness;

/**
 * The curated generators' archetype names, mapped to the shared registry.
 *
 * Both vocabularies are kept because both are load-bearing: these names appear
 * in every curated generator and in the semantic keys stored in production
 * ("first_club:messi"), while the shared names are what the audit and the
 * validation gate speak. The map is the contract between them.
 */
const SHARED_ARCHETYPE: Record<string, SharedArchetype> = {
  club_country: "CLUB_COUNTRY",
  nationality: "PLAYER_NATIONALITY",
  final_winner: "COMPETITION_WINNER",
  wc_host: "WORLD_CUP_HOST",
  league_champion: "LEAGUE_CHAMPION",
  not_played_for: "NOT_PLAYED_FOR",
  nickname: "CLUB_NICKNAME",
  stadium: "CLUB_STADIUM",
  career_path: "CAREER_PATH",
  who_am_i: "WHO_AM_I",
  guess_club: "GUESS_THE_CLUB",
  first_club: "FIRST_SENIOR_CLUB",
  final_runner_up: "COMPETITION_RUNNER_UP",
  club_connection: "CLUB_CONNECTION_PLAYER",
  adjacent_move: "NEXT_CLUB",
  title_count: "TITLE_COUNT",
  founded_year: "CLUB_FOUNDED_YEAR",
  position_precise: "POSITION_PRECISE",
  position_broad: "POSITION_BROAD",
};

export type Archetype = keyof typeof SHARED_ARCHETYPE;

/**
 * Intrinsic hardness of each question shape, read from the shared registry.
 *
 * Kept as an exported table because the curated generators and their tests read
 * it, but it is no longer a second source of truth — every value comes from
 * ARCHETYPES, so changing one changes both banks together.
 */
export const ARCHETYPE_WEIGHT: Record<Archetype, number> = Object.fromEntries(
  Object.entries(SHARED_ARCHETYPE).map(([local, shared]) => [
    local,
    ARCHETYPES[shared].weight + (ARCHETYPES[shared].reasoning ?? 0),
  ])
) as Record<Archetype, number>;

export interface Signals {
  archetype: Archetype;
  fame?: Fame;
  /** The year the fact belongs to, for dated facts only. */
  year?: number;
  distractors?: Distractors;
  /**
   * Prominence of the least well-known entity in the question, 0–3. The curated
   * registries supply this from their own data (titles held, league stature);
   * see clubFame in ./index.ts.
   */
  entityProminence?: number;
  /** Which football world the fact belongs to. Curated content is CORE. */
  tier?: DomainTier;
  factProminence?: FactProminence;
}

/**
 * The curated 0–2 fame scale onto the shared 0–3 one.
 *
 * Not a simple multiply. Tier 2 of the curated registry ("very well known")
 * must not cross the obscure-subject threshold that keeps a question out of EASY
 * and NORMAL, because those players — Rodri, Lautaro Martínez, Jordi Alba — are
 * exactly who NORMAL is for. So the top of this scale stops below it.
 */
const SHARED_FAME: Record<Fame, number> = { 0: 0, 1: 0.8, 2: 1.6 };

function toSharedSignals(signals: Signals) {
  return {
    archetype: SHARED_ARCHETYPE[signals.archetype],
    subjectFame: signals.fame === undefined ? undefined : SHARED_FAME[signals.fame],
    entityProminence: signals.entityProminence,
    tier: signals.tier ?? ("CORE" as DomainTier),
    factProminence: signals.factProminence,
    year: signals.year,
    distractors: signals.distractors,
  };
}

export const eraWeight = sharedEraWeight;

/** The continuous difficulty score. Exported so tests can probe the curve. */
export function difficultyScore(signals: Signals): number {
  return scoreSignals(toSharedSignals(signals));
}

export function difficultyFor(signals: Signals): Band {
  return classifyDifficulty(toSharedSignals(signals)).band;
}

export const BAND_ORDER: Band[] = ["EASY", "NORMAL", "HARD", "EXPERT", "IMPOSSIBLE"];
