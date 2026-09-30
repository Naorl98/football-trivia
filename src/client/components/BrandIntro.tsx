import { useEffect, useState } from "react";
import "./BrandIntro.css";

const SEEN_KEY = "fiq_intro_seen";
const DURATION = 1600;

function shouldSkip(): boolean {
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return true;
    // Returning visitors in the same session go straight to the app.
    return sessionStorage.getItem(SEEN_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Short brand entrance: a football rolls in, neural lines light up across it,
 * and the wordmark resolves. Capped at ~1.6s, dismissible by tap or key, shown
 * once per session, and skipped entirely under prefers-reduced-motion.
 */
export function BrandIntro() {
  const [visible, setVisible] = useState(() => !shouldSkip());
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    try {
      sessionStorage.setItem(SEEN_KEY, "true");
    } catch {
      // Non-essential.
    }
    const timer = window.setTimeout(() => setLeaving(true), DURATION);
    const done = window.setTimeout(() => setVisible(false), DURATION + 380);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(done);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const dismiss = () => {
      setLeaving(true);
      window.setTimeout(() => setVisible(false), 320);
    };
    window.addEventListener("keydown", dismiss, { once: true });
    window.addEventListener("pointerdown", dismiss, { once: true });
    return () => {
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("pointerdown", dismiss);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div className={`intro-overlay ${leaving ? "intro-leaving" : ""}`} aria-hidden="true">
      <div className="intro-stage">
        <svg className="intro-ball" viewBox="0 0 120 120">
          <defs>
            <radialGradient id="ball-shade" cx="35%" cy="30%">
              <stop offset="0%" stopColor="#2a332d" />
              <stop offset="100%" stopColor="#0c110e" />
            </radialGradient>
          </defs>
          <circle cx="60" cy="60" r="54" fill="url(#ball-shade)" stroke="var(--pitch-green)" strokeWidth="1.5" />
          {/* Neural web across the ball: nodes + links standing in for the "IQ". */}
          <g className="intro-net" stroke="var(--pitch-green-bright)" strokeWidth="1" fill="none">
            <path d="M60 14 L30 44 L42 84 L78 84 L90 44 Z" />
            <path d="M60 14 L60 44 M30 44 L60 44 M90 44 L60 44 M42 84 L60 44 M78 84 L60 44" />
            <path d="M30 44 L14 68 M90 44 L106 68 M42 84 L38 106 M78 84 L82 106" />
          </g>
          <g className="intro-nodes" fill="var(--gold-bright)">
            <circle cx="60" cy="14" r="3.4" />
            <circle cx="30" cy="44" r="3.4" />
            <circle cx="90" cy="44" r="3.4" />
            <circle cx="42" cy="84" r="3.4" />
            <circle cx="78" cy="84" r="3.4" />
            <circle cx="60" cy="44" r="4" />
          </g>
        </svg>
        <div className="intro-wordmark">
          Football <span className="text-green">IQ</span>
        </div>
      </div>
    </div>
  );
}
