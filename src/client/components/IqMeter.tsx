import { useEffect, useState } from "react";
import "./IqMeter.css";

/*
  A VU-meter, not a progress ring.

  The circular-gradient-donut is the single most reproduced chart in generated
  UI, so this draws the score the way a broadcast graphic or a studio level
  meter does: a 180° arc of individual tick marks, majors every ten, and a solid
  needle. Ticks below the score take ink; the rest stay faint. Nothing about it
  is a stroke-dashoffset animation.
*/

const CX = 100;
const CY = 112;
const R_OUTER = 92;
const TICKS = 41; // one every 2.5 points
const MAJOR_EVERY = 4; // → every 10 points

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Point on the gauge arc. 0 → far left, 100 → far right, sweeping over the top. */
function polar(value: number, radius: number) {
  const angle = (180 + (value / 100) * 180) * (Math.PI / 180);
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}

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
      // Ease-out cubic: fast start, gentle landing — the needle settles.
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(eased * value));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  const litTicks = Math.round((shown / 100) * (TICKS - 1));
  const needleTip = polar(shown, R_OUTER - 26);
  const needleBaseA = polar(Math.max(0, shown - 3.4), 15);
  const needleBaseB = polar(Math.min(100, shown + 3.4), 15);

  return (
    <figure className="iq" role="img" aria-label={`Football IQ ${value} מתוך 100 — ${label}`}>
      <svg viewBox="0 0 200 132" className="iq-svg" aria-hidden="true">
        {/* Tick arc. No axis numerals: the score is already set in 60px type in
            the middle of the dial, so 0/50/100 would only crowd it. */}
        {Array.from({ length: TICKS }, (_, i) => {
          const position = (i / (TICKS - 1)) * 100;
          const major = i % MAJOR_EVERY === 0;
          const inner = polar(position, R_OUTER - (major ? 17 : 10));
          const outer = polar(position, R_OUTER);
          const lit = i <= litTicks;
          // The last fifth of the scale is the "hot" end.
          const high = position >= 78;
          return (
            <line
              key={i}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              className={`iq-tick ${lit ? "is-lit" : ""} ${major ? "is-major" : ""} ${high ? "is-high" : ""}`}
            />
          );
        })}

        {/* Needle: a solid wedge, hinged on a printed pivot */}
        <polygon
          className="iq-needle"
          points={`${needleTip.x},${needleTip.y} ${needleBaseA.x},${needleBaseA.y} ${needleBaseB.x},${needleBaseB.y}`}
        />
        <circle cx={CX} cy={CY} r="7" className="iq-pivot" />
      </svg>

      <figcaption className="iq-readout">
        <span className="iq-value figures">{shown}</span>
        <span className="iq-unit label">Football IQ</span>
        <span className="iq-rank">{label}</span>
      </figcaption>
    </figure>
  );
}
