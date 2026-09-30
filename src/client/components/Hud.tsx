import { FlameMark } from "./Icon";
import "./Hud.css";

export interface HudProps {
  index: number;
  total: number;
  points: number;
  streak: number;
  difficultyLabel: string;
  modeLabel: string;
  /** Pops the score when it has just gone up. */
  scoreBumped: boolean;
}

/**
 * The in-game HUD.
 *
 * Deliberately not a panel: no background, no border, no card. It is a line of
 * text, a hairline progress bar and two small labels, sitting directly on the
 * page so the question is the only thing with visual weight. The previous
 * version was a large opaque block that dominated the screen.
 *
 * One live region announces position and score together, once per question,
 * rather than letting three separate values chatter.
 */
export function Hud({ index, total, points, streak, difficultyLabel, modeLabel, scoreBumped }: HudProps) {
  const progress = (index / total) * 100;

  return (
    <div className="hud">
      <div className="hud-line">
        <span className="hud-pos">
          שאלה <b className="num">{index + 1}</b> מתוך <b className="num">{total}</b>
        </span>

        {streak >= 2 && (
          <span className="hud-streak a-pop" key={streak}>
            <FlameMark size={12} />
            <span className="num">{streak}</span>
          </span>
        )}

        <span className="hud-score">
          <span className={`num hud-score-value ${scoreBumped ? "a-score-pop" : ""}`}>{points}</span>
          <span className="hud-score-label">נק׳</span>
        </span>
      </div>

      <div className="bar hud-bar">
        <div className="bar-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="hud-tags">
        <span className="tag">{difficultyLabel}</span>
        <span className="tag">{modeLabel}</span>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {`שאלה ${index + 1} מתוך ${total}. ${points} נקודות.`}
        {streak >= 2 ? ` ${streak} ברצף.` : ""}
      </p>
    </div>
  );
}
