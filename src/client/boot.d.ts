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
    /** HTML_LOADED | JS_LOADED | REACT_MOUNTED | APP_READY. */
    __FIQ_STAGE__?: string;
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
