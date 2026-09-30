import { useEffect, useState } from "react";
import "./IqMeter.css";

const RADIUS = 66;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Animated 0-100 Football IQ dial. The value counts up from zero so the
 * result lands rather than just appearing; reduced-motion users get the final
 * number immediately.
 */
export function IqMeter({ value, label }: { value: number; label: string }) {
  const [shown, setShown] = useState(prefersReducedMotion() ? value : 0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    const duration = 1100;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      // Ease-out cubic: fast start, gentle landing.
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(eased * value));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  const offset = CIRCUMFERENCE * (1 - shown / 100);

  return (
    <div className="iq-meter" role="img" aria-label={`Football IQ ${value} מתוך 100, ${label}`}>
      <svg viewBox="0 0 160 160" className="iq-svg" aria-hidden="true">
        <defs>
          <linearGradient id="iq-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--pitch-green-bright)" />
            <stop offset="100%" stopColor="var(--gold)" />
          </linearGradient>
        </defs>
        <circle cx="80" cy="80" r={RADIUS} className="iq-track" />
        <circle
          cx="80"
          cy="80"
          r={RADIUS}
          className="iq-progress"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="iq-center">
        <span className="iq-label">Football IQ</span>
        <span className="iq-value">{shown}</span>
        <span className="iq-rank">{label}</span>
      </div>
    </div>
  );
}
