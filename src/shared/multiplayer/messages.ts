// Trash-talk messages.
//
// A short, deliberately limited channel: a jibe between opponents, not a chat.
// Everything here is ephemeral — nothing is written to D1, nothing is replayed on
// reconnect, and nothing touches a score.
//
// The threat model is the same as for player names, plus one addition. A name is
// chosen once at the door and then shown as a label; a message is typed during a
// game, repeatedly, aimed at a specific opponent. So on top of the shared
// character policy there is a rate limit, a per-question ceiling, and a blocked
// list for the handful of words whose only purpose is abuse.

import { MESSAGE_MAX_LENGTH } from "./constants.ts";
import { sanitizeShortText } from "./names.ts";
import { QUICK_MESSAGE_TEXT, type QuickMessageId } from "./types.ts";

/**
 * Obvious abuse, blocked outright.
 *
 * Deliberately short. This is not moderation — a determined person routes around
 * any word list, and building a real one was explicitly not the job. It catches
 * the lazy case, which is most of it, and the length limit does the rest. Matching
 * is on a normalized, space-stripped form so "f u c k" and "ffuucckk" do not slip
 * through the gap a plain substring test leaves.
 */
const BLOCKED_FRAGMENTS = [
  "fuck", "shit", "bitch", "cunt", "nigg", "faggot", "retard", "rape",
  "מפגר", "זונה", "שרמוטה", "בן זונה", "תמות", "מזדיין",
];

/** Lowercased, de-spaced, de-duplicated-runs form used only for the block test. */
function abuseKey(text: string): string {
  const squashed = text
    .toLocaleLowerCase("he")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
  // Collapse a character repeated three or more times, so "shiiiit" reads as
  // "shit" without also mangling ordinary doubled letters.
  return squashed.replace(/(.)\1{2,}/gu, "$1");
}

export function containsBlockedLanguage(text: string): boolean {
  const key = abuseKey(text);
  const deduped = key.replace(/(.)\1+/gu, "$1");
  return BLOCKED_FRAGMENTS.some((word) => {
    const needle = abuseKey(word);
    return key.includes(needle) || deduped.includes(needle.replace(/(.)\1+/gu, "$1"));
  });
}

export type MessageRejection = "EMPTY" | "TOO_LONG" | "BLOCKED";

export interface MessageOutcome {
  text: string | null;
  rejection: MessageRejection | null;
}

/**
 * Resolves what a client asked to send into the text that may be broadcast.
 *
 * A preset is resolved from its id on the server, so the sentence on other
 * players' screens is one of ours whatever the client sent. Custom text is
 * sanitized and length-checked. Over-long text is refused rather than truncated:
 * silently cutting someone's sentence in half is worse than telling them it was
 * too long.
 */
export function resolveOutgoingMessage(input: {
  presetId?: string | null;
  text?: string | null;
}): MessageOutcome {
  if (input.presetId) {
    const preset = QUICK_MESSAGE_TEXT[input.presetId as QuickMessageId];
    return preset ? { text: preset, rejection: null } : { text: null, rejection: "EMPTY" };
  }

  if (typeof input.text !== "string") return { text: null, rejection: "EMPTY" };
  // Measured in code points, so an emoji counts as one character rather than two.
  if ([...input.text.trim()].length > MESSAGE_MAX_LENGTH) {
    return { text: null, rejection: "TOO_LONG" };
  }

  const cleaned = sanitizeShortText(input.text, MESSAGE_MAX_LENGTH);
  if (!cleaned) return { text: null, rejection: "EMPTY" };
  if (containsBlockedLanguage(cleaned)) return { text: null, rejection: "BLOCKED" };
  return { text: cleaned, rejection: null };
}
