// The correction layer.
//
// WHAT THIS IS FOR, AND WHAT IT IS NOT FOR
//
// Overrides exist because no classifier is right about every club in the world.
// "Willem II" is an Eredivisie side whose name ends in a reserve marker; nothing
// in the string says so.
//
// They are NOT the fix for a class of problem. If a rule here would apply to
// more than a handful of rows, it belongs in entities.ts / positions.ts /
// career.ts as normalisation, and the normalisation is what gets tested. A
// growing override table is the symptom of a missing rule, not a solution — so
// every entry below names the single row it corrects and why no pattern could.
//
// Overrides are also deliberately *not* in the React layer. A club
// misclassified in the UI is a club still misclassified in the audit, the
// difficulty model and the distractor pool.

import type { TeamKind } from "./entities.ts";
import type { DetailedPosition } from "./positions.ts";

// ---------------------------------------------------------------------------
// Team kind
// ---------------------------------------------------------------------------

/**
 * Teams whose kind the patterns get wrong, by exact provider name.
 *
 * Empty of the obvious cases on purpose: "Willem II" is handled inside
 * entities.ts as a senior-club allow-list entry, because that is a statement
 * about the *pattern* rather than about one database row, and keeping it there
 * means the pattern's own tests cover it.
 *
 * This table is for rows where the provider's own data is wrong — a club flagged
 * `national`, or a national side not flagged at all and not named after a
 * country ("Chinese Taipei", "Curaçao" style cases).
 */
export const TEAM_KIND_OVERRIDES: Record<string, TeamKind> = {
  // (no entries yet — see the header before adding one)
};

/**
 * Reserve and youth sides whose first team cannot be derived from the name.
 *
 * `parentClubName` strips the suffix and looks the remainder up, which handles
 * "Barcelona B" → "Barcelona" and "Bayern München II" → "Bayern München". It
 * cannot handle a reserve side with its own name, and Spain has several.
 */
export const RESERVE_PARENT_OVERRIDES: Record<string, string> = {
  "Barcelona Atlètic": "Barcelona",
  "Barcelona Atletic": "Barcelona",
  "Real Madrid Castilla": "Real Madrid",
  "Castilla": "Real Madrid",
  "Deportivo Fabril": "Deportivo La Coruna",
  "Sevilla Atletico": "Sevilla",
  "Bilbao Athletic": "Athletic Club",
};

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

/**
 * Precise roles for provider-named players.
 *
 * API-Football returns only Goalkeeper / Defender / Midfielder / Attacker, so
 * every precise role in this product is curated. The curated *registry*
 * (seed/data/players.ts) carries its own `role` field, which is where roles for
 * the famous names live — it is data about the player, not a correction.
 *
 * This table is narrower: it maps a PROVIDER name, as stored in `players.name`,
 * for cases where a provider-backed question needs a precise role. It is empty
 * because no provider-backed generator currently asks a precise-role question —
 * resolvePosition returns LOW confidence for every player in the knowledge base,
 * and the generator asks the broad question instead. That is the correct
 * behaviour, and the table exists so that correcting one player later does not
 * require a new mechanism.
 */
export const PROVIDER_POSITION_OVERRIDES: Record<string, DetailedPosition> = {
  // (no entries — the broad/precise rule in positions.ts covers this today)
};

// ---------------------------------------------------------------------------
// Career
// ---------------------------------------------------------------------------

/**
 * Verified first senior clubs, by provider player name.
 *
 * The only way a FIRST_SENIOR_CLUB question can be produced from the knowledge
 * base — see resolveCareerStart. A provider record cannot establish that nothing
 * earlier exists, and that is the exact claim the question makes.
 *
 * The curated registry carries the same fact for the famous names via its
 * `firstListed` flag, which is why this table is for provider rows only.
 */
export const VERIFIED_FIRST_SENIOR_CLUB: Record<string, string> = {
  // (no entries — the curated registry covers the players worth asking about)
};

/** Provider spellings that mean the same entity. Whitespace is handled upstream. */
export const PROVIDER_ALIASES: Record<string, string> = {
  "Paris Saint Germain": "Paris Saint-Germain",
  "Manchester United": "Manchester United",
  "Internazionale": "Inter",
};

export const teamKindOverride = (name: string): TeamKind | null =>
  TEAM_KIND_OVERRIDES[(name ?? "").trim()] ?? null;

export const reserveParentOverride = (name: string): string | null =>
  RESERVE_PARENT_OVERRIDES[(name ?? "").trim()] ?? null;

export const providerPositionOverride = (name: string): DetailedPosition | null =>
  PROVIDER_POSITION_OVERRIDES[(name ?? "").trim()] ?? null;

export const verifiedFirstSeniorClub = (name: string): string | null =>
  VERIFIED_FIRST_SENIOR_CLUB[(name ?? "").trim()] ?? null;
