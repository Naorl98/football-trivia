import { useEffect, useRef, useState } from "react";
import "./StreakBadge.css";

// Milestones get a stronger visual beat than ordinary streak increments, so
// the indicator stays quiet during normal play.
const MILESTONES = [3, 5, 10, 15, 20];

export function StreakBadge({ streak }: { streak: number }) {
  const [pulsing, setPulsing] = useState(false);
  const previous = useRef(streak);

  useEffect(() => {
    if (streak > previous.current && MILESTONES.includes(streak)) {
      setPulsing(true);
      const timer = window.setTimeout(() => setPulsing(false), 900);
      previous.current = streak;
      return () => window.clearTimeout(timer);
    }
    previous.current = streak;
  }, [streak]);

  if (streak < 2) return null;

  return (
    <span className={`streak-badge ${pulsing ? "streak-milestone" : ""}`} aria-live="polite">
      <span aria-hidden="true">🔥</span>
      {streak} ברצף
    </span>
  );
}

export function isStreakMilestone(streak: number): boolean {
  return MILESTONES.includes(streak);
}
