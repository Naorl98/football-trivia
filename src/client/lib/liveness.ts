// Render and mount counters, and the boot layer's own dismissal record.
//
// WHY THIS EXISTS, AND WHY IT IS NOT A DEBUG-ONLY MODULE
//
// Three startup fixes have shipped for "the screen is sometimes blank on my
// phone" and the report keeps coming back. Every one of them was a real bug and
// none of them was the whole story, and the reason the loop has been so slow is
// that a blank screen on somebody's handset leaves nothing behind: by the time
// it is described, the evidence is a reload away from being gone.
//
// The one observation that has never been explained is the user's own: titles
// "visibly shaking/reloading". That is not a description of a page that failed
// to load. It is a description of a component mounting repeatedly, and a tree
// that remounts in a loop is blank for part of every cycle — which is a blank
// screen that appears and disappears without any error being thrown anywhere.
//
// Counting mounts is the only way to tell that apart from a slow load, so the
// counters ship. They cost one object and a handful of increments, they are
// read by scripts/blankscreen-qa.mjs, and they are what makes "it rendered
// twelve times in four seconds" a fact instead of an impression.
//
// NOTHING IDENTIFYING. Counts, component names and timings. No route content,
// no storage, no codes, no names.

export interface LivenessCounts {
  [key: string]: number;
}

const counts: LivenessCounts = Object.create(null);

function bump(key: string): void {
  try {
    counts[key] = (counts[key] ?? 0) + 1;
    window.__FIQ_COUNTS__ = counts;
  } catch {
    /* a counter is never worth an exception */
  }
}

/**
 * Counts a render of `name`.
 *
 * Called from the component body on purpose. A render is the thing that is
 * suspected of looping, and an effect would only count the ones that committed.
 */
export function countRender(name: string): void {
  bump(`${name}.render`);
}

/**
 * Counts a mount and an unmount of `name`.
 *
 * Returns the cleanup, so the call site is one line inside a `useEffect` with an
 * empty dependency array. An unmount count above zero for App, Router or the
 * home page is the signal: those three mount once in a healthy session, and in
 * React's StrictMode in development they mount twice and no more.
 */
export function countMount(name: string): () => void {
  bump(`${name}.mount`);
  return () => bump(`${name}.unmount`);
}

/**
 * When and why the boot overlay came down, recorded where a test can read it.
 *
 * The overlay is the one element in this product that is both opaque,
 * full-screen and OUTSIDE #root, so it is the only thing that can hide a
 * perfectly rendered app without React knowing. "Was it still up?" has been
 * guesswork in every previous investigation; this makes it a field.
 */
export function noteBootDismissed(reason: string): void {
  try {
    window.__FIQ_BOOT__ = {
      dismissed: true,
      reason: String(reason).slice(0, 80),
      at: Math.round(performance.now()),
    };
  } catch {
    /* ignore */
  }
}
