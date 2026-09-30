// The theatrical moments: kick-off, the duel VS intro, the match-found beat, the
// round verdict, the matchmaking radar and the VAR card.
//
// Every one of them obeys two rules:
//
//   1. REDUCED MOTION IS NOT A DEGRADED PATH. Each of these has a still version
//      that carries the same information. The VS intro becomes a team sheet, the
//      radar becomes a line of text, the round verdict stops sliding but still
//      says who took it. Nothing here is the only way to learn something.
//   2. NOTHING IS ONLY A SOUND OR ONLY AN ANIMATION. The countdown reads "3" as
//      text, the round verdict is in the live region, the VAR result is written
//      out. A muted phone loses nothing but atmosphere.

import { useEffect, useRef, useState } from "react";
import { COUNTDOWN_MS } from "../../../shared/multiplayer/constants";
import { motionAllowed } from "../../lib/a11y";
import { sound } from "../../lib/sound";
import { Icon } from "../Icon";
import { BallMark } from "../BallMark";

// ------------------------------------------------------------------ kick-off

/**
 * 3 · 2 · 1 · GO, driven by the server's deadline.
 *
 * Counting from a deadline rather than with a local timer means every player in
 * the room reaches "GO" at the same moment, whatever their round-trip time.
 */
export function Countdown({ deadlineAt }: { deadlineAt: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, deadlineAt - Date.now()));
  const lastTickRef = useRef<number | null>(null);

  useEffect(() => {
    const step = () => {
      const left = Math.max(0, deadlineAt - Date.now());
      setRemaining(left);
      const whole = Math.ceil(left / 1000);
      if (whole > 0 && whole <= 3 && lastTickRef.current !== whole) {
        lastTickRef.current = whole;
        sound.play("countdownTick");
      }
    };
    step();
    const timer = window.setInterval(step, 100);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);

  const seconds = Math.ceil(remaining / 1000);
  const shown = seconds > 3 ? 3 : seconds;

  return (
    <div className="mp-count" role="status" aria-live="assertive">
      <span key={shown} className={`mp-count-num num ${motionAllowed() ? "a-pop" : ""}`}>
        {shown > 0 ? shown : "GO"}
      </span>
      <span className="sr-only">{shown > 0 ? `מתחילים בעוד ${shown}` : "מתחילים"}</span>
    </div>
  );
}

/**
 * The full kick-off sequence: the VS intro (duels only) and then the count.
 *
 * Which half is on screen is derived from the remaining time rather than tracked
 * in state, so a player who reloads mid-intro drops straight into the right frame.
 */
export function KickoffSequence({
  deadlineAt,
  duel,
  names,
}: {
  deadlineAt: number;
  duel: boolean;
  names: string[];
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = Math.max(0, deadlineAt - now);
  const inIntro = duel && remaining > COUNTDOWN_MS;

  if (inIntro) return <DuelIntro left={names[0] ?? ""} right={names[1] ?? ""} />;
  return <Countdown deadlineAt={deadlineAt} />;
}

/**
 * The versus intro: two name plates arriving from the touchlines, a ball striking
 * the middle, and a flash of floodlight.
 *
 * Under reduced motion it renders as a still team sheet — the same two names, the
 * same VS, nothing moving. That is the point: the information here is "you two,
 * against each other", and that survives without the animation.
 */
export function DuelIntro({ left, right }: { left: string; right: string }) {
  const animate = motionAllowed();
  return (
    <div className={`mp-vs ${animate ? "is-animated" : ""}`} role="status" aria-live="polite">
      <div className="mp-vs-side mp-vs-left">
        <span className="mp-vs-shirt" aria-hidden="true">
          <Icon name="shirt" size={22} />
        </span>
        <span className="mp-vs-name">{left}</span>
      </div>

      <div className="mp-vs-mid" aria-hidden="true">
        {animate && (
          <span className="mp-vs-ball">
            <BallMark size={34} />
          </span>
        )}
        <span className="mp-vs-word">VS</span>
        {animate && <span className="mp-vs-flash" />}
      </div>

      <div className="mp-vs-side mp-vs-right">
        <span className="mp-vs-shirt" aria-hidden="true">
          <Icon name="shirt" size={22} />
        </span>
        <span className="mp-vs-name">{right}</span>
      </div>

      <span className="sr-only">
        {left} נגד {right}
      </span>
    </div>
  );
}

// ------------------------------------------------------------- match found

/** "נמצא יריב!" and who it is. Brief — the duel intro is next. */
export function MatchFound({ opponentName }: { opponentName: string }) {
  return (
    <div className="mp-found" role="status" aria-live="assertive">
      <p className={`mp-found-head ${motionAllowed() ? "a-pop" : ""}`}>נמצא יריב!</p>
      <p className="mp-found-name">{opponentName}</p>
      <span className="mp-found-ring" aria-hidden="true" />
    </div>
  );
}

// ------------------------------------------------------------ round verdict

/**
 * The round verdict banner.
 *
 * `tone` only changes the colour and the mark; the sentence is the server's, so
 * the language is decided in one place and cannot drift between screens.
 */
export function RoundVerdict({
  headline,
  tone,
}: {
  headline: string;
  tone: "won" | "lost" | "draw" | "none";
}) {
  const icon = tone === "won" ? "trophy" : tone === "draw" ? "shield" : tone === "lost" ? "boot" : "whistle";
  return (
    <div className={`mp-verdict mp-verdict-${tone} ${motionAllowed() ? "a-pop" : ""}`} role="status">
      <Icon name={icon} size={18} strokeWidth={2} />
      <span>{headline}</span>
    </div>
  );
}

/**
 * The short football call-outs: שלושער, מהפך, בלתי ניתן לעצירה.
 *
 * Purely decorative (`aria-hidden`) because everything it says is already in the
 * live region — announcing it twice would be noise, not emphasis.
 */
export function Callout({ text, id }: { text: string; id: number }) {
  const [visible, setVisible] = useState<{ text: string; id: number } | null>(null);

  useEffect(() => {
    if (!text) return;
    setVisible({ text, id });
    const timer = window.setTimeout(() => setVisible(null), 1200);
    return () => window.clearTimeout(timer);
  }, [text, id]);

  if (!visible) return null;
  return (
    <div key={visible.id} className="mp-callout a-shout" aria-hidden="true">
      {visible.text}
    </div>
  );
}

// ------------------------------------------------------- matchmaking radar

/**
 * The searching screen: a floodlight sweep across two empty VS slots, with the
 * copy rotating underneath.
 *
 * Not a spinner, because a spinner says "wait" and this should say "we are
 * looking". Under reduced motion the sweep is gone and the two slots and the copy
 * remain, which still reads as a search in progress.
 */
export function SearchingStage({ line, queueSize }: { line: string; queueSize: number }) {
  const animate = motionAllowed();
  return (
    <div className={`mp-search ${animate ? "is-animated" : ""}`}>
      <div className="mp-search-pitch" aria-hidden="true">
        <span className="mp-search-sweep" />
        <span className="mp-search-slot is-you">
          <Icon name="shirt" size={20} />
        </span>
        <span className="mp-search-word">VS</span>
        <span className="mp-search-slot is-empty">
          <span className="mp-search-qmark">?</span>
        </span>
        {animate && (
          <span className="mp-search-ball">
            <BallMark size={22} />
          </span>
        )}
      </div>

      <p className="mp-search-line" role="status" aria-live="polite">
        {line}
      </p>
      {queueSize > 1 && <p className="tiny mp-search-queue">{queueSize} שחקנים בתור</p>}
    </div>
  );
}

// ----------------------------------------------------------------- VAR card

/**
 * The VAR check, for a free-text answer that only passed on tolerance.
 *
 * It is shown during the reveal, which the server has already decided the length
 * of — so nothing is delayed to make room for it. That constraint matters: an
 * animation that added latency to a timed multiplayer round would be charging the
 * player for a flourish.
 */
export function VarStamp({ approved }: { approved: boolean }) {
  return (
    <div className={`mp-var ${approved ? "is-approved" : "is-rejected"}`} role="status">
      <span className="mp-var-scan" aria-hidden="true" />
      <span className="mp-var-text">{approved ? "VAR: מאושר!" : "VAR: לא אושר"}</span>
    </div>
  );
}
