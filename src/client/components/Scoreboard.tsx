import { FlameMark } from "./Icon";
import "./Scoreboard.css";

export interface ScoreboardProps {
  /** Zero-based index of the question on screen. */
  index: number;
  total: number;
  /** Per-question outcome so far, in play order. */
  results: ("hit" | "miss")[];
  points: number;
  streak: number;
  difficultyLabel: string;
  freeText: boolean;
}

/**
 * The in-game HUD, built as a stadium scoreboard rather than a progress bar.
 *
 * Two deliberate departures from the usual quiz header:
 *
 *   1. Progress is a strip of per-question pips, not a filling bar. A bar tells
 *      you how far along you are; pips also tell you *how you did* — filled ink
 *      for a hit, hollow with a slash for a miss, an outlined box for the live
 *      question. That is the information a player actually wants mid-run.
 *   2. The score is set in tabular figures inside a ruled box, so digits change
 *      without the layout twitching.
 *
 * The whole thing is a single <section> with one live region, so assistive tech
 * hears "question 4 of 10, 3 correct" once per question instead of a stream of
 * unrelated updates.
 */
export function Scoreboard({
  index,
  total,
  results,
  points,
  streak,
  difficultyLabel,
  freeText,
}: ScoreboardProps) {
  return (
    <section className="board" aria-label="לוח ניקוד">
      <div className="board-top">
        <div className="board-cell board-cell-q">
          <span className="board-label label">שאלה</span>
          <span className="board-q figures">
            {index + 1}
            <span className="board-q-of">/{total}</span>
          </span>
        </div>

        <div className="board-tags">
          <span className="stamp stamp-solid">{difficultyLabel}</span>
          {freeText && <span className="stamp stamp-spot">תשובה חופשית</span>}
          {streak >= 2 && (
            <span className="board-streak">
              <FlameMark size={14} />
              <span className="figures">{streak}</span>
              <span className="board-streak-word">ברצף</span>
            </span>
          )}
        </div>

        <div className="board-cell board-cell-score">
          <span className="board-label label">ניקוד</span>
          <span className="board-score figures">{points}</span>
        </div>
      </div>

      {/* Pips. Decorative for AT — the live region below carries the same
          information in words. */}
      <ol className="pips" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => {
          const outcome = results[i];
          const state = i === index && outcome === undefined ? "live" : (outcome ?? "todo");
          return <li key={i} className={`pip pip-${state}`} />;
        })}
      </ol>

      <p className="sr-only" role="status" aria-live="polite">
        {`שאלה ${index + 1} מתוך ${total}. ${points} תשובות נכונות עד כה.`}
        {streak >= 2 ? ` ${streak} ברצף.` : ""}
      </p>
    </section>
  );
}
