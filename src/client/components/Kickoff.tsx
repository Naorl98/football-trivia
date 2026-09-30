import { useEffect, useState } from "react";
import { BallMark } from "./BallMark";
import { motionAllowed } from "../lib/a11y";
import "./Kickoff.css";

/**
 * The opening whistle, capped at one second.
 *
 * It exists to mark the transition into a run, not to be watched. It never
 * blocks the question underneath — the quiz renders immediately behind it and
 * the overlay is pointer-transparent — and it is skipped entirely under reduced
 * motion, where an unannounced full-screen flash is worse than no flourish.
 */
export function Kickoff({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!motionAllowed()) {
      onDone();
      return;
    }
    const out = window.setTimeout(() => setLeaving(true), 620);
    const done = window.setTimeout(onDone, 940);
    return () => {
      window.clearTimeout(out);
      window.clearTimeout(done);
    };
  }, [onDone]);

  if (!motionAllowed()) return null;

  return (
    <div className={`kick ${leaving ? "kick-out" : ""}`} aria-hidden="true">
      <span className="kick-ring" />
      <span className="kick-ball">
        <BallMark size={56} />
      </span>
      <p className="kick-text">שריקת פתיחה</p>
    </div>
  );
}
