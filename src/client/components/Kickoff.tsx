import { useEffect, useState } from "react";
import { BallMark } from "./BallMark";
import { motionAllowed } from "../lib/a11y";
import "./Kickoff.css";

/** How long the flourish lasts, and when the curtain must be gone by. */
const LEAVE_AT_MS = 620;
const DONE_AT_MS = 940;

/**
 * The opening whistle, capped at one second.
 *
 * It exists to mark the transition into a run, not to be watched. It never
 * blocks the question underneath — the quiz renders immediately behind it and
 * the overlay is pointer-transparent — and it is skipped entirely under reduced
 * motion, where an unannounced full-screen flash is worse than no flourish.
 *
 * THIS COMPONENT CAUSED THE INTERMITTENT BLANK SCREEN, and the mechanism is
 * worth keeping written down because nothing about the two lines that did it
 * looked dangerous.
 *
 * The curtain is a 92%-opaque full-screen fixed element, and the only thing
 * that removed it was `setTimeout(onDone, 940)`. iOS suspends pending timers
 * for a page that is not visible. Tap play, and inside that one second switch
 * apps, lock the phone, or take a notification: the timers never fire, and on
 * return the curtain is still there, at full opacity, over a quiz that rendered
 * perfectly. Reproduced against production with timers frozen —
 *
 *     kickPresent: true, opacity 1, covers the viewport,
 *     #root text 322 chars, recoveryShown: false, watchdogSeesUsable: true
 *
 * — and it was invisible to every guard in the product, because
 * `pointer-events: none` makes `elementFromPoint` return the quiz input BEHIND
 * the curtain. The boot layer's hit test therefore concluded the app was
 * healthy while the screen was dark. Dark rather than white, content present in
 * the DOM, no recovery offered, only ever on a phone: every detail of the
 * reports that survived three startup fixes.
 *
 * SO TIME IS NOW READ, NOT COUNTED. A timer is a request to be called later; a
 * deadline is a fact that can be checked whenever. The timers stay for the
 * normal path because they are precise, and `visibilitychange` re-checks the
 * deadline the moment the page comes back — which is exactly when a suspended
 * timer has failed and is also exactly when it matters. The curtain's own CSS
 * animation (see Kickoff.css) is the floor under both, and removes it even if
 * no JavaScript runs again at all.
 */
export function Kickoff({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!motionAllowed()) {
      onDone();
      return;
    }

    const startedAt = Date.now();
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      onDone();
    };

    const out = window.setTimeout(() => setLeaving(true), LEAVE_AT_MS);
    const done = window.setTimeout(finish, DONE_AT_MS);

    /*
      The page became visible again. If the flourish was due to end while we
      were away, end it now rather than waiting for a timer that may have been
      dropped — and if it is genuinely still mid-animation, leave it alone.
    */
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= DONE_AT_MS) finish();
      else if (elapsed >= LEAVE_AT_MS) setLeaving(true);
    };

    document.addEventListener("visibilitychange", onVisible);
    // `pageshow` covers the back/forward cache, where a page can be restored
    // without `visibilitychange` ever firing.
    window.addEventListener("pageshow", onVisible);

    return () => {
      window.clearTimeout(out);
      window.clearTimeout(done);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
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
