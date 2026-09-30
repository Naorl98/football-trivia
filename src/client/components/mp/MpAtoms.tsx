// The small, reusable parts of the multiplayer surface: the room code slab, the
// QR, the phase clock, the connection badge, reactions, and the live region.
//
// They are grouped here because they are all "furniture" — every screen uses
// several of them and none of them owns a screen. The screens themselves
// (MultiplayerPage, RoomPage, DuelSearchPage, RoomDisplayPage) compose these.

import { useEffect, useMemo, useRef, useState } from "react";
import { REACTIONS, type ReactionEmoji } from "../../../shared/multiplayer/types";
import { formatRoomCode, roomJoinUrl } from "../../../shared/multiplayer/roomCode";
import { renderQr } from "../../lib/mp/qr";
import { motionAllowed } from "../../lib/a11y";
import { sound } from "../../lib/sound";
import { Icon } from "../Icon";
import type { LiveReaction } from "../../lib/mp/useRoom";
import "./mp.css";

// ------------------------------------------------------------------ QR code

/**
 * The room link as a QR.
 *
 * DARK MODULES ON A LIGHT PANEL, always — this is the one element in the product
 * that does not follow the dark theme, and it is not an oversight. A QR drawn in
 * the page's off-white ink on the navy ground is an INVERTED code, and a good
 * number of phone cameras (including the stock iOS scanner in poor light) simply
 * will not read one. A code that looks right and does not scan is worse than no
 * code, so the panel is light and the modules are the palette's deepest navy.
 *
 * Everything else is ours: one `<path>` of rounded modules rather than the
 * library's table or <img>, so it stays crisp at any size and sits on the
 * product's geometry.
 *
 * The label is the room code, not the URL: a screen-reader user does not want a
 * URL read out, they want the six digits they can type instead.
 */
export function QrCode({ url, code, size = 148 }: { url: string; code: string; size?: number }) {
  const qr = useMemo(() => renderQr(url), [url]);
  return (
    <svg
      className="mp-qr"
      width={size}
      height={size}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label={`קוד QR להצטרפות לחדר ${formatRoomCode(code)}`}
    >
      {/* The quiet zone is part of the code: the panel must extend past the
          modules or a scanner cannot find the finder patterns. */}
      <rect width={qr.size} height={qr.size} rx="1.5" fill="#f4f3ee" />
      <path d={qr.path} fill="#090f19" />
    </svg>
  );
}

// -------------------------------------------------------------- room code slab

/**
 * The scoreboard slab: the code in broadcast digits, the QR beside it, and the
 * two ways to pass it on.
 *
 * Native share is offered only when the browser actually has it, because a button
 * that silently does nothing is worse than one that is not there. Copy is always
 * available as the fallback that works everywhere.
 */
export function RoomCodePanel({ code, compact = false }: { code: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "" : roomJoinUrl(window.location.origin, code);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy() {
    sound.play("click");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the code is on screen either way.
      setCopied(false);
    }
  }

  async function share() {
    sound.play("click");
    try {
      await navigator.share({ title: "Football IQ", text: `בואו לשחק — קוד חדר ${formatRoomCode(code)}`, url });
    } catch {
      // A cancelled share sheet throws. Nothing to report.
    }
  }

  return (
    <div className={`mp-code ${compact ? "is-compact" : ""}`}>
      <div className="mp-code-main">
        <p className="mp-code-label tiny">קוד חדר</p>
        <p className="mp-code-digits num" aria-label={`קוד חדר ${code.split("").join(" ")}`}>
          {formatRoomCode(code)}
        </p>
        {!compact && (
          <div className="mp-code-actions">
            <button className="btn btn-ghost btn-sm" onClick={copy}>
              <Icon name={copied ? "check" : "share"} size={15} />
              {copied ? "הועתק" : "העתק קישור"}
            </button>
            {canShare && (
              <button className="btn btn-ghost btn-sm" onClick={share}>
                <Icon name="share" size={15} />
                שיתוף
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mp-code-qr">
        <QrCode url={url} code={code} size={compact ? 108 : 132} />
        <p className="tiny mp-code-scan">סרקו כדי להצטרף</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- the clock

/**
 * The phase clock.
 *
 * Driven by a deadline rather than by counting down locally: the server says when
 * the window shuts, and this only draws the gap. A tab that was backgrounded for
 * ten seconds therefore comes back showing the right number instead of ten
 * seconds behind.
 *
 * The ring is decorative; the seconds are the accessible content, and the warning
 * at five seconds is announced as well as sounded so it does not depend on audio.
 */
export function PhaseClock({
  deadlineAt,
  totalMs,
  label,
  onWarning,
}: {
  deadlineAt: number | null;
  totalMs: number;
  label?: string;
  onWarning?: () => void;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, (deadlineAt ?? 0) - Date.now()));
  const warnedRef = useRef(false);

  useEffect(() => {
    warnedRef.current = false;
  }, [deadlineAt]);

  useEffect(() => {
    if (deadlineAt === null) return;
    const step = () => {
      const left = Math.max(0, deadlineAt - Date.now());
      setRemaining(left);
      if (!warnedRef.current && left <= 5000 && left > 0) {
        warnedRef.current = true;
        sound.play("timeWarning");
        onWarning?.();
      }
    };
    step();
    const timer = window.setInterval(step, 120);
    return () => window.clearInterval(timer);
  }, [deadlineAt, onWarning]);

  if (deadlineAt === null) return null;

  const seconds = Math.ceil(remaining / 1000);
  const fraction = totalMs > 0 ? Math.max(0, Math.min(1, remaining / totalMs)) : 0;
  const urgent = remaining <= 5000;
  const circumference = 2 * Math.PI * 21;

  return (
    <div className={`mp-clock ${urgent ? "is-urgent" : ""}`} role="timer" aria-live="off">
      <svg viewBox="0 0 48 48" aria-hidden="true" className="mp-clock-ring">
        <circle cx="24" cy="24" r="21" className="mp-clock-track" />
        <circle
          cx="24"
          cy="24"
          r="21"
          className="mp-clock-fill"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          // No CSS transition under reduced motion: the value still steps, it just
          // does not glide.
          style={motionAllowed() ? undefined : { transition: "none" }}
        />
      </svg>
      <span className="mp-clock-num num">{seconds}</span>
      <span className="sr-only">{label ?? "זמן שנותר"}: {seconds} שניות</span>
    </div>
  );
}

// -------------------------------------------------------------- live region

/**
 * The one live region for a multiplayer screen.
 *
 * Everything that happens in a room happens to somebody else's screen too, so
 * without this a screen-reader user would simply not know that a player joined,
 * whose turn it is, or who took the round. `aria-live="polite"` rather than
 * assertive: these are running commentary, not alerts, and interrupting the
 * question being read would be worse than waiting a beat.
 */
export function Announcer({ message }: { message: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
}

// -------------------------------------------------------------- connection

/** "מתחבר מחדש…" — visible, because a silent stall looks like a broken game. */
export function ConnectionBadge({ status }: { status: "connecting" | "open" | "reconnecting" | "closed" }) {
  if (status === "open") return null;
  const copy =
    status === "connecting" ? "מתחבר…" : status === "reconnecting" ? "מתחבר מחדש…" : "החיבור נסגר";
  return (
    <p className={`mp-conn mp-conn-${status}`} role="status" aria-live="polite">
      <span className="mp-conn-dot" aria-hidden="true" />
      {copy}
    </p>
  );
}

// --------------------------------------------------------------- reactions

/**
 * The reaction row.
 *
 * Emoji are the label here, which is the one place in this product they are
 * allowed: they are the content the player is sending, not decoration standing in
 * for an icon. Each button therefore carries a real Hebrew name so the control is
 * usable without seeing the glyph.
 *
 * The server rate-limits these; this also disables the row for the cooldown so the
 * limit is visible rather than arriving as an error.
 */
export function ReactionBar({ onSend, disabled }: { onSend: (emoji: ReactionEmoji) => void; disabled?: boolean }) {
  const [cooling, setCooling] = useState(false);

  function fire(emoji: ReactionEmoji) {
    if (cooling || disabled) return;
    onSend(emoji);
    setCooling(true);
    window.setTimeout(() => setCooling(false), 3000);
  }

  return (
    <div className="mp-reactions" role="group" aria-label="תגובות מהירות">
      {REACTIONS.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          className="mp-reaction"
          onClick={() => fire(reaction.emoji)}
          disabled={cooling || disabled}
          aria-label={reaction.labelHe}
          title={reaction.labelHe}
        >
          <span aria-hidden="true">{reaction.emoji}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Reactions floating up the edge of the screen.
 *
 * Pinned to the inline edge and `pointer-events: none`, so a burst of them can
 * never cover the question or intercept a tap — which is the failure mode that
 * makes reaction features annoying. Under reduced motion they are not rendered at
 * all: the ReactionBar already reports them to the live region.
 */
export function ReactionBurst({ reactions }: { reactions: LiveReaction[] }) {
  if (!motionAllowed()) return null;
  return (
    <div className="mp-burst" aria-hidden="true">
      {reactions.slice(-4).map((reaction) => (
        <span key={reaction.key} className="mp-burst-item">
          {reaction.emoji}
        </span>
      ))}
    </div>
  );
}
