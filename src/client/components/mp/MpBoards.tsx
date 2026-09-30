// The boards: the team sheet, the live scoreboards, the standings table, the
// podium and the winner cards.
//
// ART DIRECTION. None of these is a card with a title and a list. The lobby is a
// matchday team sheet with shirt numbers; the running score is a broadcast
// scoreboard strip; a duel is two name plates either side of a VS; the finish is a
// podium with real steps. That is the whole reason this file exists instead of
// three generic tables — the product's single-player screens already established
// this look, and a multiplayer screen that fell back to SaaS cards would read as
// a different app bolted on.
//
// Every board is also a list of rows in the DOM in scoreboard order, so a screen
// reader gets the standings in the same order the eye does.

import { useEffect, useRef, useState } from "react";
import type {
  FinalStanding,
  PublicPlayer,
  RoundReveal,
  TeamId,
  TeamResult,
} from "../../../shared/multiplayer/types";
import { motionAllowed } from "../../lib/a11y";
import { Icon, FlameMark } from "../Icon";

// ----------------------------------------------------------------- team sheet

/**
 * The lobby roster, as a matchday team sheet.
 *
 * Rows are numbered like a lineup, the host wears the armband, and a player who
 * has dropped is greyed and labelled rather than removed — a row vanishing and
 * reappearing as someone's train goes through a tunnel would be far more
 * unsettling than "מתחבר מחדש…".
 */
export function TeamSheet({
  players,
  youId,
  teams,
  teamNames,
  onKick,
  onAssign,
}: {
  players: PublicPlayer[];
  youId: string | null;
  teams: boolean;
  teamNames: Record<TeamId, string>;
  /** Present only for the host. */
  onKick?: (playerId: string) => void;
  onAssign?: (playerId: string, team: TeamId) => void;
}) {
  return (
    <ol className="mp-sheet">
      {players.map((player, index) => (
        <li
          key={player.id}
          className={`mp-sheet-row ${player.connected ? "" : "is-away"} ${player.id === youId ? "is-you" : ""} ${
            motionAllowed() ? "a-lineup" : ""
          }`}
          style={{ "--i": index } as React.CSSProperties}
        >
          <span className="mp-sheet-num num" aria-hidden="true">
            {index + 1}
          </span>

          <span className="mp-sheet-name">
            {player.name}
            {player.id === youId && <span className="sr-only"> — אתם</span>}
          </span>

          <span className="mp-sheet-tags">
            {player.isHost && (
              <span className="tag tag-amber">
                <Icon name="whistle" size={12} />
                מארח
              </span>
            )}
            {teams && player.team && (
              <span className={`tag mp-team-tag is-${player.team.toLowerCase()}`}>{teamNames[player.team]}</span>
            )}
            {!player.connected && (
              <span className="tag">{player.reconnecting ? "מתחבר מחדש…" : "לא מחובר"}</span>
            )}
          </span>

          {(onAssign || onKick) && (
            <span className="mp-sheet-host-actions">
              {onAssign && teams && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => onAssign(player.id, player.team === "GREEN" ? "GOLD" : "GREEN")}
                  aria-label={`העבר את ${player.name} לקבוצה השנייה`}
                >
                  <Icon name="replay" size={14} />
                </button>
              )}
              {onKick && player.id !== youId && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => onKick(player.id)}
                  aria-label={`הסר את ${player.name} מהחדר`}
                >
                  <Icon name="cross" size={14} />
                </button>
              )}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------- answer status

/**
 * Who has answered — and nothing more.
 *
 * This is the one board with a hard rule about what it must NOT show: whether an
 * answer was right. It gets `answeredIds` and never the round results, so there is
 * no correctness in scope for it to leak by accident.
 */
export function AnswerStatus({
  players,
  answeredIds,
  turnPlayerId,
}: {
  players: PublicPlayer[];
  answeredIds: string[];
  turnPlayerId: string | null;
}) {
  const answered = new Set(answeredIds);
  const relevant = turnPlayerId ? players.filter((p) => p.id === turnPlayerId) : players.filter((p) => p.connected);

  return (
    <ul className="mp-status">
      {relevant.map((player) => (
        <li key={player.id} className={`mp-status-row ${answered.has(player.id) ? "is-in" : ""}`}>
          <span className="mp-status-dot" aria-hidden="true" />
          <span className="mp-status-name">{player.name}</span>
          <span className="mp-status-state">{answered.has(player.id) ? "ענה" : "חושב…"}</span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------- scoreboards

/**
 * The broadcast scoreboard strip.
 *
 * Rows animate to their new position when the order changes, which is the one
 * moment the standings are worth watching — a player overtaking another is the
 * story. `--rank` drives the transform so the move costs one transform per row.
 */
export function LiveScoreboard({
  players,
  youId,
  roundWinnerIds = [],
}: {
  players: PublicPlayer[];
  youId: string | null;
  roundWinnerIds?: string[];
}) {
  const ordered = [...players].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  const leader = ordered[0]?.score ?? 0;
  const moved = useRankShift(ordered.map((p) => p.id));

  return (
    <ol className="mp-board">
      {ordered.map((player, index) => (
        <li
          key={player.id}
          className={[
            "mp-board-row",
            player.id === youId ? "is-you" : "",
            roundWinnerIds.includes(player.id) ? "is-round-winner" : "",
            moved.has(player.id) && motionAllowed() ? "is-moved" : "",
            player.connected ? "" : "is-away",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="mp-board-pos num" aria-hidden="true">
            {index + 1}
          </span>
          <span className="mp-board-name">{player.name}</span>
          {player.streak >= 2 && (
            <span className="mp-board-streak" title={`רצף ${player.streak}`}>
              <FlameMark size={12} />
              <span className="num">{player.streak}</span>
              <span className="sr-only">רצף של {player.streak}</span>
            </span>
          )}
          <span className="mp-board-score num">{player.score}</span>
          <span
            className="mp-board-bar"
            aria-hidden="true"
            style={{ "--fill": leader > 0 ? `${(player.score / leader) * 100}%` : "0%" } as React.CSSProperties}
          />
        </li>
      ))}
    </ol>
  );
}

/**
 * Remembers which rows changed rank since the last render, so only those animate.
 * Without this every row would jump on every score update.
 */
function useRankShift(order: string[]): Set<string> {
  const previousRef = useRef<string[]>([]);
  const [moved, setMoved] = useState<Set<string>>(new Set());

  useEffect(() => {
    const before = previousRef.current;
    const changed = new Set<string>();
    order.forEach((id, index) => {
      const was = before.indexOf(id);
      if (was !== -1 && was !== index) changed.add(id);
    });
    previousRef.current = order;
    if (changed.size === 0) return;
    setMoved(changed);
    const timer = window.setTimeout(() => setMoved(new Set()), 600);
    return () => window.clearTimeout(timer);
    // The joined key is the comparison: a re-render with the same order is a no-op.
  }, [order.join("|")]);

  return moved;
}

/** Two name plates and a scoreline. The head-to-head, not a table of two rows. */
export function DuelScoreboard({
  players,
  youId,
  roundWinnerIds = [],
}: {
  players: PublicPlayer[];
  youId: string | null;
  roundWinnerIds?: string[];
}) {
  const [left, right] = [...players].sort((a, b) => a.joinedAt - b.joinedAt);
  if (!left || !right) return null;

  const side = (player: PublicPlayer, className: string) => (
    <div
      className={[
        "mp-duel-side",
        className,
        player.id === youId ? "is-you" : "",
        roundWinnerIds.includes(player.id) ? "is-round-winner" : "",
        player.connected ? "" : "is-away",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="mp-duel-name">{player.name}</span>
      <span className="mp-duel-score num">{player.score}</span>
      {player.streak >= 2 && (
        <span className="mp-duel-streak">
          <FlameMark size={11} />
          <span className="num">{player.streak}</span>
        </span>
      )}
      {!player.connected && <span className="tag mp-duel-away">{player.reconnecting ? "מתחבר…" : "יצא"}</span>}
    </div>
  );

  return (
    <div className="mp-duel" aria-label="לוח התוצאות">
      {side(left, "mp-duel-left")}
      <span className="mp-duel-vs" aria-hidden="true">
        VS
      </span>
      {side(right, "mp-duel-right")}
    </div>
  );
}

/** GREEN vs GOLD, aggregate first, with each side's members under it. */
export function TeamScoreboard({
  players,
  scores,
  names,
  youId,
}: {
  players: PublicPlayer[];
  scores: Record<TeamId, number>;
  names: Record<TeamId, string>;
  youId: string | null;
}) {
  const column = (team: TeamId) => {
    const members = players
      .filter((p) => p.team === team)
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
    return (
      <div className={`mp-tsb-col is-${team.toLowerCase()}`}>
        <p className="mp-tsb-name">{names[team]}</p>
        <p className="mp-tsb-score num">{scores[team]}</p>
        <ul className="mp-tsb-members">
          {members.map((member) => (
            <li key={member.id} className={member.id === youId ? "is-you" : ""}>
              <span>{member.name}</span>
              <span className="num">{member.score}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="mp-tsb" aria-label="תוצאות הקבוצות">
      {column("GREEN")}
      <span className="mp-tsb-vs" aria-hidden="true">
        VS
      </span>
      {column("GOLD")}
    </div>
  );
}

// ------------------------------------------------------------ round results

/** Per-player outcome for the round: right, wrong, gave up, or never answered. */
export function RoundResults({
  reveal,
  players,
  youId,
}: {
  reveal: RoundReveal;
  players: PublicPlayer[];
  youId: string | null;
}) {
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "";

  return (
    <ul className="mp-round">
      {reveal.results.map((result) => {
        const state = result.revealed
          ? "revealed"
          : !result.answered
            ? "missed"
            : result.correct
              ? "correct"
              : "wrong";
        const label =
          state === "revealed" ? "נחשף" : state === "missed" ? "לא ענה" : state === "correct" ? "נכון" : "לא נכון";
        return (
          <li
            key={result.playerId}
            className={`mp-round-row is-${state} ${result.playerId === youId ? "is-you" : ""}`}
          >
            <span className="mp-round-mark" aria-hidden="true">
              <Icon
                name={state === "correct" ? "check" : state === "revealed" ? "eye" : state === "missed" ? "clock" : "cross"}
                size={15}
                strokeWidth={2.4}
              />
            </span>
            <span className="mp-round-name">{nameOf(result.playerId)}</span>
            {result.typedAnswer && <span className="mp-round-typed faint">{result.typedAnswer}</span>}
            <span className="mp-round-label tiny">{label}</span>
            {result.hintsUsed > 0 && (
              <span className="mp-round-hints tiny" title={`${result.hintsUsed} רמזים`}>
                <Icon name="bulb" size={12} />
                {result.hintsUsed}
              </span>
            )}
            <span className="mp-round-points num">{result.pointsAwarded > 0 ? `+${result.pointsAwarded}` : "0"}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------- podium

/**
 * The podium: third, then second, then first, each arriving in turn.
 *
 * Only for three or more players. A duel gets a winner card instead, because a
 * podium with two steps and an empty third is a worse picture than a scoreline —
 * and because in a one-on-one "second place" is just "lost".
 */
export function Podium({ standings }: { standings: FinalStanding[] }) {
  const animate = motionAllowed();
  const top = standings.slice(0, 3);
  // Rendered 3rd, 1st, 2nd left-to-right so the winner is in the middle; the
  // reveal order is handled by the per-step delay.
  const arrangement = [top[2], top[0], top[1]].filter(Boolean) as FinalStanding[];
  const stepFor = (position: number) => (position === 1 ? "gold" : position === 2 ? "silver" : "bronze");

  return (
    <div className={`mp-podium ${animate ? "is-animated" : ""}`}>
      {arrangement.map((entry) => (
        <div
          key={entry.playerId}
          className={`mp-podium-step is-${stepFor(entry.position)}`}
          style={{ "--delay": `${(4 - Math.min(3, entry.position)) * 260}ms` } as React.CSSProperties}
        >
          {entry.position === 1 && (
            <span className="mp-podium-trophy" aria-hidden="true">
              <Icon name="trophy" size={26} />
            </span>
          )}
          <span className="mp-podium-name">{entry.name}</span>
          <span className="mp-podium-score num">{entry.score}</span>
          <span className="mp-podium-block">
            <span className="mp-podium-pos num">{entry.position}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** The 1v1 finish: a winner, a scoreline, and the numbers behind it. */
export function WinnerCard({
  standings,
  winnerIds,
  forfeited,
}: {
  standings: FinalStanding[];
  winnerIds: string[];
  forfeited: boolean;
}) {
  const draw = winnerIds.length !== 1;
  const winner = draw ? null : standings.find((s) => s.playerId === winnerIds[0]) ?? null;

  return (
    <div className={`mp-winner ${motionAllowed() ? "a-pop" : ""}`}>
      <p className="mp-winner-label tiny">{draw ? "התוצאה" : "WINNER"}</p>
      <p className="mp-winner-name">{draw ? "שוויון!" : winner?.name}</p>
      {forfeited && <p className="mp-winner-note">היריב לא חזר למשחק</p>}

      <div className="mp-winner-stats">
        {standings.map((entry) => (
          <div key={entry.playerId} className="mp-winner-col">
            <p className="mp-winner-col-name">{entry.name}</p>
            <dl>
              <Stat k="ניקוד" v={String(entry.score)} />
              <Stat k="נכונות" v={String(entry.correctCount)} />
              <Stat k="רצף" v={String(entry.bestStreak)} />
              <Stat k="זמן ממוצע" v={entry.averageResponseMs === null ? "—" : `${(entry.averageResponseMs / 1000).toFixed(1)}s`} />
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The team finish: winning team first, then the MVP. */
export function TeamWinCard({ result, standings }: { result: TeamResult; standings: FinalStanding[] }) {
  const mvp = standings.find((s) => s.playerId === result.mvpPlayerId) ?? null;
  return (
    <div className={`mp-teamwin ${motionAllowed() ? "a-pop" : ""}`}>
      <p className="mp-teamwin-label tiny">{result.winner ? "הקבוצה המנצחת" : "התוצאה"}</p>
      <p className={`mp-teamwin-name ${result.winner ? `is-${result.winner.toLowerCase()}` : ""}`}>
        {result.winner ? `${result.names[result.winner]} ניצחו` : "שוויון בין הקבוצות"}
      </p>
      <p className="mp-teamwin-score num">
        {result.scores.GREEN} — {result.scores.GOLD}
      </p>

      {mvp && (
        <div className="mp-mvp">
          <span className="mp-mvp-label tiny">MVP</span>
          <span className="mp-mvp-name">{mvp.name}</span>
          <span className="mp-mvp-score num">{mvp.score} נקודות</span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- standings table

/** The full standings, every column. Positions can repeat — a tie is a tie. */
export function StandingsTable({ standings, youId }: { standings: FinalStanding[]; youId: string | null }) {
  return (
    <div className="mp-standings" role="table" aria-label="טבלה מלאה">
      <div className="mp-standings-head" role="row">
        <span role="columnheader">#</span>
        <span role="columnheader">שחקן</span>
        <span role="columnheader">ניקוד</span>
        <span role="columnheader">נכון</span>
        <span role="columnheader">שגוי</span>
        <span role="columnheader">דיוק</span>
        <span role="columnheader">רצף</span>
        <span role="columnheader">זמן</span>
      </div>
      {standings.map((entry) => (
        <div
          key={entry.playerId}
          className={`mp-standings-row ${entry.playerId === youId ? "is-you" : ""}`}
          role="row"
        >
          <span className="num" role="cell">
            {entry.position}
          </span>
          <span className="mp-standings-name" role="cell">
            {entry.name}
          </span>
          <span className="num mp-standings-score" role="cell">
            {entry.score}
          </span>
          <span className="num" role="cell">
            {entry.correctCount}
          </span>
          <span className="num" role="cell">
            {entry.wrongCount}
          </span>
          <span className="num" role="cell">
            {entry.accuracy}%
          </span>
          <span className="num" role="cell">
            {entry.bestStreak}
          </span>
          <span className="num" role="cell">
            {entry.averageResponseMs === null ? "—" : `${(entry.averageResponseMs / 1000).toFixed(1)}s`}
          </span>
        </div>
      ))}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="mp-stat">
      <dt className="tiny">{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  );
}
