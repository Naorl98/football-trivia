// Recognition data, derived from the curated registries.
//
// WHY THE CURATED REGISTRY IS A FAME ORACLE
//
// seed/data/clubs.ts and seed/data/players.ts were not assembled as fame lists.
// They were assembled by asking, club by club and player by player, "is this
// name unambiguous to a Hebrew-speaking football fan?" — which is the same
// question, arrived at from the other side. Membership is therefore the most
// direct evidence of recognition anywhere in this codebase, and far better than
// anything derivable from API-Football, which knows how much data it holds and
// nothing about who has heard of whom.
//
// This module turns those registries into the shape the football layer takes.
// The dependency runs one way on purpose: the football layer knows nothing about
// seed data, and this file is passed in by the scripts that use both.

import { CLUBS } from "./data/clubs.ts";
import { PLAYERS, PLAYER_ROLES } from "./data/players.ts";
import { LEAGUE_CHAMPIONS, UCL_FINALS, UEL_FINALS } from "./data/competitions.ts";
import type { CuratedRecognition } from "../src/server/football/context.ts";
import type { DetailedPosition } from "../src/server/football/positions.ts";

/**
 * Titles per curated club, counted from the competition tables we carry.
 *
 * A prominence proxy derived from data rather than from opinion: a club that
 * keeps turning up as a European or league winner is one the audience has heard
 * of. It is not a claim about the club's full honours list.
 */
function titleCounts(): Map<string, number> {
  const byId = new Map<string, number>();
  const add = (id: string) => byId.set(id, (byId.get(id) ?? 0) + 1);
  for (const final of UCL_FINALS) add(final.winner);
  for (const final of UEL_FINALS) add(final.winner);
  for (const league of LEAGUE_CHAMPIONS) for (const season of league.seasons) add(season.champion);

  // Keyed by every name the provider might use for the club, because the
  // knowledge base stores provider spellings and this has to match them.
  const byName = new Map<string, number>();
  for (const club of CLUBS) {
    const count = byId.get(club.id) ?? 0;
    for (const name of [club.en, club.he, ...club.aliases]) byName.set(name, count);
  }
  return byName;
}

/**
 * Every name a curated club might be stored under.
 *
 * Aliases are included because the provider's spelling and the registry's
 * rarely match exactly — "Atlético Madrid" against "Atletico Madrid",
 * "Tottenham Hotspur" against "Tottenham". The fold() in context.ts strips
 * accents and case, so what is left for the aliases to cover is genuinely
 * different names.
 */
function clubNames(): string[] {
  const names: string[] = [];
  for (const club of CLUBS) names.push(club.en, club.he, ...club.aliases);
  return names;
}

function playerTiers(): Map<string, 1 | 2 | 3> {
  const tiers = new Map<string, 1 | 2 | 3>();
  for (const player of PLAYERS) {
    for (const name of [player.en, player.he, ...player.aliases]) tiers.set(name, player.tier);
  }
  return tiers;
}

function playerRoles(): Map<string, DetailedPosition> {
  const roles = new Map<string, DetailedPosition>();
  for (const player of PLAYERS) {
    const role = PLAYER_ROLES[player.id];
    if (!role) continue;
    for (const name of [player.en, player.he, ...player.aliases]) roles.set(name, role);
  }
  return roles;
}

/** The whole recognition bundle, built once per run. */
export function curatedRecognition(): CuratedRecognition {
  return {
    clubNames: clubNames(),
    clubTitles: titleCounts(),
    playerTiers: playerTiers(),
    playerRoles: playerRoles(),
  };
}
