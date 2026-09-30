import { useEffect, useState } from "react";
import { motionAllowed } from "../lib/a11y";
import "./ScoreRing.css";

const R = 54;
const C = 2 * Math.PI * R;

/**
 * The Football IQ score, as a single ring with the number inside.
 *
 * One flat stroke, no gradient and no glow — the colour steps between red,
 * amber and green at the rank boundaries, so the band is readable at a glance
 * without a legend. The number counts up so the result lands rather than just
 * appearing.
 */
export function ScoreRing({ value, label }: { value: number; label: string }) {
  const [shown, setShown] = useState(motionAllowed() ? 0 : value);

  useEffect(() => {
    if (!motionAllowed()) {
      setShown(value);
      return;
    }
    const duration = 950;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setShown(Math.round((1 - Math.pow(1 - p, 3)) * value));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  const tone = value >= 75 ? "good" : value >= 45 ? "mid" : "low";

  return (
    <figure className={`ring tone-${tone}`} role="img" aria-label={`Football IQ ${value} מתוך 100 — ${label}`}>
      <svg viewBox="0 0 128 128" aria-hidden="true">
        <circle className="ring-track" cx="64" cy="64" r={R} />
        <circle
          className="ring-arc"
          cx="64"
          cy="64"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - shown / 100)}
        />
      </svg>
      <figcaption className="ring-center">
        <span className="ring-value num">{shown}</span>
        <span className="ring-cap">Football IQ</span>
      </figcaption>
    </figure>
  );
}
