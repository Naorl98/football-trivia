import { useEffect, useState } from "react";
import "./Shout.css";

export type ShoutTone = "goal" | "fast" | "streak";

export interface ShoutMessage {
  /** Changes on every shout so the same text can fire twice in a row. */
  id: number;
  text: string;
  tone: ShoutTone;
}

/**
 * The short call-outs: GOAL!, מהיר!, and the streak names.
 *
 * Fixed over the board, purely decorative (`aria-hidden`) — everything it says
 * is already in the live region the quiz screen owns, so announcing it twice
 * would just be noise. It removes itself; nothing else has to clean it up.
 */
export function Shout({ message }: { message: ShoutMessage | null }) {
  const [visible, setVisible] = useState<ShoutMessage | null>(null);

  useEffect(() => {
    if (!message) return;
    setVisible(message);
    const timer = window.setTimeout(() => setVisible(null), 1100);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!visible) return null;

  return (
    <div className={`shout shout-${visible.tone} a-shout`} key={visible.id} aria-hidden="true">
      {visible.text}
    </div>
  );
}

/** The streak milestones that earn a call, with their Hebrew names. */
const STREAK_CALLS: Record<number, string> = {
  3: "שלושער!",
  5: "ברצף!",
  10: "בלתי ניתן לעצירה",
};

export function streakCall(streak: number): string | null {
  return STREAK_CALLS[streak] ?? null;
}

export function isStreakMilestone(streak: number): boolean {
  return streak in STREAK_CALLS;
}

/** Under this, a correct answer counts as "fast". */
export const FAST_ANSWER_MS = 3500;
