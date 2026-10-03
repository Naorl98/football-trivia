// The startup stage machine.
//
// WHY THIS EXISTS. "Sometimes the page is blank" is not actionable, and the
// reason it was not actionable is that nothing recorded how far a load got.
// index.html's boot layer knew about HTML_LOADED, JS_LOADED and REACT_MOUNTED,
// which is enough to tell a dead bundle from a dead render — but it could not
// tell a rendered page that was waiting on data from one that had finished, and
// APP_READY was declared and then never reached by anything.
//
// So the full sequence is here, in one module, with one rule: the last stage a
// load reached is the first thing to look at when it fails.
//
//   HTML_RECEIVED              the shell parsed          (index.html)
//   JS_STARTED                 the bundle evaluated      (main.tsx)
//   REACT_CREATE_ROOT          createRoot returned       (main.tsx)
//   REACT_MOUNTED              React put something up    (main.tsx)
//   ROUTER_READY               the router resolved a route (App)
//   BOOT_OVERLAY_REMOVED       the shell came down       (index.html / main.tsx)
//   HOME_RENDERED              the first route painted   (App)
//   STARTUP_REQUESTS_STARTED   the first API call went out
//   STARTUP_REQUESTS_FINISHED  the last one settled
//   APP_READY                  rendered, and nothing still loading
//
// TWO THINGS IT IS CAREFUL ABOUT.
//
// It never throws. Every public function is wrapped, because a diagnostic that
// can take down the page it is diagnosing is worse than no diagnostic — which
// is exactly the lesson of the consent bar's ResizeObserver.
//
// It never blocks rendering. Stages are *recorded*, not awaited. Nothing in the
// app reads a stage to decide whether to render; a route that is waiting on an
// optional request renders its own empty state and the stage machine simply
// notes that it is waiting. APP_READY is an observation, not a gate.
//
// WHAT IT DOES NOT RECORD: no URLs with user content, no storage contents, no
// room codes, no names, no tokens. Request ids are server-generated opaque
// values. The whole ring is capped and never transmitted anywhere.

export type StartupStage =
  | "HTML_RECEIVED"
  | "JS_STARTED"
  | "REACT_CREATE_ROOT"
  | "REACT_MOUNTED"
  | "ROUTER_READY"
  | "BOOT_OVERLAY_REMOVED"
  | "HOME_RENDERED"
  | "STARTUP_REQUESTS_STARTED"
  | "STARTUP_REQUESTS_FINISHED"
  | "APP_READY";

/**
 * Each stage with the time since navigation start.
 *
 * Adopts the array index.html already seeded with HTML_RECEIVED rather than
 * starting a fresh one, so the timeline covers the whole load — the first stage
 * happens before this module exists, and a second array would have lost it.
 */
const timeline: { stage: StartupStage; at: number }[] = (() => {
  try {
    const existing = window.__FIQ_TIMELINE__;
    if (Array.isArray(existing)) return existing as { stage: StartupStage; at: number }[];
  } catch {
    /* no boot layer, e.g. a test harness loading the bundle on its own */
  }
  return [];
})();

function now(): number {
  try {
    return Math.round(performance.now());
  } catch {
    return Date.now();
  }
}

export function markStage(stage: StartupStage): void {
  try {
    window.__FIQ_STAGE__ = stage;
    if (timeline.length < 40) timeline.push({ stage, at: now() });
    window.__FIQ_TIMELINE__ = timeline;
  } catch {
    /* a stage that cannot be recorded is not worth an exception */
  }
}

export function stageTimeline(): { stage: StartupStage; at: number }[] {
  return [...timeline];
}

// ------------------------------------------------------------- readiness

let routeRendered = false;
let inFlight = 0;
let everRequested = false;
let readyAnnounced = false;

/**
 * Decides whether APP_READY has been reached.
 *
 * "Rendered, and nothing still loading." The subtlety is the route that makes no
 * requests at all — the home page is one, deliberately — which must reach
 * APP_READY immediately rather than waiting forever for a request that is never
 * coming. So readiness is `routeRendered && inFlight === 0`, and the
 * STARTUP_REQUESTS stages are recorded only if there were any.
 */
function reconsider(): void {
  if (readyAnnounced) return;
  if (!routeRendered) return;
  if (inFlight > 0) return;

  if (everRequested) markStage("STARTUP_REQUESTS_FINISHED");
  readyAnnounced = true;
  markStage("APP_READY");
  try {
    window.__FIQ_READY__?.();
  } catch {
    /* the boot layer is optional from here on */
  }
}

/** Called once by the first route to paint. */
export function markRouteRendered(): void {
  try {
    if (routeRendered) return;
    routeRendered = true;
    markStage("HOME_RENDERED");
    reconsider();
  } catch {
    /* never let this be the failure */
  }
}

/**
 * Bracketed around every API call by the client in api.ts.
 *
 * The counter, rather than a boolean, is what makes a route that fires three
 * requests in parallel reach APP_READY once all three have settled instead of
 * when the first one does.
 */
export function requestStarted(): void {
  try {
    if (!everRequested) {
      everRequested = true;
      markStage("STARTUP_REQUESTS_STARTED");
    }
    inFlight += 1;
  } catch {
    /* ignore */
  }
}

export function requestFinished(): void {
  try {
    inFlight = Math.max(0, inFlight - 1);
    reconsider();
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------- request correlation

/**
 * The last few server request ids this page saw.
 *
 * The Worker stamps every response with `X-Request-Id` and logs the same value
 * against the path, status and duration. Holding them here is what turns "a
 * browser failed" into "this request failed, and here is the Worker's own record
 * of it" — which is the only way to tell a client problem from a server one
 * after the fact.
 *
 * Capped, and never sent anywhere. It is here to be read out of a session on a
 * device that misbehaved.
 */
const requestIds: { id: string; path: string; status: number; at: number }[] = [];

export function noteRequestId(path: string, status: number, id: string | null): void {
  try {
    if (!id) return;
    if (requestIds.length >= 25) requestIds.shift();
    requestIds.push({ id, path, status, at: now() });
    window.__FIQ_REQUEST_IDS__ = requestIds;
  } catch {
    /* ignore */
  }
}
