// The handshake between index.html's boot layer and the app.
//
// These are set by the inline script in index.html, which runs before any module
// and has to keep running when a module fails to load at all. They are declared
// as optional throughout: a bundle may be opened in a context where that script
// did not run (a test harness, a future server-rendered shell), and the app must
// not depend on their presence.

interface FiqStartupError {
  kind: string;
  stage: string | null;
  route: string;
  message: string;
  stack: string;
  at: number;
}

declare global {
  interface Window {
    /** The last startup stage reached. See lib/startup.ts for the sequence. */
    __FIQ_STAGE__?: string;
    /** Every stage reached, with its time since navigation start. */
    __FIQ_TIMELINE__?: { stage: string; at: number }[];
    /** The last few server request ids, for correlating a failure with Worker logs. */
    __FIQ_REQUEST_IDS__?: { id: string; path: string; status: number; at: number }[];
    /** Bounded ring of startup failures, for diagnosis. Never leaves the page. */
    __FIQ_ERRORS__?: FiqStartupError[];
    /** Called once React has rendered: dismisses the shell and cancels the failsafe. */
    __FIQ_MOUNTED__?: () => void;
    /** Called once the first route has its data. Diagnostic only. */
    __FIQ_READY__?: () => void;
    /** Called by the error boundary, so the boot layer stops competing with it. */
    __FIQ_BOUNDARY__?: () => void;
  }
}

export {};
