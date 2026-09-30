// Standings and tie-breaking.
//
// TIE-BREAKING, in order:
//   1. score, highest first
//   2. correct answers, highest first
//   3. average response time, fastest first (a player who answered nothing is
//      placed last on this key rather than treated as infinitely fast)
//
// If two players are identical on all three they SHARE a position — the room
// really is level between them, and inventing a winner out of join order would
// be a lie the podium then tells. Shared positions consume the ranks they span,
// so two players tied on 1 are followed by position 3 (standard competition
// ranking). `winnerIds` therefore holds more than one id on a genuine draw, and
// the UI says "שוויון" instead of naming a winner.
//
// Row ORDER within a shared position is still deterministic (join order, then
// id) so every client renders the same list — shared rank does not mean random
// order.

import type { FinalStanding, PublicPlayer, TeamId, TeamResult } from "./types.ts";

/** The comparison keys, extracted so the sort and the tie test cannot drift apart. */
function keys(p: PublicPlayer): [number, number, number] {
  return [
    p.score,
    p.correctCount,
    // Never answered → sorts last. Number.MAX_SAFE_INTEGER rather than Infinity
    // so the value survives a JSON round trip if it is ever serialized.
    p.averageResponseMs ?? Number.MAX_SAFE_INTEGER,
  ];
}

function tied(a: PublicPlayer, b: PublicPlayer): boolean {
  const ka = keys(a);
  const kb = keys(b);
  return ka[0] === kb[0] && ka[1] === kb[1] && ka[2] === kb[2];
}

export function comparePlayers(a: PublicPlayer, b: PublicPlayer): number {
  const ka = keys(a);
  const kb = keys(b);
  if (ka[0] !== kb[0]) return kb[0] - ka[0];
  if (ka[1] !== kb[1]) return kb[1] - ka[1];
  if (ka[2] !== kb[2]) return ka[2] - kb[2];
  // Presentation order only — both players hold the same position.
  if (a.joinedAt !== b.joinedAt) return a.joinedAt - b.joinedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildStandings(players: readonly PublicPlayer[]): FinalStanding[] {
  const sorted = [...players].sort(comparePlayers);
  const standings: FinalStanding[] = [];

  let position = 0;
  sorted.forEach((player, index) => {
    const previous = index > 0 ? sorted[index - 1] : null;
    // Standard competition ranking: a tie shares the earlier position, and the
    // ranks it spans are consumed.
    position = previous && tied(previous, player) ? position : index + 1;

    const attempted = player.correctCount + player.wrongCount;
    standings.push({
      position,
      playerId: player.id,
      name: player.name,
      team: player.team,
      score: player.score,
      correctCount: player.correctCount,
      wrongCount: player.wrongCount,
      accuracy: attempted === 0 ? 0 : Math.round((player.correctCount / attempted) * 1000) / 10,
      bestStreak: player.bestStreak,
      averageResponseMs: player.averageResponseMs,
    });
  });

  return standings;
}

/** Every player sharing the top position. More than one on a genuine draw. */
export function winnerIdsFrom(standings: readonly FinalStanding[]): string[] {
  if (standings.length === 0) return [];
  const top = standings[0].position;
  return standings.filter((s) => s.position === top).map((s) => s.playerId);
}

export function teamTotals(players: readonly PublicPlayer[]): Record<TeamId, number> {
  const totals: Record<TeamId, number> = { GREEN: 0, GOLD: 0 };
  for (const player of players) {
    if (player.team) totals[player.team] += player.score;
  }
  return totals;
}

/**
 * The team outcome plus the MVP.
 *
 * MVP is the single best individual across BOTH teams, using the same tiebreak
 * chain as the standings — so it can be a player on the losing team, which is
 * the more interesting result and the honest one.
 */
export function buildTeamResult(
  players: readonly PublicPlayer[],
  names: Record<TeamId, string>
): TeamResult {
  const scores = teamTotals(players);
  const winner = scores.GREEN === scores.GOLD ? null : scores.GREEN > scores.GOLD ? "GREEN" : "GOLD";
  const ranked = [...players].filter((p) => p.team !== null).sort(comparePlayers);
  return {
    winner,
    scores,
    names,
    mvpPlayerId: ranked.length > 0 ? ranked[0].id : null,
  };
}

/**
 * Splits players into two balanced teams.
 *
 * Alternating over join order rather than shuffling: the host presses
 * "אזן קבוצות" to get a predictable, explainable split, and a random one that
 * puts four friends against two strangers is not what they asked for. Sizes
 * differ by at most one.
 */
export function autoBalance(players: readonly PublicPlayer[]): Map<string, TeamId> {
  const assignment = new Map<string, TeamId>();
  [...players]
    .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1))
    .forEach((player, index) => {
      assignment.set(player.id, index % 2 === 0 ? "GREEN" : "GOLD");
    });
  return assignment;
}
