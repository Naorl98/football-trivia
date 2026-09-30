import { useEffect, useState } from "react";
import { BallMark } from "./BallMark";
import "./BrandIntro.css";

const SEEN_KEY = "fiq_intro_seen";
const DURATION = 1450;

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
 * The cover, before the programme opens.
 *
 * It is built from the same three moves the rest of the design uses — a rule
 * that draws itself, type that wipes in behind it, and the mark stamping down —
 * so the first 1.4s teaches the visual language instead of being a separate
 * splash animation. Once per session, skipped under reduced motion, and
 * dismissible by any key or tap.
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
    const done = window.setTimeout(() => setVisible(false), DURATION + 400);
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
    <div className={`cover ${leaving ? "is-leaving" : ""}`} aria-hidden="true">
      <div className="cover-plate">
        <p className="cover-kicker label">מבחן ידע · כדורגל</p>
        <span className="cover-rule" />
        <div className="cover-lockup">
          <span className="cover-mark">
            <BallMark size={58} />
          </span>
          <span className="cover-type">
            <span className="cover-word">FOOTBALL</span>
            <span className="cover-iq">IQ</span>
          </span>
        </div>
        <span className="cover-rule cover-rule-2" />
      </div>
    </div>
  );
}
